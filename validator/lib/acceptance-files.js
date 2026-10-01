// Structural checks of the acceptance definitions and the test map, run with the other records (`wf records`), so a
// malformed ID or a mapping to an undefined ID is caught when it is written, not at the first `wf ci` of a task. Setup
// once recorded `AC-M1-1`, which every later acceptance evaluation rejects, and `wf records` passed. The migration
// grants and execution evidence stay in evaluateAcceptance (acceptance.js), which judges a candidate against a baseline.
import { safePath } from './sources.js';
import { matchGlob } from './glob.js';

export const ACCEPTANCE = 'docs/workflow/acceptance.json';
export const ACCEPTANCE_MAP = 'tests/acceptance-map.json';
export const ACCEPTANCE_ID = /^AC-\d+-\d+$/;
export const METHODS = ['automated', 'human', 'operational', 'inspection'];

// A file that is absent is not an error here: a project adopted before these files existed has none, and
// evaluateAcceptance decides what a task needs. A file that exists must parse and hold well-formed entries.
// With owner-approved acceptance tests (`paths.acceptance_tests`, POLICY § 9) the map and every file it names must be
// among them, or a mapping could point at a test the agent may change without the owner's receipt.
export function validateAcceptanceFiles(source, { acceptanceTests = [] } = {}) {
  const errors = [];
  const owned = path => acceptanceTests.some(g => matchGlob(g, path));
  const read = path => {
    const raw = source.read(path);
    if (raw == null) return { missing: true };
    try { return { value: JSON.parse(raw) }; } catch (e) { errors.push(`${path}: invalid JSON (${e.message})`); return { invalid: true }; }
  };
  // A file, not a directory: git's `cat-file -e` and fs.existsSync accept both.
  const exists = path => { try { safePath(path); return source.isFile ? source.isFile(path) : source.exists(path); } catch { return false; } };
  const ids = new Set();
  const definitions = read(ACCEPTANCE);
  if (definitions.value !== undefined) {
    const examples = definitions.value?.examples;
    if (!Array.isArray(examples)) errors.push(`${ACCEPTANCE}: examples must be an array`);
    for (const [i, d] of (Array.isArray(examples) ? examples : []).entries()) {
      const label = `${ACCEPTANCE}: examples[${i}]`;
      if (typeof d?.id !== 'string' || !ACCEPTANCE_ID.test(d.id)) { errors.push(`${label}: id ${JSON.stringify(d?.id ?? null)} must look like AC-001-1 (milestone number, then example number)`); continue; }
      if (ids.has(d.id)) errors.push(`${label}: duplicate id ${d.id}`);
      ids.add(d.id);
      if (!METHODS.includes(d.method)) errors.push(`${label}: ${d.id} method must be one of ${METHODS.join(', ')}`);
      if (typeof d.requirement !== 'string' || !exists(d.requirement)) errors.push(`${label}: ${d.id} requirement ${JSON.stringify(d.requirement ?? null)} is not a file in this revision`);
    }
    if (Object.hasOwn(definitions.value ?? {}, 'mapping_migrations') && !Array.isArray(definitions.value.mapping_migrations)) errors.push(`${ACCEPTANCE}: mapping_migrations must be an array`);
  }
  const definitionsUsable = definitions.missing || Array.isArray(definitions.value?.examples);
  const map = read(ACCEPTANCE_MAP);
  if (acceptanceTests.length && !owned(ACCEPTANCE_MAP)) errors.push(`${ACCEPTANCE_MAP} is not under paths.acceptance_tests, so a change to it would not need the owner's receipt; add it there`);
  if (map.value !== undefined) {
    if (!Array.isArray(map.value)) errors.push(`${ACCEPTANCE_MAP}: must be an array of {acceptance, file, name}`);
    const seen = new Set();
    for (const [i, m] of (Array.isArray(map.value) ? map.value : []).entries()) {
      const label = `${ACCEPTANCE_MAP}[${i}]`;
      // Unreadable definitions would report every mapping; the definition error above says enough.
      if (definitionsUsable && !ids.has(m?.acceptance)) errors.push(`${label}: acceptance ${JSON.stringify(m?.acceptance ?? null)} is not defined in ${ACCEPTANCE}`);
      if (typeof m?.name !== 'string' || !m.name.trim()) errors.push(`${label}: needs the test's full name`);
      if (typeof m?.file !== 'string' || !exists(m.file)) errors.push(`${label}: mapped test file ${JSON.stringify(m?.file ?? null)} is not in this revision`);
      else if (acceptanceTests.length && !owned(m.file)) errors.push(`${label}: mapped test file ${JSON.stringify(m.file)} is outside paths.acceptance_tests (${acceptanceTests.join(', ')}); move the test there, or add its path to paths.acceptance_tests with a workflow-change, so the owner approves changes to it`);
      const key = JSON.stringify([m?.acceptance, m?.file, m?.name]);
      if (seen.has(key)) errors.push(`${label}: duplicate mapping`);
      seen.add(key);
    }
  }
  return errors;
}
