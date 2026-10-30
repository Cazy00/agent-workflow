// Task readiness against the trusted baseline. SCHEMA.md "Readiness evaluation".
import { DEFERRED_RE, list, loadAll, loadConfig, loadRecord } from './records.js';
import { governingChanged } from './freshness.js';
import { overlaps } from './scope.js';
import { classifyPaths } from './paths.js';
import { milestonePathOf, tasksOnlyChange } from './tasks-only.js';
export { overlaps } from './scope.js';

export const STAGES = ['implement', 'verify', 'integrate', 'accept', 'release'];
export const OUTCOMES = {
  ready: 'Ready',
  subset: 'Ready for a bounded subset',
  needs: 'Needs discovery or resolution',
};

// MAINT-0020 P2(b): a claim need not wait for the trusted branch's run on its baseline (six claims of M-0005 waited 9–16 min
// each): `pending: <run>` stands for that run's result while the task is implemented. Verification, review and integration
// still need the result: from `verify` on readiness refuses it, and so does `review-packet`.
export const baselinePending = t => /^pending:/.test(String(t?.baseline_result ?? '')) ? `baseline_result is still ${t.baseline_result}: fill it from the trusted branch's run on the baseline commit (wf wait --commit ${t.baseline_revision ?? 'SHA'}, then pass: <run reference> or fail: <summary>) before the review packet` : null;

// v2.8.0 review X1: the found-task allowance is a count, not a place in ID order, which let a Draft with a lower ID start once a
// later one had used the allowance. `id` is within it while fewer than `found_tasks` other found tasks of the milestone have
// begun: beyond Draft, with found_from, in any of `records` (the trusted branch's, and the candidate's). Two claims on separate
// branches meet at integrate, where the first is on the trusted branch; `wf next` lists no more to start than the places left
// (next.js, v2.8.0 fix review). A milestone with no `tasks:` field has no found task
// (null); an explicit `tasks: []` makes every task naming it one. Shared with P11's carrier (ci.js, review C2).
// v2.9.0 final review S3: a Draft takes its place too once a merged carry relies on it, when any task record's accepted_findings
// names the finding its found_from names; counting begun ones only let each pull request carry a finding by another Draft.
// v2.9.0 final check A1: ci.js keeps such a carrier, relied on by the same test, while its milestone is not accepted.
export const reliedOn = records => new Set(records.flatMap(r => [...r.tasks.values()].flatMap(x => list(x.data?.accepted_findings))));
// MAINT-0024 review F2: `added`, the tasks the owner adds to the milestone's tasks: in this change (ownerAdded), take no place.
export function foundRoom({ milestone, id, records, added = [] }) {
  if (milestone?.tasks == null || list(milestone.tasks).includes(id)) return null;
  const planned = [...list(milestone.tasks), ...added], all = records.flatMap(r => [...r.tasks.values()].map(x => x.data));
  const relied = reliedOn(records);
  const begun = [...new Set(all.filter(d => /^T-\d{4}$/.test(d?.id ?? '') && d.id !== id && d.milestone === milestone.id && !planned.includes(d.id) && d.found_from && (d.status !== 'Draft' || relied.has(d.found_from))).map(d => d.id))].sort();
  const allowed = Number(milestone.found_tasks ?? 0) || 0;
  return { allowed, begun, within: begun.length < allowed };
}

