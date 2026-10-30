// Path classification with the precedence SCHEMA.md fixes. The config always comes from the baseline.
import { matchGlob } from './glob.js';
import { planningEnforcement } from './planning.js';

export const CATEGORIES = ['enforcement', 'production', 'generated', 'governing', 'planning'];

const patternOf = (g) => (typeof g === 'string' ? g : g.pattern);

// Owner-approved acceptance tests (`paths.acceptance_tests`, POLICY § 9): a path keeps its category and that
// category's gates, and a change to it also needs the owner's governing-change receipt listing it, so the agent that
// writes the code cannot also rewrite the tests that judge it.
export const isAcceptanceTest = (config, path) => (config.paths?.acceptance_tests ?? []).some(g => matchGlob(patternOf(g), path));
// Whether a path matches any of the config's globs, in either of their forms (a string, or { pattern }).
export const matchesAny = (globs, path) => (globs ?? []).some(g => matchGlob(patternOf(g), path));

// MAINT-0018: the changed paths that need a deep review (review.deep_paths, procedures/review.md). A glob anchored on a
// folder (`apps/server/migrations/**`) reaches everything under it. A glob that matches by name anywhere (one starting
// with `**`) reaches a test file only when it names tests itself: `**/*numbering*` names the code that numbers invoices,
// not its tests, which a client project's M-0004 reviewed deep three times for a test-only task.
// A test file, by each language's own convention, and narrowly, so a file in doubt stays deep (the fix review of S5): a
// code file in a test/, tests/ or __tests__/ folder, a Ruby file in spec/, or a.test.ts / a.spec.ts / a.e2e-spec.ts,
// a_test.go, a_test.exs, a_spec.rb, ATest.java (and Kotlin, Scala, Groovy, C#, Swift, PHP). A spec that is not code, such
// as an OpenAPI document, is never one.
const CODE = /\.(?:[cm]?[jt]sx?|py|rb|go|java|kts?|swift|php|rs|cs|dart|exs?|scala|groovy|cc|cpp|c|h)$/;
const TEST_FILE = [
  /(?:^|\/)(?:tests?|__tests__)\/.+/,
  /(?:^|\/)spec\/.+\.rb$/,
  /\.(?:test|spec|e2e-spec)\.[cm]?[jt]sx?$/,
  /_test\.(?:go|exs)$/,
  /_spec\.rb$/,
  /[a-z0-9]Tests?\.(?:java|kts?|scala|groovy|cs|swift|php)$/,
];
export const isTestPath = p => CODE.test(p) && TEST_FILE.some(r => r.test(p));
// MAINT-0021: a path a test-only change may touch with no review (procedures/review.md): anything in a test/, tests/ or
// __tests__/ folder, fixtures and helpers included, or a test file by isTestPath. ci.js adds the rest of the definition: no
// owner-approved acceptance test and no deep path.
export const isTestOnlyPath = p => /(?:^|\/)(?:tests?|__tests__)\//.test(p) || isTestPath(p);
const NAMES_TESTS = /(?:^|[^A-Za-z])(?:tests?|__tests__|specs?)(?:[^A-Za-z]|$)|Tests?(?![a-z])/;
const byName = g => /^\*\*/.test(g);
export const deepChanges = (globs, paths) => paths.filter(p => (globs ?? []).map(patternOf).some(g => matchGlob(g, p) && (!byName(g) || !isTestPath(p) || NAMES_TESTS.test(g))));

export function classifyPaths(config, changed) {
  const cfg = config.paths ?? {};
  const frontendPaths = planningEnforcement(config);
  return changed.map((raw) => {
    const path = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    const flag = isAcceptanceTest(config, path) ? { acceptance_test: true } : {};
    if (frontendPaths.some(g => matchGlob(g, path))) return { path, category: 'enforcement', ...flag };
    for (const category of CATEGORIES) {
      if (category === 'governing' && frontendPaths.length && matchGlob('docs/specs/**', path)) return { path, category, ...flag };
      const hit = (cfg[category] ?? []).find((g) => matchGlob(patternOf(g), path));
      if (hit) return { path, category, producer: typeof hit === 'object' ? hit.producer : undefined, ...flag };
    }
    return { path, category: 'unclassified', ...flag };
  });
}

// MAINT-0025 (v2.14.0): "records only", the change CI may skip a project's product steps for (delivery.md) and the difference a
// baseline run may be lent across (baseline-run.js). One definition for both. Every path is a planning path (tasks, feedback,
// checkpoints, docs) or a milestone or decision record: those two are `governing` in the default config because the owner approves
// them, but they hold no code, so a milestone-close records change is records-only too. The records directory's config, acceptance
// definitions and profile change what a project's own checks run and never count; neither does an owner-approved acceptance test.
export const NOT_PLANNING = ['config.json', 'acceptance.json', 'profile.md'];
export function isRecordsOnlyPath(config, path) {
  const rd = `${(config.records_dir ?? 'docs/workflow').replace(/\/+$/, '')}/`;
  if (path.startsWith(rd) && NOT_PLANNING.includes(path.slice(rd.length))) return false;
  const [c] = classifyPaths(config, [path]);
  if (c.acceptance_test) return false;
  if (c.category === 'planning') return true;
  return c.category === 'governing' && ['milestones/', 'decisions/'].some(d => path.startsWith(rd + d));
}
// At least one path, and every one of them.
export const recordsOnly = (config, paths) => paths.length > 0 && paths.every(p => isRecordsOnlyPath(config, p.replace(/\\/g, '/').replace(/^\.\//, '')));
