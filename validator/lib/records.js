// Record loading and schema checks. SCHEMA.md "Profile", "Task", "Decision", "Feedback".
import { parseFrontMatter } from './frontmatter.js';

export class WfError extends Error {}

export const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [String(v)]);

export const DIRS = { task: 'tasks', decision: 'decisions', feedback: 'feedback/inbox', milestone: 'milestones' };
// A task's branch: exactly its ID (the claim branch, procedures/execute.md), or the ID after an optional `codex/`
// followed by `-` and a description.
export const TASK_BRANCH = /^(?:codex\/)?(T-\d{4})(?:-|$)/;
const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REQUIRED = {
  milestone: ['id', 'outcome', 'status', 'coordinator', 'scope', 'governing', 'acceptance', 'authority', 'limits', 'demonstration', 'stop_conditions', 'release_authority'],
  profile: ['project', 'workflow_version', 'approval_mechanism', 'approval_label', 'coordinator', 'setup_budget_days'],
  task: ['id', 'title', 'status', 'owner', 'objective'],
  decision: ['id', 'question', 'type', 'owner', 'status', 'required_before'],
  feedback: ['id', 'task', 'revision', 'workflow_version', 'rule', 'status'],
};
const ENUMS = {
  milestone: { status: ['Draft', 'Authorised', 'Active', 'Blocked', 'Verified', 'Accepted', 'Released'] },
  profile: { approval_label: ['enforced', 'manual'] },
  task: { status: ['Draft', 'Ready', 'Active', 'Blocked', 'Done'] },
  decision: {
    status: ['Open', 'Proposed', 'Resolved'],
    type: ['decision', 'fact', 'technical', 'assumption', 'deferred'],
    required_before: ['implement', 'verify', 'accept', 'release', 'none'],
  },
  feedback: { status: ['Open', 'Classified', 'Closed'] },
};
const ID_RE = { milestone: /^M-\d{4}$/,  task: /^T-\d{4}$/, decision: /^D-\d{4}$/, feedback: /^F-\d{4}$/ };
export const DEFERRED_RE = /^(D-\d{4})@(implement|verify|accept|release)$/;

export function loadConfig(source) {
  const text = source.read('docs/workflow/config.json');
  if (text == null) throw new WfError(`docs/workflow/config.json not found in ${source.name}`);
  try { return JSON.parse(text); } catch (e) { throw new WfError(`docs/workflow/config.json: ${e.message}`); }
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
  const check = (r, owner) => { if (!owners.includes(owner)) errors.push(`${r.path}: owner ${owner} is not one of the profile's owners (${owners.join(', ')})`); };
  for (const r of all.tasks.values()) if (r.data?.owner != null) check(r, r.data.owner); // a missing task owner is a schema error
  for (const r of all.milestones.values()) {
    if (!r.data) continue;
    if (r.data.owner == null) errors.push(`${r.path}: missing owner (the profile lists owners ${owners.join(', ')})`);
    else check(r, r.data.owner);
  }
  return errors;
}

export function validateRecords(source, recordsDir) {
  const all = loadAll(source, recordsDir);
  all.errors.push(...ownerErrors(all));
  if (!all.profile) all.errors.unshift(`${recordsDir}/profile.md: missing`);
  return {
    ok: all.errors.length === 0,
    errors: all.errors,
    counts: { milestones: all.milestones.size, tasks: all.tasks.size, decisions: all.decisions.size, feedback: all.feedback.size },
  };
}
