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
    for (const t of tasks.values()) if (t.status === 'Active' && !claims.has(t.id) && !claimBranches.has(t.id)) waiting.push({ kind: 'claim', item: t.id, owner: 'agent', person: t.owner ?? null, detail: 'Active on the trusted branch with no claim branch or open pull request: if its pull request merged, the coordinator marks it Done; otherwise inspect its last handoff, then resume or release the claim' });
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

// Markdown for the pinned GitHub issue and the terminal (IDEA-17): a count strip; what waits on the owner grouped by
// kind; what must stay visible (agent queue, blocked tasks, open work outside a milestone, record errors); open pull
// requests; each milestone as a progress bar, a task table and a diagram of the decisions blocking its tasks; and the
// long tail (readiness reasons, earlier Done work, footnotes) folded into <details>. Pull request titles stay in code
// spans; record text is escaped so it cannot split a table or open or close HTML.
const pipes = text => String(text ?? '').replace(/\s+/g, ' ').trim().replaceAll('|', '\\|');
const cell = text => pipes(text).replaceAll('<', '&lt;');
const short = (text, n) => {
  const chars = Array.from(cell(text));
  if (chars.length <= n) return chars.join('');
  const cut = chars.lastIndexOf(' ', n - 1);
  return `${chars.slice(0, cut > n * 0.6 ? cut : n - 1).join('')}…`;
};
const blockingDecision = reason => reason.match(/^(?:decision|deferred input) (D-\d{4}) is (?:Open|Proposed|required before)/)?.[1] ?? null;
const pendingDecision = reason => reason.match(/^decision (D-\d{4}) is/)?.[1] ?? null;
const node = id => String(id).replace(/[^A-Za-z0-9]/g, '');
const MAX_REASONS = 5;
const BAR = 10;

// One state per task, from its status, its readiness preview and its pull requests (a draft one is work in progress).
function taskState(t, byNumber) {
  const reasons = t.reasons ?? [];
  if (t.status === 'Done') return { icon: '✅', key: 'done', next: 'Done' };
  if (t.status === 'Blocked') return { icon: '⛔', key: 'blocked', next: 'Blocked: see its resume condition' };
  const prs = t.pull_requests ?? [];
  if (prs.some(n => !byNumber.get(n)?.draft)) return { icon: '🔵', key: 'review', next: `In review: #${prs.join(', #')}` };
  if (prs.length) return { icon: '🟠', key: 'progress', next: `In progress: draft #${prs.join(', #')}` };
  if (t.status === 'Draft') return { icon: '📝', key: 'draft', next: reasons.some(r => UNRECORDED.test(r) || r.startsWith('not yet recorded')) ? 'Draft: to be planned (branch, start revision)' : 'Draft' };
  if (t.readiness === 'Ready') return t.status === 'Active' ? { icon: '🟠', key: 'progress', next: 'In progress' } : { icon: '🟢', key: 'ready', next: 'Ready to start' };
  const ds = [...new Set(reasons.map(blockingDecision).filter(Boolean))];
  if (ds.length && ds.length === reasons.length) return { icon: '🔴', key: 'blocked', next: `Waiting on decision ${ds.join(', ')}` };
  if (reasons.some(r => r.startsWith('readiness is stale'))) return { icon: '🟡', key: 'attention', next: 'Records changed: reassess readiness' };
  return { icon: '🟡', key: 'attention', next: short(reasons[0] ?? t.readiness ?? 'Needs discovery', 70) };
}

