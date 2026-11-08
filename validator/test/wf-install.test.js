import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { install, use, prune, InstallError } from '../../adapters/install.mjs';

// bin/wf-install (channel-install v1): a channel, resolved through its signed record, installed once per revision,
// read-only, behind an atomic pointer; sessions keep the revision they started on; old revisions are pruned.
const root = fileURLToPath(new URL('../..', import.meta.url));
const bin = path.join(root, 'bin/wf-install');
const HOUR = 3600 * 1000;
const git = (dir, ...args) => { const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const KEY = `ed25519:${Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64')}`;

function world(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-install-test-'));
  t.after(() => { spawnSync('chmod', ['-R', 'u+w', temp]); fs.rmSync(temp, { recursive: true, force: true }); });
  const repo = path.join(temp, 'workflow');
  fs.mkdirSync(repo); git(repo, 'init', '-q', '-b', 'main');
  const commit = (version, extra = {}) => {
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'w', version }));
    fs.mkdirSync(path.join(repo, 'procedures'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'procedures', 'operate.md'), `rules of ${version}\n`);
    for (const [f, c] of Object.entries(extra)) fs.writeFileSync(path.join(repo, f), c);
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', version); git(repo, 'tag', `v${version}`);
    return git(repo, 'rev-parse', 'HEAD');
  };
  const c1 = commit('2.19.0'), c2 = commit('2.19.1');
  git(repo, 'checkout', '-q', '-b', 'side', c1); const side = commit('2.20.0'); git(repo, 'checkout', '-q', 'main');
  const records = path.join(temp, 'records');
  fs.mkdirSync(records);
  const now = Date.now();
  let seq = 0;
  const put = (channel, tag, revision) => {
    const body = Buffer.from(JSON.stringify({ v: 1, channel, major: 2, tag, revision, version: tag.slice(1), seq: ++seq, issued_at: new Date(now - HOUR).toISOString(), expires_at: new Date(now + 47 * HOUR).toISOString() }));
    fs.writeFileSync(path.join(records, `channel-${channel}.json`), body);
    fs.writeFileSync(path.join(records, `channel-${channel}.json.sig`), sign(null, body, privateKey).toString('base64'));
  };
  const readRecord = async name => { try { return fs.readFileSync(path.join(records, name)); } catch { return null; } };
  const home = path.join(temp, 'home');
  const opts = extra => ({ root: home, keys: [KEY], repo: 'acme/workflow', gitUrl: repo, readRecord, now, retryMs: 0, ...extra });
  return { temp, repo, c1, c2, side, records, put, home, opts, now };
}
const refusal = (p, re) => assert.rejects(p, e => e instanceof InstallError && re.test(e.message), `expected a refusal matching ${re}`);

test('a channel installs its verified revision read-only and points at it', async t => {
  const w = world(t);
  w.put('stable', 'v2.19.0', w.c1);
  const out = await install(w.opts({ channel: 'stable' }));
  assert.equal(out.revision, w.c1); assert.equal(out.version, 'v2.19.0'); assert.equal(out.fresh, true);
  const dir = path.join(w.home, 'revisions', w.c1);
  assert.equal(fs.readFileSync(path.join(dir, 'procedures/operate.md'), 'utf8'), 'rules of 2.19.0\n');
  assert.equal(fs.realpathSync(path.join(w.home, 'channels/stable')), fs.realpathSync(dir));
  assert.equal(fs.statSync(dir).mode & 0o222, 0); assert.equal(fs.statSync(path.join(dir, 'package.json')).mode & 0o222, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(w.home, 'channels/stable.json'), 'utf8')).revision, w.c1);
  assert.deepEqual(fs.readdirSync(path.join(w.home, 'revisions')), [w.c1]); // no incoming directory left behind
  // a second install of the same revision keeps the directory as it is
  assert.equal((await install(w.opts({ channel: 'stable' }))).fresh, false);
});

test('a session keeps the revision it started on across a channel move', async t => {
  const w = world(t);
  w.put('canary', 'v2.19.0', w.c1);
  await install(w.opts({ channel: 'canary' }));
  const session = use({ root: w.home, name: 'canary' });
  assert.equal(session.revision, w.c1);
  w.put('canary', 'v2.19.1', w.c2);
  const moved = await install(w.opts({ channel: 'canary' }));
  assert.equal(moved.revision, w.c2); assert.equal(moved.previous, w.c1);
  assert.equal(fs.readFileSync(path.join(session.dir, 'procedures/operate.md'), 'utf8'), 'rules of 2.19.0\n'); // still there, unchanged
  assert.equal(use({ root: w.home, name: 'canary' }).revision, w.c2); // a new session takes the new one
});

