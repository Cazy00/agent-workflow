import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitSource } from '../lib/index.js';
import { carriedFrom } from '../lib/carry.js';
import { matchesAny } from '../lib/paths.js';

// MAINT-0016: a review or verification of an earlier revision still covers a pull request's head when every path changed
// since holds the trusted branch's own content or is a planning record; the task's own code, an acceptance test or a
// merge that combined both sides' edits needs new evidence.
const config = { paths: { production: ['src/**', 'tests/**'], planning: ['docs/workflow/tasks/**', 'docs/**'], acceptance_tests: ['tests/acceptance/**'] } };
function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-carry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  const commit = m => { git('add', '-A'); git('commit', '-qm', m); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  write('src/a.js', 'a\n'); write('src/shared.js', 'one\ntwo\nthree\nfour\nfive\n'); write('docs/workflow/tasks/T-0001.md', 'Active\n');
  const base = commit('base');
  git('switch', '-q', '-c', 'T-0001');
  write('src/a.js', 'a changed by the task\n');
  const reviewed = commit('T-0001: work');
  return { git, write, commit, base, reviewed, at: rev => gitSource(dir, rev) };
}
const carried = (r, baseline, candidate, from) => carriedFrom({ config, baseline: r.at(baseline), candidate: r.at(candidate), from });

test('a merge of the trusted branch and a records commit carry the evidence over', t => {
  const r = repo(t);
  r.git('switch', '-q', 'main'); r.write('src/b.js', 'from main\n'); const main = r.commit('main moves');
  r.git('switch', '-q', 'T-0001'); r.git('merge', '-q', '--no-edit', 'main');
  r.write('docs/workflow/tasks/T-0001.md', 'Done\n'); const head = r.commit('T-0001: Done');
  assert.equal(carried(r, main, head, r.reviewed).ok, true);
  assert.deepEqual(carried(r, main, head, head), { ok: true, paths: [] }, 'evidence for the head itself');
});

test('the task\'s own code or an acceptance test after the review does not carry over', t => {
  const r = repo(t);
  r.write('src/a.js', 'changed again after the review\n'); const own = r.commit('T-0001: more');
  assert.match(carried(r, r.base, own, r.reviewed).why, /changed since [0-9a-f]{12}: src\/a\.js/);
  r.git('reset', '-q', '--hard', r.reviewed);
  r.write('tests/acceptance/a.test.js', 'test\n'); const withTest = r.commit('T-0001: a test');
  assert.match(carried(r, r.base, withTest, r.reviewed).why, /tests\/acceptance\/a\.test\.js/, 'an acceptance test is never a record');
});

test('a clean merge that combined both sides\' edits to one file does not carry over', t => {
  const r = repo(t);
  r.write('src/shared.js', 'ONE\ntwo\nthree\nfour\nfive\n'); const reviewed = r.commit('T-0001: shared');
  r.git('switch', '-q', 'main'); r.write('src/shared.js', 'one\ntwo\nthree\nfour\nFIVE\n'); const main = r.commit('main edits shared');
  r.git('switch', '-q', 'T-0001'); r.git('merge', '-q', '--no-edit', 'main'); const head = r.git('rev-parse', 'HEAD');
  const c = carried(r, main, head, reviewed);
  assert.equal(c.ok, false, 'the merged file matches neither the reviewed commit nor the trusted branch');
  assert.match(c.why, /src\/shared\.js/);
});

test('a revision outside the candidate\'s history, or not a full hash, does not carry over', t => {
  const r = repo(t);
  r.git('switch', '-q', 'main'); r.write('src/c.js', 'c\n'); const other = r.commit('elsewhere');
  assert.match(carried(r, other, r.reviewed, other).why, /not an earlier revision of this candidate/);
  assert.match(carried(r, r.base, r.reviewed, 'abc123').why, /not an earlier revision of this candidate/);
});

test('matchesAny reads the config\'s glob forms', () => {
  assert.equal(matchesAny(['src/auth/**', { pattern: '**/migrations/**' }], 'db/migrations/001.sql'), true);
  assert.equal(matchesAny(['src/auth/**'], 'src/orders/a.js'), false);
  assert.equal(matchesAny(undefined, 'src/a.js'), false);
});
