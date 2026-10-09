#!/usr/bin/env node
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASK_BRANCH, WfError, listedOwners, classifyPaths, dirSource, evaluateCi, evaluateReadiness, gitSource, loadConfig, loadAll, list, validateRecords } from './lib/index.js';
import { cloneFilters, gitRunner, unsafePath, verifiedMirror } from './lib/git.js';
import { isAcceptanceTest } from './lib/paths.js';
import { createEnforcedTrust, createTrust } from './lib/trust.js';
import { evaluateAcceptance, pendingAcceptance } from './lib/acceptance.js';
import { evaluateLifecycle, evaluateSession } from './lib/lifecycle.js';
import { parseDeliveryEvidence } from './lib/delivery-evidence.js';
import { prepareReview } from './lib/review-packet.js';
import { checkDelivery } from './lib/delivery-check.js';
import { evaluateStatus, renderStatus } from './lib/status.js';
import { trustedBranchState, withDerivedBaselines } from './lib/derived.js';
import { evaluateCloseout } from './lib/closeout.js';
import { readPayloads, renderBrief } from './lib/brief.js';
import { runAttest } from './lib/attest.js';
import { evaluateNext, renderNext } from './lib/next.js';
import { evaluateClient, renderClient } from './lib/client.js';
const COMMANDS = ['records', 'readiness', 'paths', 'ci', 'acceptance', 'lifecycle', 'session', 'status', 'next', 'closeout', 'brief', 'attest', 'delivery-check', 'review-packet'];
const OPTIONS = ['repo', 'baseline', 'candidate', 'task', 'branch', 'changed', 'base', 'head', 'trust-key', 'receipts', 'repository', 'stage', 'record', 'expires-at', 'pull-requests', 'workflow-file', 'event', 'required-check', 'evidence', 'delivery-evidence', 'unsigned-receipts', 'payloads', 'out', 'sandbox', 'protect'];
const USAGE = `usage: wf <${COMMANDS.join('|')}> --baseline REV [--repo DIR] [--candidate REV]
  [--task T-0001] [--stage implement|verify|integrate|accept|release] [--trust-key FILE --receipts FILE --repository OWNER/REPO [--unsigned-receipts FILE]] [--json]
  --unsigned-receipts: a dry run of an unsigned round; a result that relies on one exits 3, never 0 (not authoritative)
  closeout --baseline TRUSTED_TIP --candidate ROUND_END + trust options: re-runs the round's gates, prints the fast-forward
  brief --payloads UNSIGNED_FILE [--repo DIR --baseline REV [--candidate ROUND_END]]: the owner's signing brief as Markdown (--json for the check)
  attest --baseline TRUSTED_TIP --candidate SHA --repository OWNER/REPO --expires-at ISO --out FILE (--sandbox LAUNCHER --protect PATH... | --unsandboxed):
    the owner's run of the approved config's checks from a verified mirror; writes unsigned verification and integration payloads
  next [--baseline TRUSTED_TIP] [--candidate REV] [--pull-requests FILE] [trust options]: the agent's next action, what to read and what to run (--json for data); grants nothing
  review-packet --baseline SHA --candidate SHA --task T-0001 --evidence EXTERNAL_FILE (repeatable); fresh canonical review inputs only
  delivery-check --repository OWNER/REPO --candidate SHA --workflow-file .github/workflows/ci.yml --branch main --required-check JOB [--event push]
  status [--baseline REV] [--candidate REV] [--pull-requests FILE] [trust options]: derived owner view as Markdown (--json for data); grants nothing
    status --client [--candidate REV]: the same records as one plain-language HTML page for a client (no IDs, people or reasons)
    with the trust options it also reports whether the local trusted branch has moved past approval
    FILE holds the JSON of: gh pr list --json number,title,headRefName,author,isDraft,isCrossRepository,reviewDecision
  ci: --delivery-evidence EXTERNAL_FILE (JSON, or a pull request description holding the marked block) is required for a
    production change in enforced and owner-merge modes
  Enforced and owner-merge modes (baseline config and profile both carry the label) need no trust options; manual mode needs all three.
  Directory sources and --changed are diagnostic inputs, not trusted integration evidence.`;
