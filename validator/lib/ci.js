// The CI verdict for a change. SCHEMA.md "CI verdict".
import { DIRS, WfError, loadConfig, validateRecords, loadAll, list } from './records.js';
import { parseFrontMatter } from './frontmatter.js';
import { classifyPaths } from './paths.js';
import { evaluateReadiness, OUTCOMES } from './readiness.js';

import { evaluateAcceptance } from './acceptance.js';
import { evaluateLifecycle } from './lifecycle.js';

const within = (p, prefix) => p === prefix || p.startsWith(prefix.replace(/\/+$/, '') + '/');

// A record ID names one piece of work for good: once a task record is removed at merge, its pull requests
// are the permanent record. Two planners on two branches, or one planner reading the directory after a
// removal, can pick the same number, and a branch that adds a removed path merges without a conflict. So an
// added record whose path already existed in the trusted branch's history must be that same record, as when a
// removal is reverted; otherwise it needs a new ID. A changed identity on an existing record (for example an
// add/add conflict resolved by keeping the other side) is noted for the reviewer. The check needs the full
// history: a shallow clone is an execution error, not a pass.
const IDENTITY = { [DIRS.task]: ['title'], [DIRS.decision]: ['question'], [DIRS.milestone]: ['outcome'], [DIRS.feedback]: ['task', 'rule'] };
function identity(source, p, fields) {
  const data = parseFrontMatter(source.read(p) ?? '').data;
  return data && fields.every(f => data[f] != null) ? fields.map(f => `${f} "${data[f]}"`).join(', ') : null;
}
function recordIds({ baseline, candidate, rd, changed }) {
  const result = { errors: [], notes: [] };
  if (baseline.kind !== 'git') return result;
  for (const p of changed) {
    const dir = Object.keys(IDENTITY).find(d => p.startsWith(`${rd}/${d}/`) && /^[^/]+\.md$/.test(p.slice(rd.length + d.length + 2)));
    if (!dir || !candidate.exists(p)) continue;
    const fields = IDENTITY[dir];
    const now = identity(candidate, p, fields);
    if (baseline.exists(p)) {
      const before = identity(baseline, p, fields);
      if (before !== now) result.notes.push(`record ${p} changes its ${fields.join(' and ')} (was ${before ?? 'unset'}); if it now describes different work, give that work a new ID`);
      continue;
    }
    if (baseline.isShallow()) throw new WfError(`cannot check whether ${p} reuses an ID: the clone is shallow; fetch the full history (fetch-depth: 0)`);
    const last = baseline.lastVersion(p);
    if (!last) continue;
    const before = identity(baseline.atRevision(last), p, fields);
    const at = last.slice(0, 12);
    if (before !== null && before === now) result.notes.push(`record ${p} restores the record last present at ${at} (same ${fields.join(' and ')})`);
    else result.errors.push(`record ${p} reuses an ID already used on the trusted branch (${before ?? 'unreadable'} at ${at}); give it a new ID, or restore that record with its exact ${fields.join(' and ')}`);
  }
  return result;
}

export function evaluateCi({ baseline, candidate = baseline, task, changed = [], trust = null }) {
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  const findings = [];
  let fail = false;

  const records = validateRecords(candidate, rd);
  for (const e of records.errors) { findings.push(`record: ${e}`); fail = true; }
  const ids = recordIds({ baseline, candidate, rd, changed });
  for (const e of ids.errors) { findings.push(e); fail = true; }
  findings.push(...ids.notes);

  const classes = classifyPaths(config, changed);
  for (const c of classes) findings.push(`${c.category}: ${c.path}`);
  if (classes.some((c) => c.category === 'unclassified')) {
    findings.push('unclassified paths must be classified in docs/workflow/config.json before integration');
    fail = true;
  }

  const production = classes.filter((c) => ['production', 'generated'].includes(c.category)).map((c) => c.path);
  let readiness = null;
  if (production.length) {
    if (!task) { findings.push('production paths changed but no task id was given (branch T-xxxx-… or --task)'); fail = true; }
    else {
      readiness = evaluateReadiness({ baseline, candidate, task, trust, changed: production, stage: 'verify' });
      findings.push(`readiness ${task}: ${readiness.outcome}`);
      for (const r of readiness.reasons) findings.push(`  ${r}`);
      const statusOk = ['Ready', 'Active'].includes(readiness.status);
      if (readiness.outcome === OUTCOMES.ready) {
        if (!statusOk) { findings.push(`task status is ${readiness.status}; production changes need Ready or Active`); fail = true; }
      } else if (readiness.outcome === OUTCOMES.subset) {
        const outside = production.filter((p) => !readiness.subset.some((s) => within(p, s)));
        if (outside.length) { findings.push(`outside the ready subset [${readiness.subset.join(', ')}]: ${outside.join(', ')}`); fail = true; }
        if (!statusOk) { findings.push(`task status is ${readiness.status}; production changes need Ready or Active`); fail = true; }
      } else fail = true;
    }
  }

  if (production.length && task) {
    const t = loadAll(candidate, rd).tasks.get(task)?.data ?? {};
    const profile = loadAll(baseline, rd).profile?.data;
    const lifecycle = evaluateLifecycle({ candidate, task: t, requiredChecks: list(profile?.required_checks), trust, stage: 'integrate' });
    const execution = trust?.claim('verification', candidate.name)?.execution;
    const acceptance = evaluateAcceptance({ baseline, candidate, execution, requiredIds: list(t.acceptance), enforced: trust?.mode === 'enforced' });
    for (const error of [...lifecycle.errors, ...acceptance.errors]) { findings.push(error); fail = true; }
    for (const item of [...(lifecycle.unverified ?? []), ...(acceptance.unverified ?? [])]) findings.push(`unverified: ${item}`);
  }
  for (const category of ['governing', 'enforcement']) {
    const protectedPaths = classes.filter(c => c.category === category).map(c => c.path);
    if (protectedPaths.length) {
      const purpose = category === 'enforcement' ? 'workflow-change' : 'governing-change';
      const receipt = trust?.claim(purpose, candidate.name);
      if (!receipt || !protectedPaths.every(p => receipt.paths?.includes(p))) {
        if (trust?.mode === 'enforced' && !receipt) findings.push(`unverified: ${purpose}: no receipt; the code-owner review of this pull request is the approval for ${protectedPaths.join(', ')} (enforced mode)`);
        else { findings.push(`${purpose} approval for the exact candidate and protected paths is required`); fail = true; }
      }
    }
  }
  if (classes.some((c) => c.category === 'enforcement')) findings.push('enforcement paths changed: protected review required; separate workflow-change approval and trusted validator execution must be established');
  if (classes.some((c) => c.category === 'governing')) findings.push('governing paths changed: decision approval (code-owner review) required');
  for (const c of classes.filter((c) => c.category === 'generated')) findings.push(`generated artifact ${c.path}: regenerate with ${c.producer ?? 'its declared producer'}`);

  return { verdict: fail ? 'fail' : 'pass', findings, classes, readiness, records: records.counts };
}
