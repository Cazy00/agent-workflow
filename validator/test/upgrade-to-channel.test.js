import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource, loadConfig, validateRecords } from '../lib/index.js';

// v2.19.0 part 3: the channel in the config schema (workflow.channel, workflow.channel_key) and the second opt-in pull
// request, bin/wf-upgrade --to-channel. The CLI tests build a scratch workflow repository from this checkout's committed
// HEAD, tagged v2.19.0, beside a v2.18.3 without the shared gate, and adopt a project from it.
const root = fileURLToPath(new URL('../..', import.meta.url));
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const git = (dir, ...args) => { const r = sh('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args]); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const key = () => `ed25519:${Buffer.from(generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64')}`;
const K1 = key(), K2 = key();

function configWith(t, workflow) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-channel-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = JSON.parse(fs.readFileSync(new URL('../../config.default.json', import.meta.url), 'utf8'));
  fs.mkdirSync(path.join(dir, 'docs/workflow'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/workflow/config.json'), JSON.stringify({ ...base, workflow: { repo: 'Cazy00/agent-workflow', ...workflow } }));
  return () => loadConfig(dirSource(dir));
}

test('workflow.channel names a channel with its key, never beside a pin', t => {
  for (const ok of [{ channel: 'stable', channel_key: K1 }, { channel: 'canary', channel_key: [K1, K2] }, { channel: 'stable-3', channel_key: K1 },
    { revision: 'a'.repeat(40), version: 'v2.19.0' }, { revision: 'a'.repeat(40), channel_key: K1 }, { version: 'UNRELEASED', revision: '' }]) {
    assert.ok(configWith(t, ok)(), JSON.stringify(ok));
  }
  for (const [workflow, why] of [
    [{ channel: 'beta', channel_key: K1 }, /workflow\.channel "beta" is not a channel/],
    [{ channel: 'stable-2', channel_key: K1 }, /is not a channel/],
    [{ channel: 'stable', channel_key: K1, revision: 'a'.repeat(40) }, /names both channel and revision/],
    [{ channel: 'stable' }, /workflow\.channel needs workflow\.channel_key/],
    [{ channel: 'stable', channel_key: 'ed25519:short' }, /workflow\.channel_key must be ed25519:/],
    [{ channel: 'stable', channel_key: [K1, K1] }, /a list of one to four different ones/],
    [{ channel: 'stable', channel_key: [K1, K2, key(), key(), key()] }, /one to four/],
    [{ channel: 'stable', channel_key: [] }, /one to four/],
  ]) assert.throws(configWith(t, workflow), why, JSON.stringify(workflow));
});

test('a milestone in progress runs under the channel the config names', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-channel-records-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = JSON.parse(fs.readFileSync(new URL('../../config.default.json', import.meta.url), 'utf8'));
  fs.mkdirSync(path.join(dir, 'docs/workflow/milestones'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/workflow/config.json'), JSON.stringify({ ...base, workflow: { repo: 'Cazy00/agent-workflow', channel: 'stable', channel_key: K1 } }));
  const set = v => fs.writeFileSync(path.join(dir, 'docs/workflow/milestones/M-0001.md'), `---\nid: M-0001\nstatus: Active\nworkflow_version: ${v}\n---\n# M-0001\n`);
  const versionErrors = () => validateRecords(dirSource(dir), 'docs/workflow').errors.filter(e => /runs under workflow/.test(e));
  set('stable');
  assert.deepEqual(versionErrors(), []);
  set('v2.19.0');
  assert.match(versionErrors().join('\n'), /runs under workflow v2\.19\.0, but docs\/workflow\/config\.json pins stable/);
});

function world(t) {
  if (sh('git', ['-C', root, 'rev-parse', 'HEAD']).status !== 0) return null;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-to-channel-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const wf = path.join(temp, 'workflow');
  git(temp, 'clone', '-q', '--no-hardlinks', '--no-tags', root, wf);
  git(wf, 'checkout', '-q', '-B', 'main');
  const pkg = path.join(wf, 'package.json');
  const bump = v => fs.writeFileSync(pkg, fs.readFileSync(pkg, 'utf8').replace(/"version": "[^"]+"/, `"version": "${v}"`));
  git(wf, 'checkout', '-q', '-b', 'old');
  git(wf, 'rm', '-q', 'bin/wf-gate-ci'); bump('2.18.3'); git(wf, 'commit', '-qam', 'v2.18.3'); git(wf, 'tag', 'v2.18.3');
  git(wf, 'checkout', '-q', 'main');
  bump('2.19.0'); git(wf, 'commit', '-qam', 'v2.19.0'); git(wf, 'tag', 'v2.19.0');
  const adopt = rev => {
    const project = path.join(temp, `project-${rev}`);
    fs.mkdirSync(project); git(project, 'init', '-q', '-b', 'main');
    const a = sh(process.execPath, [path.join(root, 'bin/wf-adopt'), '--project', project, '--workflow-repo', wf, '--rev', rev, '--repository', 'acme/shop', '--coordinator', 'owner']);
    assert.equal(a.status, 0, a.stdout + a.stderr);
    git(project, 'add', '-A'); git(project, 'commit', '-qm', 'adopted');
    return project;
  };
  const up = (project, ...args) => sh(process.execPath, [path.join(root, 'bin/wf-upgrade'), '--project', project, '--workflow-repo', wf, ...args]);
  const caller = file => fs.readFileSync(path.join(root, 'templates/github/channel', file), 'utf8').replaceAll('__ENTRY__', 'v2.19.0').replaceAll('__TRUSTED_BRANCH__', 'main');
  return { temp, wf, adopt, up, caller };
}
const readJson = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));