const git = (repo, ...args) => {
  const r = gitRunner(repo, { maxBuffer: 16 * 1024 * 1024, literal: false })(...args);
  if (r.status !== 0) throw new WfError(`git ${args[0]} failed: ${r.error?.message ?? r.stderr.trim()}`);
  return r.stdout;
};
async function main() {
  const o = { changed: [] };
  let cmd;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { o.json = true; continue; }
    if (a === '--unsandboxed') { o.unsandboxed = true; continue; }
    if (a === '--client') { o.client = true; continue; }
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (!OPTIONS.includes(name) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new WfError(`invalid option or missing value: ${a}`);
      const value = argv[++i];
      if (name === 'changed') o.changed.push(value);
      else if (['required-check', 'evidence', 'protect'].includes(name)) (o[name] ??= []).push(value);
      else if (o[name] !== undefined) throw new WfError(`duplicate option: ${a}`);
      else o[name] = value;
    } else if (!cmd) cmd = a;
    else throw new WfError(`unexpected argument: ${a}`);
  }
  if (o['delivery-evidence'] && cmd !== 'ci') throw new WfError('--delivery-evidence is only for ci');
  if (o.client && (cmd !== 'status' || o.json || o['pull-requests'] || o['trust-key'])) throw new WfError('--client is only for status, alone: it prints the client page as HTML');
  if (!COMMANDS.includes(cmd)) throw new WfError(USAGE);
  if (cmd === 'review-packet') {
    const result = prepareReview({ repo: path.resolve(o.repo ?? process.cwd()), baseline: o.baseline, candidate: o.candidate, tasks: o.task ? [o.task] : [], evidence: o.evidence });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (cmd === 'brief') {
    if (!o.payloads) throw new WfError('--payloads FILE is required');
    const file = path.resolve(o.payloads);
    const raw = fs.readFileSync(file, 'utf8');
    // With a repository, the brief reads a verified mirror of it (lib/git.js): not the clone's own objects or config.
    const mirror = o.repo ? verifiedMirror(o.repo) : null;
    try {
    const repo = mirror?.path ?? null;
    const sha = /^[0-9a-f]{40,64}$/;
    const run = repo ? gitRunner(repo) : null;
    const subject = repo ? rev => { if (!sha.test(rev ?? '')) return null; const r = run('show', '-s', '--no-show-signature', '--format=%s', rev, '--'); return r.status === 0 ? r.stdout.trim() : null; } : () => null;
    const mapped = repo ? rev => { if (!sha.test(rev ?? '')) return null; const r = run('cat-file', '-e', `${rev}:tests/acceptance-map.json`); if (r.status !== 0) return []; try { const v = JSON.parse(run('show', `${rev}:tests/acceptance-map.json`).stdout); return Array.isArray(v) ? v : null; } catch { return null; } } : null;
    let requiredChecks = null, changes = null, attestConfigured = false, pending = null;
    if (repo && o.baseline) {
      // Everything the round changes from the approved baseline to its end (--candidate, or the latest payload
      // revision), judged path by path by both configs, as a derived baseline judges it (lib/derived.js).
      const base = gitSource(repo, o.baseline);
      const configs = [loadConfig(base)];
      attestConfigured = configs[0].attest !== undefined;
      const rd = configs[0].records_dir ?? 'docs/workflow';
      requiredChecks = list(loadAll(base, rd).profile?.data?.required_checks);
      let payloads = [];
      try { payloads = readPayloads(raw); } catch { /* reported by the brief */ }
      const at = (purpose, x) => payloads.filter(p => p?.purpose === purpose && p.revision === x);
      const revisions = [...new Set(payloads.map(p => p?.revision).filter(r => sha.test(r ?? '')))];
      const contains = (older, newer) => { if (older === newer) return true; const r = run('merge-base', '--is-ancestor', older, newer); if (r.status > 1 || r.status === null) throw new WfError('git cannot compare the round\'s revisions'); return r.status === 0; };
      const latest = revisions.filter(r => revisions.every(x => contains(x, r)));
      const end = o.candidate ? gitSource(repo, o.candidate).name : latest.length === 1 ? latest[0] : null;
      if (!end || !contains(base.name, end) || revisions.some(x => !contains(x, end))) changes = { unknown: 'give --candidate ROUND_END: the payload revisions do not all lead to one revision after the baseline' };
      else {
        const tip = gitSource(repo, end);
        try { configs.push(loadConfig(tip)); } catch { /* the base config alone */ }
        const diff = (from, to) => { const r = run('diff-tree', '-r', '--no-renames', '--name-only', '-z', from, to, '--'); if (r.status !== 0) throw new WfError('git diff-tree failed'); return r.stdout.split('\0').filter(Boolean); };
        const after = new Map(revisions.map(x => [x, new Set(diff(x, end))]));
        const unchangedAt = (f, test) => revisions.some(x => !after.get(x).has(f) && test(x));
        const evidence = x => ['verification', 'review', 'integration'].every(purpose => at(purpose, x).length === 1);
        const listing = (purpose, f) => x => at(purpose, x).some(p => Array.isArray(p.paths) && p.paths.includes(f));
        const before = loadAll(base, rd).tasks, now = loadAll(tip, rd).tasks;
        // Mapped tests that may still fail, by the approved baseline (MAINT-0012): the round delivers the tasks Done at its
        // end and not at the baseline, and their own tests must pass. Without a round end every mapped test must.
        pending = pendingAcceptance(loadAll(base, rd), [...now.values()].map(r => r.data ?? {}).filter(t => t.status === 'Done' && before.get(t.id)?.data?.status !== 'Done').map(t => t.id));
        changes = { records: [], uncovered: [] };
        for (const f of diff(base.name, end)) {
          if (unsafePath(f)) { changes.uncovered.push([f, 'could pass for another path; never derived']); continue; }
          const categories = new Set(configs.map(c => classifyPaths(c, [f])[0].category));
          const record = f.startsWith(`${rd}/`) && /^(tasks|feedback\/inbox)\/[^/]+\.md$/.test(f.slice(rd.length + 1)) && [...categories].every(c => c === 'planning');
          if (record) {
            const id = f.slice(rd.length + 1).match(/^tasks\/(T-\d{4})\.md$/)?.[1];
            const was = before.get(id)?.data?.status ?? 'absent', is = now.get(id)?.data?.status ?? 'removed';
            changes.records.push(id ? (was === is ? `${id} (${is}) edited` : `${id} ${was} → ${is}`) : { path: f });
            continue;
          }
          for (const category of categories) {
            const ok = category === 'governing' ? unchangedAt(f, listing('governing-change', f))
              : category === 'enforcement' ? unchangedAt(f, listing('workflow-change', f))
              : ['production', 'generated'].includes(category) ? unchangedAt(f, evidence)
              : category === 'planning' ? unchangedAt(f, x => evidence(x) || listing('governing-change', f)(x) || listing('workflow-change', f)(x))
              : false;
            if (!ok) { changes.uncovered.push([f, category === 'unclassified' ? 'unclassified' : `${category}: needs ${category === 'governing' ? 'a governing-change listing it' : category === 'enforcement' ? 'a workflow-change listing it' : category === 'planning' ? 'an evidence set or a change payload listing it' : 'an evidence set'} at a revision where it has its final content`]); break; }
          }
          if (configs.some(c => isAcceptanceTest(c, f)) && !categories.has('governing') && !unchangedAt(f, listing('governing-change', f))) changes.uncovered.push([f, 'acceptance test: needs a governing-change listing it at a revision where it has its final content']);
        }
      }
    }
    const result = renderBrief({ file, raw, subject, mapped, requiredChecks, changes, attestConfigured, pending });
    if (o.json) console.log(JSON.stringify({ ok: result.ok, digest: result.digest, count: result.count, problems: result.problems }, null, 2));
    else process.stdout.write(result.markdown);
    return result.ok ? 0 : 1;
    } finally { mirror?.cleanup(); }
  }
  if (cmd === 'attest') {
    for (const k of ['baseline', 'candidate', 'repository', 'expires-at', 'out']) if (!o[k]) throw new WfError(`attest needs --${k}`);
    if (o['trust-key'] || o.receipts || o['unsigned-receipts']) throw new WfError('attest reads no key or receipts: it produces payloads for the owner to sign');
    if (o.unsandboxed && o.sandbox) throw new WfError('--unsandboxed cannot be combined with --sandbox');
    const repo = path.resolve(o.repo ?? process.cwd());
    const root = fs.realpathSync(repo);
    const outside = file => { const r = path.relative(root, file); return r === '..' || r.startsWith(`..${path.sep}`) || path.isAbsolute(r); };
    const out = path.resolve(o.out);
    if (!outside(path.dirname(out)) || fs.existsSync(out)) throw new WfError('--out must be a new file outside the repository, such as <round>-attest.json in the signing drop');
    const sandbox = o.sandbox ? fs.realpathSync(o.sandbox) : null;
    if (sandbox && (!outside(sandbox) || !fs.statSync(sandbox).isFile())) throw new WfError('--sandbox must be a launcher file outside the repository');
    const protect = (o.protect ?? []).map(p => path.resolve(p));
    // Config, profile and candidate come from a verified mirror (lib/git.js), never from the clone's own objects or config.
    const mirror = verifiedMirror(repo);
    try {
      const base = gitSource(mirror.path, o.baseline);
      const config = loadConfig(base);
      const requiredChecks = list(loadAll(base, config.records_dir ?? 'docs/workflow').profile?.data?.required_checks);
      const result = runAttest({ mirror: mirror.path, baseline: base.name, candidate: o.candidate, repository: o.repository, expiresAt: o['expires-at'], config, requiredChecks, sandbox, protect, unsandboxed: o.unsandboxed === true });
      const summary = { ok: result.ok, checks: result.checks ?? [], tests: { total: result.tests?.length ?? 0, passed: result.tests?.filter(t => t.status === 'passed').length ?? 0, failed: result.tests?.filter(t => t.status === 'failed').length ?? 0, skipped: result.tests?.filter(t => t.status === 'skipped').length ?? 0 }, notes: result.notes ?? [], sandboxed: result.sandboxed ?? !!sandbox };
      if (result.setupFailed) { console.log(JSON.stringify({ ...summary, ok: false, error: result.summary, setup_log: result.artifacts['setup.log'].slice(-4000) }, null, 2)); return 1; }
      const raw = `${JSON.stringify(result.payloads, null, 2)}\n`;
      fs.writeFileSync(out, raw, { mode: 0o600, flag: 'wx' });
      const digest = createHash('sha256').update(raw).digest('hex');
      console.log(JSON.stringify({ ...summary, file: out, sha256: digest, next: result.ok ? `sign it: wf-sign ${out} ${digest}` : 'do not sign: a check, a report or a mapped test failed; the payloads record what happened' , limitation: 'The checks are the candidate\'s own code; attest proves your machine ran them on this exact revision, not that they test enough.' }, null, 2));
      return result.ok ? 0 : 1;
    } finally { mirror.cleanup(); }
  }
  if (cmd === 'delivery-check') {
    const result = checkDelivery({ repository: o.repository, revision: o.candidate, workflow: o['workflow-file'], branch: o.branch, event: o.event, requiredChecks: o['required-check'] });
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }
  const repo = path.resolve(o.repo ?? process.cwd()); // Git calls find the real root themselves (lib/git.js)
  const source = spec => {
    const p = path.resolve(repo, spec);
    return fs.existsSync(p) && fs.statSync(p).isDirectory() ? dirSource(p) : gitSource(repo, spec);
  };
  if (!o.baseline && !['records', 'status', 'next'].includes(cmd)) throw new WfError('an explicit, freshly fetched --baseline is required');
  // `wf next` defaults its baseline to the local trusted branch, named by the working tree's config. Right after
  // bin/wf-adopt the adoption is not committed there yet: read the working tree then, and say so.
  let uncommitted = null;
  if (!o.baseline && cmd === 'next') {
    let branch = 'main', adopted = false;
    try { branch = loadConfig(dirSource(repo)).trusted_branch ?? 'main'; adopted = true; } catch { /* reported below */ }
    const tip = gitRunner(repo)('rev-parse', '--verify', '--quiet', '--end-of-options', `refs/heads/${branch}^{commit}`);
    if (tip.status === 0 && (!adopted || gitSource(repo, tip.stdout.trim()).read('docs/workflow/config.json') != null)) o.baseline = tip.stdout.trim();
    else if (adopted) uncommitted = `the adoption is not on ${branch} yet, so this reads the working tree: commit the scaffold (docs/workflow/, scripts/wf, AGENTS.md, CLAUDE.md, .github/, .gitignore) to ${branch}`;
  }
  if (o.candidate && o.head && o.candidate !== o.head) throw new WfError('--candidate and --head must agree');
  const baseline = o.baseline ? source(o.baseline) : dirSource(repo);
  const candidate = o.candidate || o.head ? source(o.candidate ?? o.head) : dirSource(repo);
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  if (process.env.WF_VALIDATOR_REV && config.workflow?.revision !== process.env.WF_VALIDATOR_REV) throw new WfError('running validator revision differs from the baseline adoption pin');
  let trust = null, baseTrust = null;
  if (o['unsigned-receipts'] && !o.receipts) throw new WfError('--unsigned-receipts is a dry run of a manual-mode round: it needs --trust-key, --receipts and --repository too');
  if (o['trust-key'] || o.receipts || o.repository) {
    if (!o['trust-key'] || !o.receipts || !o.repository) throw new WfError('trust requires --trust-key, --receipts and --repository together');
    if (baseline.kind !== 'git') throw new WfError(['status', 'next'].includes(cmd) ? `with the trust options, ${cmd} needs --baseline at an approved revision: the trusted branch is named by approved config, not the working tree` : 'approval requires an immutable Git baseline');
    const keyPath = fs.realpathSync(o['trust-key']);
    const relative = path.relative(fs.realpathSync(repo), keyPath);
    if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new WfError('owner trust key must be provisioned outside the candidate repository');
    const readArray = (file, what) => { const v = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(v)) throw new WfError(`${what} must be an array`); return v; };
    const envelopes = readArray(o.receipts, 'receipts');
    const unsigned = o['unsigned-receipts'] ? readArray(o['unsigned-receipts'], 'unsigned receipts') : [];
    // Derived baselines (lib/derived.js) apply only when the newest receipted baseline's config and the revision's own both enable them.
    baseTrust = createTrust({ publicKey: fs.readFileSync(keyPath, 'utf8'), repository: o.repository, envelopes, unsigned });
    trust = withDerivedBaselines(baseTrust, repo);
    if (config.repository !== o.repository) throw new WfError('repository identity differs from approved project config');
  }
  // The client page (MAINT-0008): plain-language progress as one HTML file, from the candidate's records.
  if (cmd === 'status' && o.client) {
    const date = candidate.kind === 'git' ? gitRunner(repo)('show', '-s', '--no-show-signature', '--format=%cI', candidate.name, '--') : null;
    process.stdout.write(renderClient(evaluateClient({ source: candidate, updated: date?.status === 0 ? date.stdout.trim() : new Date().toISOString() })));
    return 0;
  }
  // The derived view grants nothing. With the trust options it also reports a trusted branch that moved past approval.
  if (cmd === 'status') {
    let pullRequests = null;
    if (o['pull-requests']) {
      try { pullRequests = JSON.parse(fs.readFileSync(o['pull-requests'], 'utf8')); } catch (e) { throw new WfError(`--pull-requests: ${e.message}`); }
      if (!Array.isArray(pullRequests)) throw new WfError('--pull-requests: pull requests must be a JSON array');
    }
    const trustedBranch = trust ? trustedBranchState({ repo, branch: config.trusted_branch ?? 'main', trust }) : null;
    const view = evaluateStatus({ baseline, candidate, pullRequests, trustedBranch });
    console.log(o.json ? JSON.stringify(view, null, 2) : renderStatus(view));
    return 0;
  }
  if (cmd === 'next') {
    let pullRequests = null;
    if (o['pull-requests']) {
      try { pullRequests = JSON.parse(fs.readFileSync(o['pull-requests'], 'utf8')); } catch (e) { throw new WfError(`--pull-requests: ${e.message}`); }
      if (!Array.isArray(pullRequests)) throw new WfError('--pull-requests: pull requests must be a JSON array');
    }
    const trustedBranch = trust ? trustedBranchState({ repo, branch: config.trusted_branch ?? 'main', trust }) : null;
    const view = evaluateNext({ baseline, candidate, trustedBranch, pullRequests });
    if (uncommitted) view.note = uncommitted;
    console.log(o.json ? JSON.stringify(view, null, 2) : renderNext(view));
    return 0;
  }
  // Enforced mode: the baseline's own config and profile (both code-owner protected) record that GitHub
  // enforcement was verified at setup; the immutable baseline is then the approved baseline. Candidate copies of
  // these files are never consulted, so a candidate cannot switch modes; a directory baseline never qualifies.
  // Supplying the trust options runs the full receipt gate instead, exactly as in manual mode: no hybrid.
  // Owner-merge mode takes the same route, labelled as unprotected (lib/trust.js).
  const label = config.approval?.label;
  if (!trust && ['enforced', 'owner-merge'].includes(label) && baseline.kind === 'git') {
    const profileLabel = loadAll(baseline, rd).profile?.data?.approval_label;
    if (profileLabel !== label) throw new WfError('approval label differs between docs/workflow/config.json and the profile on the baseline');
    if (label === 'owner-merge' && listedOwners(loadAll(baseline, rd).profile?.data ?? {}).length) throw new WfError('owner-merge mode is for one owner: a project with owners uses manual or enforced mode (procedures/shared.md)');
    trust = createEnforcedTrust({ baseline: baseline.name, label });
  }
  const changed = () => {
    if (o.changed.length) {
      if (trust) throw new WfError('--changed cannot replace actual Git diff in a trusted gate');
      return o.changed;
    }
    if (o.base && o.head) {
      const base = gitSource(repo, o.base);
      if (base.name !== baseline.name) throw new WfError('--base must equal the authoritative baseline; a merge base does not establish authority');
    }
    if (baseline.kind !== 'git') throw new WfError('directory diagnostics require --changed PATH');
    if (candidate.kind === 'git') {
      if (!candidate.isAncestor(baseline.name)) throw new WfError('candidate must include the current authoritative baseline; assemble it before integration');
      return git(repo, 'diff-tree', '-r', '--no-renames', '--name-only', '-z', baseline.name, candidate.name, '--').split('\0').filter(Boolean);
    }
    // A working-tree comparison would run the clone's clean/process filters: refuse them, as review-packet does.
    const filters = cloneFilters(repo);
    if (filters.length) throw new WfError(`the clone configures its own filters (${filters.join(', ')}); compare a committed candidate instead`);
    return [...new Set([...git(repo, 'diff', '--no-renames', '--name-only', '-z', '--ignore-submodules=dirty', baseline.name, '--').split('\0'), ...git(repo, 'ls-files', '--others', '--exclude-standard', '-z').split('\0')].filter(Boolean))];
  };
  const taskId = () => {
    if (o.task) { if (!/^T-\d{4}$/.test(o.task)) throw new WfError('invalid task id'); return o.task; }
    let branch = o.branch;
    if (!branch) { try { branch = git(repo, 'branch', '--show-current').trim(); } catch { branch = ''; } }
    return branch.match(TASK_BRANCH)?.[1] ?? null;
  };
  const emit = r => console.log(o.json ? JSON.stringify(r, null, 2) : JSON.stringify(r, null, 2));
  let result;
  if (cmd === 'closeout') {
    if (!trust || trust.mode === 'enforced') throw new WfError(`closeout is for manual mode and needs --trust-key, --receipts and --repository; in ${trust?.label ?? 'enforced'} mode merging the pull request is the approval`);
    if (candidate.kind !== 'git') throw new WfError('closeout needs a committed --candidate: the revision the signed round ends at');
    // Closeout reads a verified mirror (lib/git.js): every object re-hashed, none of the clone's config, hooks or caches.
    // The local trusted branch and the printed fast-forward are the clone's own.
    const mirror = verifiedMirror(repo);
    try {
      const verified = withDerivedBaselines(baseTrust, mirror.path);
      const inMirror = rev => { try { return gitSource(mirror.path, rev); } catch (e) { throw new WfError(/invalid git revision/.test(e.message) ? `${rev.slice(0, 12)} is reachable from no branch or tag, so the verified mirror does not hold it: put the round's end on a branch` : e.message); } };
      result = evaluateCloseout({ repo: mirror.path, origin: repo, baseline: inMirror(baseline.name), candidate: inMirror(candidate.name), trust: verified });
    } finally { mirror.cleanup(); }
  }
  else if (cmd === 'records') result = validateRecords(candidate, rd);
  else if (cmd === 'paths') { const classes = classifyPaths(config, changed()); result = { ok: !classes.some(c => c.category === 'unclassified'), classes }; }
  else if (cmd === 'ci') {
    if (trust && candidate.kind !== 'git') throw new WfError('trusted integration requires a committed candidate');
    const paths = changed();
    // The agent's delivery evidence, required for a production change in the pull-request modes: JSON, a marked comment,
    // or a pull request description holding the marked block (lib/delivery-evidence.js).
    let deliveryEvidence = null;
    if (o['delivery-evidence']) {
      const file = fs.realpathSync(o['delivery-evidence']);
      const relative = path.relative(fs.realpathSync(repo), file);
      if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new WfError('delivery evidence must be outside the candidate checkout');
      if (!fs.statSync(file).isFile() || fs.statSync(file).size > 128 * 1024) throw new WfError('delivery evidence must be a regular file under 128 KiB');
      deliveryEvidence = parseDeliveryEvidence(fs.readFileSync(file, 'utf8'));
    }
    result = evaluateCi({ baseline, candidate, task: taskId(), trust, changed: paths, deliveryEvidence });
    const branchState = trustedBranchState({ repo, branch: config.trusted_branch ?? 'main', trust });
    if (branchState && !branchState.approved) result.findings.push(`note: the local trusted branch ${branchState.branch} is at ${branchState.tip.slice(0, 12)}, ${branchState.ahead ?? 'an unknown number of'} commit(s) past its newest baseline receipt${branchState.newest_receipt ? ` ${branchState.newest_receipt.slice(0, 12)}` : ''}, and that tip is not approved; keep work on a task branch and fast-forward only after closeout (procedures/execute.md)`);
  }
  else {
    const task = taskId();
    if (!task) throw new WfError('--task T-0001 or a matching branch is required');
    const readiness = evaluateReadiness({ baseline, candidate, task, trust, stage: o.stage });
    if (cmd === 'readiness') result = readiness;
    else {
      const record = loadAll(candidate, rd).tasks.get(task)?.data ?? {};
      const requiredChecks = list(loadAll(baseline, rd).profile?.data?.required_checks);
      const lifecycle = evaluateLifecycle({ candidate, task: record, requiredChecks, trust, stage: o.stage ?? 'verify' });
      const coverage = evaluateAcceptance({ baseline, candidate, task, execution: trust?.claim('verification', candidate.name)?.execution, requiredIds: list(record.acceptance), enforced: trust?.mode === 'enforced' && trust.label, pending: pendingAcceptance(loadAll(baseline, rd), [task]) });
      lifecycle.unverified = [...(lifecycle.unverified ?? []), ...(coverage.unverified ?? [])];
      if (!coverage.ok) { lifecycle.ok = false; lifecycle.errors.push(...coverage.errors); }
      if (cmd === 'acceptance') result = coverage;
      if (cmd === 'lifecycle') {
        const stage = o.stage ?? 'verify';
        const gate = evaluateReadiness({ baseline, candidate, task, trust, stage });
        result = { ...lifecycle, ok: lifecycle.ok && gate.outcome === 'Ready', readiness: gate };
      }
      if (cmd === 'session') {
        const completionGate = evaluateReadiness({ baseline, candidate, task, trust, stage: 'verify' });
        if (completionGate.outcome !== 'Ready') { lifecycle.ok = false; lifecycle.errors.push(...completionGate.reasons); }
        if (!o.record) throw new WfError('--record is required');
        result = evaluateSession({ record: JSON.parse(fs.readFileSync(o.record, 'utf8')), candidate, lifecycle, repository: o.repository ?? config.repository });
      }
    }
  }
  if (cmd === 'ci' && trust && candidate.kind !== 'git') throw new WfError('trusted integration requires a committed candidate');
  // A result that relied on an unsigned payload says so and exits 3: it is never satisfied, whatever it found.
  const provisional = trust?.provisional?.() ?? [];
  if (provisional.length) Object.assign(result, { authoritative: false, provisional });
  emit(result);
  let code;
  if (result.verdict) code = result.verdict === 'pass' ? 0 : 1;
  else if (result.outcome && cmd === 'readiness') code = result.outcome === 'Needs discovery or resolution' ? 1 : 0;
  else code = result.ok ? 0 : 1;
  return code === 0 && provisional.length ? 3 : code;
}
try { process.exitCode = await main(); } catch (e) { console.error(`wf: ${e.message}`); process.exitCode = 2; }
