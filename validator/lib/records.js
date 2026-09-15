// Record loading and schema checks. SCHEMA.md "Profile", "Task", "Decision", "Feedback".
import { parseFrontMatter } from './frontmatter.js';

export class WfError extends Error {}

export const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [String(v)]);

const DIRS = { task: 'tasks', decision: 'decisions', feedback: 'feedback/inbox' };
const REQUIRED = {
  profile: ['project', 'workflow_version', 'approval_mechanism', 'approval_label', 'coordinator', 'setup_budget_days'],
  task: ['id', 'title', 'status', 'owner', 'objective'],
  decision: ['id', 'question', 'type', 'owner', 'status', 'required_before'],
  feedback: ['id', 'task', 'revision', 'workflow_version', 'rule', 'status'],
};
const ENUMS = {
  profile: { approval_label: ['enforced', 'manual'] },
  task: { status: ['Draft', 'Ready', 'Active', 'Blocked', 'Done'] },
  decision: {
    status: ['Open', 'Proposed', 'Resolved'],
    type: ['decision', 'fact', 'technical', 'assumption', 'deferred'],
    required_before: ['implement', 'verify', 'accept', 'release', 'none'],
  },
  feedback: { status: ['Open', 'Classified', 'Closed'] },
};
const ID_RE = { task: /^T-\d{4}$/, decision: /^D-\d{4}$/, feedback: /^F-\d{4}$/ };
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
  for (const f of REQUIRED[expected]) if (data[f] == null) errors.push(`missing ${f}`);
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
  const all = { profile: null, tasks: new Map(), decisions: new Map(), feedback: new Map(), errors: [] };
  const profile = loadRecord(source, `${recordsDir}/profile.md`, 'profile');
  if (profile) { all.profile = profile; all.errors.push(...profile.errors.map((e) => `${profile.path}: ${e}`)); }
  const buckets = { task: all.tasks, decision: all.decisions, feedback: all.feedback };
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

export function validateRecords(source, recordsDir) {
  const all = loadAll(source, recordsDir);
  if (!all.profile) all.errors.unshift(`${recordsDir}/profile.md: missing`);
  return {
    ok: all.errors.length === 0,
    errors: all.errors,
    counts: { tasks: all.tasks.size, decisions: all.decisions.size, feedback: all.feedback.size },
  };
}
