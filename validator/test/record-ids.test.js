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
  // A record added and removed inside a branch that was then merged: the ID was still used.
  git(repo, 'checkout', '-q', '-b', 'side');
  write(repo, 'docs/workflow/tasks/T-0011.md', task('T-0011', 'Scratch idea')); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'side: T-0011');
  git(repo, 'rm', '-q', 'docs/workflow/tasks/T-0011.md'); git(repo, 'commit', '-qm', 'side: drop T-0011');
  git(repo, 'checkout', '-q', 'main'); git(repo, 'merge', '-q', '--no-ff', '--no-edit', 'side');
  const baseline = git(repo, 'rev-parse', 'HEAD');
  // Each candidate branches from a baseline and adds or edits one record.
  const candidate = (dir, p, text, base = baseline) => {
    git(dir, 'checkout', '-q', '-B', `candidate-${path.basename(p)}`, base);
    write(dir, p, text); git(dir, 'add', '.'); git(dir, 'commit', '-qm', `plan ${path.basename(p)}`);
    return git(dir, 'rev-parse', 'HEAD');
  };
  const ci = (dir, rev, base = baseline) => spawnSync(process.execPath, [cli, 'ci', '--repo', dir, '--baseline', base, '--candidate', rev, '--json'], { encoding: 'utf8' });
  return { temp, repo, git, write, baseline, candidate, ci };
}

test('ci rejects a record that reuses the ID of a removed record for different work, including one used only inside a merged branch', t => {
  const p = setup(t);
  const r = p.ci(p.repo, p.candidate(p.repo, 'docs/workflow/tasks/T-0007.md', task('T-0007', 'Invoice export')));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(JSON.parse(r.stdout).findings.join('\n'), /T-0007\.md reuses an ID already used on the trusted branch \(title "Login form", latest at [0-9a-f]{12}\); give it a new ID, or restore a record that only ever had one title with that exact value/);
  const branchOnly = p.ci(p.repo, p.candidate(p.repo, 'docs/workflow/tasks/T-0011.md', task('T-0011', 'Invoice export')));
  assert.equal(branchOnly.status, 1, branchOnly.stdout + branchOnly.stderr);
  assert.match(JSON.parse(branchOnly.stdout).findings.join('\n'), /T-0011\.md reuses an ID already used on the trusted branch \(title "Scratch idea"/);
});

test('ci accepts a never-used ID and the restoration of the same record', t => {
  const p = setup(t);
  const fresh = p.ci(p.repo, p.candidate(p.repo, 'docs/workflow/tasks/T-0008.md', task('T-0008', 'Invoice export')));
  assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
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

test('ci finds an ID whose use reached the trusted branch through a fast-forward over a merge', t => {
  const p = setup(t);
  // The trusted branch's first parents then run through the feature branch and skip where T-0012 was used.
  p.git(p.repo, 'checkout', '-q', '-b', 'feature', p.baseline);
  p.write(p.repo, 'docs/notes.md', 'feature work\n'); p.git(p.repo, 'add', '.'); p.git(p.repo, 'commit', '-qm', 'feature work');
  p.git(p.repo, 'checkout', '-q', 'main');
  p.write(p.repo, 'docs/workflow/tasks/T-0012.md', task('T-0012', 'Report page')); p.git(p.repo, 'add', '.'); p.git(p.repo, 'commit', '-qm', 'plan T-0012');
  p.git(p.repo, 'rm', '-q', 'docs/workflow/tasks/T-0012.md'); p.git(p.repo, 'commit', '-qm', 'T-0012 merged: remove its record');
  p.git(p.repo, 'checkout', '-q', 'feature'); p.git(p.repo, 'merge', '-q', '--no-edit', 'main');
  p.git(p.repo, 'checkout', '-q', 'main'); p.git(p.repo, 'merge', '-q', '--ff-only', 'feature');
  const base = p.git(p.repo, 'rev-parse', 'HEAD');
  const r = p.ci(p.repo, p.candidate(p.repo, 'docs/workflow/tasks/T-0012.md', task('T-0012', 'Invoice export'), base), base);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(JSON.parse(r.stdout).findings.join('\n'), /T-0012\.md reuses an ID already used on the trusted branch \(title "Report page"/);
});

test('ci notes a changed title on an existing record, such as an add/add conflict resolved the wrong way', t => {
  const p = setup(t);
  const text = fs.readFileSync(path.join(p.repo, 'docs/workflow/tasks/T-0001.md'), 'utf8').replace(/^title: .*$/m, 'title: Invoice export');
  const r = p.ci(p.repo, p.candidate(p.repo, 'docs/workflow/tasks/T-0001.md', text));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(JSON.parse(r.stdout).findings.join('\n'), /T-0001\.md changes its title \(was title "Task T-0001"\); if it now describes different work, give that work a new ID/);
});

test('ci compares an added record with every version the history holds, not only the latest', t => {
  const p = setup(t);
  // T-0007 was "Login form" on main; a branch merged later used it again as "Scratch" and removed it.
  p.git(p.repo, 'checkout', '-q', '-b', 'later', p.baseline);
  p.write(p.repo, 'docs/workflow/tasks/T-0007.md', task('T-0007', 'Scratch')); p.git(p.repo, 'add', '.'); p.git(p.repo, 'commit', '-qm', 'later: T-0007 again');
  p.git(p.repo, 'rm', '-q', 'docs/workflow/tasks/T-0007.md'); p.git(p.repo, 'commit', '-qm', 'later: drop it');
  p.git(p.repo, 'checkout', '-q', 'main'); p.git(p.repo, 'merge', '-q', '--no-ff', '--no-edit', 'later');
  const base = p.git(p.repo, 'rev-parse', 'HEAD');
  for (const title of ['Scratch', 'Login form']) {
    const r = p.ci(p.repo, p.candidate(p.repo, 'docs/workflow/tasks/T-0007.md', task('T-0007', title), base), base);
    assert.equal(r.status, 1, `${title}: ${r.stdout}${r.stderr}`);
    assert.match(JSON.parse(r.stdout).findings.join('\n'), /T-0007\.md reuses an ID already used on the trusted branch \(title "(Scratch|Login form)"; title "(Scratch|Login form)", latest at/);
  }
});
