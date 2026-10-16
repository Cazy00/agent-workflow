// `wf next` (POLICY § 8, procedures/execute.md): the agent's next action, worked out from the records by code, not by a
// session that carries the milestone in its context. It names one action, why, the few files to read for it and the
// commands to run, then what else is open and what waits on the owner. Like `wf status` it grants nothing and no gate
// reads it; the gates still decide. It replaces reading the procedures to find out what to do next, not the gates.
import { list, loadAll, loadConfig } from './records.js';
import { evaluateStatus } from './status.js';
import { OUTCOMES } from './readiness.js';
import { agentMerges, checkpointOf, milestoneHold } from './checkpoint.js';
import { overlaps } from './scope.js';
import { ACCEPTED, prunable } from './prune.js';
import { reviewLevel } from './roles.js';

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

// MAINT-0018: the workflow version the project runs under, and a newer release when the launcher knows one
// (scripts/wf passes the newest tag of its installation in WF_LATEST_RELEASE). Moving to it is the owner's decision.
const versionParts = v => (String(v ?? '').match(/^v?(\d+)\.(\d+)\.(\d+)$/) ?? []).slice(1).map(Number);
export function newerRelease(pinned, latest) {
  const [a, b] = [versionParts(pinned), versionParts(latest)];
  if (a.length !== 3 || b.length !== 3) return null;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] > a[i] ? latest : null;
  return null;
}
export function workflowOf(config, latestRelease = null) {
  const w = config.workflow ?? {};
  if (!w.version && !w.revision) return null;
  const newer = newerRelease(w.version, latestRelease);
  return { repo: w.repo ?? null, version: w.version ?? null, revision: w.revision ?? null, ...(newer ? { newer } : {}) };
}

// MAINT-0018: the next free ID of each record kind: past every record now present and every one the history ever added, so
// a record removed after its milestone's acceptance keeps its number (ci.js refuses a reused one). An open pull request's
// new records are not seen here; null when the history cannot be read.
const KINDS = { task: ['tasks', 'T'], milestone: ['milestones', 'M'], decision: ['decisions', 'D'], feedback: ['feedback/inbox', 'F'] };
export function nextIds(sources, rd) {
  const ids = {};
  for (const [kind, [dir, letter]] of Object.entries(KINDS)) {
    let max = 0;
    for (const source of sources) {
      let paths = [];
      try { paths = source.addedPaths ? source.addedPaths(`${rd}/${dir}`) : []; } catch { return null; }
      for (const p of paths) { const n = Number(p.match(new RegExp(`(?:^|/)${letter}-(\\d{4})\\.md$`))?.[1] ?? 0); if (n > max) max = n; }
    }
    ids[kind] = `${letter}-${String(max + 1).padStart(4, '0')}`;
  }
  return ids;
}

