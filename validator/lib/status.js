// A derived, read-only view for the owner who coordinates rather than implements (IDEA-08). It grants
// no authority and no gate reads it: approval is never checked here, and each open task's readiness is
// previewed as if the baseline were approved, so the view shows what would still stand in the way.
import { list, loadAll, loadConfig } from './records.js';
import { evaluateReadiness } from './readiness.js';

const preview = Object.freeze({ mode: 'preview', claim: () => null, allows: purpose => purpose === 'baseline' });
const OWNER_DECISION_TYPES = ['decision', 'deferred'];

export function evaluateStatus({ baseline, candidate = baseline }) {
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  const all = loadAll(candidate, rd);
  const profile = all.profile?.data ?? {};
  const labels = [config.approval?.label ?? null, profile.approval_label ?? null];
  if (labels[0] && labels[1] && labels[0] !== labels[1]) all.errors.push(`approval label differs between docs/workflow/config.json (${labels[0]}) and the profile (${labels[1]})`);
  const waiting = [];
  const blocked = [];
  const openForAgent = [];
  const decisions = { open: [], proposed: [] };

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
    }
    if (t.status === 'Blocked') { view.resume_condition = t.resume_condition ?? null; blocked.push({ task: view.id, resume_condition: view.resume_condition, reasons: view.reasons ?? [] }); }
    return view;
  };
  const milestones = [...all.milestones.values()].map(rec => {
    const m = rec.data ?? {};
    const id = m.id ?? rec.path;
    if (m.status === 'Verified') waiting.push({ kind: 'acceptance', item: id, owner: 'owner', detail: 'milestone verified; owner product acceptance is next' });
    if (m.status === 'Accepted') waiting.push({ kind: 'release', item: id, owner: 'owner', detail: 'milestone accepted; release authority is next' });
    return { id, status: m.status ?? null, outcome: m.outcome ?? null, measure: m.measure ?? null, tasks: (byMilestone.get(id) ?? []).map(taskView), errors: rec.errors };
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
    waiting,
    milestones,
    unassigned_tasks: unassigned,
    blocked,
    decisions,
    open_for_agent: openForAgent,
    inbox: { count: inboxItems.length, items: inboxItems },
    setup_open: setupOpen,
    feedback_open: feedbackOpen,
    record_errors: all.errors,
    limitation: 'Derived, read-only view. It grants no authority and checks no approval; gates read the records directly. Readiness is previewed as if the baseline were approved. Usage and claims: wf runtime --action status. Latest handoffs and current activity: the task pull requests.',
  };
}

export function renderStatus(s) {
  const lines = [];
  const rev = typeof s.revision === 'string' && /^[0-9a-f]{40,64}$/.test(s.revision) ? s.revision.slice(0, 12) : 'working tree';
  lines.push(`# Status: ${s.project ?? '(no profile)'} @ ${rev}`, '');
  lines.push(`Measure: ${s.measure ?? 'not recorded'}`, `Project readiness: ${s.profile_readiness ?? 'not recorded'}`, '');
  const owner = s.waiting.filter(w => w.owner !== 'agent');
  const agent = s.waiting.filter(w => w.owner === 'agent');
  lines.push('## Waiting on the owner');
  lines.push(...(owner.length ? owner.map(w => `- ${w.item}${w.owner ? ` (${w.owner})` : ''}: ${w.detail}`) : ['- nothing']), '');
  lines.push('## Next for the agent');
  lines.push(...(agent.length ? agent.map(w => `- ${w.item}: ${w.detail}`) : ['- nothing queued outside the milestones below']), '');
  lines.push('## Milestones');
  if (!s.milestones.length) lines.push('- none', '');
  for (const m of s.milestones) {
    lines.push(`### ${m.id} — ${m.status ?? '?'} — ${m.outcome ?? ''}`);
    if (m.measure) lines.push(`Measure: ${m.measure}`);
    if (!m.tasks.length) lines.push('- no tasks');
    for (const t of m.tasks) {
      lines.push(`- ${t.id} ${t.status ?? '?'} · ${t.title ?? ''}${t.readiness ? ` · readiness preview: ${t.readiness}` : ''}`);
      const reasons = t.reasons ?? [];
      for (const r of reasons.slice(0, 5)) lines.push(`    - ${r}`);
      if (reasons.length > 5) lines.push(`    - … ${reasons.length - 5} more`);
    }
    lines.push('');
  }
  if (s.unassigned_tasks.length) { lines.push('## Tasks without a known milestone'); for (const t of s.unassigned_tasks) lines.push(`- ${t.id} ${t.status ?? '?'} (milestone ${t.milestone})`); lines.push(''); }
  if (s.blocked.length) { lines.push('## Blocked'); for (const b of s.blocked) lines.push(`- ${b.task}: resume when ${b.resume_condition ?? 'not recorded'}`); lines.push(''); }
  if (s.open_for_agent.length) { lines.push('## Open questions for the agent'); for (const d of s.open_for_agent) lines.push(`- ${d.id} (${d.type}): ${d.question ?? ''}`); lines.push(''); }
  if (s.feedback_open.length) lines.push(`Open workflow feedback: ${s.feedback_open.join(', ')}`, '');
  if (s.record_errors.length) { lines.push('## Record errors'); for (const e of s.record_errors) lines.push(`- ${e}`); lines.push(''); }
  lines.push(`_${s.limitation}_`);
  return lines.join('\n') + '\n';
}
