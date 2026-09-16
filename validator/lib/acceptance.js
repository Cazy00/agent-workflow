import { safePath } from './sources.js';
const key = m => JSON.stringify([m.acceptance, m.file, m.name]);
export function evaluateAcceptance({ baseline, candidate, execution, requiredIds = [] }) {
  const errors = [];
  const read = (source, path, fallback) => {
    try { const raw = source.read(path); if (raw === null) throw new Error('missing'); return JSON.parse(raw); }
    catch (e) { errors.push(`${path}: ${e.message}`); return fallback; }
  };
  const definitions = read(baseline, 'docs/workflow/acceptance.json', {}).examples;
  const old = read(baseline, 'tests/acceptance-map.json', []);
  const maps = read(candidate, 'tests/acceptance-map.json', []);
  const ids = new Map();
  if (!Array.isArray(definitions)) errors.push('acceptance examples must be an array');
  for (const d of Array.isArray(definitions) ? definitions : []) {
    if (!/^AC-\d+-\d+$/.test(d.id ?? '') || ids.has(d.id)) errors.push(`invalid or duplicate acceptance ${d.id}`);
    if (!['automated', 'human', 'operational', 'inspection'].includes(d.method)) errors.push(`acceptance ${d.id}: unknown evidence method`);
    try { if (!baseline.exists(safePath(d.requirement))) errors.push(`acceptance ${d.id}: governing requirement missing`); } catch { errors.push(`acceptance ${d.id}: invalid requirement path`); }
    ids.set(d.id, d);
  }
  for (const id of requiredIds) if (!ids.has(id)) errors.push(`unknown acceptance ${id} required by task`);
  const seen = new Set();
  for (const m of Array.isArray(maps) ? maps : []) {
    if (!ids.has(m.acceptance)) errors.push(`unknown acceptance ${m.acceptance}`);
    if (typeof m.name !== 'string' || !m.name.trim()) errors.push('test mapping needs a test name');
    try { if (!candidate.exists(safePath(m.file))) errors.push(`mapped test file missing: ${m.file}`); } catch { errors.push(`invalid mapped test path: ${m.file}`); }
    if (seen.has(key(m))) errors.push(`duplicate mapping ${key(m)}`);
    seen.add(key(m));
  }
  if (!Array.isArray(maps) || !Array.isArray(old)) errors.push('test mappings must be arrays');
  for (const m of Array.isArray(old) ? old : []) if (!seen.has(key(m))) errors.push(`removed required mapping ${key(m)}`);
  for (const d of ids.values()) if (d.method === 'automated' && requiredIds.includes(d.id) && !(Array.isArray(maps) && maps.some(m => m.acceptance === d.id))) errors.push(`missing automated coverage for ${d.id}`);
  if (execution?.revision !== candidate.name || !Array.isArray(execution?.tests)) errors.push('execution evidence is missing or names a different candidate revision');
  for (const m of Array.isArray(maps) ? maps : []) {
    const runs = (execution?.tests ?? []).filter(r => r.file === m.file && r.name === m.name);
    if (runs.length !== 1 || runs[0].status !== 'passed') errors.push(`required test did not run exactly once and pass: ${m.file} / ${m.name}`);
  }
  return { ok: errors.length === 0, errors, reviewRequired: true, limitation: 'Names and execution prove traceability only. Independent review must inspect assertions, helpers, fixtures, setup, and execution configuration, including untagged tests.' };
}