export function renderStatus(s) {
  const lines = [];
  const rev = typeof s.revision === 'string' && /^[0-9a-f]{40,64}$/.test(s.revision) ? s.revision.slice(0, 12) : 'working tree';
  const people = s.owners?.length >= 2 ? s.owners : [];
  const owner = s.waiting.filter(w => w.owner !== 'agent');
  const agent = s.waiting.filter(w => w.owner === 'agent');
  const byNumber = new Map((s.pull_requests?.open ?? []).map(p => [p.number, p]));
  const state = t => taskState(t, byNumber);
  const open = [...s.milestones.flatMap(m => m.tasks), ...s.unassigned_tasks].filter(t => t.status !== 'Done');
  const count = key => open.filter(t => state(t).key === key).length;
  const decisionRecord = new Map([...(s.decisions?.open ?? []), ...(s.decisions?.proposed ?? [])].map(d => [d.id, d]));

  // What each open decision holds up: a task it blocks now (a reason) or at a later stage (pending).
  const holds = new Map();
  const hold = (d, kind, id) => { if (!holds.has(d)) holds.set(d, { now: [], later: [] }); if (!holds.get(d)[kind].includes(id)) holds.get(d)[kind].push(id); };
  for (const t of open) {
    for (const r of t.reasons ?? []) { const d = blockingDecision(r); if (d) hold(d, 'now', t.id); }
    for (const r of t.pending ?? []) { const d = pendingDecision(r); if (d) hold(d, 'later', t.id); }
  }

  lines.push(`# 📋 ${cell(s.project ?? '(no profile)')}: project status`, '');
  lines.push(`<sub>At \`${rev}\` · project readiness: ${cell(s.profile_readiness ?? 'not recorded')} · a derived, read-only view that approves nothing</sub>`, '');
  lines.push(`**Measure:** ${cell(s.measure ?? 'not recorded')}`, '');
  // Only the states some open task is in, so the strip fits a phone.
  const strip = [[`👤 Waiting on ${people.length ? 'owners' : 'you'}`, `**${owner.length}**`],
    ...[['ready', '🟢 Ready'], ['progress', '🟠 In progress'], ['review', '🔵 In review'], ['blocked', '🔴 Blocked'], ['attention', '🟡 Needs attention'], ['draft', '📝 Drafts']]
      .map(([key, label]) => [label, count(key)]).filter(([, n]) => n)];
  lines.push(`| ${strip.map(c => c[0]).join(' | ')} |`, `|${strip.map(() => ':-:').join('|')}|`, `| ${strip.map(c => c[1]).join(' | ')} |`, '');

  const ownerSection = (title, items, named) => {
    lines.push(`## 👤 ${title}`, '');
    if (!items.length) { lines.push('Nothing.', ''); return; }
    const reviews = items.filter(w => w.kind === 'review');
    const decisions = items.filter(w => w.kind === 'decision');
    const others = items.filter(w => !['review', 'decision'].includes(w.kind));
    const who = w => named && w.owner && w.owner !== 'owner' ? ` (${cell(w.owner)})` : '';
    if (reviews.length) {
      lines.push('**Pull requests**', '', '| Pull request | Task | Title | Author | Action |', '|---|---|---|---|---|');
      for (const w of reviews) {
        const p = byNumber.get(Number(w.item.slice(1).split(' ')[0]));
        lines.push(`| #${p?.number ?? cell(w.item.slice(1))} | ${p?.task ?? '—'} | ${p ? pipes(span(p.title)) : '—'} | ${p?.author ?? '—'} | ${w.detail.startsWith('approved') ? '✅ approved: merge once the required checks pass' : '👀 ready for review'}${who(w)} |`);
      }
      lines.push('');
    }
    if (decisions.length) {
      const rank = w => holds.get(w.item)?.now.length ? 0 : holds.get(w.item)?.later.length ? 1 : 2;
      lines.push('**Decisions**', '', `| | Decision | Question${named ? ' | Decides' : ''} | Holds up |`, `|:-:|---|---${named ? '|---' : ''}|---|`);
      const sorted = [...decisions].sort((a, b) => rank(a) - rank(b) || a.item.localeCompare(b.item));
      for (const w of sorted) {
        const d = decisionRecord.get(w.item);
        const h = holds.get(w.item);
        const up = h?.now.length ? `**${h.now.join(', ')} now**${h.later.length ? `; ${h.later.join(', ')} later` : ''}` : h?.later.length ? `${h.later.join(', ')} later` : 'no open task';
        const what = d ? `${d.status === 'Proposed' ? 'Proposed: approve or amend its answer' : 'Open: decide'} · before ${d.required_before ?? '?'}` : cell(w.detail);
        lines.push(`| ${['🔴', '🟠', '⚪'][rank(w)]} | **${w.item}**<br><sub>${what}</sub> | ${cell(d?.question ?? w.detail)}${named ? ` | ${cell(w.owner ?? 'not recorded')}` : ''} | ${up} |`);
      }
      lines.push('', '<sub>🔴 blocks a task now · 🟠 blocks a task at a later stage · ⚪ blocks no open task</sub>', '');
      lines.push('<details><summary>What each decision affects</summary>', '');
      for (const w of sorted) lines.push(`- **${w.item}**: ${cell(decisionRecord.get(w.item)?.affects?.join(', ') || 'not recorded')}`);
      lines.push('', '</details>', '');
    }
    if (others.length) {
      lines.push('**Also**', '');
      for (const w of others) lines.push(`- **${cell(w.item)}**${who(w)}: ${cell(w.detail)}`);
      lines.push('');
    }
  };
  if (!people.length) ownerSection('Waiting on you', owner, true);
  else {
    // One section per person; an item that names no listed person (an unset or shared owner) waits on either.
    for (const person of people) ownerSection(`Waiting on ${person}`, owner.filter(w => list(w.owner).includes(person)), false);
    const either = owner.filter(w => !list(w.owner).some(o => people.includes(o)));
    if (either.length) ownerSection('Waiting on either owner', either, true);
  }

  lines.push(`## 🤖 Next for the ${people.length ? 'agents' : 'agent'}`, '');
  lines.push(...(agent.length ? agent.map(w => `- **${w.item}**${people.length && w.person ? ` (${w.person}'s agents)` : ''}: ${w.detail}`) : ['Nothing queued outside the milestones below.']), '');

  // What must stay visible comes before the milestones, so a long issue cut at its size limit keeps it.
  if (s.record_errors.length) { lines.push('## ⚠️ Record errors', ''); for (const e of s.record_errors) lines.push(`- ${cell(e)}`); lines.push(''); }
  if (s.blocked.length) { lines.push('## ⛔ Blocked', ''); for (const b of s.blocked) lines.push(`- **${b.task}**: resume when ${cell(b.resume_condition ?? 'not recorded')}`); lines.push(''); }
  const where = t => t.milestone === '(none)' ? 'no milestone' : `milestone ${t.milestone}, which has no record`;
  const loose = s.unassigned_tasks.filter(t => t.status !== 'Done');
  if (loose.length) {
    lines.push('## 📂 Tasks outside a milestone record', '', '| | Task | Where | What |', '|:-:|---|---|---|');
    for (const t of loose) lines.push(`| ${state(t).icon} | **${t.id}** ${t.status ?? '?'} | ${where(t)} | ${short(t.title, 70)} |`);
    lines.push('');
  }

  if (s.pull_requests) {
    lines.push('## 🔀 Open pull requests', '');
    if (!s.pull_requests.open.length) lines.push('None.', '');
    else {
      lines.push('| Pull request | Task | Title | Author | Note |', '|---|---|---|---|---|');
      for (const p of s.pull_requests.open) {
        const note = [p.draft && 'draft', p.fork && 'fork: an outside contribution', !p.draft && !p.fork && p.review === 'APPROVED' && 'approved', !p.draft && !p.fork && p.review === 'CHANGES_REQUESTED' && 'changes requested'].filter(Boolean).join(' · ');
        lines.push(`| #${p.number} | ${p.task ?? '—'} | ${pipes(span(p.title))} | ${p.author ?? '—'} | ${note || '—'} |`);
      }
      lines.push('');
    }
  }

  if (!s.milestones.length) lines.push('## 🎯 Milestones', '', 'None.', '');
  for (const m of s.milestones) {
    const states = m.tasks.map(state);
    const done = states.filter(x => x.key === 'done').length;
    const filled = m.tasks.length ? Math.round(done / m.tasks.length * BAR) : 0;
    lines.push(`## 🎯 ${m.id} · ${cell(m.status ?? '?')}${people.length && m.owner ? ` · owner ${m.owner}` : ''}`, '');
    if (m.outcome) lines.push(`> ${cell(m.outcome)}`, '');
    if (m.measure) lines.push(`**Measure:** ${cell(m.measure)}`, '');
    const plan = m.plan?.planned.length ? ` · planned ${m.plan.planned.length} · discovered ${m.plan.discovered.length}` : '';
    lines.push(`**Progress** ${'🟩'.repeat(filled)}${'⬜'.repeat(BAR - filled)} **${done} of ${m.tasks.length} done**${plan}`, '');
    if (!m.tasks.length) { lines.push('No tasks yet.', ''); continue; }
    lines.push(`| | Task${people.length ? ' | Owner' : ''} | What | Next step | Pull request |`, `|:-:|---${people.length ? '|---' : ''}|---|---|---|`);
    m.tasks.forEach((t, i) => {
      const claim = !t.pull_requests ? '—' : t.pull_requests.length ? `#${t.pull_requests.join(', #')}` : t.claim_branch ? 'claim branch, no pull request' : ['Ready', 'Active'].includes(t.status) ? 'none yet' : '—';
      lines.push(`| ${states[i].icon} | **${t.id}**${t.discovered ? ' <sub>discovered</sub>' : ''}${people.length ? ` | ${cell(t.owner ?? '—')}` : ''} | ${short(t.title, 70)} | ${states[i].next} | ${claim} |`);
    });
    lines.push('');
    const edges = m.tasks.flatMap(t => [...new Set((t.reasons ?? []).map(blockingDecision).filter(Boolean))].map(d => [d, t.id]));
    if (edges.length) {
      lines.push('```mermaid', 'flowchart LR');
      for (const [d, id] of edges) lines.push(`  ${node(d)}["👤 ${node(d).replace(/^D/, 'D-')}"] -->|blocks| ${node(id)}["${node(id).replace(/^T/, 'T-')}"]`);
      lines.push('  classDef decision fill:#ffe3e3,stroke:#cf222e,color:#1f2328;', `  class ${[...new Set(edges.map(e => node(e[0])))].join(',')} decision;`, '```', '');
    }
    const detailed = m.tasks.filter(t => t.status !== 'Done' && ((t.reasons ?? []).length || (t.pending ?? []).length));
    if (detailed.length) {
      lines.push('<details><summary>Readiness, task by task</summary>', '');
      for (const t of detailed) {
        const all = [...(t.reasons ?? []), ...(t.pending ?? []).map(r => `later: ${r}`)];
        lines.push(`**${t.id}** ${cell(t.status ?? '?')}: ${cell(t.title)}. Readiness preview: ${cell(t.readiness ?? 'not assessed')}.`, '');
        for (const r of all.slice(0, MAX_REASONS)) lines.push(`- ${cell(r)}`);
        if (all.length > MAX_REASONS) lines.push(`- … ${all.length - MAX_REASONS} more: \`wf readiness --task ${t.id}\``);
        lines.push('');
      }
      lines.push('</details>', '');
    }
  }

  const earlier = s.unassigned_tasks.filter(t => t.status === 'Done');
  if (earlier.length) {
    lines.push(`<details><summary>📦 Earlier work outside a milestone record: ${earlier.length} Done</summary>`, '', '| Task | Where | What |', '|---|---|---|');
    for (const t of earlier) lines.push(`| ${t.id} | ${where(t)} | ${short(t.title, 90)} |`);
    lines.push('', '</details>', '');
  }
  if (s.open_for_agent.length) {
    lines.push(`<details><summary>❓ Open questions for the agent: ${s.open_for_agent.length}</summary>`, '');
    for (const d of s.open_for_agent) lines.push(`- **${d.id}** (${cell(d.type)}): ${cell(d.question ?? '')}`);
    lines.push('', '</details>', '');
  }
  if (s.feedback_open.length) lines.push(`**Open workflow feedback:** ${s.feedback_open.join(', ')}`, '');
  lines.push('<details><summary>ℹ️ About this view</summary>', '', `_${s.limitation}_`, '', '</details>');
  return lines.join('\n') + '\n';
}
