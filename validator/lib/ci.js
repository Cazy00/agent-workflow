// The CI verdict for a change. SCHEMA.md "CI verdict".
import { DIRS, WfError, loadConfig, validateRecords, loadAll, list } from './records.js';
import { parseFrontMatter } from './frontmatter.js';
import { classifyPaths } from './paths.js';
import { planningEnforcement, isPlanningRuntime } from './planning.js';
import { evaluateReadiness, OUTCOMES } from './readiness.js';

import { evaluateAcceptance } from './acceptance.js';
import { evaluateDelegation } from './delegation.js';
import { evaluateLifecycle } from './lifecycle.js';

const within = (p, prefix) => p === prefix || p.startsWith(prefix.replace(/\/+$/, '') + '/');

// A record ID names one piece of work for good: once a task record is removed after its milestone's acceptance,
// its pull requests are the permanent record. Two planners on two branches, or one planner reading the directory after a
// removal, can pick the same number, and a branch that adds a removed path merges without a conflict. So an
// added record whose path already existed in the trusted branch's history must be that same record in every
// version the history holds, as when a removal is reverted; otherwise it needs a new ID. A changed identity on an existing record (for example an
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
    const commits = baseline.versions(p);
    if (!commits.length) continue;
    const held = [...new Set(commits.map(c => identity(baseline.atRevision(c), p, fields)))];
    const at = commits[0].slice(0, 12);
    if (held.length === 1 && held[0] !== null && held[0] === now) result.notes.push(`record ${p} restores the record last present at ${at} (same ${fields.join(' and ')})`);
    else result.errors.push(`record ${p} reuses an ID already used on the trusted branch (${held.map(h => h ?? 'unreadable').join('; ')}, latest at ${at}); give it a new ID, or restore a record that only ever had one ${fields.join(' and ')} with that exact value`);
  }
  return result;
}

// Readiness reads a task named in another task's prerequisites or governing from the baseline, so that record
// stays, Done, until the last record naming it is removed (procedures/execute.md). A change fails when it removes a record
// that a remaining task names, or when a task record newly names one that is not in the candidate. The candidate
// contains the current baseline, so a removal and a planning branch meet in whichever merges second.
const NAMED = ['prerequisites', 'governing'];
const namesIn = data => NAMED.flatMap(field => list(data?.[field]).filter(v => /^T-\d{4}$/.test(v)).map(id => ({ field, id })));
function recordReferences({ baseline, candidate, rd, changed }) {
  const errors = [];
  const dir = `${rd}/${DIRS.task}/`;
  if (!changed.some(p => p.startsWith(dir))) return errors;
  const tasks = [...loadAll(candidate, rd).tasks.values()].filter(r => r.data).map(r => ({ ...r.data, id: r.data.id ?? r.path }));
  for (const p of changed) {
    const id = p.startsWith(dir) ? p.slice(dir.length).match(/^(T-\d{4})\.md$/)?.[1] : null;
    if (!id) continue;
    if (!candidate.exists(p)) {
      if (!baseline.exists(p)) continue;
      const by = tasks.map(t => [t.id, namesIn(t).filter(n => n.id === id).map(n => n.field)]).filter(([, fields]) => fields.length);
      if (by.length) errors.push(`${p} is removed, but ${by.map(([t, fields]) => `${t} (${fields.join(', ')})`).join(', ')} ${by.length > 1 ? 'name' : 'names'} ${id}; keep the record, set it Done when its work merges, and remove it with the last record that names it`);
      continue;
    }
    const before = new Set(namesIn(parseFrontMatter(baseline.read(p) ?? '').data).map(n => n.id));
    for (const n of namesIn(parseFrontMatter(candidate.read(p) ?? '').data)) {
      if (!before.has(n.id) && !candidate.exists(`${dir}${n.id}.md`)) errors.push(`${id} names ${n.id} in ${n.field}, but ${dir}${n.id}.md is not in the candidate; add that record first, or, if its work is merged and its record removed, leave the reference out`);
    }
  }
  return errors;
}

