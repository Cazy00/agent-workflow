// Record loading and schema checks. SCHEMA.md "Profile", "Task", "Decision", "Feedback".
import { parseFrontMatter } from './frontmatter.js';
import { planningEnforcement } from './planning.js';
import { validateAcceptanceFiles } from './acceptance-files.js';
import { validateAttestConfig } from './attest.js';
import { CHECKPOINTS } from './checkpoint.js';

export class WfError extends Error {}

export const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [String(v)]);

export const DIRS = { task: 'tasks', decision: 'decisions', feedback: 'feedback/inbox', milestone: 'milestones' };
// A task's branch: exactly its ID (the claim branch, procedures/execute.md), or the ID after an optional `codex/`
// followed by `-` and a description.
export const TASK_BRANCH = /^(?:(?:codex|claude)\/)?(T-\d{4})(?:-|$)/; // the tool prefixes Codex and Claude Code give branches
const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REQUIRED = {
  milestone: ['id', 'outcome', 'status', 'coordinator', 'scope', 'governing', 'acceptance', 'authority', 'limits', 'demonstration', 'stop_conditions', 'release_authority'],
  profile: ['project', 'workflow_version', 'approval_mechanism', 'approval_label', 'coordinator', 'setup_budget_days'],
  task: ['id', 'title', 'status', 'owner', 'objective'],
  decision: ['id', 'question', 'type', 'owner', 'status', 'required_before'],
  feedback: ['id', 'task', 'revision', 'workflow_version', 'rule', 'status'],
};
const ENUMS = {
  // `signing: milestone` lets the coordinator work ahead of the owner's signatures inside the milestone and collect
  // them in one round at its end (procedures/approval-evidence.md *Milestone rounds*); `task` (the default) signs per task.
  milestone: { status: ['Draft', 'Authorised', 'Active', 'Blocked', 'Verified', 'Accepted', 'Released'], signing: ['task', 'milestone'] },
  profile: { approval_label: ['enforced', 'manual', 'owner-merge'] },
  task: { status: ['Draft', 'Ready', 'Active', 'Blocked', 'Done'] },
  decision: {
    status: ['Open', 'Proposed', 'Resolved'],
    type: ['decision', 'fact', 'technical', 'assumption', 'deferred'],
    required_before: ['implement', 'verify', 'integrate', 'accept', 'release', 'none'],
  },
  feedback: { status: ['Open', 'Classified', 'Closed'] },
};
const ID_RE = { milestone: /^M-\d{4}$/,  task: /^T-\d{4}$/, decision: /^D-\d{4}$/, feedback: /^F-\d{4}$/ };
export const DEFERRED_RE = /^(D-\d{4})@(implement|verify|integrate|accept|release)$/;

