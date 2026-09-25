#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WfError, classifyPaths, dirSource, evaluateCi, evaluateReadiness, gitSource, loadConfig, loadAll, list, validateRecords } from './lib/index.js';
import { createEnforcedTrust, createTrust } from './lib/trust.js';
import { evaluateAcceptance } from './lib/acceptance.js';
import { evaluateLifecycle, evaluateSession } from './lib/lifecycle.js';
import { runOperations } from './operations.js';
import { prepareNodeEvidence } from './lib/evidence.js';
import { evaluateStatus, renderStatus } from './lib/status.js';
const COMMANDS = ['records', 'readiness', 'paths', 'ci', 'acceptance', 'lifecycle', 'session', 'status', 'report', 'runtime', 'prepare-evidence'];
const OPTIONS = ['repo', 'baseline', 'candidate', 'task', 'branch', 'changed', 'base', 'head', 'trust-key', 'receipts', 'repository', 'stage', 'record', 'operations-config', 'state', 'action', 'report-id', 'raw-log', 'environment', 'check-name', 'expires-at', 'delivery-session'];
const USAGE = `usage: wf <${COMMANDS.join('|')}> --baseline REV [--repo DIR] [--candidate REV]
  [--task T-0001] [--stage implement|verify|accept|release] [--trust-key FILE --receipts FILE --repository OWNER/REPO] [--json]
  report|runtime --operations-config FILE --state EXTERNAL_DIR --repo DIR --record FILE
  report --action deliver|status --report-id UUID (same external config/state)
  prepare-evidence --raw-log FILE --candidate SHA --repository OWNER/REPO --environment NAME --check-name NAME --expires-at ISO
  status [--baseline REV] [--candidate REV]: derived owner view as Markdown (--json for data); checks no approval and grants nothing
  Enforced mode (baseline config and profile both label the approval enforced) needs no trust options; manual mode needs all three.
  Directory sources and --changed are diagnostic inputs, not trusted integration evidence.`;