export function evaluateNext({ baseline, candidate = baseline, trustedBranch = null, pullRequests = null, latestRelease = null }) {
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  const label = config.approval?.label;
  const manual = !['enforced', 'owner-merge'].includes(label); // owner-merge approves by the pull request, as enforced does
  const checkpoint = checkpointOf(config);
  // The pull-request modes need the agent's delivery evidence in the pull request description for a production change.
  const evidence = manual ? '' : ' --delivery-evidence PR_DESCRIPTION_FILE';
  const status = evaluateStatus({ baseline, candidate, trustedBranch, pullRequests });
  const base = baseline.kind === 'git' ? baseline.name : 'TRUSTED_TIP';
  const head = candidate.kind === 'git' ? candidate.name : 'HEAD';
  const trustOptions = manual ? ' --trust-key … --receipts … --repository …' : '';
  const chosen = candidate.kind === 'git' ? ` --candidate ${head}` : ''; // a selected revision, kept in every command
  const actions = [];
  const add = a => actions.push({ read: [], run: [], ...a });
  const records = loadAll(candidate, rd);
  const task = id => records.tasks.get(id)?.data ?? {};

  if (status.record_errors.length) add({ kind: 'records', item: rd, do: 'Fix the record errors', why: status.record_errors.slice(0, 5).join('; ') + (status.record_errors.length > 5 ? `; and ${status.record_errors.length - 5} more` : ''), read: [PROCEDURE.records], run: [`wf records${chosen}`] });
  for (const w of status.waiting.filter(w => w.owner === 'agent' && w.kind === 'setup')) add({ kind: 'setup', item: w.item, do: 'Do the unchecked agent setup steps: 1, 4 and 7 together in this session, then step 8 in a fresh context', why: w.detail, read: [w.item, PROCEDURE.setup] });

  // Tasks Done in the candidate but not on the baseline: their work is finished and waits for the owner's round (manual
  // mode) or the pull request (enforced, owner-merge), unless their milestone collects one round at its end and still has work open.
  const baseTasks = loadAll(baseline, rd).tasks;
  const finished = [...records.tasks.values()].map(r => r.data).filter(t => t?.id && t.status === 'Done' && baseTasks.get(t.id)?.data?.status !== 'Done').sort(byId);
  const openIn = m => [...records.tasks.values()].some(r => r.data?.milestone === m && r.data?.status !== 'Done');
  const milestoneRound = t => records.milestones.get(t.milestone)?.data?.signing === 'milestone' && openIn(t.milestone);
  const roundReady = finished.filter(t => !milestoneRound(t));
  if (roundReady.length) {
    const ids = roundReady.map(t => t.id).join(', ');
    add(manual
      ? { kind: 'round', item: ids, do: `Close out or stage the signing round for ${ids}`, why: `${ids} ${roundReady.length > 1 ? 'are' : 'is'} Done here but not on the trusted branch`, read: [PROCEDURE.round], run: [`if the owner signed the round: wf closeout --baseline ${base} --candidate ${head} --trust-key … --receipts … --repository …`, `otherwise dry-run it: wf ci --baseline ${base} --candidate ${head} --task ${roundReady[0].id} --trust-key … --receipts … --repository … --unsigned-receipts ROUND_FILE (exit 3 is the expected dry-run result), then stage the round and end the session`] }
      : { kind: 'pr', item: ids, do: agentMerges(checkpoint) ? `Merge the pull request for ${ids} once the gate lets you` : `Get the pull request for ${ids} merged by the owner`, why: `${ids} ${roundReady.length > 1 ? 'are' : 'is'} Done here but not on the trusted branch`, read: [PROCEDURE.pr], run: [`wf ci --baseline ${base} --candidate ${head} --task ${roundReady[0].id}${evidence}`, ...(agentMerges(checkpoint) ? [config.approval?.auto_merge === true ? 'when that reports merge: agent, turn on auto-merge (gh pr merge --auto) and carry on with work that does not need this merge; otherwise it waits for the owner' : 'merge it yourself only when that reports merge: agent and every required check has passed; otherwise it waits for the owner'] : [])] });
  }
  for (const w of status.waiting.filter(w => w.owner === 'agent' && w.kind === 'claim')) add({ kind: 'claim', item: w.item, do: 'Resolve the task claim', why: w.detail, read: [PROCEDURE.claim] });
  for (const w of status.waiting.filter(w => w.owner === 'agent' && w.kind === 'changes')) add({ kind: 'changes', item: w.item, do: `Address the changes requested on ${w.item}`, why: w.detail, read: [PROCEDURE.task] });

  const milestones = status.milestones.filter(m => !['Accepted', 'Released'].includes(m.status));
  // A milestone still in Draft is planned and offered for authorisation as a whole; its tasks wait for that.
  const drafts = milestones.filter(m => m.status === 'Draft');
  const live = milestones.filter(m => !drafts.includes(m));
  const open = [...live.flatMap(m => m.tasks.map(t => ({ ...t, milestone: m.id }))), ...status.unassigned_tasks].filter(t => t.status !== 'Done' && t.status !== 'Blocked');
  // Checkpoint change or milestone: a later milestone's work waits until the owner accepts the earliest open one.
  const hold = milestoneHold({ checkpoint, milestones: records.milestones });
  const holding = t => hold?.held.has(t.milestone);
  const eligible = open.filter(t => !holding(t));
  // Priority is the authorised plan's order, read from the baseline: milestones by ID, then the order of each
  // milestone's `tasks:` as approved (the candidate's own order for a milestone not yet on the baseline), then tasks
  // discovered since, by ID.
  const approvedPlan = loadAll(baseline, rd).milestones;
  const rank = new Map();
  [...live].sort(byId).forEach((m, mi) => {
    const planned = approvedPlan.has(m.id) ? list(approvedPlan.get(m.id)?.data?.tasks) : m.plan.planned;
    m.tasks.forEach(t => { const pi = planned.indexOf(t.id); rank.set(t.id, [mi, pi === -1 ? Infinity : pi]); });
  });
  const byPriority = (a, b) => { const [am, ap] = rank.get(a.id) ?? [Infinity, Infinity]; const [bm, bp] = rank.get(b.id) ?? [Infinity, Infinity]; return am - bm || ap - bp || byId(a, b); };
  // With pull requests supplied, a task with an open pull request or a claim branch is someone's work already.
  const claimed = t => (t.pull_requests ?? []).length > 0 || t.claim_branch === true;
  const ownersDecision = t => (t.reasons ?? []).length > 0 && (t.reasons ?? []).every(r => /^(decision|deferred input) D-\d{4}/.test(r));
  const held = open.filter(holding).sort(byId).map(t => ({ task: t.id, reasons: [`waits for the owner's acceptance of ${hold.first} (checkpoint ${checkpoint})`] }));
  // MAINT-0018: work on a task begins with the access check (B5) and the task lead's brief (B1), whether the task is about
  // to start (Ready, or a Draft claimed on its own branch) or continues there.
  const handOver = id => ['wf doctor  (raise every gap in the next question to the owner)', `wf brief --lead --task ${id} --baseline ${base}  (the task lead's brief)`];
  // MAINT-0020 P10: a claim does not wait for the trusted branch's checks on its baseline (P2(b)); the lead waits with this.
  const baselineWait = kind => kind === 'start' && !manual ? [`wf wait --commit ${base}  (the trusted branch's checks on the baseline; fill baseline_result before the review packet)`] : [];
  const taskAction = (t, kind, verb, why) => {
    const record = task(t.id);
    add({ kind, item: t.id, do: `${verb} ${t.id}: ${record.title ?? ''}`.trim(), why, read: [...readList(rd, { ...record, id: t.id }, record.milestone), PROCEDURE.task], run: [...handOver(t.id), `wf readiness --baseline ${base}${chosen} --task ${t.id}${trustOptions}`, ...baselineWait(kind), `wf ci --baseline ${base} --candidate ${head} --task ${t.id}${manual ? `${trustOptions} --unsigned-receipts ROUND_FILE` : evidence}  (when its candidate is committed)`] });
  };
  const resolve = t => add({ kind: 'plan', item: t.id, do: `${t.status === 'Draft' ? 'Plan' : 'Resolve the readiness of'} ${t.id}${t.status === 'Active' ? ' before continuing it' : ''}`, why: (t.reasons ?? []).slice(0, 3).join('; ') || 'not ready', read: [`${rd}/tasks/${t.id}.md`, PROCEDURE.plan], run: [`wf readiness --baseline ${base}${chosen} --task ${t.id}${trustOptions}`] });
  // An Active task continues only while readiness lets it; one held by the owner's decision waits, and is listed as such.
  for (const t of eligible.filter(t => t.status === 'Active').sort(byPriority)) {
    if (t.readiness === OUTCOMES.ready) taskAction(t, 'continue', 'Continue', 'Active, and its readiness passes');
    else if (t.readiness === OUTCOMES.subset) taskAction(t, 'continue', 'Continue only the ready subset of', `ready only for a bounded subset: ${(t.reasons ?? []).slice(0, 2).join('; ')}`);
    else if (ownersDecision(t)) held.push({ task: t.id, reasons: t.reasons });
    else resolve(t);
  }
  // v2.8.0 review C1: planned tasks wait on the trusted branch as Draft and are claimed on their own branch (readiness.md, ci.js
  // claimedHere), so a Draft of an Authorised or Active milestone whose readiness passes starts as a Ready one does.
  const authorised = t => ['Authorised', 'Active'].includes(live.find(m => m.id === t.milestone)?.status);
  const claimable = t => !claimed(t) && (t.status === 'Ready' || (t.status === 'Draft' && authorised(t)));
  const ready = eligible.filter(t => claimable(t) && t.readiness === OUTCOMES.ready).sort(byPriority);
  const subset = eligible.filter(t => claimable(t) && t.readiness === OUTCOMES.subset).sort(byPriority);
  const claimHow = t => t.status === 'Draft' ? 'a Draft here: claim it on its own branch, Ready or Active there' : 'Ready';
  for (const t of ready) taskAction(t, 'start', 'Claim and start', `${claimHow(t)}, and its readiness passes`);
  for (const t of subset) taskAction(t, 'start', 'Claim and start the ready subset of', `${claimHow(t)}; ready only for a bounded subset: ${(t.reasons ?? []).slice(0, 2).join('; ')}`);
  // MAINT-0020 P2(a): every task that can start now, each with its own lead in the background. In M-0005 the leads ran in the
  // foreground one after another (17.4 h), though T-0025, T-0026 and T-0028 could have run beside T-0029. In priority order, a
  // task whose readiness passes (so no prerequisite is outstanding on the trusted branch) joins when its scope overlaps no
  // running (Active or claimed) or joining task's, until three run (execute.md). A task with no scope overlaps every other.
  const running = open.filter(t => t.status === 'Active' || claimed(t));
  const scopeOf = t => list(task(t.id).scope);
  const clash = (a, b) => { const [x, y] = [scopeOf(a), scopeOf(b)]; return !x.length || !y.length || x.some(p => y.some(q => overlaps(p, q))); };
  const startable = [];
  for (const t of [...ready, ...subset]) {
    if (running.length + startable.length >= 3) break;
    if (![...running, ...startable].some(u => clash(t, u))) startable.push(t);
  }
  for (const t of eligible.filter(t => ['Ready', 'Draft'].includes(t.status) && t.readiness === OUTCOMES.needs).sort(byPriority)) {
    if (ownersDecision(t)) held.push({ task: t.id, reasons: t.reasons });
    else resolve(t);
  }
  for (const w of status.waiting.filter(w => w.owner === 'agent' && w.kind === 'plan')) add({ kind: 'plan', item: w.item, do: `Complete the plan of ${w.item}`, why: w.detail, read: [`${rd}/milestones/${w.item}.md`, PROCEDURE.plan] });
  // MAINT-0020 P7(c): `wf doctor` before the plan's question as well, since in M-0005 it first ran 7 h 40 min after the plan's
  // one question round (at the first hand-over), and its gap reached the owner a day late.
  // MAINT-0020 P8: an accepted milestone's Done task records still here (M-0005 of mateen-systems: 34 of five milestones) go in
  // one `wf prune` commit, which rides in the pull request that prepares the next authorisation, or is an action of its own.
  const stale = [...records.milestones.values()].map(r => r.data).filter(m => m?.id && ACCEPTED.includes(m.status)).sort(byId).map(m => ({ id: m.id, n: prunable(records, m.id).remove.length })).filter(m => m.n);
  const prune = stale.map(m => `wf prune --milestone ${m.id}  (removes its ${m.n} Done task record${m.n === 1 ? '' : 's'} in one records-only commit${drafts.length ? '; it rides in this pull request' : ''})`);
  drafts.forEach((m, i) => add({ kind: 'plan', item: m.id, do: `Prepare ${m.id} for the owner's authorisation`, why: `Draft milestone with ${m.tasks.length} task record(s)${m.plan.uncovered.length ? `; acceptance ${m.plan.uncovered.join(', ')} is served by no task` : ''}`, read: [`${rd}/milestones/${m.id}.md`, PROCEDURE.plan], run: ['wf doctor  (put every gap in the plan\'s question to the owner, before authorisation)', ...(i === 0 ? prune : [])] }));
  for (const d of status.open_for_agent) add({ kind: 'decide', item: d.id, do: `Resolve ${d.id} within delegated authority, or propose it to its owner`, why: d.question ?? 'open decision', read: [`${rd}/decisions/${d.id}.md`, PROCEDURE.plan] });
  for (const m of milestones.filter(m => ['Authorised', 'Active'].includes(m.status) && m.tasks.length && m.tasks.every(t => t.status === 'Done') && !m.plan.uncovered.length && !m.plan.missing.length)) {
    add({ kind: 'present', item: m.id, do: `Prepare ${m.id} for the owner's acceptance`, why: 'every planned task is Done', read: [`${rd}/milestones/${m.id}.md`, PROCEDURE.present, ...(manual ? [PROCEDURE.round] : [])] });
  }
  for (const w of status.waiting.filter(w => w.owner === 'agent' && w.kind === 'inbox')) add({ kind: 'triage', item: w.item, do: 'Triage the inbox', why: w.detail, read: [w.item, PROCEDURE.triage] });
  if (!drafts.length && stale.length) add({ kind: 'prune', item: stale.map(m => m.id).join(', '), do: `Remove the Done task records of ${stale.map(m => m.id).join(', ')}`, why: 'the milestone is accepted; its Done task records are read by every wf next and readiness run', read: [PROCEDURE.pr], run: prune });

  // MAINT-0020 P5(a): the second model's runs a milestone can spend (review.md): two per deep task, one for the milestone review,
  // which the deep tasks must leave. F5: M-0005's Codex ran out at the milestone review. A task is deep as the lead's brief reads
  // it (roles.js reviewLevel: its review field, else its scope against review.deep_paths; v2.8.0 review). Only the budget is
  // printed: the runs already used are left to v2.9.0's `wf usage` (P14), since the pull-request data `wf next` is given holds
  // only the open pull requests, without their descriptions or comments.
  const deepPaths = config.review?.deep_paths ?? [];
  const secondModel = config.review?.second_model ? milestones.filter(m => ['Authorised', 'Active'].includes(m.status)).map(m => {
    const deepTasks = [...records.tasks.values()].filter(r => r.data?.milestone === m.id && reviewLevel(r.data, deepPaths).level === 'deep').length;
    return { milestone: m.id, deep_tasks: deepTasks, runs: 2 * deepTasks + 1 };
  }) : [];
  const owner = status.waiting.filter(w => w.owner !== 'agent').map(w => ({ kind: w.kind, item: w.item, owner: w.owner, detail: w.detail }));
  const blocked = status.blocked.map(b => ({ task: b.task, resume_condition: b.resume_condition }));
  const next = actions[0] ?? { kind: 'stop', item: null, do: 'Stop: no agent work is eligible', why: owner.length ? `waiting on the owner: ${owner.map(w => `${w.kind} ${w.item}`).join(', ')}` : 'nothing is open', read: [], run: ['post the session outcome and handoff (procedures/execute.md *Resume, limits and handoff*)'] };
  return {
    ok: true, revision: candidate.name, baseline: base, mode: manual ? 'manual' : label, ...(checkpoint ? { checkpoint } : {}), workflow: workflowOf(config, latestRelease), next_ids: nextIds([baseline, candidate], rd),
    next, startable: startable.map(t => t.id), running: running.map(t => t.id).sort(), also: actions.slice(1, 8), more: Math.max(0, actions.length - 8), owner, blocked, held, second_model_budget: secondModel,
    limitation: 'Derived from the records; grants nothing and no gate reads it. Read what it names and nothing else unless one of those points further; the gates decide.',
  };
}

