import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// MAINT-0016: `git fetch` moves origin/<trusted branch>, never the local branch, so `wf next` reads the newer of the two
// when one contains the other, and says so. In mateen-systems a stale local main named a stale next action.
const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-next-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(fixture, dir, { recursive: true });
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const commit = (line, m) => { fs.appendFileSync(path.join(dir, 'README.md'), `${line}\n`); git('add', '-A'); git('commit', '-qm', m); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  const first = commit('first', 'first'), second = commit('second', 'second');
  const next = () => { const r = spawnSync(process.execPath, [cli, 'next', '--repo', dir, '--json'], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(r.stdout); };
  return { git, commit, first, second, next };
}

test('a local trusted branch behind origin reads origin, and says so', t => {
  const r = repo(t);
  r.git('update-ref', 'refs/remotes/origin/main', r.second); r.git('reset', '-q', '--hard', r.first);
  const n = r.next();
  assert.equal(n.baseline, r.second);
  assert.match(n.note, /the local main is behind origin\/main, so this reads origin\/main as last fetched/);
});

test('a local trusted branch ahead of origin, or with no remote, reads the local branch without a note', t => {
  const r = repo(t);
  assert.deepEqual([r.next().baseline, r.next().note], [r.second, undefined], 'no remote');
  r.git('update-ref', 'refs/remotes/origin/main', r.first);
  assert.deepEqual([r.next().baseline, r.next().note], [r.second, undefined], 'ahead');
});

test('a local trusted branch that has diverged from origin reads the local branch, and says so', t => {
  const r = repo(t);
  r.git('switch', '-q', '--detach', r.first); const elsewhere = r.commit('elsewhere', 'elsewhere');
  r.git('update-ref', 'refs/remotes/origin/main', elsewhere); r.git('switch', '-q', 'main');
  const n = r.next();
  assert.equal(n.baseline, r.second);
  assert.match(n.note, /the local main and origin\/main have diverged; this reads the local main/);
});
