// `wf next` (POLICY § 8, procedures/execute.md): the agent's next action, worked out from the records by code, not by a
// session that carries the milestone in its context. It names one action, why, the few files to read for it and the
// commands to run, then what else is open and what waits on the owner. Like `wf status` it grants nothing and no gate
// reads it; the gates still decide. It replaces reading the procedures to find out what to do next, not the gates.
import { list, loadAll, loadConfig } from './records.js';
import { evaluateStatus } from './status.js';
import { OUTCOMES } from './readiness.js';

const PROCEDURE = {
  records: 'SCHEMA.md (the section the error names)',
  setup: 'procedures/setup.md',
  round: 'procedures/approval-evidence.md *Signing rounds* and *Closeout*',
  pr: 'procedures/execute.md *Checkpoints and task records*',
  claim: 'procedures/execute.md *Coordinate and delegate*',
  task: 'procedures/execute.md *Implement a task*, then procedures/review.md',
  plan: 'procedures/readiness.md',
  present: 'procedures/accept-release.md',
  triage: 'procedures/maintenance.md',
};
const byId = (a, b) => String(a.id).localeCompare(String(b.id));

// The files a task's work starts from: its record, its milestone, what it names as governing, its design, and the
// acceptance definitions and map when it serves acceptance IDs.
function readList(rd, task, milestone) {
  const files = [`${rd}/tasks/${task.id}.md`];
  if (milestone) files.push(`${rd}/milestones/${milestone}.md`);
  for (const g of list(task.governing)) {
    if (g === 'PROFILE') files.push(`${rd}/profile.md`);
    else if (/^D-\d{4}$/.test(g)) files.push(`${rd}/decisions/${g}.md`);
    else if (/^T-\d{4}$/.test(g)) files.push(`${rd}/tasks/${g}.md`);
    else files.push(g);
  }
  if (task.design) files.push(...list(task.design));
  if (list(task.acceptance).length) files.push(`${rd}/acceptance.json`, 'tests/acceptance-map.json');
  return [...new Set(files)];
}

