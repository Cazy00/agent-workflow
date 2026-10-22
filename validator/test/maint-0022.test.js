import test from 'node:test';
import assert from 'node:assert/strict';
import { evidence, project } from './helpers/maint-0018.js';

// MAINT-0022: the owner's review diet of 22 October 2026, for projects. review.cadence milestone: tasks need no review, the
// milestone gets one review of its whole diff with a security focus on review.deep_paths, one fix check, no round three;
// review.same_vendor separate-session: a reviewer of the implementer's vendor counts from a fresh session; the milestone's
// plan gets one quick review before its tasks start. Without the new keys, v2.10.0 holds.

const diet = (more = {}) => c => ({ ...c, acceptance_evidence: true, review: { cadence: 'milestone', deep_paths: ['src/auth/**'], ...more } });
const noReview = head => { const e = evidence(head); delete e.review; return e; };
const levelNone = head => { const e = evidence(head); e.review = { level: 'none' }; return e; };
const ci = (p, head, e) => p.run(['ci', '--baseline', p.baseline, '--candidate', head, '--task', 'T-0001'], { evidence: e });
const findings = r => r.out?.findings.join(' | ') ?? r.stdout + r.stderr;

// Task 2. No task review under the milestone cadence, while the task's milestone is authorised; only the review is waived.
test('MAINT-0022: under cadence milestone a task merges with no review', t => {
  const p = project(t, { configEdit: diet() });
  p.write('src/a.js', 'export const result = 1;\n'); p.write('src/auth/session.js', 'export const session = 1;\n');
  const head = p.commit('T-0001: the work, a deep path among it');
  for (const e of [noReview(head), levelNone(head)]) {
    const r = ci(p, head, e);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(findings(r), /independent review evidence is missing|need a deep review/);
    assert.match(findings(r), /note: review\.cadence milestone: no task review is needed; the milestone review covers this change \(procedures\/review\.md\); its security focus includes the deep paths changed here: src\/auth\/session\.js/);
  }
  // A review given anyway is checked as given.
  const given = evidence(head); given.review.level = 'standard';
  assert.match(findings(ci(p, head, given)), /it changes paths that need a deep review \(review\.deep_paths\): src\/auth\/session\.js/);
});

test('MAINT-0022: a candidate that sets cadence milestone still needs its review', t => {
  const p = project(t);
  p.edit('docs/workflow/config.json', x => JSON.stringify(diet()(JSON.parse(x))));
  p.write('src/a.js', 'export const result = 1;\n'); const head = p.commit('T-0001: the work, and the cadence');
  const r = ci(p, head, noReview(head));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(findings(r), /independent review evidence is missing/);
  assert.doesNotMatch(findings(r), /review\.cadence milestone: no task review/);
});

// The implementer's vendor reviewing, with the fresh session recorded or not.
const sameVendor = (head, fresh = true) => { const e = evidence(head); Object.assign(e.review, { vendor: 'Anthropic', implementer_vendor: 'Anthropic' }); e.review.context.fresh_session = fresh; return e; };

test('MAINT-0022: without the new keys v2.10.0 holds', t => {
  const p = project(t);
  p.write('src/a.js', 'export const result = 1;\n'); const head = p.commit('T-0001: the work');
  assert.match(findings(ci(p, head, noReview(head))), /independent review evidence is missing/);
  assert.match(findings(ci(p, head, levelNone(head))), /review level none is only for a test-only change/);
  assert.match(findings(ci(p, head, sameVendor(head))), /the reviewer's vendor must differ from the implementer's/);
});

// Task 3. A reviewer of the implementer's vendor, from a fresh session, where the trusted branch's config allows it.
test('MAINT-0022: same vendor needs a fresh session', t => {
  const p = project(t, { configEdit: c => ({ ...c, review: { same_vendor: 'separate-session' } }) });
  p.write('src/a.js', 'export const result = 1;\n'); const head = p.commit('T-0001: the work');
  const ok = ci(p, head, sameVendor(head));
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const stale = ci(p, head, sameVendor(head, false));
  assert.equal(stale.status, 1, stale.stdout + stale.stderr);
  assert.match(findings(stale), /review\.same_vendor separate-session accepts that only with review\.context\.fresh_session true/);
});

test('MAINT-0022: no waiver outside an authorised milestone', t => {
  const p = project(t, { configEdit: diet(), baselineEdit: ({ edit }) => edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised', 'status: Verified')) });
  p.write('src/a.js', 'export const result = 1;\n'); const head = p.commit('T-0001: the work');
  const r = ci(p, head, noReview(head));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(findings(r), /independent review evidence is missing/);
});

test('MAINT-0022: an acceptance-test change keeps its owner approval under the cadence', t => {
  const p = project(t, { configEdit: c => diet()({ ...c, approval: { ...c.approval, defer_to_acceptance: true }, paths: { ...c.paths, acceptance_tests: ['src/acceptance/**', 'tests/acceptance-map.json'] } }) });
  p.write('src/acceptance/a.test.js', 'test("a", () => {});\n'); p.write('src/a.js', 'export const result = 1;\n');
  const head = p.commit('T-0001: the work and its acceptance test');
  const r = ci(p, head, noReview(head));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.out.deferred.join(' | '), /it changes acceptance tests: src\/acceptance\/a\.test\.js/);
});
