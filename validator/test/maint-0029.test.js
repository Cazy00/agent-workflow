import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitSource, loadAll } from '../lib/index.js';
import { acceptanceEvidenceErrors } from '../lib/acceptance-evidence.js';

// MAINT-0029 (B44): under review.cadence milestone, a fix check whose revision does not descend from the review's revision
// passes when its production code equals the checked head's. Found at headless-lightroom M-0006's acceptance: the fix check
// ran on a head branched before the review's (records-only) revision and had to be named through a later merge commit.

const RD = 'docs/workflow';
const task = (id, status, more = '') => `---\nrecord: task\nid: ${id}\nmilestone: M-0001\nstatus: ${status}\n${more}---\n# ${id}\n`;
const milestone = status => `---\nrecord: milestone\nid: M-0001\nstatus: ${status}\n---\n# M-0001\n`;
const config = { paths: { production: ['src/**'], governing: [`${RD}/milestones/**`], planning: ['docs/**'] }, review: { cadence: 'milestone' } };
const FIX = task('T-0004', 'Done', 'found_from: R-0009/F1\nscope: [src/c/]\n');

// The milestone: T-0001's code merged and Done (`coded`), then the review at `reviewed`, a records-only commit after it.
function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-maint-0029-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  const commit = m => { git('add', '-A'); git('commit', '-qm', m); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  write('src/a.js', 'a\n'); write(`${RD}/milestones/M-0001.md`, milestone('Draft')); write(`${RD}/tasks/T-0001.md`, task('T-0001', 'Draft', 'scope: [src/a.js]\n'));
  commit('M-0001 planned');
  write(`${RD}/milestones/M-0001.md`, milestone('Authorised')); write(`${RD}/tasks/T-0001.md`, task('T-0001', 'Active', 'scope: [src/a.js]\n'));
  const authorised = commit('M-0001 authorised');
  write('src/a.js', 'a, T-0001\n'); write(`${RD}/tasks/T-0001.md`, task('T-0001', 'Done', 'scope: [src/a.js]\n'));
  const coded = commit('T-0001 merged');
  write('docs/notes.md', 'the review ran here\n'); const reviewed = commit('notes');
  return { dir, git, write, commit, authorised, coded, reviewed, at: rev => gitSource(dir, rev) };
}
// The fix of F1 on a branch from `coded`, before the review's revision: the head the fix check read. Then merged into main
// (`code` changes src/a.js in the merge itself) and the milestone accepted.
function sideFix(r, { code = null } = {}) {
  r.git('checkout', '-q', '-b', 'fix', r.coded);
  r.write('src/c/fix.js', 'fixed\n'); r.write(`${RD}/tasks/T-0004.md`, FIX); const fixed = r.commit('T-0004, the fix of F1');
  r.git('checkout', '-q', 'main'); r.git('merge', '-q', '--no-ff', '--no-commit', 'fix');
  if (code) r.write('src/a.js', code);
  const merged = r.commit('Merge the fix of F1');
  r.write(`${RD}/milestones/M-0001.md`, milestone('Accepted'));
  return { fixed, merged, head: r.commit('Accept M-0001') };
}
const evidence = (r, head, revision) => ({
  schema: 'agent-workflow/acceptance-evidence@1', milestone: 'M-0001', candidate: head,
  review: { reviewer: 'codereview milestone', model: 'claude:opus', revision: r.reviewed, report: 'https://github.com/o/r/pull/9#issuecomment-1', base: r.authorised, fix_check: { revision, reviewer: 'codereview fixcheck', model: 'claude:sonnet', report: 'https://github.com/o/r/pull/9#issuecomment-2' } },
  walkthrough: { not_applicable: 'the fixture has no user interface' }, deferred: [], tests_changed: [],
});
const run = (r, head, revision) => {
  const notes = [];
  const errors = acceptanceEvidenceErrors({ evidence: evidence(r, head, revision), milestone: 'M-0001', config, candidate: r.at(head), baseline: r.at(head), records: [loadAll(r.at(head), RD)], notes });
  return { errors: errors.join(' | '), notes: notes.join(' | ') };
};
const AFTER = /the milestone review's fix check must come after the review's revision/;
const SAME_CODE = /does not descend from the review's revision [0-9a-f]{12}; it passes because its production code equals the checked head's \(MAINT-0029\)/;

test('MAINT-0029: the M-0006 shape, a fix check on a head that does not descend from the review, passes and says why', t => {
  const r = repo(t); const { fixed, merged, head } = sideFix(r);
  assert.equal(r.at(fixed).isAncestor(r.reviewed), false);
  const named = run(r, head, fixed);
  assert.equal(named.errors, '');
  assert.match(named.notes, SAME_CODE);
  assert.match(named.notes, new RegExp(`fix check revision ${fixed.slice(0, 12)} `));
  // Naming the merge commit, as M-0006 had to, still passes by the old rule, with no note.
  assert.deepEqual(run(r, head, merged), { errors: '', notes: '' });
});

test('MAINT-0029: a non-descending fix check with one changed code line after it fails', t => {
  const r = repo(t); const { fixed, head } = sideFix(r, { code: 'a, T-0001, and a line the fix check never read\n' });
  const { errors, notes } = run(r, head, fixed);
  assert.match(errors, AFTER);
  assert.match(errors, /its production code differs from the checked head's: src\/a\.js/);
  assert.equal(notes, '');
});

test('MAINT-0029: the descending fix check still passes; one before the review still fails', t => {
  const r = repo(t);
  r.write('src/c/fix.js', 'fixed\n'); r.write(`${RD}/tasks/T-0004.md`, FIX); const fixed = r.commit('T-0004, the fix of F1');
  r.write(`${RD}/milestones/M-0001.md`, milestone('Accepted')); const head = r.commit('Accept M-0001');
  assert.deepEqual(run(r, head, fixed), { errors: '', notes: '' });
  // `coded` is an ancestor of the review's revision: a fix check cannot come before the review it checks.
  const q = repo(t);
  q.write(`${RD}/milestones/M-0001.md`, milestone('Accepted')); const qhead = q.commit('Accept M-0001');
  const before = run(q, qhead, q.coded);
  assert.match(before.errors, AFTER);
  assert.equal(before.notes, '');
});
