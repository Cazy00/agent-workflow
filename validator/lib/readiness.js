// Task readiness against the trusted baseline. SCHEMA.md "Readiness evaluation".
import { DEFERRED_RE, list, loadAll, loadConfig, loadRecord } from './records.js';
import { governingChanged } from './freshness.js';
import { overlaps } from './scope.js';
export { overlaps } from './scope.js';

export const STAGES = ['implement', 'verify', 'accept', 'release'];
export const OUTCOMES = {
  ready: 'Ready',
  subset: 'Ready for a bounded subset',
  needs: 'Needs discovery or resolution',
};

export function stageOf(task) {
  if (task.accepted) return 'release';
  if (task.verified) return 'accept';
  if (task.implemented) return 'verify';
  return 'implement';
}

const trim = (p) => p.replace(/^\.\//, '').replace(/\/+$/, '');
const scopesOf = (rec) => {
  const s = list(rec?.data?.affects).filter((a) => a.startsWith('paths:')).map((a) => trim(a.slice(6)));
  return s.length ? s : null; // null = blocks everything
};

export function evaluateReadiness({ baseline, candidate = baseline, task: taskId, trust = null, stage: requestedStage, changed = [] }) {
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  const reasons = [];
  const pending = [];
  const blocks = []; // { id, scopes }
  let structural = false; // a failure no subset can route around
  const fail = (msg) => { reasons.push(msg); structural = true; };
  const block = (id, msg, scopes) => { reasons.push(msg); blocks.push({ id, scopes }); };

  const taskPath = `${rd}/tasks/${taskId}.md`;
  const rec = loadRecord(candidate, taskPath, 'task') ?? loadRecord(baseline, taskPath, 'task');
  if (!rec) return finish({ taskId, status: null, stage: null, reasons: [`task ${taskId} not found`], structural: true });
  for (const e of rec.errors) fail(`task record: ${e}`);
  const t = rec.data ?? {};

  if (t.status === 'Blocked') fail(`task status is Blocked; resume condition: ${t.resume_condition ?? 'not recorded'}`);
  if (t.status === 'Done' && (!requestedStage || requestedStage === 'implement')) fail('task status is Done: open a new task for further work');

  const base = loadAll(baseline, rd);
  if (!trust?.allows('baseline', baseline.name)) fail('owner approval evidence for the exact baseline is missing or invalid');
  for (const e of base.errors) fail(`baseline record: ${e}`);
  for (const field of ['scope', 'milestone', 'governing', 'acceptance', 'branch', 'start_revision', 'governing_baseline_revision', 'feature_readiness', 'verification', 'review']) {
    if (!list(t[field]).length) fail(`${field} is not recorded`);
  }
  if (base.profile?.data?.readiness !== 'Ready') fail('project readiness has not been established on the approved baseline');
  if (base.profile && !list(base.profile.data?.required_checks).length) fail('the profile records no required_checks: project readiness needs at least one check that runs on every candidate (setup step 7)');
  if (requestedStage && !STAGES.includes(requestedStage)) fail(`unknown stage ${requestedStage}`);
  const laterStage = ['accept', 'release'].includes(requestedStage);
  const milestone = base.milestones.get(t.milestone)?.data;
  if (!milestone || !(laterStage ? ['Authorised', 'Active', 'Verified', 'Accepted', 'Released'] : ['Authorised', 'Active']).includes(milestone.status)) fail(`milestone ${t.milestone ?? '(missing)'} is not authorised for implementation on the baseline`);
  if (milestone) {
    for (const scope of list(t.scope)) if (!list(milestone.scope).some(s => scope === s || scope.startsWith(s.replace(/\/$/, '') + '/'))) fail(`task scope ${scope} is outside milestone authority`);
    for (const id of list(t.acceptance)) if (!list(milestone.acceptance).includes(id)) fail(`acceptance ${id} is outside milestone authority`);
  }
  for (const p of changed) if (!list(t.scope).some(s => p === s || p.startsWith(s.replace(/\/$/, '') + '/'))) fail(`changed production path ${p} is outside task scope`);
  if (t.feature_readiness && !baseline.exists(t.feature_readiness)) fail(`feature_readiness ${t.feature_readiness} is not on the baseline`);
  if (list(t.risks).some(r => ['shared-contract', 'synchronisation', 'money', 'stock', 'security', 'irreversible-data', 'cross-component'].includes(r)) && (!t.design || !baseline.exists(t.design))) fail('a governing design is required for the recorded risk');
  for (const assumption of list(t.assumptions)) if (!list(base.profile?.data?.permitted_assumptions).includes(assumption)) fail(`assumption ${assumption} is not delegated by the profile`);
  const previous = base.tasks.get(taskId)?.data ?? {};
  for (const field of ['prerequisites', 'decisions', 'deferred_inputs', 'governing', 'acceptance', 'risks']) {
    for (const item of list(previous[field])) if (!list(t[field]).includes(item)) fail(`removed trusted ${field} reference ${item}; resolve the governing change first`);
  }
  if (previous.feature && t.feature !== previous.feature) fail('task feature changed without governing resolution');
  if (previous.milestone && t.milestone !== previous.milestone) fail('task milestone changed without governing resolution');
  if (baseline.kind === 'git') {
    if (!(candidate.kind === 'git' ? candidate.isAncestor(t.start_revision) : baseline.hasCommit(t.start_revision))) fail('start_revision must identify an available commit in the candidate history');
    if (!baseline.isAncestor(t.governing_baseline_revision)) fail('governing_baseline_revision is invalid');
    else if (governingChanged({ baseline, revision: t.governing_baseline_revision, recordsDir: rd, task: t, previous })) fail('readiness is stale: governing records changed; reassess against the current baseline');
  }
  if (!base.profile) fail(`${rd}/profile.md is not on the trusted baseline`);
  for (const g of list(t.governing)) {
    const ok = g === 'PROFILE' ? !!base.profile
      : /^D-\d{4}$/.test(g) ? base.decisions.has(g)
      : /^T-\d{4}$/.test(g) ? base.tasks.has(g)
      : baseline.exists(g);
    if (!ok) fail(`governing record ${g} is not on the trusted baseline`);
  }

  for (const p of list(t.prerequisites)) {
    if (/^T-\d{4}$/.test(p)) {
      const u = base.tasks.get(p);
      if (!u || u.data?.status !== 'Done') fail(`prerequisite ${p} is not Done on the trusted baseline (${u ? u.data?.status : 'missing'})`);
    } else if (/^D-\d{4}$/.test(p)) {
      const d = base.decisions.get(p);
      if (!d || d.data?.status !== 'Resolved') fail(`prerequisite ${p} is not Resolved on the trusted baseline (${d ? d.data?.status : 'missing'})`);
    } else if (p.startsWith('contract:')) {
      const path = p.slice('contract:'.length);
      if (!baseline.exists(path)) fail(`contract ${path} is not on the trusted baseline`);
    } else fail(`prerequisite "${p}" is not a task id, decision id, or contract:<path>`);
  }

  const stage = STAGES[Math.max(STAGES.indexOf(requestedStage ?? 'implement'), STAGES.indexOf(stageOf(t)), STAGES.indexOf(stageOf(previous)))];
  if (!STAGES.includes(stage)) fail(`unknown stage ${stage}`);
  const stageIdx = STAGES.indexOf(stage);
  const inScope = new Set([...list(t.decisions), ...list(t.prerequisites).filter(p => /^D-\d{4}$/.test(p))]);
  // Decisions the task names, or that name the task. Supersession blocks only these: a superseded decision reached
  // through a feature, milestone or path effect alone is replaced, and its superseder is assessed where its own effects reach.
  const named = new Set(inScope);
  const taskScope = [...list(t.scope), ...changed];
  for (const [id, d] of base.decisions) {
    const affects = list(d.data?.affects);
    if (affects.includes(taskId)) named.add(id);
    if (affects.some(a => a === taskId || a === t.feature || a === previous.feature || a === t.milestone || (a.startsWith('paths:') && taskScope.some(p => overlaps(a.slice(6), p))))) inScope.add(id);
  }
  const cand = candidate === baseline ? null : loadAll(candidate, rd).decisions;
  const blockedIds = new Set();
  for (const id of inScope) {
    const b = base.decisions.get(id);
    const c = cand?.get(id) ?? null;
    if (!b) {
      block(id, c ? `decision ${id} exists only in the candidate; it is not on the trusted baseline` : `decision ${id} is not on the trusted baseline`, scopesOf(c));
      blockedIds.add(id); continue;
    }
    const superseder = [...base.decisions.values()].find((d) => d.data?.status === 'Resolved' && d.data?.supersedes === id);
    const by = b.data?.superseded_by ?? superseder?.data?.id;
    if (by && !named.has(id)) continue;
    if (by) { block(id, `decision ${id} is superseded by ${by}; reference ${by} instead`, scopesOf(b)); blockedIds.add(id); continue; }
    if (b.data?.status === 'Resolved') continue;
    const req = b.data?.required_before ?? 'implement';
    if (req === 'none' || STAGES.indexOf(req) > stageIdx) { pending.push(`decision ${id} is ${b.data?.status}; required before ${req} (task stage: ${stage})`); continue; }
    const where = c?.data?.status === 'Resolved'
      ? `decision ${id} is Resolved only in the candidate; the trusted baseline has ${b.data?.status}`
      : `decision ${id} is ${b.data?.status} on the trusted baseline`;
    block(id, `${where} (required before ${req}; task stage: ${stage})`, scopesOf(b));
    blockedIds.add(id);
  }

  for (const d of list(t.deferred_inputs)) {
    const m = d.match(DEFERRED_RE);
    if (!m) continue; // reported by the schema check
    const [, id, st] = m;
    if (STAGES.indexOf(st) > stageIdx || blockedIds.has(id)) continue;
    const b = base.decisions.get(id);
    const superseded = b?.data?.superseded_by || [...base.decisions.values()].some(d => d.data?.status === 'Resolved' && d.data?.supersedes === id);
    if (!b || b.data?.status !== 'Resolved' || superseded) {
      block(id, `deferred input ${id} is required before ${st}; task stage is ${stage} and it is ${superseded ? 'superseded' : b ? b.data?.status : 'missing'} on the trusted baseline`, scopesOf(b));
    }
  }

  if (!t.baseline_revision) fail('baseline_revision is not recorded');
  else if (baseline.kind === 'git' && !(candidate.kind === 'git' ? candidate.isAncestor(t.baseline_revision) : baseline.hasCommit(t.baseline_revision))) fail(`baseline_revision ${t.baseline_revision} is not an available commit in the candidate history`);
  if (!t.baseline_result) fail('baseline_result is not recorded (pass, or fail: <summary> for a known failing baseline)');

  return finish({ taskId, status: t.status, stage, reasons, pending, structural, blocks, subset: list(t.subset).map(trim), baseline: baseline.name });
}

function finish({ taskId, status, stage, reasons, pending = [], structural, blocks = [], subset = [], baseline = null }) {
  let outcome = OUTCOMES.needs;
  let readySubset = [];
  if (reasons.length === 0) outcome = OUTCOMES.ready;
  else if (!structural && subset.length && blocks.every((b) => b.scopes && !b.scopes.some((s) => subset.some((p) => overlaps(s, p))))) {
    outcome = OUTCOMES.subset;
    readySubset = subset;
  }
  return { task: taskId, status, stage, outcome, reasons, pending, subset: readySubset, baseline };
}