export function evaluateCi({ baseline, candidate = baseline, task, tasks, changed = [], trust = null, changedLines = null, deliveryEvidence = null, ownerApproved = false }) {
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  const findings = [];
  let fail = false;

  // Check tracked runtime output at the whole candidate, not only today's diff.
  // A directory diagnostic cannot establish what Git actually tracks.
  if (planningEnforcement(config).length) {
    if (candidate.kind === 'git') {
      const tracked = [...candidate.listTree('docs/specs'), ...candidate.listTree('.specify')];
      for (const p of tracked.filter(isPlanningRuntime)) {
        findings.push(`Spec Kit runtime/projection output must not be tracked: ${p}`); fail = true;
      }
    } else findings.push('unverified: Spec Kit tracked-output exclusion requires a Git candidate');
  }

  const records = validateRecords(candidate, rd);
  for (const e of records.errors) { findings.push(`record: ${e}`); fail = true; }
  const ids = recordIds({ baseline, candidate, rd, changed });
  for (const e of ids.errors) { findings.push(e); fail = true; }
  findings.push(...ids.notes);
  for (const e of recordReferences({ baseline, candidate, rd, changed })) { findings.push(e); fail = true; }

  const classes = classifyPaths(config, changed);
  for (const c of classes) findings.push(`${c.category}: ${c.path}`);
  if (classes.some((c) => c.category === 'unclassified')) {
    findings.push('unclassified paths must be classified in docs/workflow/config.json before integration');
    fail = true;
  }

  const production = classes.filter((c) => ['production', 'generated'].includes(c.category)).map((c) => c.path);
  const selected = tasks ?? (task ? [task] : []);
  if (!Array.isArray(selected) || selected.some(id => !/^T-\d{4}$/.test(id)) || new Set(selected).size !== selected.length) {
    throw new WfError('tasks must be distinct T-NNNN IDs');
  }
  if (task && tasks) throw new WfError('use task or tasks, not both');
  const batch = selected.length > 1;
  const candidateRecords = loadAll(candidate, rd);
  const baselineRecords = loadAll(baseline, rd);
  const readinessByTask = {};
  let readiness = null;
  const assigned = new Map(selected.map(id => [id, []]));
  if (batch) {
    const policy = config.delivery?.batching;
    if (!policy || !Number.isInteger(policy.max_tasks) || policy.max_tasks < selected.length || policy.max_tasks > 20 ||
        typeof policy.environment !== 'string' || !policy.environment.trim() || typeof policy.rollback !== 'string' || !policy.rollback.trim()) {
      findings.push('batch integration needs approved baseline delivery.batching: max_tasks (2..20), environment and rollback'); fail = true;
    }
    const records = selected.map(id => candidateRecords.tasks.get(id)?.data);
    if (records.some(r => !r) || new Set(records.map(r => r?.milestone)).size !== 1 || new Set(records.map(r => r?.owner)).size !== 1) {
      findings.push('a batch requires existing tasks in one milestone with one implementing owner'); fail = true;
    }
    if (trust?.mode !== 'enforced') {
      const reviewed = trust?.claim('review', candidate.name)?.tasks;
      if (!Array.isArray(reviewed) || selected.some(id => !reviewed.includes(id))) { findings.push('the candidate review receipt must cover every task in the batch'); fail = true; }
    }
  }
  for (const p of production) {
    const owners = batch ? selected.filter(id => list(candidateRecords.tasks.get(id)?.data?.scope).some(s => within(p, s))) : selected;
    if (owners.length !== 1) { findings.push(`production path ${p} must belong to exactly one selected task (found ${owners.length})`); fail = true; }
    else assigned.get(owners[0]).push(p);
  }
  if (production.length && !selected.length) { findings.push('production paths changed but no task id was given (branch T-xxxx-… or --task/--tasks)'); fail = true; }
  for (const id of selected) {
    const paths = assigned.get(id);
    if (!production.length && !batch) continue;
    if (batch && !paths.length) { findings.push(`batch task ${id} owns no changed production paths; omit it`); fail = true; }
    const gate = evaluateReadiness({ baseline, candidate, task: id, trust, changed: paths, stage: 'integrate' });
    readinessByTask[id] = gate;
    if (!batch) readiness = gate;
    findings.push(`readiness ${id}: ${gate.outcome}`);
    for (const r of gate.reasons) findings.push(`  ${r}`);
    const baselineStatus = baselineRecords.tasks.get(id)?.data?.status;
    const statusOk = ['Ready', 'Active'].includes(gate.status);
    const doneHere = gate.status === 'Done' && ['Ready', 'Active'].includes(baselineStatus);
    if (gate.outcome === OUTCOMES.ready) {
      if (!statusOk && !doneHere) { findings.push(`task status is ${gate.status} (${id}); production changes need Ready or Active (or Done in this pull request)`); fail = true; }
    } else if (gate.outcome === OUTCOMES.subset) {
      const outside = paths.filter(p => !gate.subset.some(s => within(p, s)));
      if (outside.length) { findings.push(`outside the ready subset [${gate.subset.join(', ')}]: ${outside.join(', ')}`); fail = true; }
      if (!statusOk) { findings.push(`task status is ${gate.status}; production changes need Ready or Active; a task Ready only for a subset cannot be marked Done`); fail = true; }
    } else fail = true;
    const t = candidateRecords.tasks.get(id)?.data ?? {};
    const lifecycle = evaluateLifecycle({ candidate, task: t, requiredChecks: list(baselineRecords.profile?.data?.required_checks), trust, stage: 'integrate' });
    for (const error of lifecycle.errors) { findings.push(error); fail = true; }
    for (const item of lifecycle.unverified ?? []) findings.push(`unverified: ${item}`);
  }
  if (selected.length && (production.length || batch)) {
    const execution = trust?.claim('verification', candidate.name)?.execution;
    const taskRequirements = selected.map(id => [id, list(candidateRecords.tasks.get(id)?.data?.acceptance)]);
    const acceptance = evaluateAcceptance({ baseline, candidate, taskRequirements, execution, enforced: trust?.mode === 'enforced' });
    for (const error of acceptance.errors) { findings.push(error); fail = true; }
    for (const item of acceptance.unverified ?? []) findings.push(`unverified: ${item}`);
  }
  const delegation = evaluateDelegation({ config,
    baselineTasks: [...baselineRecords.tasks.values()].map(r => r.data), tasks: [...candidateRecords.tasks.values()].map(r => r.data),
    taskIds: selected, classes, revision: candidate.name, changedLines, evidence: deliveryEvidence,
    requiredChecks: list(baselineRecords.profile?.data?.required_checks), ownerApproved });
  if (delegation.enabled) {
    if (trust?.mode !== 'enforced') { findings.push('agent-operated routine delegation requires verified enforced-mode setup'); fail = true; }
    if (!delegation.ok) fail = true;
    findings.push(...delegation.errors, ...delegation.unverified.map(x => `unverified: ${x}`));
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

  return { verdict: fail ? 'fail' : 'pass', findings, classes, readiness, ...(delegation.enabled ? { delegation } : {}), ...(batch ? { tasks: selected, readinessByTask } : {}), records: records.counts };
}
