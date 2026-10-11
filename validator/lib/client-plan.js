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