test('--to-channel from a v2.19.0 pin writes the channel, the key and the thin callers, and the release accepts the records', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  const project = w.adopt('v2.19.0');
  const before = fs.readFileSync(path.join(project, 'docs/workflow/config.json'), 'utf8');
  const report = w.up(project, '--to-channel', 'stable', '--key', K1);
  assert.equal(report.status, 0, report.stdout + report.stderr);
  assert.match(report.stdout, /v2\.19\.0 → channel stable/);
  assert.match(report.stdout, /update \.github\/workflows\/wf-ci\.yml: still the pinned release's copy: the thin caller of the shared entry at v2\.19\.0/);
  assert.match(report.stdout, /`wf ci \/ gate`/, 'says the required check moves');
  assert.equal(fs.readFileSync(path.join(project, 'docs/workflow/config.json'), 'utf8'), before, 'a report writes nothing');

  const applied = w.up(project, '--to-channel', 'stable', '--key', K1, '--apply');
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  assert.match(applied.stdout, /The new release's validator accepts the records/);
  const config = readJson(project, 'docs/workflow/config.json');
  assert.deepEqual(config.workflow, { repo: 'Cazy00/agent-workflow', channel: 'stable', channel_key: K1 });
  assert.equal(fs.readFileSync(path.join(project, '.github/workflows/wf-ci.yml'), 'utf8'), w.caller('wf-ci.yml'));
  assert.equal(fs.readFileSync(path.join(project, '.github/workflows/wf-status.yml'), 'utf8'), w.caller('wf-status.yml'));
  assert.match(fs.readFileSync(path.join(project, 'docs/workflow/profile.md'), 'utf8'), /^workflow_version: stable$/m);
  git(project, 'add', '-A'); git(project, 'commit', '-qm', 'opt in');

  // stable -> canary with a second key: a config change only, the callers are already the entry's
  const moved = w.up(project, '--to-channel', 'canary', '--key', K1, '--key', K2, '--json', '--apply');
  assert.equal(moved.status, 0, moved.stdout + moved.stderr);
  assert.deepEqual(JSON.parse(moved.stdout).changes.map(c => c.path), ['docs/workflow/config.json', 'docs/workflow/profile.md']);
  assert.deepEqual(readJson(project, 'docs/workflow/config.json').workflow.channel_key, [K1, K2]);
});

test('--to-channel refuses a pin from before the shared gate, a bad key and a mixed request', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  const old = w.adopt('v2.18.3');
  const r = w.up(old, '--to-channel', 'stable', '--key', K1);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /the pin v2\.18\.3 has no shared gate: first move the pin to v2\.19\.0 or later/);
  const project = w.adopt('v2.19.0');
  for (const [args, why] of [
    [['--to-channel', 'stable'], /needs --key ed25519:/],
    [['--to-channel', 'stable', '--key', 'ed25519:nope'], /workflow\.channel_key must be ed25519:/],
    [['--to-channel', 'beta', '--key', K1], /workflow\.channel "beta" is not a channel/],
    [['--to-channel', 'stable', '--key', K1, '--rev', 'v2.19.0'], /two different pull requests/],
    [['--key', K1], /go with --to-channel/],
    [['--to-channel', 'stable', '--key', K1, '--entry', 'v2.18.3'], /the entry must be a release tag v2\.19\.0 or later/],
  ]) {
    const x = w.up(project, ...args);
    assert.equal(x.status, 2, `${args.join(' ')}: ${x.stdout}${x.stderr}`);
    assert.match(x.stderr, why, args.join(' '));
  }
});

test('a workflow file the project changed is listed, not replaced; a milestone in progress moves to the channel', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  const project = w.adopt('v2.19.0');
  fs.appendFileSync(path.join(project, '.github/workflows/wf-status.yml'), '# ours\n');
  const milestone = path.join(project, 'docs/workflow/milestones/M-0001.md');
  fs.mkdirSync(path.dirname(milestone), { recursive: true });
  fs.writeFileSync(milestone, '---\nid: M-0001\nstatus: Active\nworkflow_version: v2.19.0\n---\n# M-0001\n');
  const r = w.up(project, '--to-channel', 'stable', '--key', K1, '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.ok(plan.left.some(l => l.path === '.github/workflows/wf-status.yml' && /changed in this project/.test(l.why)));
  assert.ok(!plan.changes.some(c => c.path === '.github/workflows/wf-status.yml'));
  assert.ok(plan.changes.some(c => c.path === 'docs/workflow/milestones/M-0001.md' && /channel moves reach it/.test(c.why)));
  assert.ok(plan.notes.some(n => /scripts\/wf/.test(n)), 'the launcher limitation is said');
});
