import fs from 'node:fs';
import { parseFrontMatter } from '../../validator/lib/frontmatter.js';
import { safePath } from '../../validator/lib/sources.js';
import { validateRecords } from '../../validator/lib/records.js';
import { contained, digest, writeNew } from './files.mjs';

export function featurePath(feature) {
  if (!/^docs\/specs\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature ?? '')) throw new Error('feature must be docs/specs/<lowercase-hyphenated-slug>');
  return feature;
}
const scalar = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || /[\r\n\0]/.test(value) || /^\[.*\]$/.test(value)) throw new Error(`invalid ${label}`);
  return value;
};
const array = (value, label, { empty = true } = {}) => {
  if (!Array.isArray(value) || (!empty && !value.length) || new Set(value).size !== value.length) throw new Error(`invalid ${label}`);
  return value.map(v => { scalar(v, label); if (label !== 'steps' && v.includes(',')) throw new Error(`commas are unsupported in ${label}`); return v; });
};
const exact = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(value, k))) throw new Error(`invalid ${label} fields`);
};

// Pure preparation. The writer must independently collect current allocation
// evidence and canonical sources; supplying an ID list is never proof of that.
export function prepareDraftTasks({ plan, sourceDigest, usedIds, exists }) {
  exact(plan, ['schema','feature','milestone','source_digest','tasks'], 'task plan');
  if (plan.schema !== 'wf-task-plan/v1' || plan.source_digest !== sourceDigest || !/^[a-f0-9]{64}$/.test(sourceDigest)) throw new Error('unsupported or stale task plan');
  featurePath(plan.feature);
  if (!/^M-\d{4}$/.test(plan.milestone) || !exists(`docs/workflow/milestones/${plan.milestone}.md`)) throw new Error('native milestone is missing');
  if (!Array.isArray(plan.tasks) || !plan.tasks.length) throw new Error('at least one coherent task required');
  const keys = new Set(), references = new Map();
  for (const task of plan.tasks) {
    exact(task, ['key','title','objective','owner','scope','acceptance','governing','prerequisites','decisions','risks','steps','verification','review'], 'task');
    if (!/^[a-z][a-z0-9-]*$/.test(task.key) || keys.has(task.key)) throw new Error('task keys must be distinct local names');
    keys.add(task.key);
    for (const field of ['title','objective','owner','verification','review']) scalar(task[field], field);
    for (const field of ['scope','acceptance','governing','prerequisites','decisions','risks','steps']) array(task[field], field, { empty: !['scope','acceptance','governing','steps'].includes(field) });
    for (const scope of task.scope) safePath(scope);
    for (const ref of task.governing) {
      if (ref === 'PROFILE') continue;
      const rel = /^T-\d{4}$/.test(ref) ? `docs/workflow/tasks/${ref}.md` : /^D-\d{4}$/.test(ref) ? `docs/workflow/decisions/${ref}.md` : ref.startsWith('contract:') ? ref.slice(9) : ref;
      safePath(rel); if (!exists(rel)) throw new Error(`missing governing source: ${ref}`);
    }
    for (const id of task.decisions) if (!/^D-\d{4}$/.test(id) || !exists(`docs/workflow/decisions/${id}.md`)) throw new Error(`missing decision: ${id}`);
    references.set(task.key, task.prerequisites);
  }
  for (const [key, refs] of references) {
    for (const ref of refs) {
      if (ref.startsWith('key:')) { if (!keys.has(ref.slice(4))) throw new Error(`missing local prerequisite: ${ref}`); }
      else if (/^T-\d{4}$/.test(ref)) { if (!exists(`docs/workflow/tasks/${ref}.md`)) throw new Error(`missing native prerequisite: ${ref}`); }
      else if (ref.startsWith('contract:')) { safePath(ref.slice(9)); if (!exists(ref.slice(9))) throw new Error(`missing contract: ${ref}`); }
      else throw new Error(`unsupported prerequisite: ${ref}`);
    }
  }
  const degrees = new Map([...references].map(([key,refs]) => [key, refs.filter(r=>r.startsWith('key:')).length]));
  const next = [...degrees].filter(([,n])=>n===0).map(([key])=>key);
  for (let i=0;i<next.length;i++) for (const [key,refs] of references) {
    if (refs.includes(`key:${next[i]}`)) {
      degrees.set(key,degrees.get(key)-1); if (degrees.get(key)===0) next.push(key);
    }
  }
  if (next.length !== keys.size) throw new Error('task prerequisite cycle');
  if (!Array.isArray(usedIds) || usedIds.some(id => !/^T-\d{4}$/.test(id))) throw new Error('invalid allocated ID inventory');
  const max = Math.max(0, ...usedIds.map(id => Number(id.slice(2))));
  if (max + plan.tasks.length > 9999) throw new Error('four-digit task ID space exhausted');
  const allocated = new Map(plan.tasks.map((t,i) => [t.key, `T-${String(max + i + 1).padStart(4,'0')}`]));
  return plan.tasks.map(t => {
    const id = allocated.get(t.key), rel = `docs/workflow/tasks/${id}.md`;
    if (exists(rel)) throw new Error(`task collision: ${rel}`);
    const fields = { record: 'task', id, title: t.title, status: 'Draft', owner: t.owner, objective: t.objective,
      milestone: plan.milestone, feature: plan.feature, acceptance: t.acceptance, feature_readiness: `${plan.feature}/spec.md`,
      risks: t.risks, design: `${plan.feature}/plan.md`, verification: t.verification, review: t.review,
      scope: t.scope, governing: [...new Set([...t.governing, `${plan.feature}/spec.md`, `${plan.feature}/plan.md`])],
      prerequisites: t.prerequisites.map(p => p.startsWith('key:') ? allocated.get(p.slice(4)) : p), decisions: t.decisions,
      assumptions: [], deferred_inputs: [], subset: [] };
    const front = Object.entries(fields).map(([k,v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`);
    const text = ['---', ...front, '---', `# ${id} — ${t.title}`, '', '## Implementation steps', '', ...t.steps.map(s => `- [ ] ${s}`), '',
      'Draft only. Readiness, implementation, review and acceptance use the native workflow.', ''].join('\n');
    const parsed = parseFrontMatter(text);
    if (parsed.errors.length || digest(parsed.data) !== digest(fields)) throw new Error(`task serialization would alter fields: ${id}`);
    return { id, path: rel, text };
  });
}

// Validate the candidate in memory before any write. Native schema/profile
// rules remain authoritative, including future changes to those rules.
export function validateDraftCandidate({ source, drafts }) {
  const proposed = new Map(drafts.map(d => [d.path,d.text]));
  const overlay = { ...source,
    read: p => proposed.has(p) ? proposed.get(p) : source.read(p),
    list: dir => [...new Set([...source.list(dir),...proposed.keys()].filter(p => p.slice(0,p.lastIndexOf('/')) === dir))].sort(),
  };
  const result = validateRecords(overlay,'docs/workflow');
  if (!result.ok) throw new Error(`invalid native Draft candidate: ${result.errors.join('; ')}`);
  return result;
}

// Creates no Ready or approved record. The caller serializes allocation before
// invoking this batch. Preflight precedes all writes; caught errors roll back
// only the exact files this call created, never pre-existing or modified files.
export function writeDraftBatch({ repo, drafts }) {
  for (const d of drafts) {
    if (!/^T-\d{4}$/.test(d.id) || d.path !== `docs/workflow/tasks/${d.id}.md` || parseFrontMatter(d.text).data?.status !== 'Draft') throw new Error('invalid Draft batch');
    const target = contained(repo, d.path);
    if (fs.existsSync(target)) throw new Error(`task collision: ${d.path}`);
  }
  if (new Set(drafts.map(d => d.path)).size !== drafts.length) throw new Error('duplicate Draft target');
  const created = [];
  try {
    for (const d of drafts) { writeNew(repo, d.path, d.text); created.push(d); }
  } catch (error) {
    for (const d of created) {
      const p = contained(repo, d.path);
      if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === d.text) fs.unlinkSync(p);
    }
    throw error;
  }
  return created.map(({ id, path }) => ({ id, path }));
}
