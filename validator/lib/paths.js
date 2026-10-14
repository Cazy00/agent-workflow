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

// MAINT-0018: the changed paths that need a deep review (review.deep_paths, procedures/review.md). A test file is reached
// only by a glob that names a test location itself: `**/*numbering*` names the code that numbers invoices, not its tests,
// which mateen-systems' M-0004 reviewed deep three times for a test-only task.
// A test file is a code file in a test directory (test/, tests/, __tests__/, spec/) or named as one (a.test.ts, a_test.go,
// a.spec.ts, a_spec.rb, test_a.py, ATest.java); a spec file that is not code, such as an OpenAPI document, is not one.
const CODE = /\.(?:[cm]?[jt]sx?|py|rb|go|java|kts?|swift|php|rs|cs|dart|exs?|scala|cc|cpp|c|h)$/;
const TEST_DIR = /(?:^|\/)(?:tests?|__tests__|spec)\//;
const TEST_NAME = /(?:^|\/)test_[^/]*$|[._-](?:test|spec)s?\.[^/.]+$|[a-z0-9](?:Tests?|Spec)\.[^/.]+$/;
export const isTestPath = p => CODE.test(p) && (TEST_DIR.test(p) || TEST_NAME.test(p));
const NAMES_TESTS = /(?:^|[^A-Za-z])(?:tests?|__tests__|specs?)(?:[^A-Za-z]|$)|Tests?(?![a-z])/;
export const deepChanges = (globs, paths) => paths.filter(p => (globs ?? []).some(g => matchGlob(patternOf(g), p) && (!isTestPath(p) || NAMES_TESTS.test(patternOf(g)))));

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
