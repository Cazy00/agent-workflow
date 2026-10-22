import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evidence, project } from './helpers/maint-0018.js';
import { gitSource } from '../lib/index.js';
import { acceptanceEvidenceErrors } from '../lib/acceptance-evidence.js';

// MAINT-0022: the owner's review diet of 22 October 2026, for projects. review.cadence milestone: tasks need no review, the
// milestone gets one review of its whole diff with a security focus on review.deep_paths, one fix check, no round three;
// review.same_vendor separate-session: a reviewer of the implementer's vendor counts from a fresh session; the milestone's
// plan gets one quick review before its tasks start. Without the new keys, v2.10.0 holds.

const diet = (more = {}) => c => ({ ...c, acceptance_evidence: true, review: { cadence: 'milestone', deep_paths: ['src/auth/**'], ...more } });
// The milestone's plan review on the trusted branch, which readiness needs under the cadence (Task 4).
const planLink = 'plan_review: https://github.com/fixture/project/pull/2#issuecomment-1\n';
const withLink = ({ edit }) => edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised\n', `status: Authorised\n${planLink}`));
const noReview = head => { const e = evidence(head); delete e.review; return e; };
const levelNone = head => { const e = evidence(head); e.review = { level: 'none' }; return e; };
const ci = (p, head, e) => p.run(['ci', '--baseline', p.baseline, '--candidate', head, '--task', 'T-0001'], { evidence: e });
const findings = r => r.out?.findings.join(' | ') ?? r.stdout + r.stderr;

// Task 2. No task review under the milestone cadence, while the task's milestone is authorised; only the review is waived.
test('MAINT-0022: under cadence milestone a task merges with no review', t => {
  const p = project(t, { configEdit: diet(), baselineEdit: withLink });
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
  const p = project(t, { configEdit: c => diet()({ ...c, approval: { ...c.approval, defer_to_acceptance: true }, paths: { ...c.paths, acceptance_tests: ['src/acceptance/**', 'tests/acceptance-map.json'] } }), baselineEdit: withLink });
  p.write('src/acceptance/a.test.js', 'test("a", () => {});\n'); p.write('src/a.js', 'export const result = 1;\n');
  const head = p.commit('T-0001: the work and its acceptance test');
  const r = ci(p, head, noReview(head));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.out.deferred.join(' | '), /it changes acceptance tests: src\/acceptance\/a\.test\.js/);
});

// Task 4. The milestone's one review: of the whole milestone diff (its base at or before every task's start), with the deep paths
// it reached as its security focus, and one fix check whose revision then covers the fixes, nothing after it.
function milestoneRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-maint-0022-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  const commit = m => { git('add', '-A'); git('commit', '-qm', m); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  write('src/a.js', 'a\n'); write('docs/workflow/milestones/M-0001.md', 'status: Authorised\n');
  const s1 = commit('M-0001 authorised; T-0001 starts here');
  write('src/a.js', 'a, T-0001\n'); const s2 = commit('T-0001 merged; T-0002 starts here');
  write('src/auth/session.js', 'T-0002\n'); const reviewed = commit('T-0002 merged');
  return { dir, git, write, commit, s1, s2, reviewed, at: rev => gitSource(dir, rev) };
}
const accept = (r, note = '') => { r.write('docs/workflow/milestones/M-0001.md', `status: Accepted\n${note}`); return r.commit('Accept M-0001'); };
const tasks = (s1, s2) => ({ tasks: new Map([['T-0001', { data: { id: 'T-0001', milestone: 'M-0001', status: 'Done', start_revision: s1 } }], ['T-0002', { data: { id: 'T-0002', milestone: 'M-0001', status: 'Done', start_revision: s2 } }], ['T-0003', { data: { id: 'T-0003', milestone: 'M-0001', status: 'Draft', start_revision: 'not started' } }]]) });
const acceptanceConfig = (review = { cadence: 'milestone', deep_paths: ['src/auth/**', 'src/billing/**'] }) => ({ paths: { production: ['src/**'], governing: ['docs/workflow/milestones/**'], planning: ['docs/**'] }, review });
function acceptanceOf(reviewed, walked = reviewed, more = {}) {
  return {
    schema: 'agent-workflow/acceptance-evidence@1', milestone: 'M-0001', candidate: walked,
    review: { reviewer: 'codereview milestone', model: 'claude:opus', revision: reviewed, report: 'https://github.com/o/r/pull/9#issuecomment-1', ...more },
    walkthrough: { not_applicable: 'the fixture has no user interface' },
    deferred: [], tests_changed: [],
  };
}
const acceptanceErrors = (r, head, e, { config = acceptanceConfig(), records } = {}) => acceptanceEvidenceErrors({ evidence: e, milestone: 'M-0001', config, candidate: r.at(head), records: [records ?? tasks(r.s1, r.s2)] }).join(' | ');

