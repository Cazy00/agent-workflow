import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// bin/wf-upgrade over fixture projects, pinned and on a channel, against a scratch workflow repository with two
// releases whose templates differ: v2.19.0 (each caller and the copied wf-ci.yml carry an extra line) and v2.19.1 (this
// checkout's committed templates). A channel's default release is what its signed record says (`publish`), read
// through the resolver from a scratch directory (WF_RESOLVE_TEST). The plan is run, not read from the source: the listed
// steps and the written files are what is checked.
const root = fileURLToPath(new URL('../..', import.meta.url));
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const git = (dir, ...args) => { const r = sh('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args]); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const PAIR = generateKeyPairSync('ed25519');
const K1 = `ed25519:${Buffer.from(PAIR.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64')}`;
const HOUR = 3600 * 1000;
const OLD = '# the v2.19.0 shape\n';
const CHANGED = ['templates/github/channel/wf-ci.yml', 'templates/github/channel/wf-status.yml', 'templates/github/wf-ci.yml'];

function world(t) {
  if (sh('git', ['-C', root, 'rev-parse', 'HEAD']).status !== 0) return null;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-callers-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const wf = path.join(temp, 'workflow');
  git(temp, 'clone', '-q', '--no-hardlinks', '--no-tags', root, wf);
  git(wf, 'checkout', '-q', '-B', 'main');
  const pkg = path.join(wf, 'package.json');
  const bump = v => fs.writeFileSync(pkg, fs.readFileSync(pkg, 'utf8').replace(/"version": "[^"]+"/, `"version": "${v}"`));
  const head = Object.fromEntries(CHANGED.map(f => [f, fs.readFileSync(path.join(wf, f), 'utf8')]));
  for (const f of CHANGED) fs.writeFileSync(path.join(wf, f), head[f] + OLD);
  bump('2.19.0'); git(wf, 'commit', '-qam', 'v2.19.0'); git(wf, 'tag', 'v2.19.0');
  for (const f of CHANGED) fs.writeFileSync(path.join(wf, f), head[f]);
  bump('2.19.1'); git(wf, 'commit', '-qam', 'v2.19.1'); git(wf, 'tag', 'v2.19.1');
  // A later release, tagged but (unless published) on no channel: its wf-ci.yml caller carries an extra line.
  const release = (version, extra) => {
    fs.appendFileSync(path.join(wf, 'templates/github/channel/wf-ci.yml'), extra);
    bump(version); git(wf, 'commit', '-qam', `v${version}`); git(wf, 'tag', `v${version}`);
  };
  // The signed record of a channel, as the broker publishes it; `unpublish` removes it.
  const records = path.join(temp, 'records');
  fs.mkdirSync(records);
  const publish = (channel, tag, seq = 1) => {
    const now = Date.now();
    const body = Buffer.from(JSON.stringify({ v: 1, channel, major: 2, tag, revision: git(wf, 'rev-parse', `${tag}^{commit}`), version: tag.slice(1), seq, issued_at: new Date(now - HOUR).toISOString(), expires_at: new Date(now + 47 * HOUR).toISOString() }));
    fs.writeFileSync(path.join(records, `channel-${channel}.json`), body);
    fs.writeFileSync(path.join(records, `channel-${channel}.json.sig`), sign(null, body, PAIR.privateKey).toString('base64'));
  };
  const unpublish = channel => fs.rmSync(path.join(records, `channel-${channel}.json`), { force: true });
  publish('stable', 'v2.19.1');
  const adopt = name => {
    const project = path.join(temp, name);
    fs.mkdirSync(project); git(project, 'init', '-q', '-b', 'main');
    const a = sh(process.execPath, [path.join(root, 'bin/wf-adopt'), '--project', project, '--workflow-repo', wf, '--rev', 'v2.19.0', '--repository', 'acme/shop', '--coordinator', 'owner']);
    assert.equal(a.status, 0, a.stdout + a.stderr);
    git(project, 'add', '-A'); git(project, 'commit', '-qm', 'adopted');
    return project;
  };
  const run = (project, ...args) => sh(process.execPath, [path.join(root, 'bin/wf-upgrade'), '--project', project, '--workflow-repo', wf, '--git-url', wf, '--record-url', records, ...args], { env: { ...process.env, WF_RESOLVE_TEST: '1' } });
  const up = (project, ...args) => {
    const r = run(project, ...args);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return args.includes('--json') ? JSON.parse(r.stdout) : r.stdout;
  };
  const read = (project, rel) => fs.readFileSync(path.join(project, rel), 'utf8');
  const caller = (file, entry) => head[`templates/github/channel/${file}`].replaceAll('__ENTRY__', entry).replaceAll('__TRUSTED_BRANCH__', 'main');
  const onChannel = name => {
    const project = adopt(name);
    const plan = up(project, '--to-channel', 'stable', '--key', K1, '--entry', 'v2.19.0', '--apply', '--json');
    assert.equal(plan.entry, 'v2.19.0');
    assert.ok(plan.validation.ok, JSON.stringify(plan.validation));
    git(project, 'add', '-A'); git(project, 'commit', '-qm', 'opt in at v2.19.0');
    assert.equal(read(project, '.github/workflows/wf-ci.yml'), caller('wf-ci.yml', 'v2.19.0') + OLD, 'the v2.19.0 caller, as --entry v2.19.0 writes it');
    return project;
  };
  return { wf, adopt, run, up, read, caller, onChannel, head, release, publish, unpublish };
}

test('a pinned project: the plan moves the pin, refreshes an unchanged wf-ci.yml and lists a changed wf-status.yml', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  const project = w.adopt('pinned');
  fs.appendFileSync(path.join(project, '.github/workflows/wf-status.yml'), '# ours\n');
  git(project, 'commit', '-qam', 'customise wf-status.yml');
  const plan = w.up(project, '--json');
  assert.equal(plan.from_version, 'v2.19.0');
  assert.equal(plan.to_version, 'v2.19.1');
  assert.deepEqual(plan.changes.map(c => [c.action, c.path]), [['update', 'docs/workflow/config.json'], ['update', 'docs/workflow/profile.md'], ['update', '.github/workflows/wf-ci.yml']]);
  assert.deepEqual(plan.left.map(l => l.path), ['.github/workflows/wf-status.yml']);
  const applied = w.up(project, '--apply', '--json');
  assert.ok(applied.validation.ok, JSON.stringify(applied.validation));
  assert.equal(w.read(project, '.github/workflows/wf-ci.yml'), w.head['templates/github/wf-ci.yml'].replaceAll('__TRUSTED_BRANCH__', 'main'));
  assert.match(w.read(project, '.github/workflows/wf-status.yml'), /# ours\n$/, 'a changed copy is left as it is');
});

test('--to-channel from a v2.19.0 pin takes the release the channel is on as its entry by default; --entry overrides it', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  const project = w.adopt('optin');
  const plan = w.up(project, '--to-channel', 'stable', '--key', K1, '--json');
  assert.equal(plan.entry, 'v2.19.1');
  assert.match(plan.changes.find(c => c.path === '.github/workflows/wf-ci.yml').why, /shared entry at v2\.19\.1/);
  assert.equal(w.up(project, '--to-channel', 'stable', '--key', K1, '--entry', 'v2.19.0', '--json').entry, 'v2.19.0');
  w.up(project, '--to-channel', 'stable', '--key', K1, '--apply');
  assert.equal(w.read(project, '.github/workflows/wf-ci.yml'), w.caller('wf-ci.yml', 'v2.19.1'));
  assert.equal(w.read(project, '.github/workflows/wf-status.yml'), w.caller('wf-status.yml', 'v2.19.1'));
});

test('a channel project: the plain upgrade refreshes unchanged callers to the channel\'s release and moves their entry', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  const project = w.onChannel('channel');
  const config = w.read(project, 'docs/workflow/config.json');
  const plan = w.up(project, '--json');
  assert.equal(plan.from_version, 'channel stable, entry v2.19.0');
  assert.equal(plan.to_version, 'channel stable, entry v2.19.1');
  assert.deepEqual(plan.changes.map(c => [c.action, c.path]), [['update', '.github/workflows/wf-ci.yml'], ['update', '.github/workflows/wf-status.yml']]);
  assert.deepEqual(plan.left, []);
  const applied = w.up(project, '--apply');
  assert.match(applied, /^Upgraded .*: channel stable, entry v2\.19\.0 → channel stable, entry v2\.19\.1/);
  assert.match(applied, /The new release's validator accepts the records/);
  assert.equal(w.read(project, '.github/workflows/wf-ci.yml'), w.caller('wf-ci.yml', 'v2.19.1'));
  assert.equal(w.read(project, '.github/workflows/wf-status.yml'), w.caller('wf-status.yml', 'v2.19.1'));
  assert.equal(w.read(project, 'docs/workflow/config.json'), config, 'the channel and its key stay');
  git(project, 'commit', '-qam', 'callers at v2.19.1');
  assert.match(w.up(project), /^Already at channel stable, entry v2\.19\.1; nothing to do\./);
  // a caller is never moved back: --rev v2.19.0 leaves a v2.19.1 caller alone
  const back = w.up(project, '--rev', 'v2.19.0', '--json');
  assert.deepEqual(back.changes, []);
  assert.ok(back.notes.every(n => /newer than v2\.19\.0: left as it is \(a caller moves forward only\)/.test(n)) && back.notes.length === 2, back.notes.join('\n'));
});

test('a channel project: a customised caller is left untouched and listed as a step by hand', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  const project = w.onChannel('custom');
  fs.appendFileSync(path.join(project, '.github/workflows/wf-status.yml'), '# ours\n');
  git(project, 'commit', '-qam', 'customise the status caller');
  const before = w.read(project, '.github/workflows/wf-status.yml');
  const plan = w.up(project, '--json');
  assert.deepEqual(plan.changes.map(c => c.path), ['.github/workflows/wf-ci.yml']);
  assert.deepEqual(plan.left.map(l => l.path), ['.github/workflows/wf-status.yml']);
  assert.match(plan.left[0].why, /by hand: replace it with templates\/github\/channel\/wf-status\.yml at v2\.19\.1 \(fill __TRUSTED_BRANCH__ with main and __ENTRY__ with v2\.19\.1\)/);
  const text = w.up(project, '--apply');
  assert.match(text, /Left as they are:\n {2}\.github\/workflows\/wf-status\.yml: a thin caller changed in this project; by hand/);
  assert.equal(w.read(project, '.github/workflows/wf-status.yml'), before);
  assert.equal(w.read(project, '.github/workflows/wf-ci.yml'), w.caller('wf-ci.yml', 'v2.19.1'));
});

test('the default is the release the channel is on, never a newer local tag; no verified record, no default (F1)', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  const project = w.onChannel('soak');
  w.release('2.19.2', '# only in v2.19.2\n'); // tagged, but stable is still on v2.19.1 (a canary that never passed the soak)
  const plan = w.up(project, '--json');
  assert.equal(plan.entry, 'v2.19.1');
  assert.equal(plan.to_version, 'channel stable, entry v2.19.1');
  const fresh = w.adopt('fresh');
  assert.equal(w.up(fresh, '--to-channel', 'stable', '--key', K1, '--json').entry, 'v2.19.1');
  // the broker promotes: the default follows the record
  w.publish('stable', 'v2.19.2', 2);
  assert.equal(w.up(project, '--json').entry, 'v2.19.2');
  // no record: refused with the way out, and --rev / --entry still name a release explicitly
  w.unpublish('stable');
  for (const [p, args, flag] of [[project, [], '--rev'], [fresh, ['--to-channel', 'stable', '--key', K1], '--entry']]) {
    const r = w.run(p, ...args);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, new RegExp(`cannot tell which release channel stable is on \\(.*missing.*\\), so there is no default: pass ${flag} vX\\.Y\\.Z`));
  }
  assert.equal(w.up(project, '--rev', 'v2.19.2', '--json').entry, 'v2.19.2');
  assert.equal(w.up(fresh, '--to-channel', 'stable', '--key', K1, '--entry', 'v2.19.2', '--json').entry, 'v2.19.2');
  // a record whose tag this checkout holds at another commit is refused too
  w.publish('stable', 'v2.19.2', 3);
  git(w.wf, 'tag', '-f', 'v2.19.2', 'v2.19.1');
  const moved = w.run(project);
  assert.equal(moved.status, 2);
  assert.match(moved.stderr, /cannot tell which release channel stable is on|but the tag v2\.19\.2 in/);
});

