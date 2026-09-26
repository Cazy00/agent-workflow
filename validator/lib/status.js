// A derived, read-only view for the owner who coordinates rather than implements (IDEA-08). It grants
// no authority and no gate reads it: approval is never checked here, and each open task's readiness is
// previewed as if the baseline were approved, so the view shows what would still stand in the way.
// With two or more `owners` in the profile it shows what waits on each person, and given the open pull
// requests it shows each task's claim and flags a task claimed twice (IDEA-13). Per milestone it shows the plan
// as authorised (`tasks`), the tasks discovered since, and until acceptance what the plan leaves unserved (IDEA-14).
import { TASK_BRANCH, list, listedOwners, loadAll, loadConfig, ownerErrors } from './records.js';
import { evaluateReadiness } from './readiness.js';

const preview = Object.freeze({ mode: 'preview', claim: () => null, allows: purpose => purpose === 'baseline' });
const OWNER_DECISION_TYPES = ['decision', 'deferred'];
const TITLE_TASK = /^(T-\d{4})\b/;
const UNRECORDED = /^(\w+) is not recorded\b/;
// A pull request title is untrusted text: in a code span GitHub renders no link, mention, image or HTML.
const span = text => `\`${text.replaceAll('`', "'")}\``;

// Open pull requests as `gh pr list --json number,title,headRefName,author,isDraft,isCrossRepository,reviewDecision`
// prints them. Their text is untrusted: only plain fields are kept, each on one line. A pull request names
// the task that the CLI's branch rule or the start of its title gives, unless it comes from a fork; when the
// two name different tasks it names neither. The claim is the branch named exactly after the task
// (procedures/execute.md); only without one does the lowest-numbered pull request naming the task hold it.
export function readPullRequests(input) {
  if (!Array.isArray(input)) throw new Error('pull requests must be a JSON array');
  const line = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  return input.filter(p => Number.isSafeInteger(p?.number) && p.number > 0).map(p => {
    const title = line(p.title, 120);
    const branch = line(p.headRefName, 120);
    const author = line(p.author?.login, 60);
    const named = [branch.match(TASK_BRANCH)?.[1], title.match(TITLE_TASK)?.[1]].filter(Boolean);
    const mismatch = named.length === 2 && named[0] !== named[1] ? named : null;
    return {
      number: p.number, title, branch,
      author: /^[\w.-]+(\[bot\])?$/.test(author) ? author : null,
      draft: p.isDraft === true, fork: p.isCrossRepository === true,
      review: ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'].includes(p.reviewDecision) ? p.reviewDecision : null,
      task: mismatch ? null : named[0] ?? null,
      mismatch,
    };
  }).sort((a, b) => a.number - b.number);
}

