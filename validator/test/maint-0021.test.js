import test from 'node:test';
import assert from 'node:assert/strict';
import { evidence, project } from './helpers/maint-0018.js';
import { isTestOnlyPath } from '../lib/paths.js';

// MAINT-0021: the owner's review policy of 18 October 2026. A test-only change needs no review; the reviewer is another
// vendor's; one review on the final code; a fix check only after a blocking finding at deep or milestone; one reviewer
// command per level. M-0003 to M-0005 of mateen-systems ran about three reviews a change, and Codex ran out of quota.

// Item 1. A test-only change: every production path a test path, none an owner-approved acceptance test, none deep.
const noReview = head => { const e = evidence(head); delete e.review; return e; };
const levelNone = head => { const e = evidence(head); e.review = { level: 'none' }; return e; };
const ci = (p, head, e) => p.run(['ci', '--baseline', p.baseline, '--candidate', head, '--task', 'T-0001'], { evidence: e });

test('MAINT-0021: a test-only change merges with no review', t => {
  const p = project(t);
  p.write('src/a.test.js', 'test("a", () => {});\n'); const head = p.commit('T-0001: a test');
  for (const e of [noReview(head), levelNone(head)]) {
    const r = ci(p, head, e);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.out.findings.join(' | '), /independent review evidence is missing/);
    assert.match(r.out.findings.join(' | '), /a test-only change: no review is needed/);
  }
});

test('MAINT-0021: level none on product code fails', t => {
  const p = project(t);
  p.write('src/a.js', 'export const result = 1;\n'); const head = p.commit('T-0001: the work');
  const r = ci(p, head, levelNone(head));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.out.findings.join(' | '), /review level none is only for a test-only change/);
  const missing = ci(p, head, noReview(head));
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.match(missing.out.findings.join(' | '), /independent review evidence is missing/);
});

test('MAINT-0021: an acceptance test change is never test-only', t => {
  const p = project(t, { configEdit: c => ({ ...c, paths: { ...c.paths, acceptance_tests: ['src/acceptance/**'] } }) });
  p.write('src/acceptance/a.test.js', 'test("a", () => {});\n'); const head = p.commit('T-0001: an acceptance test');
  const r = ci(p, head, noReview(head));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.out.findings.join(' | '), /independent review evidence is missing/);
});

test('MAINT-0021: a deep test path is not test-only', t => {
  const p = project(t, { configEdit: c => ({ ...c, review: { deep_paths: ['**/*numbering*.test.js'] } }) });
  p.write('src/numbering.test.js', 'test("n", () => {});\n'); const head = p.commit('T-0001: a numbering test');
  const r = ci(p, head, noReview(head));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.out.findings.join(' | '), /independent review evidence is missing/);
});

test('MAINT-0021: a test-only path is anything in a test folder, or a test file', () => {
  for (const p of ['tests/fixtures/a.json', 'test/helpers.py', 'src/__tests__/x.snap', 'src/a.test.ts', 'pkg/a_test.go']) assert.equal(isTestOnlyPath(p), true, p);
  for (const p of ['src/a.js', 'docs/tests.md', 'src/testsuite/a.js', 'contest/a.js', 'tests.json']) assert.equal(isTestOnlyPath(p), false, p);
});