test('a refused resolution changes nothing', async t => {
  const w = world(t);
  w.put('stable', 'v2.19.0', w.c1);
  await install(w.opts({ channel: 'stable' }));
  fs.writeFileSync(path.join(w.records, 'channel-stable.json'), fs.readFileSync(path.join(w.records, 'channel-stable.json'), 'utf8').replace(w.c1, w.c2)); // forged
  await refusal(install(w.opts({ channel: 'stable' })), /resolving stable: .*not signed/);
  w.put('stable', 'v2.20.0', w.side); // signed, but off main
  await refusal(install(w.opts({ channel: 'stable' })), /not on main/);
  assert.equal(path.basename(fs.readlinkSync(path.join(w.home, 'channels/stable'))), w.c1);
  assert.deepEqual(fs.readdirSync(path.join(w.home, 'revisions')), [w.c1]);
  await refusal(install(w.opts({ channel: 'stable', keys: [] })), /needs --key/);
  await refusal(install(w.opts({ channel: 'latest' })), /not a channel/);
});

test('a hold installs its revision on main, with no pointer', async t => {
  const w = world(t);
  const out = await install(w.opts({ revision: w.c2 }));
  assert.equal(out.channel, 'hold'); assert.ok(fs.existsSync(path.join(w.home, 'revisions', w.c2, 'package.json')));
  assert.equal(fs.existsSync(path.join(w.home, 'channels')), false);
  assert.equal(use({ root: w.home, name: w.c2 }).dir, path.join(w.home, 'revisions', w.c2));
  await refusal(install(w.opts({ revision: w.side })), /not on main/);
  await refusal(install(w.opts({ revision: 'abc' })), /not a full revision/);
  assert.throws(() => use({ root: w.home, name: 'stable' }), /not installed/);
});

test('prune removes only revisions no pointer names and no session used for 7 days', async t => {
  const w = world(t);
  w.put('stable', 'v2.19.0', w.c1);
  await install(w.opts({ channel: 'stable' }));
  w.put('stable', 'v2.19.1', w.c2);
  await install(w.opts({ channel: 'stable' }));
  assert.deepEqual(prune({ root: w.home, now: w.now + 6 * 24 * HOUR }).removed, []); // c1 used (installed) 6 days ago
  use({ root: w.home, name: w.c1, now: w.now + 5 * 24 * HOUR }); // a session started on it
  assert.deepEqual(prune({ root: w.home, now: w.now + 11 * 24 * HOUR }).removed, []);
  const later = prune({ root: w.home, now: w.now + 13 * 24 * HOUR });
  assert.deepEqual(later.removed, [w.c1]); assert.deepEqual(later.kept, [w.c2]); // the pointer keeps c2 however old
  assert.equal(fs.existsSync(path.join(w.home, 'revisions', w.c1)), false);
});

test('the CLI installs, uses and refuses test overrides outside tests', async t => {
  const w = world(t);
  w.put('stable', 'v2.19.0', w.c1);
  const run = (args, env = {}) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  const ok = run(['--channel', 'stable', '--key', KEY, '--repo', 'acme/workflow', '--root', w.home, '--git-url', w.repo, '--record-url', w.records], { WF_RESOLVE_TEST: '1' });
  assert.equal(ok.status, 0, ok.stderr); assert.equal(JSON.parse(ok.stdout).revision, w.c1);
  const used = run(['--use', 'stable', '--root', w.home]);
  assert.equal(used.status, 0, used.stderr); assert.equal(JSON.parse(used.stdout).dir, path.join(w.home, 'revisions', w.c1));
  const env = { ...process.env }; delete env.WF_RESOLVE_TEST;
  const blocked = spawnSync(process.execPath, [bin, '--channel', 'stable', '--key', KEY, '--root', w.home, '--git-url', w.repo], { encoding: 'utf8', env });
  assert.equal(blocked.status, 2); assert.match(blocked.stderr, /for tests only/);
  assert.equal(run(['--use', 'stable', '--prune', '--root', w.home]).status, 2);
  assert.match(run(['--use', 'stable', '--key', KEY]).stderr, /--key goes with --channel/);
  assert.equal(JSON.parse(run(['--prune', '--root', w.home]).stdout).kept.length, 1);
});
