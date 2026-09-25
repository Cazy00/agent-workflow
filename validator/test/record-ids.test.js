import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A record ID names one piece of work for good. Task records are removed at merge, so a planner who reads the
// directory, or a second person planning on another branch, can pick an ID the history already used; a branch
// that adds the removed path merges cleanly. `wf ci` checks the baseline's history instead.
const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const task = (id, title) => `---\nrecord: task\nid: ${id}\ntitle: ${title}\nstatus: Draft\nowner: agent\nobjective: ${title}\n---\n# ${id}\n`;

function setup(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-ids-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'project');
  fs.cpSync(fixture, repo, { recursive: true });
  const git = (dir, ...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (dir, p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.name', 'Test Worker'); git(repo, 'config', 'user.email', 'worker@example.invalid');
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'initial');
  write(repo, 'docs/workflow/tasks/T-0007.md', task('T-0007', 'Login form'));
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'plan T-0007');
  git(repo, 'rm', '-q', 'docs/workflow/tasks/T-0007.md'); git(repo, 'commit', '-qm', 'T-0007 merged: remove its record');
  // A record added and removed inside a branch never reached the trusted branch, even through a merge commit.
  git(repo, 'checkout', '-q', '-b', 'side');
  write(repo, 'docs/workflow/tasks/T-0011.md', task('T-0011', 'Scratch idea')); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'side: T-0011');
  git(repo, 'rm', '-q', 'docs/workflow/tasks/T-0011.md'); git(repo, 'commit', '-qm', 'side: drop T-0011');
  git(repo, 'checkout', '-q', 'main'); git(repo, 'merge', '-q', '--no-ff', '--no-edit', 'side');
  const baseline = git(repo, 'rev-parse', 'HEAD');
  // Each candidate branches from the baseline and adds one record.
  const candidate = (dir, p, text) => {
    git(dir, 'checkout', '-q', '-B', `candidate-${path.basename(p)}`, baseline);
    write(dir, p, text); git(dir, 'add', '.'); git(dir, 'commit', '-qm', `plan ${path.basename(p)}`);
    return git(dir, 'rev-parse', 'HEAD');
  };
  const ci = (dir, rev) => spawnSync(process.execPath, [cli, 'ci', '--repo', dir, '--baseline', baseline, '--candidate', rev, '--json'], { encoding: 'utf8' });
  return { temp, repo, git, write, baseline, candidate, ci };
}

test('ci rejects a record that reuses the ID of a removed record for different work', t => {
  const p = setup(t);
  const r = p.ci(p.repo, p.candidate(p.repo, 'docs/workflow/tasks/T-0007.md', task('T-0007', 'Invoice export')));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(JSON.parse(r.stdout).findings.join('\n'), /T-0007\.md reuses an ID already used on the trusted branch \(title "Login form" at [0-9a-f]{12}\); give it a new ID, or restore that record with its exact title/);
});

test('ci accepts a never-used ID, an ID used only inside a merged branch, and the restoration of the same record', t => {
  const p = setup(t);
  const fresh = p.ci(p.repo, p.candidate(p.repo, 'docs/workflow/tasks/T-0008.md', task('T-0008', 'Invoice export')));
  assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
  const branchOnly = p.ci(p.repo, p.candidate(p.repo, 'docs/workflow/tasks/T-0011.md', task('T-0011', 'Invoice export')));
  assert.equal(branchOnly.status, 0, branchOnly.stdout + branchOnly.stderr);
  const restored = p.ci(p.repo, p.candidate(p.repo, 'docs/workflow/tasks/T-0007.md', task('T-0007', 'Login form').replace('status: Draft', 'status: Blocked\nresume_condition: the revert is reviewed')));
  assert.equal(restored.status, 0, restored.stdout + restored.stderr);
  assert.doesNotMatch(restored.stdout, /reuses an ID/);
  assert.match(restored.stdout, /T-0007\.md restores the record last present at [0-9a-f]{12} \(same title\)/, 'the reviewer sees the restoration');
});

test('ci refuses to run the check on a shallow clone instead of passing it', t => {
  const p = setup(t);
  const shallow = path.join(p.temp, 'shallow');
  assert.equal(spawnSync('git', ['clone', '-q', '--depth', '1', '--branch', 'main', `file://${p.repo}`, shallow]).status, 0);
  p.git(shallow, 'config', 'user.name', 'Test Worker'); p.git(shallow, 'config', 'user.email', 'worker@example.invalid');
  const r = p.ci(shallow, p.candidate(shallow, 'docs/workflow/tasks/T-0007.md', task('T-0007', 'Invoice export')));
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /the clone is shallow; fetch the full history/);
});
