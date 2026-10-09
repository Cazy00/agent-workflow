import { safePath } from './sources.js';
import { list } from './records.js';
const key = m => JSON.stringify([m.acceptance, m.file, m.name]);
const MAP = 'tests/acceptance-map.json';
const IN_PROGRESS = ['Authorised', 'Active', 'Blocked'];

// MAINT-0012: owner-approved acceptance tests are written and approved before the work (readiness.md), so they fail
// until the tasks that serve them are done. A scenario is pending while the milestone that lists it is in progress and a
// task of that milestone that serves it is not yet Done, other than the tasks a change delivers; its mapped tests must
// still run once, and may fail until then. `records` is lib/records.js loadAll. Returns acceptance ID → the IDs of the
// tasks it waits for.
export function pendingAcceptance(records, delivering = []) {
  const pending = new Map();
  const tasks = [...(records?.tasks?.values() ?? [])].map(r => r.data ?? {});
  for (const m of records?.milestones?.values() ?? []) {
    const milestone = m.data ?? {};
    if (!IN_PROGRESS.includes(milestone.status)) continue;
    for (const id of list(milestone.acceptance)) {
      const waiting = tasks.filter(t => t.milestone === milestone.id && list(t.acceptance).includes(id) && t.status !== 'Done' && !delivering.includes(t.id)).map(t => t.id);
      if (waiting.length) pending.set(id, [...new Set([...(pending.get(id) ?? []), ...waiting])].sort());
    }
  }
  return pending;
}

// What every given set of records leaves pending: a gate passes the approved baseline's records and the candidate's (and
// closeout the trusted tip's too), so neither side alone can excuse a test. Records the agent wrote can only make it
// stricter; which scenarios wait for which tasks grows only with the owner (pendingChange, ci.js).
export function pendingIn(sets, delivering = []) {
  const [first, ...rest] = sets.map(r => pendingAcceptance(r, delivering));
  const out = new Map();
  for (const [id, waiting] of first ?? []) {
    const kept = waiting.filter(t => rest.every(p => p.get(id)?.includes(t)));
    if (kept.length && rest.every(p => p.has(id))) out.set(id, kept);
  }
  return out;
}

// How the scenarios waiting for tasks differ from `before` to `after` (records, nothing delivered): `added` lists each
// scenario that waits for a task it did not wait for before (a new or reopened task, or one given the scenario), which
// only the owner may approve, and `completed` each scenario that stops waiting, with the tasks it waited for, whose
// mapped tests must pass from then on.
export function pendingChange(before, after) {
  const was = pendingAcceptance(before), is = pendingAcceptance(after);
  const added = [...is].flatMap(([acceptance, ts]) => ts.filter(t => !was.get(acceptance)?.includes(t)).map(task => ({ acceptance, task })));
  const completed = [...was].filter(([acceptance]) => !is.has(acceptance)).map(([acceptance, tasks]) => ({ acceptance, tasks }));
  return { added, completed };
}

// A mapped test that did not pass, and the tasks its scenario waits for (ci's notes, the signing brief).
export const pendingRun = (m, runs, waiting) => ({ acceptance: m.acceptance, file: m.file, name: m.name, runs: runs.length, status: runs.length === 1 ? runs[0].status : null, waiting });
export const pendingNote = w => `pending acceptance test ${w.file} / ${w.name} (${w.acceptance}) ${w.status}; it may fail until ${w.waiting.join(', ')} ${w.waiting.length === 1 ? 'is' : 'are'} Done, and must pass from then on`;

