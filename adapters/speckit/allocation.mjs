import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectIdentity } from '../identity.mjs';
import { gitSource } from '../../validator/lib/sources.js';
import { loadConfig } from '../../validator/lib/records.js';
import { inventory, digest } from './files.mjs';
import { cleanEnvironment } from './runtime.mjs';

const REV = /^[a-f0-9]{40}$/;
export function taskIdsFromPaths(paths) {
  return [...new Set(paths.flatMap(p => {
    const match = p.match(/^docs\/workflow\/tasks\/(T-\d{4})\.md$/);
    return match ? [match[1]] : [];
  }))].sort();
}
export function validateAllocationSnapshot(snapshot, { repository, baseline, now = Date.now() }) {
  if (snapshot?.schema !== 'wf-speckit-allocation/v1' || snapshot.repository !== repository || snapshot.baseline !== baseline ||
      snapshot.complete !== true || snapshot.shallow !== false || !Array.isArray(snapshot.ids) ||
      snapshot.ids.some(id => !/^T-\d{4}$/.test(id)) || !Array.isArray(snapshot.pulls) ||
      snapshot.pulls.some(p => !Number.isSafeInteger(p.number) || p.number <= 0 || !REV.test(p.head) || p.available !== true) ||
      !Number.isFinite(snapshot.observed_at) || snapshot.observed_at > now || now - snapshot.observed_at > 60000)
    throw new Error('incomplete, stale or invalid allocation snapshot');
  return snapshot;
}
const pullsKey = pulls => pulls.map(p => ({ number: p.number, title: p.title, branch: p.head?.ref, head: p.head?.sha })).sort((a,b) => a.number - b.number);

// Always retrieves live data. A caller-written external JSON snapshot cannot
// supply freshness, complete pagination or availability by declaration alone.
export function collectAllocationSnapshot({ repo, baseline, expectedSnapshot, token = process.env.WF_WORKER_TOKEN }) {
  if (!REV.test(baseline)) throw new Error('exact baseline commit required');
  const source = gitSource(repo, baseline), config = loadConfig(source);
  if (source.isShallow()) throw new Error('task allocation requires full local history');
  if ((config.records_dir ?? 'docs/workflow') !== 'docs/workflow') throw new Error('adapter requires the native docs/workflow record root');
  const repository = config.repository, worker = config.approval?.agent_identity;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !worker || worker.toLowerCase() === repository.split('/')[0].toLowerCase()) throw new Error('baseline must name the separate worker identity and repository');
  if (!token) throw new Error('explicit worker token required; no owner fallback');
  const gitEnv = { ...cleanEnvironment(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: fileURLToPath(new URL('../worker-askpass.sh', import.meta.url)), WF_WORKER_TOKEN: token };
  const invoke = (tool, args, cwd, env) => {
    const r = spawnSync(tool, args, { cwd, env, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
    // Do not expose transport stderr, credentials or arbitrary remote output.
    if (r.error || r.status !== 0) throw new Error(`${tool} allocation retrieval failed`);
    return r.stdout;
  };
  const localGit = (...args) => invoke('git', ['--literal-pathspecs', ...args], repo, cleanEnvironment()).trim();
  const gh = (...args) => invoke('gh', args, os.tmpdir(), { ...cleanEnvironment(), GH_TOKEN: token, GITHUB_TOKEN: token, GH_HOST: 'github.com' });
  const transport = (...args) => invoke('git', ['-c', 'credential.helper=', ...args], os.tmpdir(), gitEnv).trim();
  const branch = localGit('branch', '--show-current');
  const identity = inspectIdentity({ expected: { repository, worker, branch }, token, run: (tool,args) => tool === 'gh' ? gh(...args) : args.includes('ls-remote') ? transport(...args) : localGit(...args) });
  if (!identity.ok) throw new Error(identity.errors.join('; '));
  const trustedBranch = config.trusted_branch ?? 'main';
  localGit('check-ref-format', `refs/heads/${trustedBranch}`);
  const endpoint = `repos/${repository}/pulls?state=open&per_page=100`;
  const getPulls = () => {
    const pages = JSON.parse(gh('api', '--paginate', '--slurp', endpoint));
    if (!Array.isArray(pages) || !pages.length || pages.some(p => !Array.isArray(p))) throw new Error('incomplete pull request pages');
    const pulls = pages.flat();
    if (new Set(pulls.map(p => p.number)).size !== pulls.length || pulls.some(p => !Number.isSafeInteger(p.number) || p.number <= 0 || !REV.test(p.head?.sha) || p.base?.repo?.full_name !== repository)) throw new Error('invalid pull request snapshot');
    return pulls;
  };
  const pulls = getPulls(), url = `https://github.com/${repository}.git`;
  const mirror = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-speckit-history-'));
  try {
    transport('init', '--bare', '-q', mirror);
    transport('-C', mirror, 'fetch', '--no-tags', url, `+refs/heads/${trustedBranch}:refs/heads/baseline`);
    const git = (...args) => transport('-C', mirror, '--literal-pathspecs', ...args);
    if (git('rev-parse', 'refs/heads/baseline') !== baseline) throw new Error('authoritative baseline moved; refresh the task plan');
    const revisions = [baseline];
    for (const pull of pulls) {
      const ref = `refs/wf-speckit/pulls/${pull.number}`;
      transport('-C', mirror, 'fetch', '--no-tags', url, `+refs/pull/${pull.number}/head:${ref}`);
      if (git('rev-parse', ref) !== pull.head.sha) throw new Error(`pull request ${pull.number} moved or is unavailable`);
      revisions.push(ref);
    }
    const paths = git('log', '--full-history', '--format=', '--name-only', '-z', ...revisions, '--', 'docs/workflow/tasks/').split('\0').map(s => s.replace(/^\n+/, '')).filter(Boolean);
    const ids = new Set([...taskIdsFromPaths(paths), ...taskIdsFromPaths(inventory(repo, 'docs/workflow/tasks'))]);
    const claims = transport('ls-remote', '--heads', url).split('\n').map(line => line.split(/\s+/)[1]?.replace('refs/heads/', '')).filter(Boolean);
    for (const label of [...claims, ...pulls.flatMap(p => [p.title, p.head.ref])]) {
      const match = label?.match(/^(?:codex\/)?(T-\d{4})(?:\b|-)/);
      if (match) ids.add(match[1]);
    }
    if (digest(pullsKey(getPulls())) !== digest(pullsKey(pulls))) throw new Error('pull requests changed during allocation; refresh before writing');
    if (!transport('ls-remote', url, `refs/heads/${trustedBranch}`).startsWith(`${baseline}\t`)) throw new Error('authoritative baseline moved during allocation');
    const snapshot = { schema: 'wf-speckit-allocation/v1', repository, baseline, complete: true, shallow: false, observed_at: Date.now(),
      ids: [...ids].sort(), pulls: pulls.map(p => ({ number: p.number, head: p.head.sha, available: true })).sort((a,b) => a.number-b.number) };
    if (expectedSnapshot) {
      validateAllocationSnapshot(expectedSnapshot, { repository, baseline });
      if (digest({ ids: snapshot.ids, pulls: snapshot.pulls }) !== digest({ ids: expectedSnapshot.ids, pulls: expectedSnapshot.pulls })) throw new Error('external allocation snapshot differs from current live state');
    }
    return snapshot;
  } finally { fs.rmSync(mirror, { recursive: true, force: true }); }
}