// The client page's settings (`wf status --client`). A theme's values reach CSS, so each is checked to be only what it
// says: a hex colour, a plain font name, a repository path, a number. Paths are read through the source, which refuses
// anything outside the repository.
const plainObject = v => v && typeof v === 'object' && !Array.isArray(v);
const only = (value, keys, where) => { if (!plainObject(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error(`${where} may contain only ${keys.join(', ')}`); };
const COLOR_KEYS = ['page', 'surface', 'text', 'muted', 'line', 'done', 'active', 'review', 'planned', 'brand', 'on_brand'];
function colors(value, where) {
  only(value, COLOR_KEYS, where);
  for (const [k, v] of Object.entries(value)) if (typeof v !== 'string' || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) throw new Error(`${where}.${k} must be a hex colour like #174A7C`);
}
const FONT = /^[A-Za-z0-9][A-Za-z0-9 \-]{0,59}$/;
const repoPath = (v, where) => { if (typeof v !== 'string' || !v || v.startsWith('/') || v.split('/').some(p => p === '..' || p === '.' || p === '') || /[\\\0]/.test(v)) throw new Error(`${where} must be a path inside the repository`); };
function validateClientConfig(c) {
  only(c, ['title', 'exclude', 'language', 'detail', 'theme'], 'client');
  if (c.detail !== undefined && !['stages', 'parts', 'full'].includes(c.detail)) throw new Error('client.detail must be stages, parts or full');
  if (c.title !== undefined && typeof c.title !== 'string') throw new Error('client.title must be a string');
  if (c.exclude !== undefined && (!Array.isArray(c.exclude) || c.exclude.some(id => !/^M-\d{4}$/.test(id)))) throw new Error('client.exclude must list milestone IDs like M-0001');
  if (c.language !== undefined && !['en', 'ar'].includes(c.language)) throw new Error('client.language must be en or ar');
  if (c.theme === undefined) return;
  only(c.theme, ['colors', 'dark', 'fonts', 'logo', 'radius'], 'client.theme');
  const t = c.theme;
  if (t.colors !== undefined) colors(t.colors, 'client.theme.colors');
  if (t.dark !== undefined && t.dark !== false) colors(t.dark, 'client.theme.dark');
  if (t.fonts !== undefined) {
    only(t.fonts, ['text', 'display', 'files'], 'client.theme.fonts');
    for (const k of ['text', 'display']) if (t.fonts[k] !== undefined && (typeof t.fonts[k] !== 'string' || !FONT.test(t.fonts[k]))) throw new Error(`client.theme.fonts.${k} must be a plain font name`);
    if (t.fonts.files !== undefined) {
      if (!Array.isArray(t.fonts.files) || t.fonts.files.length > 8) throw new Error('client.theme.fonts.files must list at most 8 font files');
      t.fonts.files.forEach((f, i) => {
        only(f, ['family', 'weight', 'file'], `client.theme.fonts.files[${i}]`);
        if (typeof f.family !== 'string' || !FONT.test(f.family)) throw new Error(`client.theme.fonts.files[${i}].family must be a plain font name`);
        if (f.weight !== undefined && (!Number.isInteger(f.weight) || f.weight < 100 || f.weight > 900)) throw new Error(`client.theme.fonts.files[${i}].weight must be 100 to 900`);
        repoPath(f.file, `client.theme.fonts.files[${i}].file`);
      });
    }
  }
  if (t.logo !== undefined) repoPath(t.logo, 'client.theme.logo');
  if (t.radius !== undefined && (typeof t.radius !== 'number' || t.radius < 0 || t.radius > 40)) throw new Error('client.theme.radius must be 0 to 40');
}

export function loadConfig(source) {
  const text = source.read('docs/workflow/config.json');
  if (text == null) throw new WfError(`docs/workflow/config.json not found in ${source.name}`);
  try {
    const config = JSON.parse(text);
    planningEnforcement(config);
    const tests = config.paths?.acceptance_tests;
    if (tests !== undefined && (!Array.isArray(tests) || tests.some(g => typeof g !== 'string' || !g.trim()))) throw new Error('paths.acceptance_tests must be an array of glob strings');
    validateAttestConfig(config.attest);
    if (config.client !== undefined) validateClientConfig(config.client);
    const checkpoint = config.approval?.checkpoint;
    if (checkpoint !== undefined) {
      if (!CHECKPOINTS.includes(checkpoint)) throw new Error('approval.checkpoint must be change, milestone or plan');
      if (config.approval.label !== 'owner-merge') throw new Error('approval.checkpoint applies only to owner-merge approval; manual and enforced modes keep their own approval route');
    }
    if (config.delegation !== undefined) {
      const d = config.delegation;
      if (!d || typeof d !== 'object' || Array.isArray(d) || Object.keys(d).some(k => k !== 'routine') ||
          !d.routine || typeof d.routine !== 'object' || Array.isArray(d.routine) || typeof d.routine.enabled !== 'boolean') {
        throw new Error('delegation must contain routine with an explicit boolean enabled');
      }
    }
    return config;
  } catch (e) { throw new WfError(`docs/workflow/config.json: ${e.message}`); }
}

export function loadRecord(source, relPath, expected) {
  const text = source.read(relPath);
  if (text == null) return null;
  const { data, body, errors } = parseFrontMatter(text);
  if (!data) return { path: relPath, data: null, body, errors: [...errors, 'no front matter'] };
  if (data.record !== expected) errors.push(`record is "${data.record ?? ''}", expected "${expected}"`);
  for (const f of REQUIRED[expected]) if (data[f] == null || data[f] === '' || (Array.isArray(data[f]) && !data[f].length)) errors.push(`missing ${f}`);
  for (const [f, allowed] of Object.entries(ENUMS[expected])) {
    if (data[f] != null && !allowed.includes(data[f])) errors.push(`${f} must be one of ${allowed.join(', ')} (got "${data[f]}")`);
  }
  if (expected !== 'profile' && data.id) {
    const stem = relPath.split('/').pop().replace(/\.md$/, '');
    if (!ID_RE[expected].test(data.id)) errors.push(`id ${data.id} is malformed`);
    else if (data.id !== stem) errors.push(`id ${data.id} does not match filename ${stem}`);
  }
  if (expected === 'task') {
    if (data.status === 'Blocked' && !data.resume_condition) errors.push('a Blocked task must record resume_condition');
    for (const d of list(data.deferred_inputs)) if (!DEFERRED_RE.test(d)) errors.push(`deferred input "${d}" must look like D-0001@verify`);
    if (data.baseline_result != null && !/^(pass$|fail:)/.test(data.baseline_result)) errors.push(`baseline_result must be "pass" or "fail: <summary>" (got "${data.baseline_result}")`);
  }
  if (expected === 'decision') {
    for (const f of ['supersedes', 'superseded_by']) if (data[f] && !ID_RE.decision.test(data[f])) errors.push(`${f} must be a decision id`);
  }
  return { path: relPath, data, body, errors };
}

export function loadAll(source, recordsDir) {
  const all = { profile: null, milestones: new Map(), tasks: new Map(), decisions: new Map(), feedback: new Map(), errors: [] };
  const profile = loadRecord(source, `${recordsDir}/profile.md`, 'profile');
  if (profile) { all.profile = profile; all.errors.push(...profile.errors.map((e) => `${profile.path}: ${e}`)); }
  const buckets = { milestone: all.milestones, task: all.tasks, decision: all.decisions, feedback: all.feedback };
  for (const [type, dir] of Object.entries(DIRS)) {
    for (const p of source.list(`${recordsDir}/${dir}`)) {
      const r = loadRecord(source, p, type);
      if (!r) continue;
      all.errors.push(...r.errors.map((e) => `${p}: ${e}`));
      buckets[type].set(r.data?.id ?? p, r);
    }
  }
  return all;
}

// With two or more people in the profile's `owners`, every task names the person whose agents implement it
// and every milestone the person who authorises and accepts it, so work cannot sit unassigned or with a
// misspelt owner that no one's agents pick up (procedures/shared.md).
// The profile's `owners` when it lists two or more distinct GitHub usernames, otherwise none.
export function listedOwners(profile) {
  const raw = profile?.owners;
  return Array.isArray(raw) && raw.length >= 2 && new Set(raw).size === raw.length && raw.every(n => USERNAME.test(n)) ? raw : [];
}
export function ownerErrors(all) {
  const raw = all.profile?.data?.owners;
  if (raw == null || (Array.isArray(raw) && !raw.length)) return [];
  const owners = listedOwners(all.profile.data);
  if (!owners.length) return [`${all.profile.path}: owners must list two or more distinct GitHub usernames, like [alice, bob]`];
  const errors = [];
  // Owner-merge counts one owner's own merge as approval; with several owners whose merge counts is undefined.
  if (all.profile.data.approval_label === 'owner-merge') errors.push(`${all.profile.path}: approval_label owner-merge is for one owner; a project with owners uses manual or enforced mode (procedures/shared.md)`);
  const check = (r, owner) => { if (!owners.includes(owner)) errors.push(`${r.path}: owner ${owner} is not one of the profile's owners (${owners.join(', ')})`); };
  for (const r of all.tasks.values()) if (r.data?.owner != null) check(r, r.data.owner); // a missing task owner is a schema error
  for (const r of all.milestones.values()) {
    if (!r.data) continue;
    if (r.data.owner == null) errors.push(`${r.path}: missing owner (the profile lists owners ${owners.join(', ')})`);
    else check(r, r.data.owner);
  }
  return errors;
}

// The acceptance-test globs come from `config` when given (a gate passes the baseline's), otherwise from the
// source's own config.
export function validateRecords(source, recordsDir, config = null) {
  const all = loadAll(source, recordsDir);
  let tests = config?.paths?.acceptance_tests;
  if (!config) { try { tests = loadConfig(source).paths?.acceptance_tests; } catch { /* a missing or invalid config is reported where it is loaded */ } }
  all.errors.push(...ownerErrors(all), ...validateAcceptanceFiles(source, { acceptanceTests: tests ?? [] }));
  if (!all.profile) all.errors.unshift(`${recordsDir}/profile.md: missing`);
  return {
    ok: all.errors.length === 0,
    errors: all.errors,
    counts: { milestones: all.milestones.size, tasks: all.tasks.size, decisions: all.decisions.size, feedback: all.feedback.size },
  };
}