export function evaluateStatus({ baseline, candidate = baseline, pullRequests = null }) {
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  const all = loadAll(candidate, rd);
  all.errors.push(...ownerErrors(all));
  const profile = all.profile?.data ?? {};
  const owners = listedOwners(profile);
  const labels = [config.approval?.label ?? null, profile.approval_label ?? null];
  if (labels[0] && labels[1] && labels[0] !== labels[1]) all.errors.push(`approval label differs between docs/workflow/config.json (${labels[0]}) and the profile (${labels[1]})`);
  const waiting = [];
  const blocked = [];
  const openForAgent = [];
  const decisions = { open: [], proposed: [] };
  const prs = pullRequests == null ? null : readPullRequests(pullRequests);
  const claims = new Map(); // task ID -> the open same-repository pull requests naming it, lowest number first
  for (const p of prs ?? []) if (p.task && !p.fork) claims.set(p.task, [...(claims.get(p.task) ?? []), p]);
  const claimBranches = new Set(prs && owners.length ? candidate.claimBranches?.() ?? [] : []); // shared projects claim by branch
  // The claim branch holds a task, with or without its pull request; without one, the lowest-numbered pull request.
  const holderOf = id => (claims.get(id) ?? []).find(p => p.branch === id) ?? (claimBranches.has(id) ? null : claims.get(id)?.[0] ?? null);

  const byMilestone = new Map();
  for (const rec of all.tasks.values()) {
    const key = rec.data?.milestone ?? '(none)';
    if (!byMilestone.has(key)) byMilestone.set(key, []);
    byMilestone.get(key).push(rec);
  }
  const taskView = rec => {
    const t = rec.data ?? {};
    const view = { id: t.id ?? rec.path, title: t.title ?? null, status: t.status ?? null, owner: t.owner ?? null, errors: rec.errors };
    if (t.id && t.status !== 'Done') {
      let r;
      try { r = evaluateReadiness({ baseline, candidate, task: t.id, trust: preview }); } catch (e) { r = { outcome: 'not assessable', reasons: [e.message], pending: [] }; }
      view.readiness = r.outcome; view.reasons = r.reasons; view.pending = r.pending;
      // A Draft is still being planned: its missing start facts are one line, not one blocker each.
      const missing = t.status === 'Draft' ? r.reasons.map(x => x.match(UNRECORDED)?.[1]).filter(Boolean) : [];
      if (missing.length) { view.missing_fields = missing; view.reasons = [`not yet recorded: ${missing.join(', ')}`, ...r.reasons.filter(x => !UNRECORDED.test(x))]; }
    }
    if (prs) { view.pull_requests = (claims.get(view.id) ?? []).map(p => p.number); view.claim_branch = claimBranches.has(view.id); }
    if (t.status === 'Blocked') { view.resume_condition = t.resume_condition ?? null; blocked.push({ task: view.id, resume_condition: view.resume_condition, reasons: view.reasons ?? [] }); }
    return view;
  };
  const milestones = [...all.milestones.values()].map(rec => {
    const m = rec.data ?? {};
    const id = m.id ?? rec.path;
    const owner = m.owner ?? 'owner';
    if (m.status === 'Verified') waiting.push({ kind: 'acceptance', item: id, owner, detail: 'milestone verified; owner product acceptance is next' });
    if (m.status === 'Accepted') waiting.push({ kind: 'release', item: id, owner, detail: 'milestone accepted; release authority is next' });
    // Task records stay until the milestone is accepted (procedures/execute.md), so until then the plan is
    // checked against them: every acceptance ID served by some task, every planned task still recorded.
    const recs = byMilestone.get(id) ?? [];
    const ids = recs.map(r => r.data?.id).filter(Boolean);
    const planned = [...new Set(list(m.tasks))];
    const plan = { planned, discovered: planned.length ? ids.filter(t => !planned.includes(t)) : [], uncovered: [], missing: [] };
    if (!['Accepted', 'Released'].includes(m.status)) {
      plan.uncovered = list(m.acceptance).filter(a => !recs.some(r => list(r.data?.acceptance).includes(a)));
      plan.missing = planned.filter(t => !ids.includes(t));
      const person = m.owner ?? null;
      if (plan.uncovered.length) waiting.push({ kind: 'plan', item: id, owner: 'agent', person, detail: `acceptance ${plan.uncovered.join(', ')} is served by no task: plan one (procedures/readiness.md)` });
      if (plan.missing.length) waiting.push({ kind: 'plan', item: id, owner: 'agent', person, detail: `planned ${plan.missing.join(', ')} is not among this milestone's task records: write it, or re-cut the plan` });
    }
    const tasks = recs.map(r => ({ ...taskView(r), discovered: plan.discovered.includes(r.data?.id) }));
    return { id, status: m.status ?? null, outcome: m.outcome ?? null, measure: m.measure ?? null, owner: m.owner ?? null, plan, tasks, errors: rec.errors };
  });
  const known = new Set(milestones.map(m => m.id));
  const unassigned = [...byMilestone.entries()].filter(([k]) => !known.has(k)).flatMap(([k, recs]) => recs.map(r => ({ ...taskView(r), milestone: k })));

  for (const rec of all.decisions.values()) {
    const d = rec.data ?? {};
    if (!['Open', 'Proposed'].includes(d.status)) continue;
    const entry = { id: d.id ?? rec.path, question: d.question ?? null, type: d.type ?? null, owner: d.owner ?? null, required_before: d.required_before ?? null, affects: list(d.affects), status: d.status };
    (d.status === 'Open' ? decisions.open : decisions.proposed).push(entry);
    if (d.status === 'Proposed' || OWNER_DECISION_TYPES.includes(d.type)) waiting.push({ kind: 'decision', item: entry.id, owner: entry.owner, detail: `${d.status}: ${entry.question ?? ''} (required before ${entry.required_before}; affects ${entry.affects.join(', ') || 'unspecified'})` });
    else openForAgent.push(entry);
  }

  // Claims and reviews, from the open pull requests when they are supplied.
  let pullRequestView = null;
  if (prs) {
    const tasks = new Map([...all.tasks.values()].filter(r => r.data?.id).map(r => [r.data.id, r.data]));
    const ownerOf = id => all.milestones.get(tasks.get(id)?.milestone)?.data?.owner ?? 'owner';
    const duplicates = [];
    for (const [task, ps] of claims) {
      const holder = holderOf(task);
      const others = ps.filter(p => p !== holder).map(p => p.number);
      if (!others.length) continue;
      duplicates.push({ task, holder: holder?.number ?? null, claim_branch: claimBranches.has(task), others });
      const held = holder ? `#${holder.number}${holder.branch === task ? ', on the claim branch,' : ''} holds the claim` : `the claim branch ${task} holds the claim`;
      waiting.push({ kind: 'claim', item: task, owner: 'agent', person: tasks.get(task)?.owner ?? null, detail: `${held}; close #${others.join(', #')} or move its work there` });
    }
    for (const b of claimBranches) if (!(claims.get(b) ?? []).some(p => p.branch === b)) waiting.push({ kind: 'claim', item: b, owner: 'agent', person: tasks.get(b)?.owner ?? null, detail: `claim branch ${b} has no open pull request from it: its holder opens one, or releases the claim by deleting the branch` });
    for (const p of prs.filter(p => p.mismatch && !p.fork)) waiting.push({ kind: 'claim', item: `#${p.number}`, owner: 'agent', person: null, detail: `its branch names ${p.mismatch[0]} and its title ${p.mismatch[1]}; rename one so the claim is clear` });
    for (const t of tasks.values()) if (t.status === 'Active' && !claims.has(t.id) && !claimBranches.has(t.id)) waiting.push({ kind: 'claim', item: t.id, owner: 'agent', person: t.owner ?? null, detail: 'Active on the trusted branch with no claim branch or open pull request: if its pull request merged, mark it Done; otherwise inspect its last handoff, then resume or release the claim' });
    // Fork pull requests stay in the list below: outside contributions never enter anyone's list of actions.
    for (const p of prs.filter(p => !p.draft && !p.fork)) {
      const label = `#${p.number}${p.task ? ` ${p.task}` : ''}`;
      const about = `${span(p.title)}${p.author ? ` by ${p.author}` : ''}`;
      const ours = p.task && tasks.has(p.task);
      if (p.review === 'CHANGES_REQUESTED') waiting.push({ kind: 'changes', item: label, owner: 'agent', person: ours ? tasks.get(p.task).owner ?? null : null, detail: `changes requested · ${about}` });
      else waiting.push({ kind: 'review', item: label, owner: ours ? ownerOf(p.task) : 'owner', detail: `${p.review === 'APPROVED' ? 'approved; merge once the required checks pass' : 'ready for review'} · ${about}` });
    }
    pullRequestView = { open: prs, duplicates, claim_branches: [...claimBranches].sort() };
  }

  const inboxItems = (candidate.listAll ?? candidate.list).call(candidate, `${rd}/inbox`).filter(p => !p.endsWith('/README.md') && !p.endsWith('/.gitkeep'));
  if (inboxItems.length) waiting.push({ kind: 'inbox', item: `${rd}/inbox`, owner: 'agent', detail: `${inboxItems.length} item(s) awaiting triage` });
  const setupText = candidate.read(`${rd}/setup.md`);
  let setupOpen = null;
  if (setupText) {
    const [ownerPart, agentPart = ''] = setupText.split(/^## Agent steps/m);
    const count = s => (s.match(/^- \[ \]/gm) ?? []).length;
    setupOpen = { owner: count(ownerPart), agent: count(agentPart) };
    if (setupOpen.owner) waiting.push({ kind: 'setup', item: `${rd}/setup.md`, owner: 'owner', detail: `${setupOpen.owner} owner setup step(s) unchecked` });
    if (setupOpen.agent) waiting.push({ kind: 'setup', item: `${rd}/setup.md`, owner: 'agent', detail: `${setupOpen.agent} agent setup step(s) unchecked` });
  }
  const feedbackOpen = [...all.feedback.values()].filter(f => f.data?.status === 'Open').map(f => f.data.id);

  return {
    ok: true,
    revision: candidate.name,
    project: profile.project ?? null,
    measure: profile.measure ?? null,
    profile_readiness: profile.readiness ?? null,
    owners,
    waiting,
    milestones,
    unassigned_tasks: unassigned,
    blocked,
    decisions,
    open_for_agent: openForAgent,
    pull_requests: pullRequestView,
    inbox: { count: inboxItems.length, items: inboxItems },
    setup_open: setupOpen,
    feedback_open: feedbackOpen,
    record_errors: all.errors,
    limitation: 'Derived, read-only view. It grants no authority and checks no approval; gates read the records directly. Readiness is previewed as if the baseline were approved. Usage and local claims: wf runtime --action status. Shared claims, latest handoffs and current activity: the task branches and pull requests.',
  };
}

export function renderStatus(s) {
  const lines = [];
  const rev = typeof s.revision === 'string' && /^[0-9a-f]{40,64}$/.test(s.revision) ? s.revision.slice(0, 12) : 'working tree';
  lines.push(`# Status: ${s.project ?? '(no profile)'} @ ${rev}`, '');
  lines.push(`Measure: ${s.measure ?? 'not recorded'}`, `Project readiness: ${s.profile_readiness ?? 'not recorded'}`, '');
  const people = s.owners?.length >= 2 ? s.owners : [];
  const owner = s.waiting.filter(w => w.owner !== 'agent');
  const agent = s.waiting.filter(w => w.owner === 'agent');
  if (!people.length) {
    lines.push('## Waiting on the owner');
    lines.push(...(owner.length ? owner.map(w => `- ${w.item}${w.owner ? ` (${w.owner})` : ''}: ${w.detail}`) : ['- nothing']), '');
  } else {
    // One section per person; an item that names no listed person (an unset or shared owner) waits on either.
    for (const person of people) {
      const mine = owner.filter(w => list(w.owner).includes(person));
      lines.push(`## Waiting on ${person}`, ...(mine.length ? mine.map(w => `- ${w.item}: ${w.detail}`) : ['- nothing']), '');
    }
    const either = owner.filter(w => !list(w.owner).some(o => people.includes(o)));
    if (either.length) lines.push('## Waiting on either owner', ...either.map(w => `- ${w.item}${w.owner && w.owner !== 'owner' ? ` (${w.owner})` : ''}: ${w.detail}`), '');
  }
  lines.push(people.length ? '## Next for the agents' : '## Next for the agent');
  lines.push(...(agent.length ? agent.map(w => `- ${w.item}${people.length && w.person ? ` (${w.person}'s agents)` : ''}: ${w.detail}`) : ['- nothing queued outside the milestones below']), '');
  if (s.pull_requests) {
    lines.push('## Open pull requests');
    lines.push(...(s.pull_requests.open.length ? s.pull_requests.open.map(p => `- #${p.number}${p.task ? ` ${p.task}` : ''} · ${span(p.title)}${p.author ? ` · ${p.author}` : ''}${p.draft ? ' (draft)' : ''}${p.fork ? ' (fork: an outside contribution)' : ''}`) : ['- none']), '');
  }
  lines.push('## Milestones');
  if (!s.milestones.length) lines.push('- none', '');
  for (const m of s.milestones) {
    const plan = m.plan?.planned.length ? ` · planned ${m.plan.planned.length} · discovered ${m.plan.discovered.length}` : '';
    lines.push(`### ${m.id} — ${m.status ?? '?'} — ${m.outcome ?? ''}${people.length && m.owner ? ` (owner ${m.owner})` : ''}${plan}`);
    if (m.measure) lines.push(`Measure: ${m.measure}`);
    if (!m.tasks.length) lines.push('- no tasks');
    for (const t of m.tasks) {
      const claim = !t.pull_requests ? '' : t.pull_requests.length ? ` · #${t.pull_requests.join(', #')}` : t.claim_branch ? ' · claim branch, no pull request' : ['Ready', 'Active'].includes(t.status) ? ' · no pull request' : '';
      lines.push(`- ${t.id} ${t.status ?? '?'}${people.length && t.owner ? ` · ${t.owner}` : ''} · ${t.title ?? ''}${t.discovered ? ' · discovered' : ''}${t.readiness ? ` · readiness preview: ${t.readiness}` : ''}${claim}`);
      const reasons = t.reasons ?? [];
      for (const r of reasons.slice(0, 5)) lines.push(`    - ${r}`);
      if (reasons.length > 5) lines.push(`    - … ${reasons.length - 5} more`);
    }
    lines.push('');
  }
  if (s.unassigned_tasks.length) { lines.push('## Tasks without a milestone record'); for (const t of s.unassigned_tasks) lines.push(`- ${t.id} ${t.status ?? '?'} (${t.milestone === '(none)' ? 'no milestone' : `milestone ${t.milestone}`})`); lines.push(''); }
  if (s.blocked.length) { lines.push('## Blocked'); for (const b of s.blocked) lines.push(`- ${b.task}: resume when ${b.resume_condition ?? 'not recorded'}`); lines.push(''); }
  if (s.open_for_agent.length) { lines.push('## Open questions for the agent'); for (const d of s.open_for_agent) lines.push(`- ${d.id} (${d.type}): ${d.question ?? ''}`); lines.push(''); }
  if (s.feedback_open.length) lines.push(`Open workflow feedback: ${s.feedback_open.join(', ')}`, '');
  if (s.record_errors.length) { lines.push('## Record errors'); for (const e of s.record_errors) lines.push(`- ${e}`); lines.push(''); }
  lines.push(`_${s.limitation}_`);
  return lines.join('\n') + '\n';
}
