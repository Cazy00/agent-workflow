import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitSource, loadAll } from '../lib/index.js';
import { acceptanceEvidenceErrors } from '../lib/acceptance-evidence.js';

// MAINT-0028 (B42): under review.cadence milestone with a fix check, a task whose code the milestone review read but whose
// record was marked Done after the review passes when the record names its delivered revision (`implemented`) inside the
// review's range and none of its scope's code changed after the review, except in a fix task's scope. Found at
// headless-lightroom M-0006's acceptance.

const RD = 'docs/workflow';
const task = (id, status, more = '') => `---\nrecord: task\nid: ${id}\nmilestone: M-0001\nstatus: ${status}\n${more}---\n# ${id}\n`;
const milestone = status => `---\nrecord: milestone\nid: M-0001\nstatus: ${status}\n---\n# M-0001\n`;
const config = { paths: { production: ['src/**'], governing: [`${RD}/milestones/**`], planning: ['docs/**'] }, review: { cadence: 'milestone' } };
const FIX = task('T-0004', 'Done', 'found_from: R-0009/F1\nscope: [src/c/]\n');

// The milestone: T-0001 merged and Done; T-0002's code merged (`delivered`) with its record still Active; the review at
// `reviewed`; then whatever the test adds after it.
function repo(t, { t2At = 'Active', scope = '[src/b/]' } = {}) {
  const T2 = (status, more = '') => task('T-0002', status, `${scope ? `scope: ${scope}\n` : ''}${more}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-maint-0028-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  const commit = m => { git('add', '-A'); git('commit', '-qm', m); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  write('src/a.js', 'a\n'); write(`${RD}/milestones/M-0001.md`, milestone('Draft'));
  write(`${RD}/tasks/T-0001.md`, task('T-0001', 'Draft', 'scope: [src/a.js]\n')); write(`${RD}/tasks/T-0002.md`, T2('Draft'));
  const before = commit('M-0001 planned');
  write(`${RD}/milestones/M-0001.md`, milestone('Authorised')); write(`${RD}/tasks/T-0002.md`, T2(t2At));
  const authorised = commit('M-0001 authorised');
  write('src/a.js', 'a, T-0001\n'); write(`${RD}/tasks/T-0001.md`, task('T-0001', 'Done', 'scope: [src/a.js]\n')); const s2 = commit('T-0001 merged');
  write('src/b/x.js', 'T-0002\n'); const delivered = commit('T-0002 merged, its record still Active');
  write('docs/notes.md', 'the review ran here\n'); const reviewed = commit('notes');
  return { T2, dir, git, write, commit, before, authorised, s2, delivered, reviewed, at: rev => gitSource(dir, rev) };
}
const fixCheck = (r, revision, more = {}) => ({
  schema: 'agent-workflow/acceptance-evidence@1', milestone: 'M-0001', candidate: revision,
  review: { reviewer: 'codereview milestone', model: 'claude:opus', revision: r.reviewed, report: 'https://github.com/o/r/pull/9#issuecomment-1', base: r.authorised, fix_check: { revision, reviewer: 'codereview fixcheck', model: 'claude:sonnet', report: 'https://github.com/o/r/pull/9#issuecomment-2' }, ...more },
  walkthrough: { not_applicable: 'the fixture has no user interface' }, deferred: [], tests_changed: [],
});
const accept = r => { r.write(`${RD}/milestones/M-0001.md`, milestone('Accepted')); return r.commit('Accept M-0001'); };
const errors = (r, head, e) => acceptanceEvidenceErrors({ evidence: e, milestone: 'M-0001', config, candidate: r.at(head), baseline: r.at(head), records: [loadAll(r.at(head), RD)] }).join(' | ');
const NOT_REVIEWED = /T-0002 was not Done at the milestone review's revision [0-9a-f]{12} and fixes none of its findings \(found_from\)/;
// After the review: the fix of finding F1, then T-0002 marked Done naming `implemented` (after the fix check, as in M-0006).
function lagging(r, implemented, { late = null } = {}) {
  r.write('src/c/fix.js', 'fixed\n'); r.write(`${RD}/tasks/T-0004.md`, FIX);
  if (late) r.write(late, 'code the review never read\n');
  const fixed = r.commit('T-0004, the fix of F1');
  r.write(`${RD}/tasks/T-0002.md`, r.T2('Done', `implemented: ${implemented}\n`)); r.commit('T-0002 Done');
  return { fixed, head: accept(r) };
}

test('MAINT-0028: the M-0006 shape, code reviewed and its record Done later, passes', t => {
  const r = repo(t); const { fixed, head } = lagging(r, r.delivered);
  assert.equal(errors(r, head, fixCheck(r, fixed)), '');
  // Marked Done inside the fix check's range, before the fix check's revision, it passes too.
  const q = repo(t);
  q.write('src/c/fix.js', 'fixed\n'); q.write(`${RD}/tasks/T-0004.md`, FIX); q.write(`${RD}/tasks/T-0002.md`, q.T2('Done', `implemented: ${q.delivered}\n`));
  const qfixed = q.commit('T-0004, the fix of F1, and T-0002 Done');
  assert.equal(errors(q, accept(q), fixCheck(q, qfixed)), '');
  // The review's revision itself is a delivered revision the review read.
  const p = repo(t); const pp = lagging(p, p.reviewed);
  assert.equal(errors(p, pp.head, fixCheck(p, pp.fixed)), '');
});

test('MAINT-0028: a task whose code the review never read still fails', t => {
  // Its code and its delivered revision come after the review.
  const r = repo(t);
  r.write('src/b/y.js', 'after the review\n'); const late = r.commit('T-0002 code after the review');
  r.write('src/c/fix.js', 'fixed\n'); r.write(`${RD}/tasks/T-0004.md`, FIX); r.write(`${RD}/tasks/T-0002.md`, r.T2('Done', `implemented: ${late}\n`));
  const fixed = r.commit('T-0004 and T-0002 Done');
  const e = errors(r, accept(r), fixCheck(r, fixed));
  assert.match(e, NOT_REVIEWED);
  assert.match(e, new RegExp(`its implemented ${late.slice(0, 12)} is not the review's revision or an earlier one`));
  // Its record names an early, reviewed commit, while its scope's code changed after the review.
  const q = repo(t); const qq = lagging(q, q.delivered, { late: 'src/b/y.js' });
  const qe = errors(q, qq.head, fixCheck(q, qq.fixed));
  assert.match(qe, NOT_REVIEWED);
  assert.match(qe, /its scope's code changed after the review: src\/b\/y\.js/);
  // Code after the review in both its scope and a fix task's: the delivered revision still has to be one the review read.
  const b = repo(t, { scope: '[src/]' });
  b.write('src/c/late.js', 'after the review\n'); b.write('src/c/fix.js', 'fixed\n'); b.write(`${RD}/tasks/T-0004.md`, FIX); const blate = b.commit('T-0002 code, and the fix');
  b.write(`${RD}/tasks/T-0002.md`, b.T2('Done', `implemented: ${blate}\n`)); b.commit('T-0002 Done');
  assert.match(errors(b, accept(b), fixCheck(b, blate)), new RegExp(`its implemented ${blate.slice(0, 12)} is not the review's revision or an earlier one`));
  // A scope the record narrows after the review does not hide it: the scope at the review's revision counts.
  const n = repo(t);
  n.write('src/c/fix.js', 'fixed\n'); n.write(`${RD}/tasks/T-0004.md`, FIX); n.write('src/b/y.js', 'late\n');
  n.write(`${RD}/tasks/T-0002.md`, task('T-0002', 'Done', `scope: [src/b/x.js]\nimplemented: ${n.delivered}\n`));
  const nfixed = n.commit('T-0004, late code, T-0002 Done with a narrower scope');
  assert.match(errors(n, accept(n), fixCheck(n, nfixed)), /its scope's code changed after the review: src\/b\/y\.js/);
});

test('MAINT-0028: a fix in the task\'s scope that a fix task\'s scope covers passes', t => {
  const r = repo(t);
  r.write('src/b/fix.js', 'fixed\n'); r.write(`${RD}/tasks/T-0004.md`, task('T-0004', 'Done', 'found_from: R-0009/F1\nscope: [src/b/fix.js]\n'));
  const fixed = r.commit('T-0004, a fix inside T-0002\'s scope');
  r.write(`${RD}/tasks/T-0002.md`, r.T2('Done', `implemented: ${r.delivered}\n`)); r.commit('T-0002 Done');
  assert.equal(errors(r, accept(r), fixCheck(r, fixed)), '');
});

test('MAINT-0028: a forged or unrelated delivered revision still fails', t => {
  const cases = [
    ['not a commit', () => 'a'.repeat(40), /its implemented aaaaaaaaaaaa is not the review's revision or an earlier one/],
    ['short', () => 'abc123', /names no implemented, the full commit hash it was delivered at/],
    ['before the milestone', r => r.before, /its implemented [0-9a-f]{12} is the review's base or comes before it/],
    ['the base itself', r => r.authorised, /its implemented [0-9a-f]{12} is the review's base or comes before it/],
    ['a side branch', r => { r.git('checkout', '-q', '-b', 'side', r.s2); r.write('src/z.js', 'side\n'); const s = r.commit('side'); r.git('checkout', '-q', 'main'); return s; }, /its implemented [0-9a-f]{12} is not the review's revision or an earlier one/],
  ];
  for (const [name, pick, why] of cases) {
    const r = repo(t); const implemented = pick(r); const { fixed, head } = lagging(r, implemented);
    const e = errors(r, head, fixCheck(r, fixed));
    assert.match(e, NOT_REVIEWED, name); assert.match(e, why, name);
  }
});

test('MAINT-0028: no implemented, no scope, or Draft at the review still fails', t => {
  const r = repo(t);
  r.write('src/c/fix.js', 'fixed\n'); r.write(`${RD}/tasks/T-0004.md`, FIX); r.write(`${RD}/tasks/T-0002.md`, r.T2('Done')); const fixed = r.commit('fix; T-0002 Done, no implemented');
  assert.match(errors(r, accept(r), fixCheck(r, fixed)), /T-0002 was not Done .* names no implemented, the full commit hash it was delivered at/);
  const q = repo(t, { scope: null }); const qq = lagging(q, q.delivered);
  assert.match(errors(q, qq.head, fixCheck(q, qq.fixed)), /T-0002 was not Done .* has no scope to show none of its code came after the review/);
  const d = repo(t, { t2At: 'Draft' }); const dd = lagging(d, d.delivered);
  assert.match(errors(d, dd.head, fixCheck(d, dd.fixed)), /T-0002 was not Done .* was Draft or absent at the review's revision/);
});

test('MAINT-0028: with parts, the first part\'s base bounds the delivered revision', t => {
  const r = repo(t); const { fixed, head } = lagging(r, r.delivered);
  const parts = [{ base: r.authorised, revision: r.s2 }, { base: r.s2, revision: r.reviewed }];
  const e = fixCheck(r, fixed); delete e.review.base; e.review.parts = parts;
  assert.equal(errors(r, head, e), '');
  const q = repo(t); const qq = lagging(q, q.authorised);
  const qe = fixCheck(q, qq.fixed); delete qe.review.base; qe.review.parts = [{ base: q.authorised, revision: q.s2 }, { base: q.s2, revision: q.reviewed }];
  assert.match(errors(q, qq.head, qe), /its implemented [0-9a-f]{12} is the review's base or comes before it/);
});

// Deep review B1, S1: only a task the fix check stands for excuses late code in its scope, never a Draft, a task Done before the
// review, or the task being judged.
test('MAINT-0028: only a finding fix the fix check stands for excuses late code', t => {
  const r = repo(t);
  r.write(`${RD}/tasks/T-0099.md`, task('T-0099', 'Draft', 'found_from: R-0009/F2\nscope: [src/]\n'));
  const rr = lagging(r, r.delivered, { late: 'src/b/y.js' });
  assert.match(errors(r, rr.head, fixCheck(r, rr.fixed)), /its scope's code changed after the review: src\/b\/y\.js/, 'a Draft');
  const q = repo(t);
  q.write(`${RD}/tasks/T-0098.md`, task('T-0098', 'Done', 'found_from: R-0008/F1\nscope: [src/]\n')); q.reviewed = q.commit('an old finding fixed before the review');
  const qq = lagging(q, q.delivered, { late: 'src/b/y.js' });
  assert.match(errors(q, qq.head, fixCheck(q, qq.fixed)), /its scope's code changed after the review: src\/b\/y\.js/, 'Done before the review');
  const s = repo(t);
  s.write('src/c/fix.js', 'fixed\n'); s.write(`${RD}/tasks/T-0004.md`, FIX); s.write('src/b/y.js', 'late\n');
  s.write(`${RD}/tasks/T-0002.md`, s.T2('Active', 'found_from: R-0009/F1\n')); const sfixed = s.commit('late code, T-0002 names a finding for now');
  s.write(`${RD}/tasks/T-0002.md`, s.T2('Done', `found_from: trial\nimplemented: ${s.delivered}\n`)); s.commit('T-0002 Done');
  assert.match(errors(s, accept(s), fixCheck(s, sfixed)), /its scope's code changed after the review: src\/b\/y\.js/, 'its own scope');
});

// Deep review N2: the task's pull request merged with a merge commit, `implemented` its branch head, reached through a second parent.
test('MAINT-0028: implemented as a merged branch head passes', t => {
  const r = repo(t);
  r.git('checkout', '-q', '-b', 'T-0002b', r.s2); r.write('src/b/z.js', 'T-0002 part 2\n'); const head = r.commit('T-0002 part 2 on its branch');
  r.git('checkout', '-q', 'main'); r.git('merge', '-q', '--no-ff', 'T-0002b', '-m', 'Merge pull request #7'); r.reviewed = r.git('rev-parse', 'HEAD');
  const { fixed, head: end } = lagging(r, head);
  assert.equal(errors(r, end, fixCheck(r, fixed)), '');
});
