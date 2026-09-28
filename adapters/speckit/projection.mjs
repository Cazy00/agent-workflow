import { parseFrontMatter } from '../../validator/lib/frontmatter.js';
import { safePath } from '../../validator/lib/sources.js';
import { digest, sha256 } from './files.mjs';

const VERSION = 'wf-task-projection/v1';
const scalar = value => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/[\\`*_[\]<>|]/g, '\\$&');

// Inputs are already selected canonical sources, not a task view. The caller
// must establish their complete governing closure and installation integrity.
export function renderTaskProjection({ sources, selectedTask, lockDigest }) {
  if (!/^T-\d{4}$/.test(selectedTask) || !/^[a-f0-9]{64}$/.test(lockDigest)) throw new Error('explicit native task and lock digest required');
  if (!Array.isArray(sources)) throw new Error('sources must be path/text entries');
  const paths = new Set();
  const normalized = sources.map(({ path, text, version = 'working' }) => {
    safePath(path);
    if (!['working','baseline'].includes(version) || paths.has(`${version}:${path}`) || typeof text !== 'string') throw new Error(`duplicate or invalid source: ${path}`);
    if (/^docs\/specs\/[^/]+\/tasks\.md$/.test(path)) throw new Error('a projection cannot be a canonical source');
    paths.add(`${version}:${path}`);
    return { path, text: text.replace(/\r\n/g, '\n'), version };
  }).sort((a,b) => `${a.version}:${a.path}` < `${b.version}:${b.path}` ? -1 : `${a.version}:${a.path}` > `${b.version}:${b.path}` ? 1 : 0);
  const tasks = normalized.filter(s => s.version === 'working' && /^docs\/workflow\/tasks\/T-\d{4}\.md$/.test(s.path)).map(s => {
    const record = parseFrontMatter(s.text);
    if (!record.data || record.errors.length || record.data.record !== 'task' ||
        !s.path.endsWith(`/${record.data.id}.md`) || !['Draft','Ready','Active','Blocked','Done'].includes(record.data.status))
      throw new Error(`invalid native task: ${s.path}`);
    return { ...record, path: s.path };
  });
  if (!tasks.some(t => t.data.id === selectedTask)) throw new Error('selected native task is absent from canonical sources');
  const sourceDigest = digest({ version: VERSION, selectedTask, lockDigest, sources: normalized });
  const lines = [`generated: ${VERSION}`, `selected_task: ${selectedTask}`, `source_digest: ${sourceDigest}`, '',
    '# Native task view', '', 'Generated and disposable. Edit native task records; never import changes from this view.',
    'Status and checklist marks do not establish readiness, verification or acceptance.', ''];
  for (const task of tasks) {
    lines.push(`## ${task.data.id}${task.data.id === selectedTask ? ' (selected)' : ''} — ${scalar(task.data.title)}`, '',
      `Source: ${task.path}`, `Status: ${task.data.status}`, `Objective: ${scalar(task.data.objective)}`, '');
    // Show existing step marks only, without interpreting them as completed work.
    let fenced = false;
    for (const line of task.body.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (!fenced && /^\s*[-*] \[[ xX]\] /.test(line)) lines.push(line);
    }
    lines.push('');
  }
  const bytes = lines.join('\n');
  return { bytes, sourceDigest, contentDigest: sha256(bytes) };
}

export function verifyTaskProjection({ sources, selectedTask, lockDigest, bytes }) {
  const expected = renderTaskProjection({ sources, selectedTask, lockDigest });
  if (bytes === expected.bytes) return { ok: true, reasons: [] };
  const header = typeof bytes === 'string' ? bytes.match(/^source_digest: ([a-f0-9]{64})$/m)?.[1] : undefined;
  return { ok: false, reasons: [header === expected.sourceDigest ? 'projection_modified' : 'projection_stale'] };
}