// MAINT-0024 (a client project, 29 October 2026): the owner approved a found task, which their merge of the milestone record
// adding it to `tasks:` records, yet readiness read only the trusted branch's list, so the pull request carrying both the
// task and its milestone line failed, and the records-only one before it could not pass a broken required check: nothing
// merged for three days. A task the candidate's milestone record names in `tasks:` and the trusted branch's does not is
// planned here when that record is governing by the trusted branch's config, both sides: `wf ci` then passes the change only
// to the owner's approval of the exact candidate (the owner's merge in owner-merge mode, code-owner review in enforced mode, a
// governing-change receipt in manual mode). ownerAdded lists such tasks of a milestone; addedByOwner gives readiness's note.
export function ownerAdded({ config, base, cand, milestone }) {
  const b = base?.milestones.get(milestone), c = cand?.milestones.get(milestone);
  if (!b || !c || ![b.path, c.path].every(p => classifyPaths(config, [p])[0]?.category === 'governing')) return [];
  return list(c.data?.tasks).filter(id => !list(b.data?.tasks).includes(id));
}
// MAINT-0026: under approval.defer_to_acceptance a change that only appends tasks to the record (lib/tasks-only.js) is the agent's
// merge, and the owner approves the task at the milestone's acceptance, where it is listed.
export function addedByOwner({ config, base, cand, milestone, id, baseline = null, candidate = null }) {
  if (!ownerAdded({ config, base, cand, milestone }).includes(id)) return null;
  const rd = config.records_dir ?? 'docs/workflow';
  if (baseline && candidate && tasksOnlyChange({ config, rd, base: baseline, cand: candidate, path: milestonePathOf(rd, milestone), records: cand }).ok) return `${id} is added to ${milestone}'s tasks: in this change, so it is planned; the owner approves it at ${milestone}'s acceptance, where it is listed (approval.defer_to_acceptance)`;
  return `${id} is added to ${milestone}'s tasks: in this change, so it is planned once the owner approves the milestone record (wf ci passes that only to the owner)`;
}

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
    // MAINT-0022 (the owner's review diet, 22 October 2026): under review.cadence milestone a milestone's plan gets one quick review
    // before its tasks start, linked from its record on the trusted branch (records.js checks the link's form); a milestone past
    // Active is past its tasks (v2.11.0 review S2).
    if (config.review?.cadence === 'milestone' && ['Authorised', 'Active'].includes(milestone.status) && !milestone.plan_review) fail(`milestone ${t.milestone} has no plan_review: with review.cadence milestone its plan gets one quick review before its tasks start (procedures/readiness.md)`);
    for (const scope of list(t.scope)) if (!list(milestone.scope).some(s => scope === s || scope.startsWith(s.replace(/\/$/, '') + '/'))) fail(`task scope ${scope} is outside milestone authority`);
    for (const id of list(t.acceptance)) if (!list(milestone.acceptance).includes(id)) fail(`acceptance ${id} is outside milestone authority`);
  }
  // MAINT-0020 P6(b): five of M-0005's seven question rounds were about its limits; tasks 8, 9 and 10 were each asked. A found
  // task (one naming the milestone that the trusted branch's `tasks:` list does not) fixes a finding of the milestone's own
  // review or trial, named in `found_from`, within the milestone's `found_tasks` (none when unset; foundRoom). Any other
  // is the owner's to allow, as before.
  const candAll = candidate === baseline ? null : loadAll(candidate, rd);
  const ownerIds = ownerAdded({ config, base, cand: candAll, milestone: t.milestone });
  const room = ['Authorised', 'Active'].includes(milestone?.status) ? foundRoom({ milestone: { ...milestone, id: t.milestone }, id: taskId, records: [base, ...(candAll ? [candAll] : [])], added: ownerIds }) : null;
  const added = room ? addedByOwner({ config, base, cand: candAll, milestone: t.milestone, id: taskId, baseline, candidate }) : null;
  if (added) pending.push(added);
  else if (room) {
    const ask = `ask the owner, who adds it to ${t.milestone}'s tasks: or moves the work to a later milestone`;
    if (!t.found_from) fail(`${taskId} is a found task of ${t.milestone} (its tasks: list does not name it) without found_from: name the review finding (R-NNNN/F1) or trial it fixes, or ${ask}`);
    else if (!room.within) fail(`${taskId} would be found task ${room.begun.length + 1} of ${t.milestone}, beyond its found_tasks allowance of ${room.allowed}${room.begun.length ? ` (begun: ${room.begun.join(', ')})` : ''}: ${ask}`);
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
  // Decisions the task names (here or on the baseline), or that name the task. A superseded decision reached only through
  // a feature, milestone or path effect is skipped when its superseder is on the baseline and in scope, so assessed itself.
  const named = new Set([...inScope, ...list(previous.decisions), ...list(previous.prerequisites).filter(p => /^D-\d{4}$/.test(p))]);
  const taskScope = [...list(t.scope), ...changed];
  for (const [id, d] of base.decisions) {
    const affects = list(d.data?.affects);
    if (affects.includes(taskId)) named.add(id);
    if (affects.some(a => a === taskId || a === t.feature || a === previous.feature || a === t.milestone || (a.startsWith('paths:') && taskScope.some(p => overlaps(a.slice(6), p))))) inScope.add(id);
  }
  const cand = candAll?.decisions ?? null;
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
    if (by && by !== id && !named.has(id) && base.decisions.has(by) && inScope.has(by)) continue;
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
  else if (stageIdx > 0 && baselinePending(t)) fail(baselinePending(t));

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
