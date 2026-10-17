import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cli, evidence, project, taskPath } from './helpers/maint-0018.js';
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

// Item 3. One reviewer command for every level (review.reviewer_command); the briefs and the budget follow it.
const reviewIs = text => x => x.replace(/^review: .*$/m, `review: ${text}`);
const wf = (p, ...args) => spawnSync(process.execPath, [cli, ...args, '--repo', p.repo], { encoding: 'utf8' });
const command = { second_model: { tool: 'codex', model: 'm1', final_model: 'm2' }, reviewer_command: 'review run --role {role} --level {level}', deep_paths: ['src/auth/**'] };

test('MAINT-0021: reviewer_command wins over second_model in briefs and budget', t => {
  const p = project(t, { configEdit: c => ({ ...c, review: command }) });
  const task = fs.readFileSync(path.join(p.repo, taskPath), 'utf8');
  p.edit(taskPath, reviewIs('deep: money'));
  p.write('docs/workflow/tasks/T-0002.md', reviewIs('light')(task.replaceAll('T-0001', 'T-0002')));
  p.write('docs/workflow/tasks/T-0003.md', reviewIs('none: tests only')(task.replaceAll('T-0001', 'T-0003')));
  p.edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised', 'status: Active'));
  const sha = p.commit('a deep task, a light one and a test-only one');
  const lead = wf(p, 'brief', '--lead', '--task', 'T-0001', '--baseline', sha);
  assert.equal(lead.status, 0, lead.stdout + lead.stderr);
  assert.match(lead.stdout, /`review run --role strong --level deep`/);
  assert.match(lead.stdout, /`review run --role fixcheck --level fixcheck`/);
  assert.doesNotMatch(lead.stdout, /fresh reviewer of your own tool/);
  const accept = wf(p, 'brief', '--acceptance', '--milestone', 'M-0001', '--baseline', sha);
  assert.equal(accept.status, 0, accept.stdout + accept.stderr);
  assert.match(accept.stdout, /`review run --role milestone --level milestone`/);
  assert.doesNotMatch(accept.stdout, /fresh reviewer of your own tool/);
  const next = wf(p, 'next', '--baseline', sha);
  assert.equal(next.status, 0, next.stdout + next.stderr);
  assert.ok(next.stdout.split('\n').includes('M-0001: review budget: 5 runs (one per light or standard task, two per deep task, two for the milestone review); keep two for the milestone review'), next.stdout);
  assert.deepEqual(p.run(['next', '--baseline', sha]).out.second_model_budget, [{ milestone: 'M-0001', deep_tasks: 1, other_tasks: 1, runs: 5 }]);
});

test('MAINT-0021: a task review by final_model is still refused with reviewer_command set', t => {
  const p = project(t, { configEdit: c => ({ ...c, review: command }) });
  p.write('src/a.js', 'export const result = 1;\n'); const head = p.commit('T-0001: the work');
  const e = evidence(head); e.review.model = 'm2';
  const r = ci(p, head, e);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.out.findings.join(' | '), /a task's review is never by m2/);
});

test('MAINT-0021: without reviewer_command the briefs and budget are unchanged', t => {
  const p = project(t, { configEdit: c => ({ ...c, review: { second_model: { tool: 'codex', model: 'm1' } } }) });
  p.edit(taskPath, reviewIs('deep: money'));
  const sha = p.commit('a deep task');
  const lead = wf(p, 'brief', '--lead', '--task', 'T-0001', '--baseline', sha);
  assert.match(lead.stdout, /codex exec -m m1 -c model_reasoning_effort=high/);
  assert.match(wf(p, 'next', '--baseline', sha).stdout, /M-0001: second-model budget: 3 runs \(two per deep task, one for the milestone review\)/);
});
