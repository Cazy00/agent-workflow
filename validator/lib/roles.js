// MAINT-0020 P4: the model and effort each role is launched with (`roles` in the config; SCHEMA.md). M-0005 of mateen-systems ran
// 46 of 51 helpers at the session's xhigh effort, and every role on the coordinator's model, though execute.md said effort
// follows the review level. `wf brief --lead` prints the settings; `wf session` notes a recorded launch that differs. Neither
// grants anything. The reviewer's effort stays with review.md and review.second_model.
import { LEVELS, ROLES, list } from './records.js';
import { deepChanges } from './paths.js';

// What a project that names no `roles` gets, and what config.default.json writes (a test keeps the two equal).
export const DEFAULT_ROLES = {
  lead: { model: 'sonnet', effort: 'low' },
  implementer: { model: null, effort: { light: 'medium', standard: 'high', deep: 'xhigh' } },
  paperwork: { model: 'haiku', effort: 'low' },
  walker: { model: 'sonnet', effort: 'medium' },
};
// A role the config names only in part keeps the default for the rest; a given effort replaces the default's whole.
export const resolveRoles = config => Object.fromEntries(ROLES.map(r => [r, { ...DEFAULT_ROLES[r], ...(config.roles?.[r] ?? {}) }]));
// The effort for a review level; with no level, the default one (standard).
export const effortOf = (role, level) => (role.effort && typeof role.effort === 'object' ? role.effort[level ?? 'standard'] : role.effort) ?? null;

// A task's review level: the first word of its `review` field when that is a level, else deep when its scope reaches a path of
// review.deep_paths (the rule the brief prints), else unread, which the caller treats as the default level, standard.
export function reviewLevel(task, deepPaths = []) {
  const word = String(task?.review ?? '').trim().match(/^[a-z]+/i)?.[0].toLowerCase();
  if (LEVELS.includes(word)) return { level: word, why: `the task's review field starts with ${word}` };
  // A scope entry is a path prefix: it reaches a glob that matches the path itself or a file under it.
  const hit = list(task?.scope).map(s => String(s).replace(/\/+$/, '')).find(s => deepChanges(deepPaths, [s, `${s}/x`]).length);
  if (hit) return { level: 'deep', why: `its scope reaches review.deep_paths (${hit})` };
  return { level: null, why: 'its review field names no level (light, standard or deep) and its scope reaches no review.deep_paths; standard is the default' };
}

// Notes for a session outcome's `models` ({ role: { model, effort } }, what each role was launched with). A model alias and the
// ID that contains it are the same (`sonnet`, `claude-sonnet-5-5`), and a role set to inherit has no model to differ from.
const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
export const modelsShapeOk = m => isObject(m) && Object.values(m).every(u => isObject(u) && ['model', 'effort'].every(k => u[k] == null || typeof u[k] === 'string'));
const sameModel = (a, b) => { const [x, y] = [a, b].map(s => s.toLowerCase()); return x.includes(y) || y.includes(x); };
export function modelNotes(models, roles, level = null) {
  const notes = [];
  for (const [role, used] of Object.entries(models)) {
    const want = roles[role];
    if (!want) continue;
    if (want.model && used.model && !sameModel(used.model, want.model)) notes.push(`${role} ran on ${used.model}; roles.${role}.model says ${want.model}`);
    const allowed = want.effort && typeof want.effort === 'object' ? (level ? [want.effort[level]] : Object.values(want.effort)) : [want.effort];
    if (allowed[0] && used.effort && !allowed.includes(used.effort)) notes.push(`${role} ran at effort ${used.effort}; roles.${role}.effort says ${allowed.join(' or ')}${level ? ` for a ${level} task` : ''}`);
  }
  return notes;
}
