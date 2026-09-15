// Task readiness against the trusted baseline. SCHEMA.md "Readiness evaluation".
import { DEFERRED_RE, list, loadAll, loadConfig, loadRecord } from './records.js';

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
export const overlaps = (a, b) => { a = trim(a); b = trim(b); return a === b || a.startsWith(b + '/') || b.startsWith(a + '/'); };
const scopesOf = (rec) => {
  const s = list(rec?.data?.affects).filter((a) => a.startsWith('paths:')).map((a) => trim(a.slice(6)));
  return s.length ? s : null; // null = blocks everything
};

export function evaluateReadiness({ baseline, candidate = baseline, task: taskId }) {
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

  if (t.status === 'Draft') fail('task status is Draft: not Ready');
  if (t.status === 'Blocked') fail(`task status is Blocked; resume condition: ${t.resume_condition ?? 'not recorded'}`);
  if (t.status === 'Done') fail('task status is Done: open a new task for further work');

  const base = loadAll(baseline, rd);
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

  const stage = stageOf(t);
  const stageIdx = STAGES.indexOf(stage);
  const inScope = new Set(list(t.decisions));
  for (const [id, d] of base.decisions) if (list(d.data?.affects).includes(taskId)) inScope.add(id);
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
    if (!b || b.data?.status !== 'Resolved') {
      block(id, `deferred input ${id} is required before ${st}; task stage is ${stage} and it is ${b ? b.data?.status : 'missing'} on the trusted baseline`, scopesOf(b));
    }
  }

  if (!t.baseline_revision) fail('baseline_revision is not recorded');
  else if (baseline.isAncestor(t.baseline_revision) === false) fail(`baseline_revision ${t.baseline_revision} is not an ancestor of the trusted baseline ${baseline.name}`);
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