test('MAINT-0022: the milestone review covers every task from its start', t => {
  const r = milestoneRepo(t); const head = accept(r);
  assert.equal(acceptanceErrors(r, head, acceptanceOf(r.reviewed, r.reviewed, { base: r.s1, deep_paths: ['src/auth/**'] })), '');
  assert.match(acceptanceErrors(r, head, acceptanceOf(r.reviewed, r.reviewed, { base: r.s2, deep_paths: ['src/auth/**'] })), new RegExp(`the milestone review's base ${r.s2.slice(0, 12)} comes after T-0001's start_revision ${r.s1.slice(0, 12)}: under review\\.cadence milestone it reviews the whole milestone diff, from a base at or before every task's start`));
  assert.match(acceptanceErrors(r, head, acceptanceOf(r.reviewed, r.reviewed, { deep_paths: ['src/auth/**'] })), /the milestone review needs its base, the full commit hash its diff starts from \(review\.cadence milestone\)/);
  // A task record of either side counts: a candidate cannot move a start later to pass a narrower review.
  const moved = tasks(r.s2, r.s2);
  assert.match(acceptanceErrors(r, head, acceptanceOf(r.reviewed, r.reviewed, { base: r.s2, deep_paths: ['src/auth/**'] }), { records: { tasks: new Map([...moved.tasks, ['T-0001b', { data: { id: 'T-0001', milestone: 'M-0001', status: 'Done', start_revision: r.s1 } }]]) } }), /comes after T-0001's start_revision/);
  const lost = tasks(r.s1, 'f'.repeat(40));
  assert.match(acceptanceErrors(r, head, acceptanceOf(r.reviewed, r.reviewed, { base: r.s1, deep_paths: ['src/auth/**'] }), { records: lost }), /T-0002's start_revision ffffffffffff is not a commit of this repository/);
});

test('MAINT-0022: the milestone review names the deep paths it reached', t => {
  const r = milestoneRepo(t); const head = accept(r);
  assert.match(acceptanceErrors(r, head, acceptanceOf(r.reviewed, r.reviewed, { base: r.s1 })), /the milestone review's deep_paths must list the review\.deep_paths the milestone changed, its security focus: src\/auth\/\*\*/);
  assert.match(acceptanceErrors(r, head, acceptanceOf(r.reviewed, r.reviewed, { base: r.s1, deep_paths: ['src/billing/**'] })), /must list the review\.deep_paths the milestone changed, its security focus: src\/auth\/\*\*/);
  assert.equal(acceptanceErrors(r, head, acceptanceOf(r.reviewed, r.reviewed, { base: r.s1, deep_paths: ['src/auth/**'] })), '');
  assert.equal(acceptanceErrors(r, head, acceptanceOf(r.reviewed, r.reviewed, { base: r.s2, deep_paths: ['src/auth/**'] }), { records: tasks(r.s2, r.s2) }), '', 'the diff from s2 still reaches src/auth');
});

test('MAINT-0022: the milestone\'s fix check covers the fixes, and nothing after it', t => {
  const r = milestoneRepo(t);
  r.write('src/a.js', 'a, T-0001, fixed\n'); const fixed = r.commit('the review\'s fix');
  const head = accept(r);
  const fix = (revision, more = {}) => ({ base: r.s1, deep_paths: ['src/auth/**'], fix_check: { revision, reviewer: 'codereview fixcheck', model: 'claude:sonnet', report: 'https://github.com/o/r/pull/9#issuecomment-2', ...more } });
  assert.equal(acceptanceErrors(r, head, acceptanceOf(r.reviewed, fixed, fix(fixed))), '');
  assert.match(acceptanceErrors(r, head, acceptanceOf(r.reviewed, fixed)), /the milestone review's revision [0-9a-f]{12} is followed by changes to src\/a\.js/, 'no fix check');
  assert.match(acceptanceErrors(r, head, acceptanceOf(r.reviewed, fixed, fix(r.s2))), /the milestone review's fix check must come after the review's revision/);
  assert.match(acceptanceErrors(r, head, acceptanceOf(r.reviewed, fixed, fix(fixed, { report: 'none' }))), /the milestone review's fix check needs its reviewer, model and an https report/);
  // A fix check on a side branch is not in this pull request's history.
  r.git('checkout', '-q', '-b', 'side', r.reviewed); r.write('src/a.js', 'side\n'); const side = r.commit('a side fix'); r.git('checkout', '-q', 'main');
  assert.match(acceptanceErrors(r, head, acceptanceOf(r.reviewed, fixed, fix(side))), /the milestone review's fix check revision [0-9a-f]{12} is not in this pull request's history/);
  // No round three: code after the fix check needs the owner, as code after an uncovered review does.
  r.write('src/a.js', 'a, T-0001, fixed again\n'); const again = r.commit('a fix after the fix check'); const later = accept(r, 'again\n');
  assert.match(acceptanceErrors(r, later, acceptanceOf(r.reviewed, again, fix(fixed))), /the milestone review's fix check revision [0-9a-f]{12} is followed by changes to src\/a\.js/);
});

test('MAINT-0022: without the new keys the acceptance evidence is read as in v2.10.0', t => {
  const r = milestoneRepo(t);
  r.write('src/a.js', 'a, T-0001, fixed\n'); const fixed = r.commit('the review\'s fix'); const head = accept(r);
  const fixCheck = { fix_check: { revision: fixed, reviewer: 'x', model: 'y', report: 'https://github.com/o/r/pull/9#issuecomment-2' } };
  const errors = acceptanceErrors(r, head, acceptanceOf(r.reviewed, fixed, fixCheck), { config: acceptanceConfig({ deep_paths: ['src/auth/**'] }) });
  assert.match(errors, /the milestone review's revision [0-9a-f]{12} is followed by changes to src\/a\.js/);
  assert.doesNotMatch(errors, /base|deep_paths/);
});

test('MAINT-0022: same vendor needs a fresh session in the milestone review too', t => {
  const r = milestoneRepo(t); const head = accept(r);
  const same = (sameVendor, fresh) => acceptanceErrors(r, head, acceptanceOf(r.reviewed, r.reviewed, { vendor: 'Anthropic', implementer_vendor: 'anthropic', ...(fresh === undefined ? {} : { fresh_session: fresh }) }), { config: acceptanceConfig({ same_vendor: sameVendor }) });
  assert.match(same('never', true), /the milestone review's vendor must differ from the implementer's/);
  assert.equal(same('separate-session', true), '');
  assert.match(same('separate-session'), /the milestone review is of the implementer's vendor: review\.same_vendor separate-session accepts that only with review\.fresh_session true/);
  assert.match(same('separate-session', 'yes'), /the milestone review's fresh_session must be true or false when given/);
});

// The plan's one quick review, linked from the milestone record on the trusted branch, before the milestone's tasks start.
test('MAINT-0022: the plan review is read from the trusted branch', t => {
  const readiness = (p, head) => p.run(['readiness', '--baseline', p.baseline, '--candidate', head, '--task', 'T-0001']);
  const missing = /milestone M-0001 has no plan_review: with review\.cadence milestone its plan gets one quick review before its tasks start \(procedures\/readiness\.md\)/;
  const p = project(t, { configEdit: diet() });
  withLink(p); const head = p.commit('the plan review, added by the candidate');
  const r = readiness(p, head);
  assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stdout, missing);
  const q = project(t, { configEdit: diet(), baselineEdit: withLink });
  const ok = readiness(q, q.baseline);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr); assert.doesNotMatch(ok.stdout, missing);
  const plain = project(t);
  assert.doesNotMatch(readiness(plain, plain.baseline).stdout, missing, 'the task cadence needs no plan review');
});