const git = (repo, ...args) => {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
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
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (!OPTIONS.includes(name) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new WfError(`invalid option or missing value: ${a}`);
      const value = argv[++i];
      if (name === 'changed') o.changed.push(value);
      else if (o[name] !== undefined) throw new WfError(`duplicate option: ${a}`);
      else o[name] = value;
    } else if (!cmd) cmd = a;
    else throw new WfError(`unexpected argument: ${a}`);
  }
  if (!COMMANDS.includes(cmd)) throw new WfError(USAGE);
  if (cmd === 'prepare-evidence') {
    if (!o['raw-log']) throw new WfError('--raw-log is required');
    const result = prepareNodeEvidence({raw:fs.readFileSync(o['raw-log'],'utf8'),revision:o.candidate,repository:o.repository,environment:o.environment,checkName:o['check-name'],expiresAt:o['expires-at'],projectRoot:fs.realpathSync(o.repo ?? process.cwd())});
    console.log(JSON.stringify(result,null,2));
    return result.ok ? 0 : 1;
  }
  if (['report','runtime'].includes(cmd)) {
    const result = await runOperations(cmd,o);
    console.log(JSON.stringify(result,null,2));
    return result.status && result.status !== 'delivered' ? 1 : ['exhausted','unknown'].includes(result.budget_status) ? 1 : 0;
  }
  const repo = path.resolve(o.repo ?? process.cwd());
  const source = spec => {
    const p = path.resolve(repo, spec);
    return fs.existsSync(p) && fs.statSync(p).isDirectory() ? dirSource(p) : gitSource(repo, spec);
  };
  if (!o.baseline && !['records', 'status'].includes(cmd)) throw new WfError('an explicit, freshly fetched --baseline is required');
  if (o.candidate && o.head && o.candidate !== o.head) throw new WfError('--candidate and --head must agree');
  const baseline = o.baseline ? source(o.baseline) : dirSource(repo);
  const candidate = o.candidate || o.head ? source(o.candidate ?? o.head) : dirSource(repo);
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  if (process.env.WF_VALIDATOR_REV && config.workflow?.revision !== process.env.WF_VALIDATOR_REV) throw new WfError('running validator revision differs from the baseline adoption pin');
  let trust = null;
  if (o['trust-key'] || o.receipts || o.repository) {
    if (!o['trust-key'] || !o.receipts || !o.repository) throw new WfError('trust requires --trust-key, --receipts and --repository together');
    if (baseline.kind !== 'git') throw new WfError('approval requires an immutable Git baseline');
    const keyPath = fs.realpathSync(o['trust-key']);
    const relative = path.relative(fs.realpathSync(repo), keyPath);
    if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new WfError('owner trust key must be provisioned outside the candidate repository');
    const envelopes = JSON.parse(fs.readFileSync(o.receipts, 'utf8'));
    if (!Array.isArray(envelopes)) throw new WfError('receipts must be an array');
    trust = createTrust({ publicKey: fs.readFileSync(keyPath, 'utf8'), repository: o.repository, envelopes });
    if (config.repository !== o.repository) throw new WfError('repository identity differs from approved project config');
  }
  // Enforced mode: the baseline's own config and profile (both code-owner protected) record that GitHub
  // enforcement was verified at setup; the immutable baseline is then the approved baseline. Candidate copies of
  // these files are never consulted, so a candidate cannot switch modes; a directory baseline never qualifies.
  // Supplying the trust options runs the full receipt gate instead, exactly as in manual mode: no hybrid.
  if (!trust && config.approval?.label === 'enforced' && baseline.kind === 'git') {
    const profileLabel = loadAll(baseline, rd).profile?.data?.approval_label;
    if (profileLabel !== 'enforced') throw new WfError('approval label differs between docs/workflow/config.json and the profile on the baseline');
    trust = createEnforcedTrust({ baseline: baseline.name });
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
      return git(repo, 'diff', '--no-renames', '--name-only', '-z', baseline.name, candidate.name, '--').split('\0').filter(Boolean);
    }
    return [...new Set([...git(repo, 'diff', '--no-renames', '--name-only', '-z', baseline.name, '--').split('\0'), ...git(repo, 'ls-files', '--others', '--exclude-standard', '-z').split('\0')].filter(Boolean))];
  };
  const taskId = () => {
    if (o.task) { if (!/^T-\d{4}$/.test(o.task)) throw new WfError('invalid task id'); return o.task; }
    let branch = o.branch;
    if (!branch) { try { branch = git(repo, 'branch', '--show-current').trim(); } catch { branch = ''; } }
    return branch.match(/^(?:codex\/)?(T-\d{4})(?:-|$)/)?.[1] ?? null;
  };
  if (cmd === 'status') { const view = evaluateStatus({ baseline, candidate }); console.log(o.json ? JSON.stringify(view, null, 2) : renderStatus(view)); return 0; }
  const emit = r => console.log(o.json ? JSON.stringify(r, null, 2) : JSON.stringify(r, null, 2));
  let result;
  if (cmd === 'records') result = validateRecords(candidate, rd);
  else if (cmd === 'paths') { const classes = classifyPaths(config, changed()); result = { ok: !classes.some(c => c.category === 'unclassified'), classes }; }
  else if (cmd === 'ci') result = evaluateCi({ baseline, candidate, task: taskId(), trust, changed: changed() });
  else {
    const task = taskId();
    if (!task) throw new WfError('--task T-0001 or a matching branch is required');
    const readiness = evaluateReadiness({ baseline, candidate, task, trust, stage: o.stage === 'integrate' ? 'verify' : o.stage });
    if (cmd === 'readiness') result = readiness;
    else {
      const record = loadAll(candidate, rd).tasks.get(task)?.data ?? {};
      const requiredChecks = list(loadAll(baseline, rd).profile?.data?.required_checks);
      const lifecycle = evaluateLifecycle({ candidate, task: record, requiredChecks, trust, stage: o.stage ?? 'verify' });
      const coverage = evaluateAcceptance({ baseline, candidate, execution: trust?.claim('verification', candidate.name)?.execution, requiredIds: list(record.acceptance), enforced: trust?.mode === 'enforced' });
      lifecycle.unverified = [...(lifecycle.unverified ?? []), ...(coverage.unverified ?? [])];
      if (!coverage.ok) { lifecycle.ok = false; lifecycle.errors.push(...coverage.errors); }
      if (cmd === 'acceptance') result = coverage;
      if (cmd === 'lifecycle') {
        const stage = o.stage ?? 'verify';
        const gate = evaluateReadiness({ baseline, candidate, task, trust, stage: stage === 'integrate' ? 'verify' : stage });
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
  emit(result);
  if (result.verdict) return result.verdict === 'pass' ? 0 : 1;
  if (result.outcome && cmd === 'readiness') return result.outcome === 'Needs discovery or resolution' ? 1 : 0;
  return result.ok ? 0 : 1;
}
try { process.exitCode = await main(); } catch (e) { console.error(`wf: ${e.message}`); process.exitCode = 2; }
