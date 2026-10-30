#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASK_BRANCH, WfError, listedOwners, classifyPaths, dirSource, evaluateCi, evaluateReadiness, gitSource, loadConfig, loadAll, list, validateRecords } from './lib/index.js';
import { cloneFilters, gitRunner, unsafePath, verifiedMirror } from './lib/git.js';
import { isAcceptanceTest, recordsOnly } from './lib/paths.js';
import { createEnforcedTrust, createTrust } from './lib/trust.js';
import { evaluateAcceptance, ownerTests, pendingChange, pendingIn, pendingNote, testedIds } from './lib/acceptance.js';
import { evaluateLifecycle, evaluateSession } from './lib/lifecycle.js';
import { DELIVERY_MARKER, parseDeliveryEvidence } from './lib/delivery-evidence.js';
import { evidenceSkeleton } from './lib/evidence-skeleton.js';
import { parseAcceptanceEvidence } from './lib/acceptance-evidence.js';
import { prepareReview } from './lib/review-packet.js';
import { checkDelivery } from './lib/delivery-check.js';
import { evaluateStatus, renderStatus } from './lib/status.js';
import { trustedBranchState, withDerivedBaselines } from './lib/derived.js';
import { evaluateCloseout } from './lib/closeout.js';
import { readPayloads, renderBrief } from './lib/brief.js';
import { runAttest } from './lib/attest.js';
import { evaluateNext, renderNext, secondModelBudget } from './lib/next.js';
import { evaluateUsage, outcomeUsage, renderUsage, usageProject, usageWindow } from './lib/usage.js';
import { renderLeadBrief } from './lib/lead-brief.js';
import { renderAcceptanceBrief } from './lib/acceptance-brief.js';
import { resolveRoles, reviewLevel } from './lib/roles.js';
import { evaluateDoctor } from './lib/doctor.js';
import { decideReuse, formatMarker } from './lib/ci-reuse.js';
import { prune } from './lib/prune.js';
import { waitForCommit, waitForPullRequest, workflowRuns, WAIT_CEILING_SECONDS, CHECK_RUNS_SECONDS } from './lib/wait.js';
import { evaluateClient, renderClient } from './lib/client.js';
import { gitHistory } from './lib/client-history.js';
import { readBranches } from './lib/client-live.js';
const COMMANDS = ['records', 'readiness', 'paths', 'ci', 'pending', 'acceptance', 'lifecycle', 'session', 'status', 'next', 'closeout', 'brief', 'attest', 'delivery-check', 'review-packet', 'evidence', 'doctor', 'wait', 'done', 'prune', 'usage', 'reuse'];
const OPTIONS = ['repo', 'baseline', 'candidate', 'task', 'branch', 'changed', 'base', 'head', 'trust-key', 'receipts', 'repository', 'stage', 'record', 'expires-at', 'pull-requests', 'runs', 'workflow-file', 'event', 'required-check', 'evidence', 'delivery-evidence', 'unsigned-receipts', 'payloads', 'out', 'sandbox', 'protect', 'from', 'pr', 'implemented', 'timeout', 'commit', 'milestone', 'acceptance-evidence', 'claude-session', 'codex-dir', 'since', 'until', 'marker'];
const USAGE = `usage: wf <${COMMANDS.join('|')}> --baseline REV [--repo DIR] [--candidate REV]
  [--task T-0001] [--stage implement|verify|integrate|accept|release] [--trust-key FILE --receipts FILE --repository OWNER/REPO [--unsigned-receipts FILE]] [--json]
  --unsigned-receipts: a dry run of an unsigned round; a result that relies on one exits 3, never 0 (not authoritative)
  records [--json]: validates the project's records (tasks, milestones, decisions, profile) at --candidate
  readiness --task T-0001 [--stage implement|verify|integrate|accept|release]: whether the task may start work at the stage (Ready, or what must be resolved first)
  lifecycle --task T-0001 [--stage ...]: the task's lifecycle evidence for the stage, and the readiness gate it needs
  acceptance --task T-0001: whether every acceptance criterion the task names has a mapped test that passed or is pending
  session --record PATH [--task T-0001] [--repository OWNER/REPO]: validates a session outcome written from templates/session.json, outside the checkout; --task (or a task branch) is needed for a verified-complete outcome
  --help, -h: this usage (also after a command: wf session --help)
  closeout --baseline TRUSTED_TIP --candidate ROUND_END + trust options: re-runs the round's gates, prints the fast-forward
  pending --baseline REV --candidate REV [--task T-0001 | --branch NAME]: the mapped tests that may fail at the candidate, for a CI job that runs them
  brief --payloads UNSIGNED_FILE [--repo DIR --baseline REV [--candidate ROUND_END]]: the owner's signing brief as Markdown (--json for the check)
  brief --lead --task T-0001 [--baseline REV]: the task lead's brief, from the records (MAINT-0018)
  brief --acceptance --milestone M-0001 [--baseline REV]: the brief for the fresh helpers that close a milestone, from the records (MAINT-0020 P3)
  doctor: what this machine can do for the project's work (tools, access, the config's preflight checks); every gap goes in the next question to the owner (the plan's, when planning)
  wait --pr N [--merged] | --commit SHA [--timeout MINUTES]: waits for the pull request's (or a trusted-branch commit's) required checks to appear and finish (or, with --merged, for the pull request to merge)
    for at most ${WAIT_CEILING_SECONDS} s, or --timeout minutes (stay inside the five-minute prompt cache); exit 0 passed or merged, 1 failed, 4 still pending (the output's next is the command to run again)
  done --task T-0001 --implemented SHA: marks the task record Done in the working tree, for the pull request's last commit
  reuse --candidate SHA --emit | --marker TEXT: for a project's CI. --emit prints the marker (the candidate's tree and commit) a passing pull request run leaves on its head; with --marker (the marker found on the pull request that produced a push, or "none") prints reuse=true only when the pushed commit's tree is the tree the pull request passed on, else reuse=false and the reason on standard error (--json: both); grants nothing (v2.14.0)
  prune --milestone M-0001 [--dry-run]: one commit on the current branch, never the trusted branch, removing the Done task records of an Accepted or Released milestone, except those another record names
  usage [--claude-session SESSION.jsonl]... [--codex-dir DIR] [--since ISO] [--until ISO] [--task T-0001 [--outcome]] [--milestone M-0001 [--acceptance-evidence FILE]]: per agent, task and role, what the
    harnesses' own records say was used, and the second model's runs (against the milestone's budget with --milestone; with the acceptance evidence, a milestone review made in contiguous parts counts as one); --json for usage@1, --outcome for a session outcome's usage; grants nothing;
    runs from a full installation (the project's scripts/wf, or node validator/cli.js in a workflow checkout), not bin/wf, which extracts only validator/
  attest --baseline TRUSTED_TIP --candidate SHA --repository OWNER/REPO --expires-at ISO --out FILE (--sandbox LAUNCHER --protect PATH... | --unsandboxed):
    the owner's run of the approved config's checks from a verified mirror; writes unsigned verification and integration payloads
  next [--baseline TRUSTED_TIP] [--candidate REV] [--pull-requests FILE] [--check-runs | --runs FILE] [trust options]: the agent's next action, what to read and what to run (--json for data); grants nothing
    --check-runs reads the trusted branch's runs from GitHub (--runs FILE: JSON of commit hash to workflow runs) to name the baseline_result a claim may record when its baseline holds code already tested (MAINT-0023 P5)
  review-packet --baseline SHA --candidate SHA --task T-0001 --evidence EXTERNAL_FILE (repeatable); fresh canonical review inputs only
  evidence --baseline REV --candidate SHA [--task T-0001] [--from PREVIOUS_EVIDENCE]: the delivery evidence, started with what can be derived; fill in what you ran and the review
  delivery-check --repository OWNER/REPO --candidate SHA --workflow-file .github/workflows/ci.yml --branch main --required-check JOB [--event push]
  status [--baseline REV] [--candidate REV] [--pull-requests FILE] [trust options]: derived owner view as Markdown (--json for data); grants nothing
    status --client [--candidate REV] [--live [--pull-requests FILE]]: the same records as one plain-language HTML page for a client (no IDs, people or reasons); --live adds the parts moving on remote branches
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
    if (a === '--live') { o.live = true; continue; }
    if (a === '--lead') { o.lead = true; continue; }
    if (a === '--acceptance') { o.acceptance = true; continue; }
    if (a === '--merged') { o.merged = true; continue; }
    if (a === '--emit') { o.emit = true; continue; }
    if (a === '--dry-run') { o.dryRun = true; continue; }
    if (a === '--outcome') { o.outcome = true; continue; }
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a === '--check-runs') { o['check-runs'] = true; continue; }
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (!OPTIONS.includes(name) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new WfError(`invalid option or missing value: ${a}`);
      const value = argv[++i];
      if (name === 'changed') o.changed.push(value);
      else if (['required-check', 'evidence', 'protect', 'claude-session'].includes(name)) (o[name] ??= []).push(value);
      else if (o[name] !== undefined) throw new WfError(`duplicate option: ${a}`);
      else o[name] = value;
    } else if (!cmd) cmd = a;
    else throw new WfError(`unexpected argument: ${a}`);
  }
  // MAINT-0023 P9: the usage, on stdout and exit 0, for the whole tool or after a command; an unknown command still fails below.
  if (o.help) {
    if (cmd !== undefined && !COMMANDS.includes(cmd)) throw new WfError(USAGE);
    console.log(USAGE);
    return 0;
  }
  if ((o.emit || o.marker !== undefined) && cmd !== 'reuse') throw new WfError('--emit and --marker are only for reuse');
  if (o['delivery-evidence'] && cmd !== 'ci') throw new WfError('--delivery-evidence is only for ci');
  if (o['acceptance-evidence'] !== undefined && (cmd !== 'usage' || o.milestone === undefined)) throw new WfError('--acceptance-evidence is only for usage, with --milestone');
  if (o.client && (cmd !== 'status' || o.json || o['trust-key'])) throw new WfError('--client is only for status, without --json or the trust options: it prints the client page as HTML');
  if (o.live && !o.client) throw new WfError('--live is only for status --client');
  if ((o.dryRun && cmd !== 'prune') || (o.milestone !== undefined && !['prune', 'usage'].includes(cmd) && !(cmd === 'brief' && o.acceptance))) throw new WfError('--dry-run and --milestone are only for prune (--milestone also for usage and brief --acceptance)');
  if (o.acceptance && (cmd !== 'brief' || o.lead)) throw new WfError('--acceptance is only for brief, without --lead');
  if ((o.outcome || ['claude-session', 'codex-dir', 'since', 'until'].some(k => o[k] !== undefined)) && cmd !== 'usage') throw new WfError('--claude-session, --codex-dir, --since, --until and --outcome are only for usage');
  if ((o['check-runs'] || o.runs !== undefined) && cmd !== 'next') throw new WfError('--check-runs and --runs are only for next');
  if (o['check-runs'] && o.runs !== undefined) throw new WfError('use --check-runs or --runs FILE, not both');
  if (o.client && o['pull-requests'] && !o.live) throw new WfError('--pull-requests needs --live with --client: the pull requests only mark branch parts as being checked');
  if (!COMMANDS.includes(cmd)) throw new WfError(USAGE);
  if (cmd === 'review-packet') {
    const result = prepareReview({ repo: path.resolve(o.repo ?? process.cwd()), baseline: o.baseline, candidate: o.candidate, tasks: o.task ? [o.task] : [], evidence: o.evidence });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (cmd === 'brief' && !o.lead && !o.acceptance) {
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
    let requiredChecks = null, changes = null, attestConfigured = false, pending = null, needsBaseline = null, widened = [];
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
        // Mapped tests that may still fail at a payload's revision, as closeout's gate decides it for the task the round
        // implements there (MAINT-0012): pending by the approved baseline (closeout's trusted tip), the task's recorded
        // baseline_revision and that revision alike, with the task delivered. A revision no task of the round names as
        // implemented, or no round end, gets no pending tests.
        const baseRecords = loadAll(base, rd);
        if (ownerTests(configs[0])) pending = rev => {
          const tasks = [...now.values()].map(r => r.data ?? {}).filter(t => t.status === 'Done' && before.get(t.id)?.data?.status !== 'Done' && t.implemented === rev);
          if (tasks.length !== 1 || !sha.test(tasks[0].baseline_revision ?? '')) return null;
          try { return pendingIn([baseRecords, loadAll(gitSource(repo, tasks[0].baseline_revision), rd), loadAll(gitSource(repo, rev), rd)], [tasks[0].id]); } catch { return null; }
        };
        // A derived baseline never rests on evidence with a failing test, so after one the round needs an explicit baseline
        // where the next task of the round builds on it (later ones derive again), or, if none does, at the round's end.
        if (pending) needsBaseline = rev => {
          const later = [...new Set([...now.values()].map(r => r.data ?? {}).filter(t => t.status === 'Done' && before.get(t.id)?.data?.status !== 'Done' && t.implemented !== rev && sha.test(t.baseline_revision ?? '') && t.baseline_revision !== base.name && contains(rev, t.baseline_revision)).map(t => t.baseline_revision))];
          const nearest = later.filter(r => later.every(x => contains(r, x)));
          return later.length ? nearest : [end];
        };
        // What the round's records let fail that the baseline did not (MAINT-0012), for the owner's judgement.
        if (ownerTests(configs[0])) widened = pendingChange(baseRecords, loadAll(tip, rd), testedIds(base), testedIds(tip)).added.map(w => `${w.acceptance} for ${w.task}`);
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
    const result = renderBrief({ file, raw, subject, mapped, requiredChecks, changes, attestConfigured, pending, needsBaseline, widened });
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
  // MAINT-0020 P14: what the harnesses' own records say each agent used (lib/usage.js); it grants nothing and no gate reads it. A
  // reader per harness (adapters/usage/) is loaded only here, so a validator extracted alone (bin/wf) still runs every other command;
  // usage is no gate, so bin/wf is not changed to extract the readers (v2.9.0 review S1-3): it runs from a full installation.
  if (cmd === 'usage') {
    for (const k of ['since', 'until']) if (o[k] !== undefined && Number.isNaN(Date.parse(o[k]))) throw new WfError(`--${k} must be an ISO time, such as 2026-10-16T06:08:00Z`);
    if (o.task !== undefined && !/^T-\d{4}$/.test(o.task)) throw new WfError('usage --task needs T-0001');
    if (o.milestone !== undefined && !/^M-\d{4}$/.test(o.milestone)) throw new WfError('usage --milestone needs M-0001');
    if (o.outcome && !o.task) throw new WfError('usage --outcome needs --task T-0001: the block is that task\'s');
    if (!o['claude-session'] && !o.since) throw new WfError('usage needs --claude-session SESSION.jsonl, or --since ISO to count the second model\'s runs alone');
    // The project's config and records, from the working tree, when there is a project here: prices, IDs and the budget.
    const dir = path.resolve(o.repo ?? process.cwd()), here = dirSource(dir);
    const config = here.read('docs/workflow/config.json') == null ? null : loadConfig(here);
    const records = config ? loadAll(here, config.records_dir ?? 'docs/workflow') : null;
    // v2.9.0 final review S1: where this project is, so a second-model run is its own only when it ran there or, with no folder,
    // its first prompt names it (lib/usage.js projectOf, v2.9.0 final check A2): the repository and its worktrees (each as Git gives it and as its real path), the folder
    // names usage.folders allows, and the names config repository and the main worktree's folder give it. Outside Git, no folder.
    const listed = gitRunner(dir)('worktree', 'list', '--porcelain');
    const trees = listed.status === 0 ? listed.stdout.split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9)) : [];
    const real = p => { try { return fs.realpathSync(p); } catch { return p; } };
    const repository = typeof config?.repository === 'string' ? config.repository.trim() : '';
    const where = { folders: [...new Set(trees.flatMap(p => [p, real(p)]))], folder_names: config?.usage?.folders ?? [], names: [...new Set([repository, repository.split('/').pop(), trees.length ? path.basename(trees[0]) : ''].filter(Boolean))] };
    const readers = [['claude-session', 'claude-code.mjs', null], ['codex-dir', 'codex.mjs', path.join(os.homedir(), '.codex', 'sessions')]];
    const readings = [];
    for (const [option, file, fallback] of readers) {
      const paths = [o[option] ?? fallback].flat().filter(Boolean);
      if (!paths.length) continue;
      let reader;
      try { reader = await import(new URL(`../adapters/usage/${file}`, import.meta.url)); } catch (e) { throw new WfError(`usage needs adapters/usage/${file} of the workflow installation (run it from a full one: the project's scripts/wf, or node validator/cli.js in a workflow checkout; bin/wf extracts only validator/): ${e.message}`); }
      try { readings.push(reader.read(paths, { ...usageWindow(readings, o.since, o.until), names: where.names })); } catch (e) { throw new WfError(e.message); }
    }
    // MAINT-0023 P6: a milestone review made in parts is one review when the acceptance evidence's parts are a contiguous set, judged
    // by the acceptance evidence's own function (lib/acceptance-evidence.js reviewPartsErrors) against this repository's history.
    let reviewParts = null;
    if (o['acceptance-evidence'] !== undefined) {
      if (!config) throw new WfError('--acceptance-evidence needs the project\'s docs/workflow/config.json here');
      let stat, text;
      try { stat = fs.statSync(o['acceptance-evidence']); text = fs.readFileSync(o['acceptance-evidence'], 'utf8'); } catch (e) { throw new WfError(`cannot read the acceptance evidence ${o['acceptance-evidence']}: ${e.message}`); }
      if (!stat.isFile() || stat.size > 128 * 1024) throw new WfError('the acceptance evidence must be a regular file under 128 KiB');
      let found;
      try { found = text.trim().startsWith('{') ? JSON.parse(text) : parseAcceptanceEvidence(text); } catch (e) { throw new WfError(e instanceof WfError ? e.message : 'the acceptance evidence is not valid JSON'); }
      const review = found?.review;
      if (!review || review.parts === undefined) throw new WfError('the acceptance evidence has no review.parts to count');
      try { reviewParts = { parts: review.parts, revision: review.revision, milestone: o.milestone, recordsDir: config.records_dir ?? 'docs/workflow', candidate: gitSource(dir, o.candidate ?? 'HEAD'), baseline: o.baseline ? gitSource(dir, o.baseline) : null }; } catch (e) { throw new WfError(e.message); }
    }
    const result = evaluateUsage({ readings, reviewParts, since: o.since ?? null, until: o.until ?? null, task: o.task ?? null, milestone: o.milestone ?? null, prices: config?.usage?.prices ?? null, project: { ...usageProject(records, o.milestone), ...where }, budget: o.milestone && config ? secondModelBudget(config, records, [o.milestone])[0] ?? null : null, notes: config ? [] : ['no docs/workflow/config.json here: no prices or budget, and this project\'s runs are attributed to the IDs the transcripts name'] });
    if (o.outcome) console.log(JSON.stringify(outcomeUsage(result), null, 2));
    else if (o.json) console.log(JSON.stringify(result, null, 2));
    else process.stdout.write(renderUsage(result));
    return 0;
  }
  const repo = path.resolve(o.repo ?? process.cwd()); // Git calls find the real root themselves (lib/git.js)
  const source = spec => {
    const p = path.resolve(repo, spec);
    return fs.existsSync(p) && fs.statSync(p).isDirectory() ? dirSource(p) : gitSource(repo, spec);
  };
  if (!o.baseline && !['records', 'status', 'next', 'doctor', 'wait', 'done', 'prune', 'brief', 'reuse'].includes(cmd)) throw new WfError('an explicit, freshly fetched --baseline is required');
  // `wf next` defaults its baseline to the trusted branch named by the working tree's config. `git fetch` moves
  // origin/<branch>, never the local branch, so the newer of the two is read when one contains the other, and a note says
  // which (MAINT-0016). Right after bin/wf-adopt the adoption is not committed there yet: read the working tree then.
  let baselineNote = null;
  if (!o.baseline && ['next', 'doctor'].includes(cmd)) { // doctor runs the trusted branch's preflight, not a working-tree edit
    let branch = 'main', adopted = false;
    try { branch = loadConfig(dirSource(repo)).trusted_branch ?? 'main'; adopted = true; } catch { /* reported below */ }
    const run = gitRunner(repo);
    const tipOf = ref => { const r = run('rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`); return r.status === 0 ? r.stdout.trim() : null; };
    const contains = (older, newer) => run('merge-base', '--is-ancestor', older, newer).status === 0;
    const local = tipOf(`refs/heads/${branch}`), remote = tipOf(`refs/remotes/origin/${branch}`);
    let tip = local ?? remote;
    if (local && remote && local !== remote) {
      if (contains(local, remote)) { tip = remote; baselineNote = `the local ${branch} is behind origin/${branch}, so this reads origin/${branch} as last fetched; git fetch origin ${branch}:${branch} moves the local branch`; }
      else if (!contains(remote, local)) baselineNote = `the local ${branch} and origin/${branch} have diverged; this reads the local ${branch}`;
    }
    if (tip && (!adopted || gitSource(repo, tip).read('docs/workflow/config.json') != null)) o.baseline = tip;
    else if (adopted) baselineNote = `the adoption is not on ${branch} yet, so this reads the working tree: commit the scaffold (docs/workflow/, scripts/wf, AGENTS.md, CLAUDE.md, .github/, .gitignore) to ${branch}`;
  }
  if (o.candidate && o.head && o.candidate !== o.head) throw new WfError('--candidate and --head must agree');
  const baseline = o.baseline ? source(o.baseline) : dirSource(repo);
  const candidate = o.candidate || o.head ? source(o.candidate ?? o.head) : dirSource(repo);
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  if (process.env.WF_VALIDATOR_REV && config.workflow?.revision !== process.env.WF_VALIDATOR_REV) throw new WfError('running validator revision differs from the baseline adoption pin');
  // MAINT-0018 Part B: helpers that grant nothing and no gate reads. The lead's brief (B1), the start-of-session check
  // (B5), waiting on a pull request and the Done record (B6).
  if (cmd === 'brief' && o.acceptance) {
    if (!/^M-\d{4}$/.test(o.milestone ?? '')) throw new WfError('brief --acceptance needs --milestone M-0001');
    process.stdout.write(renderAcceptanceBrief({ baseline, candidate, milestone: o.milestone }));
    return 0;
  }
  if (cmd === 'brief') {
    if (!o.task || !/^T-\d{4}$/.test(o.task)) throw new WfError('brief --lead needs --task T-0001');
    process.stdout.write(renderLeadBrief({ baseline, candidate, task: o.task }));
    return 0;
  }
  if (cmd === 'doctor') {
    const result = evaluateDoctor({ config, repo });
    // Which config the preflight came from: the trusted branch's, or the working tree's right after adoption (fix review).
    result.config_from = baseline.kind === 'git' ? `the trusted branch at ${baseline.name.slice(0, 12)}` : 'the working tree (the trusted branch has no adopted config yet)';
    if (baselineNote) result.note = baselineNote;
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }
  if (cmd === 'reuse') {
    if (!/^[0-9a-f]{40,64}$/.test(o.candidate ?? '')) throw new WfError('reuse needs --candidate with a full commit SHA');
    if (o.baseline) throw new WfError('reuse takes no --baseline');
    if ((o.emit === true) === (o.marker !== undefined)) throw new WfError('reuse needs --emit or --marker TEXT, not both');
    const tip = gitSource(repo, o.candidate);
    const tree = tip.tree();
    if (o.emit) { console.log(formatMarker({ tree, merge: o.candidate })); return 0; }
    const decision = decideReuse({ candidate: { tree }, marker: o.marker });
    if (o.json) console.log(JSON.stringify(decision, null, 2));
    else { console.log(`reuse=${decision.reuse}`); process.stderr.write(`wf reuse: ${decision.reason}\n`); }
    return 0;
  }
  if (cmd === 'wait') {
    if ((o.pr === undefined) === (o.commit === undefined)) throw new WfError('wait needs --pr NUMBER or --commit SHA');
    if (o.pr !== undefined && !/^\d+$/.test(o.pr)) throw new WfError('wait needs --pr NUMBER');
    if (o.commit !== undefined && o.merged) throw new WfError('wait --commit has no --merged: a commit does not merge');
    if (o.commit !== undefined && !/^[0-9a-f]{40,64}$/.test(o.commit)) throw new WfError('wait --commit needs the full hash of the commit');
    if (!/^[\w.-]+\/[\w.-]+$/.test(config.repository ?? '')) throw new WfError('wait needs repository in docs/workflow/config.json');
    const interval = (process.env.WF_WAIT_INTERVAL ?? '') === '' ? 30 : Number(process.env.WF_WAIT_INTERVAL);
    if (!Number.isFinite(interval) || interval < 0) throw new WfError('WF_WAIT_INTERVAL must be a number of seconds');
    const minutes = o.timeout === undefined ? null : Number(o.timeout);
    if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0)) throw new WfError('--timeout must be a number of minutes');
    // The ceiling is injectable as the interval is (WF_WAIT_INTERVAL), so a test need not wait 270 s for `pending`.
    const ceiling = (process.env.WF_WAIT_CEILING ?? '') === '' ? WAIT_CEILING_SECONDS : Number(process.env.WF_WAIT_CEILING);
    if (!Number.isFinite(ceiling) || ceiling <= 0) throw new WfError('WF_WAIT_CEILING must be a number of seconds');
    const seconds = minutes === null ? ceiling : minutes * 60;
    // The checks a merge needs: the profile's, and `wf ci` in the pull-request modes (it runs on pull requests only, so
    // never for a commit). Their runs may not exist yet.
    const prMode = ['enforced', 'owner-merge'].includes(config.approval?.label);
    const profile = list(loadAll(baseline, rd).profile?.data?.required_checks);
    const result = o.commit !== undefined
      ? waitForCommit({ repository: config.repository, sha: o.commit, interval, seconds, required: [...new Set(profile)] })
      : waitForPullRequest({ repository: config.repository, number: o.pr, merged: o.merged === true, interval, seconds, required: [...new Set([...profile, ...(prMode ? ['wf ci'] : [])])] });
    // MAINT-0020 P12: still pending is neither a pass nor a failure: exit 4, and the exact command to run again.
    if (result.result === 'pending') result.next = ['wf wait', o.commit !== undefined ? `--commit ${o.commit}` : `--pr ${o.pr}`, o.merged ? '--merged' : '', minutes === null ? '' : `--timeout ${o.timeout}`].filter(Boolean).join(' ');
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : result.result === 'pending' ? 4 : 1;
  }
  if (cmd === 'done') {
    if (!o.task || !/^T-\d{4}$/.test(o.task)) throw new WfError('done needs --task T-0001');
    if (!/^[0-9a-f]{40,64}$/.test(o.implemented ?? '')) throw new WfError('done needs --implemented with the full hash of the commit that implements the task');
    const run = gitRunner(repo);
    if (run('cat-file', '-e', `${o.implemented}^{commit}`).status !== 0 || run('merge-base', '--is-ancestor', o.implemented, 'HEAD').status !== 0) throw new WfError(`${o.implemented.slice(0, 12)} is not a commit in this checkout's history`);
    const rel = `${rd}/tasks/${o.task}.md`;
    // Read through the working-tree source, which refuses a path that leaves the repository or passes a symbolic link.
    let text;
    try { text = dirSource(repo).read(rel); } catch (e) { throw new WfError(e.message); }
    if (text == null) throw new WfError(`${rel} not found`);
    const file = path.join(fs.realpathSync(repo), rel);
    const front = text.match(/^---\r?\n[\s\S]*?\r?\n---/)?.[0];
    const status = front?.match(/^status:[ \t]*(\S+)/m)?.[1];
    if (status === 'Done') throw new WfError(`${o.task} is Done already`);
    if (!['Ready', 'Active'].includes(status)) throw new WfError(`${o.task} is ${status ?? 'without a status'}: claim it (Ready or Active) in an earlier commit of this pull request first`);
    const eol = /\r\n/.test(front) ? '\r\n' : '\n';
    let next = front.replace(/^status:[^\r\n]*/m, 'status: Done');
    next = /^implemented:/m.test(next) ? next.replace(/^implemented:[^\r\n]*/m, `implemented: ${o.implemented}`) : next.replace(/^status: Done/m, `status: Done${eol}implemented: ${o.implemented}`);
    fs.writeFileSync(file, next + text.slice(front.length));
    console.log(JSON.stringify({ ok: true, path: rel, next: `git add ${rel} && git commit -m "${o.task}: Done"  (the last commit of the task's branch)` }, null, 2));
    return 0;
  }
  // MAINT-0020 P8: the Done task records of an accepted milestone, removed by one commit that names them (lib/prune.js).
  if (cmd === 'prune') {
    if (!/^M-\d{4}$/.test(o.milestone ?? '')) throw new WfError('prune needs --milestone M-0001');
    if (o.baseline || o.candidate || o.head) throw new WfError('prune reads the working tree and commits to the current branch: it takes no --baseline or --candidate');
    console.log(JSON.stringify(prune({ repo, rd, all: loadAll(dirSource(repo), rd), milestone: o.milestone, dryRun: o.dryRun === true, trustedBranch: config.trusted_branch ?? 'main' }), null, 2));
    return 0;
  }
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
    const isGit = candidate.kind === 'git';
    const date = isGit ? gitRunner(repo)('show', '-s', '--no-show-signature', '--format=%cI', candidate.name, '--') : null;
    let pullRequests = null;
    if (o['pull-requests']) {
      try { pullRequests = JSON.parse(fs.readFileSync(o['pull-requests'], 'utf8')); } catch (e) { throw new WfError(`--pull-requests: ${e.message}`); }
      if (!Array.isArray(pullRequests)) throw new WfError('--pull-requests: pull requests must be a JSON array');
    }
    // History and branches need Git: a directory source renders from the working tree alone.
    const history = isGit ? gitHistory(repo, candidate.name, rd) : null;
    const live = o.live && isGit ? readBranches({ repo, base: candidate.name, trustedBranch: config.trusted_branch ?? 'main', recordsDir: rd, pullRequests }) : null;
    let view;
    try { view = evaluateClient({ source: candidate, updated: date?.status === 0 ? date.stdout.trim() : new Date().toISOString(), history, live }); } catch (e) { throw new WfError(e.message); }
    for (const w of view.warnings) process.stderr.write(`wf status --client: ${w}\n`);
    process.stdout.write(renderClient(view));
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
    // A finished milestone's removed task records come back from Git history; a working-tree source has none.
    const history = candidate.kind === 'git' ? gitHistory(repo, candidate.name, rd) : null;
    const view = evaluateStatus({ baseline, candidate, pullRequests, trustedBranch, history });
    console.log(o.json ? JSON.stringify(view, null, 2) : renderStatus(view));
    if (history?.warnings.length) process.stderr.write('wf status: history could not be read from Git; the tasks of finished milestones may be missing\n');
    return 0;
  }
  if (cmd === 'next') {
    let pullRequests = null;
    if (o['pull-requests']) {
      try { pullRequests = JSON.parse(fs.readFileSync(o['pull-requests'], 'utf8')); } catch (e) { throw new WfError(`--pull-requests: ${e.message}`); }
      if (!Array.isArray(pullRequests)) throw new WfError('--pull-requests: pull requests must be a JSON array');
    }
    const trustedBranch = trust ? trustedBranchState({ repo, branch: config.trusted_branch ?? 'main', trust }) : null;
    // MAINT-0023 P5: the runs behind a baseline_result, from a file ({"<sha>": [workflow runs]}) or, with --check-runs, from GitHub.
    let runsFor = null;
    if (o.runs) {
      let runs; try { runs = JSON.parse(fs.readFileSync(o.runs, 'utf8')); } catch (e) { throw new WfError(`--runs: ${e.message}`); }
      if (!runs || typeof runs !== 'object' || Array.isArray(runs)) throw new WfError('--runs: runs must be a JSON object of commit hash to workflow runs');
      runsFor = sha => runs[sha] ?? [];
    } else if (o['check-runs']) {
      if (!/^[\w.-]+\/[\w.-]+$/.test(config.repository ?? '')) throw new WfError('--check-runs needs repository in docs/workflow/config.json');
      const deadline = Date.now() + CHECK_RUNS_SECONDS * 1000; // one allowance for every commit read, not one per call
      runsFor = sha => workflowRuns({ repository: config.repository, sha, deadline });
    }
    const view = evaluateNext({ baseline, candidate, trustedBranch, pullRequests, latestRelease: process.env.WF_LATEST_RELEASE || null, runsFor });
    if (baselineNote) view.note = baselineNote;
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
  // MAINT-0023 P9: what `wf session` accepts, named in each error (it was `--record is required`, and a bare ENOENT or JSON.parse message).
  const sessionRecord = () => {
    if (!o.record) throw new WfError('session needs --record PATH: a session outcome written from templates/session.json, outside the checkout (and --task T-0001, or a task branch, for a verified-complete outcome)');
    let text;
    try { text = fs.readFileSync(o.record, 'utf8'); } catch (e) { throw new WfError(`session --record ${o.record} cannot be read (${e.code ?? e.message}): write the outcome from templates/session.json outside the checkout and give its path`); }
    try { return JSON.parse(text); } catch (e) { throw new WfError(`session --record ${o.record} cannot be read as JSON (${e.message}): write the outcome from templates/session.json`); }
  };
  const emit = r => console.log(o.json ? JSON.stringify(r, null, 2) : JSON.stringify(r, null, 2));
  // MAINT-0018: the workflow pins a session may have run under, the baseline's and the candidate's.
  const sessionPins = () => [config.workflow, (() => { try { return loadConfig(candidate).workflow; } catch { return null; } })()];
  // MAINT-0016: the delivery evidence, started (lib/evidence-skeleton.js). It grants nothing; `wf ci` checks the result.
  if (cmd === 'evidence') {
    if (baseline.kind !== 'git' || candidate.kind !== 'git' || !(o.candidate || o.head)) throw new WfError('evidence needs --baseline and --candidate as Git revisions');
    const task = taskId();
    if (!task) throw new WfError('--task T-0001 or a matching branch is required');
    const previous = o.from ? parseDeliveryEvidence(fs.readFileSync(o.from, 'utf8')) : null;
    const { evidence, notes } = evidenceSkeleton({ baseline, candidate, task, previous });
    for (const n of notes) console.error(`wf: ${n}`);
    console.log(o.json ? JSON.stringify(evidence, null, 2) : `${DELIVERY_MARKER}\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\``);
    return 0;
  }
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
  // The mapped tests that may fail at this candidate, as ci decides it (MAINT-0012): a project's acceptance job reads it
  // and fails on any other mapped test, so that job can stay a required check. It reads; it grants nothing.
  else if (cmd === 'pending') {
    const delivered = taskId(); // --task, or the task its branch names (--branch in CI), as ci takes it
    const waiting = ownerTests(config) ? pendingIn([loadAll(baseline, rd), loadAll(candidate, rd)], delivered ? [delivered] : []) : new Map();
    // An unreadable map, or one the baseline had and the candidate lost, lists nothing to check: refuse it, as ci does.
    const raw = candidate.read('tests/acceptance-map.json');
    if (raw == null && baseline.read('tests/acceptance-map.json') != null) throw new WfError('tests/acceptance-map.json is missing at the candidate but present on the baseline');
    let map;
    try { map = JSON.parse(raw ?? '[]'); } catch { map = null; }
    if (!Array.isArray(map)) throw new WfError('tests/acceptance-map.json at the candidate is not a JSON array of mappings');
    // The map must pass the gate's own checks first (acceptance.js): no required mapping lost or moved to another
    // scenario, no unknown scenario or missing test file, the delivered task's automated scenarios covered.
    const mapCheck = evaluateAcceptance({ baseline, candidate, task: delivered, requiredIds: delivered ? list(loadAll(candidate, rd).tasks.get(delivered)?.data?.acceptance) : [], enforced: 'pending' });
    if (mapCheck.errors.length) throw new WfError(`the candidate's acceptance map fails the gate: ${mapCheck.errors.join('; ')}`);
    // A test may fail only when every scenario it is mapped to is pending; `required` lists every other mapped test.
    const same = (a, b) => a?.file === b?.file && a?.name === b?.name;
    const mayFail = m => map.filter(x => same(x, m)).every(x => waiting.has(x?.acceptance));
    const entry = m => ({ acceptance: m.acceptance, file: m.file, name: m.name });
    result = { ok: true, delivered, pending: map.filter(mayFail).map(m => ({ ...entry(m), waiting: waiting.get(m.acceptance) })), required: map.filter(m => !mayFail(m)).map(entry) };
  }
  else if (cmd === 'paths') {
    const classes = classifyPaths(config, changed());
    // MAINT-0017 A3: a project's CI may skip its product steps on planning_only (delivery.md); empty or unclassified is never.
    // v2.14.0: records_only also counts milestone and decision records (lib/paths.js), which planning_only never did.
    result = { ok: !classes.some(c => c.category === 'unclassified'), planning_only: classes.length > 0 && classes.every(c => c.category === 'planning'), records_only: recordsOnly(config, changed()), classes };
  }
  else if (cmd === 'ci') {
    if (trust && candidate.kind !== 'git') throw new WfError('trusted integration requires a committed candidate');
    const paths = changed();
    // The agent's delivery evidence, required for a production change in the pull-request modes: JSON, a marked comment,
    // or a pull request description holding the marked block (lib/delivery-evidence.js).
    let deliveryEvidence = null, acceptanceEvidence = null;
    if (o['delivery-evidence']) {
      const file = fs.realpathSync(o['delivery-evidence']);
      const relative = path.relative(fs.realpathSync(repo), file);
      if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new WfError('delivery evidence must be outside the candidate checkout');
      if (!fs.statSync(file).isFile() || fs.statSync(file).size > 128 * 1024) throw new WfError('delivery evidence must be a regular file under 128 KiB');
      const text = fs.readFileSync(file, 'utf8');
      deliveryEvidence = parseDeliveryEvidence(text);
      acceptanceEvidence = parseAcceptanceEvidence(text);
      // A file holding only the acceptance evidence's JSON reads as delivery evidence's raw form: move it over.
      if (deliveryEvidence?.schema === 'agent-workflow/acceptance-evidence@1') { acceptanceEvidence = deliveryEvidence; deliveryEvidence = null; }
    }
    result = evaluateCi({ baseline, candidate, task: taskId(), trust, changed: paths, deliveryEvidence, acceptanceEvidence, autoMerge: process.env.WF_PR_AUTO_MERGE === 'on' });
    const branchState = trustedBranchState({ repo, branch: config.trusted_branch ?? 'main', trust });
    if (branchState && !branchState.approved) result.findings.push(`note: the local trusted branch ${branchState.branch} is at ${branchState.tip.slice(0, 12)}, ${branchState.ahead ?? 'an unknown number of'} commit(s) past its newest baseline receipt${branchState.newest_receipt ? ` ${branchState.newest_receipt.slice(0, 12)}` : ''}, and that tip is not approved; keep work on a task branch and fast-forward only after closeout (procedures/execute.md)`);
  }
  else if (cmd === 'session' && !taskId()) {
    // MAINT-0018: an outcome that is not verified-complete reads no task evidence, so a session that ends on an acceptance
    // or planning pull request needs no task to name.
    result = evaluateSession({ record: sessionRecord(), candidate, lifecycle: null, repository: o.repository ?? config.repository, workflow: sessionPins(), roles: resolveRoles(config) });
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
      const coverage = evaluateAcceptance({ baseline, candidate, task, execution: trust?.claim('verification', candidate.name)?.execution, requiredIds: list(record.acceptance), enforced: trust?.mode === 'enforced' && trust.label, pending: ownerTests(config) ? pendingIn([loadAll(baseline, rd), loadAll(candidate, rd)], [task]) : new Map() });
      lifecycle.unverified = [...(lifecycle.unverified ?? []), ...(coverage.unverified ?? [])];
      // Pending tests that did not pass are named, as ci names them (MAINT-0012).
      coverage.notes = (coverage.pending ?? []).map(pendingNote);
      lifecycle.notes = [...(lifecycle.notes ?? []), ...coverage.notes];
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
        result = evaluateSession({ record: sessionRecord(), candidate, lifecycle, repository: o.repository ?? config.repository, workflow: sessionPins(), roles: resolveRoles(config), level: reviewLevel(record, config.review?.deep_paths).level ?? 'standard' });
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
