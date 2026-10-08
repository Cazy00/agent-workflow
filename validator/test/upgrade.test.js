import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareVersions } from '../../adapters/upgrade.mjs';

// bin/wf-upgrade (MAINT-0011): moving a project to a newer release removes what the releases in between no longer read.
// CI checks out one commit without tags, so each test builds an older release in a scratch clone of this checkout: the
// committed HEAD with older templates and the config keys v1.8.0 to v1.14.0 wrote.
const root = fileURLToPath(new URL('../..', import.meta.url));
const upgrade = path.join(root, 'bin/wf-upgrade');
const adopt = path.join(root, 'bin/wf-adopt');
const run = (cmd, args, cwd) => spawnSync(cmd, args, { encoding: 'utf8', cwd });
const git = (dir, ...args) => { const r = run('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };

function releases(t, oldTag = 'v1.10.1') {
  if (run('git', ['-C', root, 'rev-parse', 'HEAD']).status !== 0) return null;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-upgrade-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const wf = path.join(temp, 'workflow');
  git(temp, 'clone', '-q', '--no-hardlinks', root, wf);
  const head = git(wf, 'rev-parse', 'HEAD');
  const edit = (rel, fn) => fs.writeFileSync(path.join(wf, rel), fn(fs.readFileSync(path.join(wf, rel), 'utf8')));
  edit('templates/github/wf-ci.yml', x => `${x}# an older release\n`);
  edit('templates/github/wf-status.yml', x => `${x}# an older release\n`);
  edit('templates/claude/agents/independent-reviewer.md', x => `${x}\nAn older line.\n`);
  edit('config.default.json', x => JSON.stringify({ ...JSON.parse(x), setup_budget_days: 2, execution: { mode: 'assisted', runner_adopted: false }, delivery: { batching: null }, delegation: { routine: { enabled: false } } }, null, 2) + '\n');
  edit('package.json', x => x.replace(/"version": "[^"]+"/, `"version": "${oldTag.slice(1)}"`));
  git(wf, 'commit', '-qam', 'an older release'); git(wf, 'tag', '-f', oldTag);
  git(wf, 'checkout', '-q', head, '--', '.'); git(wf, 'commit', '-qm', 'this release'); git(wf, 'tag', '-f', 'v2.0.0');
  const project = path.join(temp, 'project');
  fs.mkdirSync(project); git(project, 'init', '-q');
  const a = run(process.execPath, [adopt, '--project', project, '--workflow-repo', wf, '--rev', oldTag, '--repository', 'acme/shop', '--coordinator', 'owner']);
  assert.equal(a.status, 0, a.stdout + a.stderr);
  return { wf, project, temp, up: (...args) => run(process.execPath, [upgrade, '--project', project, '--workflow-repo', wf, ...args]) };
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

test('an upgrade reports first, then moves the pin, drops the keys nothing reads and refreshes untouched workflow files', t => {
  const r = releases(t); if (!r) return t.skip('not a Git checkout');
  const { wf, project, up } = r;
  fs.rmSync(path.join(project, '.github/workflows/wf-ci.yml')); // as a project adopted before v1.11.0 has it
  fs.appendFileSync(path.join(project, '.claude/agents/independent-reviewer.md'), '\nOur own rule.\n');
  git(project, 'add', '-A'); git(project, 'commit', '-qm', 'adopted');
  const before = read(project, 'docs/workflow/config.json');
  assert.ok(['delegation', 'delivery', 'execution', 'setup_budget_days'].every(k => k in JSON.parse(before)), 'the older scaffold wrote the old keys');

  const plan = up('--rev', 'v2.0.0');
  assert.equal(plan.status, 0, plan.stdout + plan.stderr);
  assert.match(plan.stdout, /v1\.10\.1 → v2\.0\.0/);
  assert.match(plan.stdout, /update docs\/workflow\/config\.json: .*removes delegation, delivery, execution, setup_budget_days/);
  assert.match(plan.stdout, /update \.github\/workflows\/wf-status\.yml: still the pinned release's copy/);
  assert.match(plan.stdout, /add\s+\.github\/workflows\/wf-ci\.yml/);
  assert.match(plan.stdout, /Left as they are:\n  \.claude\/agents\/independent-reviewer\.md: changed in this project/);
  for (const v of ['v1.11.0', 'v1.14.0', 'v2.0.0']) assert.match(plan.stdout, new RegExp(`- ${v.replaceAll('.', '\\.')}: `), v);
  assert.doesNotMatch(plan.stdout, /- v1\.10\.1: /, 'what the pinned release already had is not asked again');
  assert.equal(read(project, 'docs/workflow/config.json'), before, 'a report writes nothing');

  fs.appendFileSync(path.join(project, 'docs/workflow/config.json'), ' ');
  const dirty = up('--rev', 'v2.0.0', '--apply');
  assert.equal(dirty.status, 2);
  assert.match(dirty.stderr, /commit or stash these first/);
  git(project, 'checkout', '--', 'docs/workflow/config.json');

  const applied = up('--rev', 'v2.0.0', '--apply');
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  assert.match(applied.stdout, /The new release's validator accepts the records/);
  const config = JSON.parse(read(project, 'docs/workflow/config.json'));
  assert.deepEqual([config.workflow.version, config.workflow.revision], ['v2.0.0', git(wf, 'rev-parse', 'v2.0.0')]);
  for (const k of ['delegation', 'delivery', 'execution', 'setup_budget_days']) assert.ok(!(k in config), k);
  assert.equal(config.approval.checkpoint, 'milestone', 'settings the project chose are kept');
  assert.match(read(project, 'docs/workflow/profile.md'), /^workflow_version: v2\.0\.0$/m);
  assert.equal(read(project, '.github/workflows/wf-ci.yml'), git(wf, 'show', 'v2.0.0:templates/github/wf-ci.yml') + '\n');
  assert.doesNotMatch(read(project, '.github/workflows/wf-status.yml'), /an older release/);
  assert.match(read(project, '.claude/agents/independent-reviewer.md'), /Our own rule\./, 'a file the project changed is left alone');

  git(project, 'add', '-A'); git(project, 'commit', '-qm', 'upgraded');
  assert.match(up('--rev', 'v2.0.0').stdout, /Already at v2\.0\.0/);
  const back = up('--rev', 'v1.10.1');
  assert.equal(back.status, 2);
  assert.match(back.stderr, /a pin moves forward only/);
});

test('an upgrade to a revision between releases records it as unreleased and asks for what its package.json heads to', t => {
  const r = releases(t, 'v1.13.0'); if (!r) return t.skip('not a Git checkout');
  git(r.project, 'add', '-A'); git(r.project, 'commit', '-qm', 'adopted');
  git(r.wf, 'commit', '-q', '--allow-empty', '-m', 'between releases');
  const plan = JSON.parse(r.up('--rev', 'HEAD', '--json').stdout);
  assert.deepEqual([plan.from_version, plan.to_version], ['v1.13.0', 'v2.0.0 (unreleased)']);
  assert.ok(plan.notes.some(n => n.startsWith('v1.14.0: ')) && !plan.notes.some(n => n.startsWith('v1.11.0: ')), plan.notes.join(' | '));
  const applied = r.up('--rev', 'HEAD', '--apply');
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  assert.equal(JSON.parse(read(r.project, 'docs/workflow/config.json')).workflow.version, 'UNRELEASED');
});

test('an unadopted project, an unknown pin or an unknown target is refused without writing', t => {
  const r = releases(t); if (!r) return t.skip('not a Git checkout');
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-upgrade-bare-')); t.after(() => fs.rmSync(bare, { recursive: true, force: true }));
  const none = run(process.execPath, [upgrade, '--project', bare, '--workflow-repo', r.wf]);
  assert.equal(none.status, 2); assert.match(none.stderr, /not adopted/);
  assert.match(r.up('--rev', 'v9.9.9').stderr, /does not resolve/);
  const file = path.join(r.project, 'docs/workflow/config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8')); config.workflow.revision = 'f'.repeat(40); fs.writeFileSync(file, JSON.stringify(config));
  assert.match(r.up('--rev', 'v2.0.0').stderr, /does not hold the project's pinned revision/);
});

test('versions compare by number, and every entry in upgrades.json is a release with known fields', () => {
  assert.ok(compareVersions('v1.10.1', 'v1.9.0') > 0);
  assert.equal(compareVersions('1.14.0', 'v1.14.0'), 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'upgrades.json'), 'utf8'));
  for (const [version, step] of Object.entries(manifest)) {
    assert.match(version, /^v\d+\.\d+\.\d+$/);
    for (const key of Object.keys(step)) assert.ok(['remove_config', 'remove_files', 'add_files', 'notes'].includes(key), `${version}: ${key}`);
    for (const p of [...(step.remove_files ?? []), ...(step.add_files ?? [])]) assert.ok(!p.startsWith('/') && !p.split('/').includes('..'), p);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(Object.keys(manifest).some(v => v === `v${pkg.version}`), 'the release being made says what an upgrade to it changes');
});
