#!/usr/bin/env node
// Read-only terminal identity preflight. It never changes global account settings.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
export function inspectIdentity({ expected, token, run }) {
  if (!token) return { ok: false, errors: ['explicit worker credential is missing; no owner fallback is permitted'] };
  const errors = [];
  try {
    if (!/^[\w.-]+\/[\w.-]+$/.test(expected.repository) || !expected.worker || !expected.branch) throw new Error('expected repository, worker and branch are required');
    const identity = JSON.parse(run('gh', ['api', 'user']));
    if (identity.login !== expected.worker) return { ok: false, errors: ['authenticated identity is not the expected worker'] };
    const repository = JSON.parse(run('gh', ['api', `repos/${expected.repository}`]));
    if (repository.full_name !== expected.repository || repository.owner?.type !== 'User' || repository.owner?.login !== expected.repository.split('/')[0]) errors.push('target repository is not owned by the expected personal account');
    const branch = run('git', ['branch', '--show-current']).trim();
    if (branch !== expected.branch) errors.push('current branch differs from the authorised target');
    const urls = run('git', ['remote', 'get-url', '--push', '--all', 'origin']).trim().split(/\r?\n/);
    if (urls.length !== 1) return { ok: false, errors: ['multiple Git push destinations require separate explicit authority'] };
    const remote = new URL(urls[0]);
    if (remote.protocol !== 'https:' || remote.hostname !== 'github.com' || remote.password || remote.pathname.replace(/^\//, '').replace(/\.git$/, '') !== expected.repository) errors.push('Git publishing target differs from the expected HTTPS repository');
    const refs = run('git', ['ls-remote', `https://github.com/${expected.repository}.git`, 'HEAD']);
    if (!/^[a-f0-9]{40,64}\s+HEAD/m.test(refs)) errors.push('worker Git route did not resolve the repository HEAD');
    return { ok: !errors.length, errors, repository: expected.repository, branch, api_user: identity.login, git_credential_user: identity.login, route: 'explicit-token HTTPS Git and gh', limitation: 'This read-only check proves identity and target, not push permissions, commit attribution, approval authority, or credential isolation.' };
  } catch { return { ok: false, errors: ['worker identity or repository route could not be verified; no fallback attempted'] }; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [repository, worker, branch] = process.argv.slice(2);
  const token = process.env.WF_WORKER_TOKEN;
  const run = (tool, args) => {
    const transport = tool === 'git' && args.includes('ls-remote');
    const env = { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token, GH_HOST: 'github.com', GIT_TERMINAL_PROMPT: '0' };
    if (transport) {
      // Run away from repository config. An empty credential helper plus a dedicated
      // askpass route cannot select the owner's stored credentials.
      Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0', GIT_ASKPASS: fileURLToPath(new URL('./worker-askpass.sh', import.meta.url)), WF_WORKER_TOKEN: token });
      for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_COMMON_DIR']) delete env[key];
    }
    const callArgs = transport ? ['-c', 'credential.helper=', ...args] : args;
    const result = spawnSync(tool, callArgs, { encoding: 'utf8', timeout: 30000, env, cwd: transport ? os.tmpdir() : process.cwd() });
    if (result.status !== 0) throw new Error('route failed');
    return result.stdout;
  };
  const result = inspectIdentity({ expected: { repository, worker, branch }, token, run });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