export function renderNext(n) {
  const lines = [];
  const bullet = items => items.map(i => `  - ${i}`);
  if (n.note) lines.push(`Note: ${n.note}`, '');
  const w = n.workflow;
  if (w) {
    lines.push(`Workflow: ${w.repo ?? 'agent-workflow'} ${w.version ?? 'unknown version'} (${w.revision ?? 'no revision'}); name it in the session outcome (\`workflow\`)`);
    if (w.newer) lines.push(`  A newer release, ${w.newer}, exists. Moving to it is the owner's decision (bin/wf-upgrade); a milestone in progress stays on its version unless the owner decides otherwise.`);
    lines.push('');
  }
  lines.push(`Next: ${n.next.do}`, `Why: ${n.next.why}`);
  if (n.next.read.length) lines.push('Read:', ...bullet(n.next.read));
  if (n.next.run.length) lines.push('Run:', ...bullet(n.next.run));
  if (n.startable?.length) lines.push('', `${n.startable.length > 1 ? 'Start together, each with its own lead' : 'Start, with its own lead'} in the background${n.running?.length ? ` (beside ${n.running.join(', ')})` : ''}: ${n.startable.join(', ')}`);
  if (n.also.length) lines.push('', 'Also open (after this one):', ...bullet(n.also.map(a => `${a.do} (${a.why})`)), ...(n.more ? [`  - and ${n.more} more`] : []));
  if (n.owner.length) lines.push('', 'Waiting on the owner (do not do these):', ...bullet(n.owner.map(w => `${w.kind} ${w.item}: ${w.detail}`)));
  if (n.held?.length) lines.push('', 'Held for the owner\'s decision or acceptance (do not work on these):', ...bullet(n.held.map(h => `${h.task}: ${h.reasons.slice(0, 2).join('; ')}`)));
  if (n.blocked.length) lines.push('', 'Blocked:', ...bullet(n.blocked.map(b => `${b.task}: resumes when ${b.resume_condition ?? 'its resume condition is met'}`)));
  if (n.second_model_budget?.length) lines.push('', ...n.second_model_budget.map(b => `${b.milestone}: second-model budget: ${b.runs} run${b.runs === 1 ? '' : 's'} (two per deep task, one for the milestone review); keep one for the milestone review`));
  if (n.next_ids) lines.push('', `Next free IDs here: ${Object.values(n.next_ids).join(', ')}; check the open pull requests too (wf status --pull-requests). Reviews are numbered on the pull requests.`);
  lines.push('', `(${n.mode} mode${n.checkpoint ? `, checkpoint ${n.checkpoint}` : ''}; baseline ${String(n.baseline).slice(0, 12)}; ${n.limitation})`);
  return `${lines.join('\n')}\n`;
}