export function evaluateNext({ baseline, candidate = baseline, trustedBranch = null }) {
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  const manual = config.approval?.label !== 'enforced';
  const status = evaluateStatus({ baseline, candidate, trustedBranch });
  const base = baseline.kind === 'git' ? baseline.name : 'TRUSTED_TIP';
  const head = candidate.kind === 'git' ? candidate.name : 'HEAD';
  const actions = [];
  const add = a => actions.push({ read: [], run: [], ...a });
  const records = loadAll(candidate, rd);
  const task = id => records.tasks.get(id)?.data ?? {};

  if (status.record_errors.length) add({ kind: 'records', item: rd, do: 'Fix the record errors', why: status.record_errors.slice(0, 5).join('; ') + (status.record_errors.length > 5 ? `; and ${status.record_errors.length - 5} more` : ''), read: [PROCEDURE.records], run: ['wf records'] });
  for (const w of status.waiting.filter(w => w.owner === 'agent' && w.kind === 'setup')) add({ kind: 'setup', item: w.item, do: 'Do the next unchecked agent step in the setup record, one per session', why: w.detail, read: [w.item, PROCEDURE.setup] });

  // Tasks Done in the candidate but not on the baseline: their work is finished and waits for the owner's round (manual
  // mode) or the pull request (enforced), unless their milestone collects one round at its end and still has work open.
  const baseTasks = loadAll(baseline, rd).tasks;
  const finished = [...records.tasks.values()].map(r => r.data).filter(t => t?.id && t.status === 'Done' && baseTasks.get(t.id)?.data?.status !== 'Done').sort(byId);
  const openIn = m => [...records.tasks.values()].some(r => r.data?.milestone === m && r.data?.status !== 'Done');
  const milestoneRound = t => records.milestones.get(t.milestone)?.data?.signing === 'milestone' && openIn(t.milestone);
  const roundReady = finished.filter(t => !milestoneRound(t));
  if (roundReady.length) {
    const ids = roundReady.map(t => t.id).join(', ');
    add(manual
      ? { kind: 'round', item: ids, do: `Close out or stage the signing round for ${ids}`, why: `${ids} ${roundReady.length > 1 ? 'are' : 'is'} Done here but not on the trusted branch`, read: [PROCEDURE.round], run: [`if the owner signed the round: wf closeout --baseline ${base} --candidate ${head} --trust-key … --receipts … --repository …`, `otherwise dry-run it: wf ci --baseline ${base} --candidate ${head} --task ${roundReady[0].id} --trust-key … --receipts … --repository … --unsigned-receipts ROUND_FILE (exit 3 is the expected dry-run result), then stage the round and end the session`] }
      : { kind: 'pr', item: ids, do: `Get the pull request for ${ids} merged`, why: `${ids} ${roundReady.length > 1 ? 'are' : 'is'} Done here but not on the trusted branch`, read: [PROCEDURE.pr], run: [`wf ci --baseline ${base} --candidate ${head} --task ${roundReady[0].id}`] });
  }
  for (const w of status.waiting.filter(w => w.owner === 'agent' && w.kind === 'claim')) add({ kind: 'claim', item: w.item, do: 'Resolve the task claim', why: w.detail, read: [PROCEDURE.claim] });

  const milestones = status.milestones.filter(m => !['Accepted', 'Released'].includes(m.status));
  // A milestone still in Draft is planned and offered for authorisation as a whole; its tasks wait for that.
  const drafts = milestones.filter(m => m.status === 'Draft');
  const live = milestones.filter(m => !drafts.includes(m));
  const open = [...live.flatMap(m => m.tasks.map(t => ({ ...t, milestone: m.id }))), ...status.unassigned_tasks].filter(t => t.status !== 'Done' && t.status !== 'Blocked');
  const taskAction = (t, kind, verb, why) => {
    const record = task(t.id);
    add({ kind, item: t.id, do: `${verb} ${t.id}: ${record.title ?? ''}`.trim(), why, read: [...readList(rd, { ...record, id: t.id }, record.milestone), PROCEDURE.task], run: [`wf readiness --baseline ${base} --task ${t.id}`, `wf ci --baseline ${base} --candidate HEAD --task ${t.id}${manual ? ' --trust-key … --receipts … --repository … --unsigned-receipts ROUND_FILE' : ''}  (when its candidate is committed)`] });
  };
  for (const t of open.filter(t => t.status === 'Active').sort(byId)) taskAction(t, 'continue', 'Continue', `Active${t.readiness && t.readiness !== OUTCOMES.ready ? `; readiness: ${t.readiness}` : ''}`);
  for (const t of open.filter(t => t.status === 'Ready' && t.readiness === OUTCOMES.ready).sort(byId)) taskAction(t, 'start', 'Claim and start', 'Ready, and its readiness passes');
  for (const t of open.filter(t => t.status === 'Ready' && t.readiness === OUTCOMES.subset).sort(byId)) taskAction(t, 'start', 'Claim and start the ready subset of', `ready only for a bounded subset: ${(t.reasons ?? []).slice(0, 2).join('; ')}`);
  for (const t of open.filter(t => t.status === 'Draft' && t.readiness === OUTCOMES.ready).sort(byId)) add({ kind: 'plan', item: t.id, do: `Mark ${t.id} Ready, or finish planning it`, why: 'a Draft whose readiness passes', read: [`${rd}/tasks/${t.id}.md`, PROCEDURE.plan], run: [`wf readiness --baseline ${base} --task ${t.id}`] });
  for (const t of open.filter(t => ['Ready', 'Draft'].includes(t.status) && t.readiness === OUTCOMES.needs).sort(byId)) {
    const ownerDecision = (t.reasons ?? []).every(r => /^(decision|deferred input) D-\d{4}/.test(r));
    if (!ownerDecision) add({ kind: 'plan', item: t.id, do: `${t.status === 'Draft' ? 'Plan' : 'Resolve the readiness of'} ${t.id}`, why: (t.reasons ?? []).slice(0, 3).join('; ') || 'not ready', read: [`${rd}/tasks/${t.id}.md`, PROCEDURE.plan], run: [`wf readiness --baseline ${base} --task ${t.id}`] });
  }
  for (const w of status.waiting.filter(w => w.owner === 'agent' && w.kind === 'plan')) add({ kind: 'plan', item: w.item, do: `Complete the plan of ${w.item}`, why: w.detail, read: [`${rd}/milestones/${w.item}.md`, PROCEDURE.plan] });
  for (const m of drafts) add({ kind: 'plan', item: m.id, do: `Prepare ${m.id} for the owner's authorisation`, why: `Draft milestone with ${m.tasks.length} task record(s)${m.plan.uncovered.length ? `; acceptance ${m.plan.uncovered.join(', ')} is served by no task` : ''}`, read: [`${rd}/milestones/${m.id}.md`, PROCEDURE.plan] });
  for (const d of status.open_for_agent) add({ kind: 'decide', item: d.id, do: `Resolve ${d.id} within delegated authority, or propose it to its owner`, why: d.question ?? 'open decision', read: [`${rd}/decisions/${d.id}.md`, PROCEDURE.plan] });
  for (const m of milestones.filter(m => ['Authorised', 'Active'].includes(m.status) && m.tasks.length && m.tasks.every(t => t.status === 'Done') && !m.plan.uncovered.length && !m.plan.missing.length)) {
    add({ kind: 'present', item: m.id, do: `Prepare ${m.id} for the owner's acceptance`, why: 'every planned task is Done', read: [`${rd}/milestones/${m.id}.md`, PROCEDURE.present, ...(manual ? [PROCEDURE.round] : [])] });
  }
  for (const w of status.waiting.filter(w => w.owner === 'agent' && w.kind === 'inbox')) add({ kind: 'triage', item: w.item, do: 'Triage the inbox', why: w.detail, read: [w.item, PROCEDURE.triage] });

  const owner = status.waiting.filter(w => w.owner !== 'agent').map(w => ({ kind: w.kind, item: w.item, owner: w.owner, detail: w.detail }));
  const blocked = status.blocked.map(b => ({ task: b.task, resume_condition: b.resume_condition }));
  const next = actions[0] ?? { kind: 'stop', item: null, do: 'Stop: no agent work is eligible', why: owner.length ? `waiting on the owner: ${owner.map(w => `${w.kind} ${w.item}`).join(', ')}` : 'nothing is open', read: [], run: ['post the session outcome and handoff (procedures/execute.md *Resume, limits and handoff*)'] };
  return {
    ok: true, revision: candidate.name, baseline: base, mode: manual ? 'manual' : 'enforced',
    next, also: actions.slice(1, 8), more: Math.max(0, actions.length - 8), owner, blocked,
    limitation: 'Derived from the records; grants nothing and no gate reads it. Read what it names and nothing else unless one of those points further; the gates decide.',
  };
}

export function renderNext(n) {
  const lines = [];
  const bullet = items => items.map(i => `  - ${i}`);
  lines.push(`Next: ${n.next.do}`, `Why: ${n.next.why}`);
  if (n.next.read.length) lines.push('Read:', ...bullet(n.next.read));
  if (n.next.run.length) lines.push('Run:', ...bullet(n.next.run));
  if (n.also.length) lines.push('', 'Also open (after this one):', ...bullet(n.also.map(a => `${a.do} (${a.why})`)), ...(n.more ? [`  - and ${n.more} more`] : []));
  if (n.owner.length) lines.push('', 'Waiting on the owner (do not do these):', ...bullet(n.owner.map(w => `${w.kind} ${w.item}: ${w.detail}`)));
  if (n.blocked.length) lines.push('', 'Blocked:', ...bullet(n.blocked.map(b => `${b.task}: resumes when ${b.resume_condition ?? 'its resume condition is met'}`)));
  lines.push('', `(${n.mode} mode; baseline ${String(n.baseline).slice(0, 12)}; ${n.limitation})`);
  return `${lines.join('\n')}\n`;
}
