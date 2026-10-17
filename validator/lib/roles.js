// MAINT-0020 P4: the model and effort each role is launched with (`roles` in the config; SCHEMA.md). M-0005 of mateen-systems ran
// 46 of 51 helpers at the session's xhigh effort, and every role on the coordinator's model, though execute.md said effort
// follows the review level. `wf brief --lead` prints the settings; `wf session` notes a recorded launch that differs. Neither
// grants anything. The reviewer's effort stays with review.md and review.second_model.
import { EFFORTS, LEVELS, ROLES, list } from './records.js';
import { deepChanges } from './paths.js';
import { reachesBelow } from './scope.js';

// What a project that names no `roles` gets, and what config.default.json writes (a test keeps the two equal).
export const DEFAULT_ROLES = {
  lead: { model: 'sonnet', effort: 'low' },
  implementer: { model: null, effort: { light: 'medium', standard: 'high', deep: 'xhigh' } },
  paperwork: { model: 'haiku', effort: 'low' },
  walker: { model: 'sonnet', effort: 'medium' },
  // MAINT-0020 P3: the acceptance helper writes the package the owner reads and trials from, too much for paperwork's Haiku at low.
  acceptance: { model: 'sonnet', effort: 'medium' },
};
// A role the config names only in part keeps the default for the rest; a given effort replaces the default's whole.
export const resolveRoles = config => Object.fromEntries(ROLES.map(r => [r, { ...DEFAULT_ROLES[r], ...(config.roles?.[r] ?? {}) }]));
// The effort for a review level; with no level, the default one (standard).
export const effortOf = (role, level) => (role.effort && typeof role.effort === 'object' ? role.effort[level ?? 'standard'] : role.effort) ?? null;

// The second model's settings for a review, null without one. The owner's rule (17 October 2026): small reviews and reviews alongside
// development use its `model` at high effort (at most max_effort); only the milestone review, the one last check of everything
// built, may use final_model, at final_effort, to conserve the second model's usage.
const atMost = (effort, max) => (max && EFFORTS.indexOf(effort) > EFFORTS.indexOf(max) ? max : effort);
export function secondModelOf(config, { milestone = false } = {}) {
  const m = config.review?.second_model;
  return m ? { tool: m.tool, model: (milestone && m.final_model) || m.model, effort: (milestone && m.final_effort) || atMost('high', m.max_effort) } : null;
}
// Its launch, detached (review.md), with the effort explicit: Codex's default effort is low, and a launch without one ran at low on
// 16 October 2026. For another tool the brief knows no command, and says so.
export const secondModelLaunch = (s, name) => (s.tool === 'codex'
  ? `\`setsid nohup codex exec -m ${s.model} -c model_reasoning_effort=${s.effort} "${name}: …" > REVIEW_OUTPUT 2>&1 &\``
  : `pass the effort explicitly when you launch ${s.tool}: the config names no command for it, and its default effort may be lower`);

// A task's review level: the first word of its `review` field when that is a level, else deep when its scope reaches a path of
// review.deep_paths (the rule the brief prints), else unread, which the caller treats as the default level, standard.
export function reviewLevel(task, deepPaths = []) {
  const word = String(task?.review ?? '').trim().match(/^[a-z]+/i)?.[0].toLowerCase();
  if (LEVELS.includes(word)) return { level: word, why: `the task's review field starts with ${word}` };
  // A scope entry is a path prefix: it reaches a glob that matches the path itself or a file under it, or a folder the glob
  // pins below it (v2.8.0 review X3: `src` reaches `src/auth/**`, which the probe of `src/x` missed; scope.js reachesBelow).
  const hit = list(task?.scope).map(s => String(s).replace(/\/+$/, '')).find(s => deepChanges(deepPaths, [s, `${s}/x`]).length || (deepPaths ?? []).some(g => reachesBelow(s, g)));
  if (hit) return { level: 'deep', why: `its scope reaches review.deep_paths (${hit})` };
  return { level: null, why: 'its review field names no level (light, standard or deep) and its scope reaches no review.deep_paths; standard is the default' };
}

// MAINT-0020 P14: the launch-name convention. A helper's description starts with its task or milestone and its role, then free
// text ("T-0025 implementer shop time zone"), so `wf usage` attributes its cost; M-0005's two studies sorted 51 helpers by hand.
// `wf brief --lead` prints the names; a description that does not follow it is read by keywords and marked inferred (usage.js).
// MAINT-0020 P1: a slice's helper adds ", slice N of M" after the role, which parseLaunchName reads past.
// MAINT-0020 P3: `plan` drafts the next milestone (wf brief --acceptance names it).
export const LAUNCH_ROLES = { task: ['lead', 'implementer', 'fix', 'reviewer', 'paperwork'], milestone: ['walker', 'acceptance', 'reviewer', 'plan'] };
export const launchName = (id, role, slice = null) => `${id} ${role}${slice ? `, slice ${slice[0]} of ${slice[1]}` : ''}`;
export function parseLaunchName(description) {
  const m = String(description ?? '').match(/^(T-\d{4}|M-\d{4}) ([a-z]+)(?=$|[\s:,.;(—–-])/);
  return m && LAUNCH_ROLES[m[1][0] === 'T' ? 'task' : 'milestone'].includes(m[2]) ? { id: m[1], role: m[2] } : null;
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