test('a hold that keeps thin callers moves them with the pin, also when the pin is already at the target (F2)', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  const project = w.onChannel('hold');
  const configPath = path.join(project, 'docs/workflow/config.json');
  const hold = rev => {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const { channel, channel_key: key, ...rest } = config.workflow;
    config.workflow = { ...rest, revision: git(w.wf, 'rev-parse', `${rev}^{commit}`), version: rev };
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    git(project, 'commit', '-qam', `hold at ${rev}`);
  };
  hold('v2.19.0');
  const plan = w.up(project, '--json');
  assert.equal(plan.to_version, 'v2.19.1');
  assert.deepEqual(plan.left, []);
  for (const file of ['wf-ci.yml', 'wf-status.yml']) assert.match(plan.changes.find(c => c.path === `.github/workflows/${file}`)?.why ?? '', /still a released caller \(entry v2\.19\.0\).*at v2\.19\.1 replaces it \(a hold's caller moves with the pin\)/, file);
  // the pin already at the target, the callers still at v2.19.0
  hold('v2.19.1');
  const same = w.up(project, '--json');
  assert.equal(same.current, false);
  assert.deepEqual(same.changes.map(c => c.path), ['.github/workflows/wf-ci.yml', '.github/workflows/wf-status.yml']);
  w.up(project, '--apply');
  assert.equal(w.read(project, '.github/workflows/wf-ci.yml'), w.caller('wf-ci.yml', 'v2.19.1'));
  assert.equal(w.read(project, '.github/workflows/wf-status.yml'), w.caller('wf-status.yml', 'v2.19.1'));
  git(project, 'commit', '-qam', 'callers at v2.19.1');
  assert.equal(w.up(project, '--json').current, true);
});

test('a customised caller at the target entry is reported as customised, not as already current (F3)', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  const project = w.onChannel('ours');
  w.up(project, '--apply');
  git(project, 'commit', '-qam', 'callers at v2.19.1');
  fs.appendFileSync(path.join(project, '.github/workflows/wf-status.yml'), '# ours\n');
  git(project, 'commit', '-qam', 'customise the status caller');
  const plan = w.up(project, '--json');
  assert.equal(plan.current, false);
  assert.deepEqual(plan.changes, []);
  assert.deepEqual(plan.left.map(l => l.path), ['.github/workflows/wf-status.yml']);
  assert.match(plan.left[0].why, /^a thin caller changed in this project; by hand/);
  assert.deepEqual(plan.notes, []);
  // a customised caller ahead of the target is customised too, not "moves forward only"
  const back = w.up(project, '--rev', 'v2.19.0', '--json');
  assert.deepEqual(back.left.map(l => l.path), ['.github/workflows/wf-status.yml']);
});

test('a pre-channel copy on a channel project: a released copy is replaced, a changed one is "not a thin caller yet" (F5)', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  const project = w.onChannel('page');
  const page = path.join(project, '.github/workflows/wf-client-page.yml');
  const copy = fs.readFileSync(path.join(root, 'templates/github/wf-client-page.yml'), 'utf8').replaceAll('__TRUSTED_BRANCH__', 'main');
  fs.writeFileSync(page, copy);
  git(project, 'add', '-A'); git(project, 'commit', '-qm', 'old page copy');
  const plan = w.up(project, '--json');
  assert.match(plan.changes.find(c => c.path === '.github/workflows/wf-client-page.yml')?.why ?? '', /still a released copy of templates\/github\/wf-client-page\.yml from before channels/);
  fs.appendFileSync(page, '# ours\n');
  git(project, 'commit', '-qam', 'changed page copy');
  const changed = w.up(project, '--json');
  assert.match(changed.left.find(l => l.path === '.github/workflows/wf-client-page.yml')?.why ?? '', /^not a thin caller yet, and not a released copy/);
});
