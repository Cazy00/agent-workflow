// The client plan (MAINT-0014): the project's phases and steps in the client's words, from the file `client.plan` names.
// It holds the plan's shape only; every state comes from the records. It is read at the same revision as the records
// (the trusted branch), so a branch being worked on cannot change it.
const LIMIT = 256 * 1024;
const plainObject = v => v && typeof v === 'object' && !Array.isArray(v);
const only = (v, keys, where) => {
  if (!plainObject(v)) throw new Error(`${where} must be an object`);
  if (Object.keys(v).some(k => !keys.includes(k))) throw new Error(`${where} may contain only ${keys.join(', ')}`);
};
const words = (v, where, required = false) => {
  if (v === undefined && !required) return;
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${where} must be a non-empty string`);
};

export function loadPlan(source, file) {
  const raw = source.read(file);
  if (raw == null) throw new Error(`client.plan: ${file} is not a file in ${source.name}`);
  if (Buffer.byteLength(raw) > LIMIT) throw new Error(`client.plan: ${file} is larger than 256 KB`);
  let plan;
  try { plan = JSON.parse(raw); } catch (e) { throw new Error(`client.plan: ${file} is not valid JSON: ${e.message}`); }
  const where = `client.plan (${file})`;
  only(plan, ['phases'], where);
  if (!Array.isArray(plan.phases) || !plan.phases.length) throw new Error(`${where}: phases must list at least one phase`);
  const placed = new Map(); // a milestone belongs to one step, so its parts are counted once
  plan.phases.forEach((phase, i) => {
    const at = `${where}: phases[${i}]`;
    only(phase, ['title', 'summary', 'steps'], at);
    words(phase.title, `${at}.title`, true); words(phase.summary, `${at}.summary`);
    if (!Array.isArray(phase.steps) || !phase.steps.length) throw new Error(`${at}.steps must list at least one step`);
    phase.steps.forEach((step, j) => {
      const sat = `${at}.steps[${j}]`;
      only(step, ['title', 'summary', 'milestones', 'done', 'added'], sat);
      words(step.title, `${sat}.title`, true); words(step.summary, `${sat}.summary`);
      if (step.done !== undefined && step.done !== true) throw new Error(`${sat}.done may only be true`);
      if (step.added !== undefined && (typeof step.added !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(step.added))) throw new Error(`${sat}.added must be a date like 2026-11-02`);
      if (step.milestones === undefined) return;
      if (step.done) throw new Error(`${sat}: a step is done by its milestones or by done: true, not both`);
      if (!Array.isArray(step.milestones) || step.milestones.some(id => typeof id !== 'string' || !/^M-\d{4}$/.test(id))) throw new Error(`${sat}.milestones must list milestone IDs like M-0001`);
      for (const id of step.milestones) {
        if (placed.has(id)) throw new Error(`${where}: ${id} is in two steps (${placed.get(id)} and ${sat})`);
        placed.set(id, sat);
      }
    });
  });
  return plan;
}

// A step from its milestones' stages. Done: done by hand, or every milestone signed off. In progress: a milestone under
// way, awaiting sign-off or paused, or a part moving. Next is given afterwards, to the first step neither.
function step({ title, summary, done, added, stages }) {
  const items = stages.flatMap(s => s.items);
  const moving = stages.some(s => s.moving) || items.some(i => i.state === 'active' || i.state === 'checking');
  const state = done || (stages.length && stages.every(s => s.finished)) ? 'done'
    : stages.some(s => s.tone === 'active' || s.tone === 'review') || moving ? 'active' : 'later';
  const total = stages.reduce((n, s) => n + (s.parts?.total ?? s.items.length), 0);
  const doneParts = stages.reduce((n, s) => n + (s.parts?.done ?? s.items.filter(i => i.state === 'done').length), 0); // items are empty at detail 'stages'
  const parts = total ? { done: doneParts, total } : null;
  return {
    title, summary, state, added, items, parts,
    on_hold: stages.reduce((n, s) => n + (s.on_hold ?? 0), 0),
    progress: state === 'done' ? 1 : parts ? parts.done / parts.total : 0,
  };
}
const share = steps => steps.length ? steps.reduce((n, s) => n + s.progress, 0) / steps.length : 0;

export function planView({ plan, stages, known, exclude }) {
  const byId = new Map(stages.map(s => [s.id, s]));
  const placed = new Set();
  const phases = plan.phases.map(p => ({
    title: p.title.trim(), summary: p.summary?.trim() ?? null,
    steps: p.steps.map(s => {
      const ids = s.milestones ?? [];
      for (const id of ids) if (!known.has(id)) throw new Error(`client.plan: the step "${s.title.trim()}" names ${id}, which has no milestone record`);
      ids.forEach(id => placed.add(id));
      const own = ids.filter(id => !exclude.has(id)).map(id => byId.get(id)).filter(Boolean);
      if (ids.length && !own.length) return null; // every milestone it names is left out of the page
      return step({ title: s.title.trim(), summary: s.summary?.trim() ?? null, done: s.done === true, added: Boolean(s.added), stages: own });
    }).filter(Boolean),
  })).filter(p => p.steps.length);
  // A milestone the plan does not place still shows, so a forgotten line in the plan hides nothing.
  const unplaced = stages.filter(s => !placed.has(s.id));
  if (unplaced.length) {
    if (!phases.length) phases.push({ title: null, summary: null, steps: [] });
    phases.at(-1).steps.push(...unplaced.map(s => step({ title: s.title, summary: s.outcome, done: false, added: true, stages: [s] })));
  }
  const steps = phases.flatMap(p => p.steps);
  const next = steps.find(s => s.state === 'later');
  if (next) next.state = 'next';
  for (const p of phases) p.progress = share(p.steps);
  const open = steps.findIndex(s => s.state !== 'done');
  return { phases, steps, progress: share(steps), position: open === -1 ? null : { index: open + 1, total: steps.length }, unplaced: unplaced.map(s => s.id) };
}
