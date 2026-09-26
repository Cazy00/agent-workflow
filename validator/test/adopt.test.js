import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource, loadConfig, validateRecords } from '../lib/index.js';

// bin/wf-adopt is the model-free scaffold from procedures/setup.md step 3. These tests use this
// checkout as the workflow source, so they need a Git checkout and skip without one.
const root = fileURLToPath(new URL('../..', import.meta.url));
const script = path.join(root, 'bin/wf-adopt');
const head = () => { const r = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-adopt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['-C', dir, 'init', '-q']).status, 0);
  return dir;
}
const adopt = (dir, ...extra) => spawnSync(process.execPath, [script, '--project', dir, '--workflow-repo', root, '--rev', 'HEAD', '--repository', 'fixture/project', '--coordinator', 'owner', ...extra], { encoding: 'utf8' });

test('wf-adopt scaffolds an adoption pinned to a full hash, and the result validates and runs', t => {
  const rev = head(); if (!rev) return t.skip('not a Git checkout');
  const dir = project(t);
  const r = adopt(dir, '--production', '**/*.dart', '--lane', 'existing', '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).revision, rev);
  const source = dirSource(dir);
  const config = loadConfig(source);
  assert.equal(config.workflow.revision, rev);
  assert.equal(config.repository, 'fixture/project');
  assert.ok(config.paths.production.includes('**/*.dart'));
  assert.ok(config.paths.production.includes('src/**'), 'defaults are kept');
  assert.deepEqual(validateRecords(source, 'docs/workflow').errors, []);
  const profile = fs.readFileSync(path.join(dir, 'docs/workflow/profile.md'), 'utf8');
  assert.match(profile, /^project: project$/m);
  assert.match(profile, /^approval_label: manual$/m);
  assert.equal(config.approval.label, 'manual');
  if (spawnSync('git', ['-C', root, 'cat-file', '-e', 'HEAD:templates/claude/agents/independent-reviewer.md']).status === 0) {
    assert.match(fs.readFileSync(path.join(dir, '.claude/agents/independent-reviewer.md'), 'utf8'), /^name: independent-reviewer$/m);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'docs/workflow/acceptance.json'), 'utf8')), { examples: [] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'tests/acceptance-map.json'), 'utf8')), []);
  for (const d of ['milestones', 'tasks', 'decisions', 'feedback/inbox', 'inbox/done']) assert.ok(fs.statSync(path.join(dir, 'docs/workflow', d)).isDirectory(), d);
  const setup = fs.readFileSync(path.join(dir, 'docs/workflow/setup.md'), 'utf8');
  assert.match(setup, /Owner steps/); assert.match(setup, /Existing repository/); assert.ok(setup.includes(rev));
  assert.match(setup, /required status checks \(`wf ci` now; each entry of the profile's `required_checks` when approving the profile change that defines it\), branches up to date before merging/);
  assert.match(setup, /7\. The profile's `required_checks` \(readiness fails while it is empty\)/);
  assert.match(setup, /0 required approvals and approval of the most recent push off, `CODEOWNERS` `\* @OWNER` then `\/docs\/workflow\/tasks\/` and `\/docs\/workflow\/feedback\/` unowned, and \*Allow auto-merge\* on/, 'a single owner gets the records carve-out');
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /turn it on as you open the pull request/);
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /session \| status`/);
  if (spawnSync('git', ['-C', root, 'cat-file', '-e', 'HEAD:templates/github/wf-status.yml']).status === 0) {
    const workflow = fs.readFileSync(path.join(dir, '.github/workflows/wf-status.yml'), 'utf8');
    assert.match(workflow, /branches: \[main\]/); assert.match(workflow, /refs\/heads\/main'/); assert.doesNotMatch(workflow, /__TRUSTED_BRANCH__/);
    assert.match(setup, /Pin the \*Project status\* issue/);
  }
  assert.ok(fs.statSync(path.join(dir, 'scripts/wf')).mode & 0o111, 'launcher is executable');
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^\.cache\/$/m);
  assert.equal(spawnSync('git', ['-C', path.join(dir, '.cache/agent-workflow'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), rev);
  // The local launcher runs the pinned validator against the fresh scaffold without touching the network.
  const wf = spawnSync('bash', [path.join(dir, 'scripts/wf'), 'records'], { cwd: dir, encoding: 'utf8' });
  assert.equal(wf.status, 0, wf.stdout + wf.stderr);
  assert.equal(JSON.parse(wf.stdout).ok, true);
});

test('wf-adopt never overwrites an existing file and refuses a second adoption', t => {
  const rev = head(); if (!rev) return t.skip('not a Git checkout');
  const dir = project(t);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'existing guide\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/');
  const first = adopt(dir);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), 'existing guide\n');
  assert.match(first.stdout, /Left as they were[\s\S]*AGENTS\.md/);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'node_modules/\n.cache/\n');
  const before = fs.readFileSync(path.join(dir, 'docs/workflow/config.json'), 'utf8');
  const second = adopt(dir);
  assert.equal(second.status, 2);
  assert.match(second.stderr, /already exists/);
  assert.equal(fs.readFileSync(path.join(dir, 'docs/workflow/config.json'), 'utf8'), before);
});

test('wf-adopt always scaffolds manual approval and offers no way to start enforced', t => {
  const rev = head(); if (!rev) return t.skip('not a Git checkout');
  const dir = project(t);
  const r = adopt(dir, '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const config = loadConfig(dirSource(dir));
  assert.deepEqual([config.approval.label, config.approval.mechanism], ['manual', 'manual-signed-receipts']);
  const profile = fs.readFileSync(path.join(dir, 'docs/workflow/profile.md'), 'utf8');
  assert.match(profile, /^approval_label: manual$/m);
  assert.match(profile, /^approval_mechanism: manual-signed-receipts$/m);
  assert.match(fs.readFileSync(path.join(dir, 'docs/workflow/setup.md'), 'utf8'), /switch .*enforced.* in one code-owner-reviewed pull request/);
  const other = project(t);
  assert.equal(adopt(other, '--approval', 'enforced').status, 2, 'no approval option exists');
  assert.ok(!fs.existsSync(path.join(other, 'docs/workflow')));
});

test('wf-adopt refuses a workflow revision that lacks its templates before writing anything', t => {
  const rev = head(); if (!rev) return t.skip('not a Git checkout');
  if (spawnSync('git', ['-C', root, 'rev-parse', '--verify', 'v1.0.0^{commit}']).status !== 0) return t.skip('v1.0.0 tag not present');
  const dir = project(t);
  const r = spawnSync(process.execPath, [script, '--project', dir, '--workflow-repo', root, '--rev', 'v1.0.0', '--repository', 'fixture/project', '--coordinator', 'owner'], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /not present at/);
  assert.ok(!fs.existsSync(path.join(dir, 'docs/workflow')));
});

test('wf-adopt rejects an unresolvable pin and malformed options without writing anything', t => {
  const rev = head(); if (!rev) return t.skip('not a Git checkout');
  const dir = project(t);
  const bad = spawnSync(process.execPath, [script, '--project', dir, '--workflow-repo', root, '--rev', 'no-such-ref', '--repository', 'fixture/project', '--coordinator', 'owner'], { encoding: 'utf8' });
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);
  assert.equal(adopt(dir, '--repository').status, 2, 'missing value');
  assert.equal(adopt(dir, '--lane', 'unattended').status, 2, 'unknown lane');
  assert.equal(spawnSync(process.execPath, [script, '--project', dir, '--workflow-repo', root, '--rev', 'HEAD', '--repository', 'not-a-slug', '--coordinator', 'owner'], { encoding: 'utf8' }).status, 2);
  assert.ok(!fs.existsSync(path.join(dir, 'docs/workflow')));
});

test('wf-adopt sets up a shared project with --owner and refuses one owner, a bad name or a revision without support', t => {
  const rev = head(); if (!rev) return t.skip('not a Git checkout');
  const refused = (...extra) => { const dir = project(t); const r = adopt(dir, ...extra); assert.equal(r.status, 2, r.stdout + r.stderr); assert.ok(!fs.existsSync(path.join(dir, 'docs/workflow')), 'nothing is written'); return r; };
  assert.match(refused('--owner', 'alice').stderr, /two or more/);
  assert.match(refused('--owner', 'alice', '--owner', 'not a name').stderr, /not a GitHub username/);
  assert.match(refused('--owner', 'alice', '--owner', 'alice').stderr, /twice/);
  // A workflow revision whose profile template has no `owners` line: built here, so the check never depends on tags.
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-old-'));
  t.after(() => fs.rmSync(old, { recursive: true, force: true }));
  for (const rel of ['config.default.json', 'templates/profile.md', 'templates/setup.md']) {
    fs.mkdirSync(path.dirname(path.join(old, rel)), { recursive: true });
    fs.writeFileSync(path.join(old, rel), fs.readFileSync(path.join(root, rel), 'utf8').replace(/^owners:.*\n/m, ''));
  }
  const g = (...args) => assert.equal(spawnSync('git', ['-C', old, ...args]).status, 0);
  g('init', '-q'); g('add', '.'); g('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'old workflow');
  const target = project(t);
  const unsupported = spawnSync(process.execPath, [script, '--project', target, '--workflow-repo', old, '--rev', 'HEAD', '--repository', 'fixture/project', '--coordinator', 'alice', '--owner', 'alice', '--owner', 'bob'], { encoding: 'utf8' });
  assert.equal(unsupported.status, 2, unsupported.stdout + unsupported.stderr);
  assert.match(unsupported.stderr, /no shared-project support/);
  assert.ok(!fs.existsSync(path.join(target, 'docs/workflow')), 'nothing is written');
  const dir = project(t);
  const r = adopt(dir, '--owner', 'alice', '--owner', 'bob', '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).owners, ['alice', 'bob']);
  assert.match(fs.readFileSync(path.join(dir, 'docs/workflow/profile.md'), 'utf8'), /^owners: \[alice, bob\]$/m);
  assert.match(fs.readFileSync(path.join(dir, 'docs/workflow/setup.md'), 'utf8'), /^- \[ \] Shared project .*`CODEOWNERS` assigns every path \(`\*`\) to alice, bob and no worker, and the ruleset requires code-owner review and approval of the most recent push;.* step 9 also shows that a worker's approval cannot merge/m);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'docs/workflow/setup.md'), 'utf8'), /unowned/, 'a shared project keeps every path owned');
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /auto-merge/, 'no auto-merge instruction without the single-owner settings');
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /work only on tasks whose `owner` is the person you work for, and claim each one before starting/);
  assert.deepEqual(validateRecords(dirSource(dir), 'docs/workflow').errors, []);
  const solo = project(t);
  assert.equal(adopt(solo).status, 0, 'a one-owner adoption needs no --owner');
  assert.doesNotMatch(fs.readFileSync(path.join(solo, 'docs/workflow/setup.md'), 'utf8'), /^- \[ \] Shared project/m);
  assert.doesNotMatch(fs.readFileSync(path.join(solo, 'AGENTS.md'), 'utf8'), /Several people share/);
});