export function evaluateAcceptance({ baseline, candidate, task, execution, requiredIds = [], taskRequirements, enforced = false, pending = new Map() }) {
  const errors = [];
  const unverified = [];
  const waived = [];
  // Mapping preservation is global to the candidate, but a migration grant belongs
  // to one selected task and that task must require the migrated acceptance ID.
  const requirements = new Map(taskRequirements ?? [[task, requiredIds]]);
  const requiredAcceptance = [...new Set([...requirements.values()].flat())];
  const read = (source, path, fallback) => {
    try { const raw = source.read(path); if (raw === null) throw new Error('missing'); return JSON.parse(raw); }
    catch (e) { errors.push(`${path}: ${e.message}`); return fallback; }
  };
  const acceptance = read(baseline, 'docs/workflow/acceptance.json', {});
  const definitions = acceptance?.examples;
  // A baseline whose history never held the map (a project moving its pin from a release that had none) requires no
  // mappings. A map that existed and was later removed, or a read that fails, still fails closed.
  const neverMapped = (() => {
    try { return !baseline.exists(MAP) && (baseline.kind !== 'git' || baseline.versions(MAP).length === 0); } catch { return false; }
  })();
  const old = neverMapped ? [] : read(baseline, MAP, []);
  const maps = read(candidate, 'tests/acceptance-map.json', []);
  const ids = new Map();
  if (!Array.isArray(definitions)) errors.push('acceptance examples must be an array');
  for (const d of Array.isArray(definitions) ? definitions : []) {
    if (!/^AC-\d+-\d+$/.test(d.id ?? '') || ids.has(d.id)) errors.push(`invalid or duplicate acceptance ${d.id}`);
    if (!['automated', 'human', 'operational', 'inspection'].includes(d.method)) errors.push(`acceptance ${d.id}: unknown evidence method`);
    try { if (!baseline.exists(safePath(d.requirement))) errors.push(`acceptance ${d.id}: governing requirement missing`); } catch { errors.push(`acceptance ${d.id}: invalid requirement path`); }
    ids.set(d.id, d);
  }
  for (const id of requiredAcceptance) if (!ids.has(id)) errors.push(`unknown acceptance ${id} required by task`);
  const seen = new Set();
  for (const m of Array.isArray(maps) ? maps : []) {
    if (!ids.has(m.acceptance)) errors.push(`unknown acceptance ${m.acceptance}`);
    if (typeof m.name !== 'string' || !m.name.trim()) errors.push('test mapping needs a test name');
    try { if (!candidate.exists(safePath(m.file))) errors.push(`mapped test file missing: ${m.file}`); } catch { errors.push(`invalid mapped test path: ${m.file}`); }
    if (seen.has(key(m))) errors.push(`duplicate mapping ${key(m)}`);
    seen.add(key(m));
  }
  if (!Array.isArray(maps) || !Array.isArray(old)) errors.push('test mappings must be arrays');
  const oldKeys = new Set((Array.isArray(old) ? old : []).map(key));
  const migrations = Object.hasOwn(acceptance ?? {}, 'mapping_migrations') ? acceptance.mapping_migrations : [];
  if (!Array.isArray(migrations)) errors.push('mapping_migrations must be an array');
  const migratedFrom = new Set();
  const migratedTo = new Set();
  const allowedRemovals = new Set();
  const eligible = [];
  const manifestStart = errors.length;
  const fields = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === expected.slice().sort().join(',');
  for (const [index, migration] of (Array.isArray(migrations) ? migrations : []).entries()) {
    const label = `mapping_migrations[${index}]`;
    if (!fields(migration, ['task', 'from', 'to', 'requirement']) ||
        !fields(migration.from, ['acceptance', 'file', 'name']) ||
        !fields(migration.to, ['acceptance', 'file', 'name']) ||
        typeof migration.task !== 'string' || !/^T-\d{4}$/.test(migration.task) ||
        ![migration.requirement, ...Object.values(migration.from), ...Object.values(migration.to)].every(v => typeof v === 'string' && v.trim() === v && v.length > 0)) {
      errors.push(`${label}: malformed mapping migration`);
      continue;
    }
    const entryStart = errors.length;
    const from = key(migration.from);
    const to = key(migration.to);
    if (migratedFrom.has(from) || migratedTo.has(to)) errors.push(`${label}: mapping migrations must be one-to-one`);
    migratedFrom.add(from);
    migratedTo.add(to);
    const definition = ids.get(migration.from.acceptance);
    if (from === to || migration.from.acceptance !== migration.to.acceptance ||
        definition?.method !== 'automated' || definition.requirement !== migration.requirement) {
      errors.push(`${label}: migration must preserve an approved automated acceptance and its requirement`);
      continue;
    }
    try { if (!baseline.exists(safePath(migration.requirement))) errors.push(`${label}: governing requirement missing on baseline`); }
    catch { errors.push(`${label}: invalid governing requirement path`); }
    for (const endpoint of [migration.from, migration.to]) {
      try { safePath(endpoint.file); } catch { errors.push(`${label}: invalid mapped test path: ${endpoint.file}`); }
    }
    // Once merged, the destination is the ordinary protected baseline mapping. Its old grant is inert.
    if (!oldKeys.has(from)) {
      if (!oldKeys.has(to)) errors.push(`${label}: neither source nor consumed destination is in the baseline map`);
      continue;
    }
    // Both on the baseline: the grant removes nothing. Only its own task, trying to drop the source, is told why.
    if (oldKeys.has(to)) {
      if (requirements.has(migration.task) && !seen.has(from)) errors.push(`${label}: destination is already mapped on the baseline`);
      continue;
    }
    if (!requirements.has(migration.task) || seen.has(from)) continue;
    if (!requirements.get(migration.task).includes(migration.from.acceptance)) {
      errors.push(`${label}: migrated acceptance is not required by the current task`);
      continue;
    }
    if (!seen.has(to)) { errors.push(`${label}: destination mapping is missing from candidate`); continue; }
    if (errors.length === entryStart) eligible.push({ from, label });
  }
  for (const value of migratedFrom) if (migratedTo.has(value)) errors.push(`mapping migrations cannot chain or reverse mapping ${value}`);
  if (errors.length === manifestStart) for (const { from, label } of eligible) {
    allowedRemovals.add(from);
    if (enforced) unverified.push(`${label}: renamed test execution and preserved coverage require technical review (unverified by this validator)`);
  }
  for (const m of Array.isArray(old) ? old : []) if (!seen.has(key(m)) && !allowedRemovals.has(key(m))) errors.push(`removed required mapping ${key(m)}`);
  for (const d of ids.values()) if (d.method === 'automated' && requiredAcceptance.includes(d.id) && !(Array.isArray(maps) && maps.some(m => m.acceptance === d.id))) errors.push(`missing automated coverage for ${d.id}`);
  if (!execution && enforced) unverified.push(`execution: no verification receipt; agents must substantiate the required test runs on the pull request; this validator has not authenticated them (${typeof enforced === 'string' ? enforced : 'enforced'} mode)`);
  else {
    if (execution?.revision !== candidate.name || !Array.isArray(execution?.tests)) errors.push('execution evidence is missing or names a different candidate revision');
    for (const m of Array.isArray(maps) ? maps : []) {
      const runs = (execution?.tests ?? []).filter(r => r.file === m.file && r.name === m.name);
      if (runs.length === 1 && runs[0].status === 'passed') continue;
      // A pending test still runs once and is reported; only its result may be a failure (MAINT-0012).
      const waiting = pending.get(m.acceptance);
      if (waiting && runs.length === 1) waived.push(pendingRun(m, runs, waiting));
      else if (waiting) errors.push(`pending test did not run exactly once: ${m.file} / ${m.name} (it may fail until ${waiting.join(', ')} ${waiting.length === 1 ? 'is' : 'are'} Done, but must run and be reported)`);
      else errors.push(`required test did not run exactly once and pass: ${m.file} / ${m.name}`);
    }
  }
  return { ok: errors.length === 0, errors, unverified, pending: waived, reviewRequired: true, limitation: 'Names and execution prove traceability only. Independent review must inspect assertions, helpers, fixtures, setup, and execution configuration, including untagged tests.' };
}
