import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, readWorkflow, githubRecords, gitEnv, ResolveError, MAX_VALIDITY_MS } from '../../adapters/resolve.mjs';

// bin/wf-resolve (channel-resolve v3): the base config's channel or hold -> the release that judges, or a refusal.
// The trust root is a channel record signed with the broker's Ed25519 key; GitHub tags, markers and assets only store.
// Each test builds a workflow repository in a scratch directory and serves records from memory; nothing leaves the machine.
const root = fileURLToPath(new URL('../..', import.meta.url));
const bin = path.join(root, 'bin/wf-resolve');
const HOUR = 3600 * 1000;
const git = (dir, ...args) => { const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const cleanEnv = () => { const env = { ...process.env }; for (const k of ['GITHUB_ACTIONS', 'GITHUB_EVENT_NAME', 'GITHUB_EVENT_PATH', 'WF_RESOLVE_TEST']) delete env[k]; return env; };
const cli = (args, env = {}) => new Promise(done => {
  const p = spawn(process.execPath, [bin, ...args], { env: { ...cleanEnv(), ...env } });
  let out = '', err = '';
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
  p.on('close', status => done({ status, out, err }));
});
const keyPair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { privateKey, text: `ed25519:${Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64')}` };
};
const KEY = keyPair();

// A workflow repository on main: v2.0.0 (annotated), v2.1.0 (lightweight), then an untagged commit still at 2.1.0, and a
// side commit main never reaches (tagged v2.9.0). Each commit's package.json carries its version. `assets` holds what
// the "channels" release stores; `put(channel, fields, key)` signs a record into it, `reads` logs every asset read.
function world(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-resolve-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'workflow');
  fs.mkdirSync(repo); git(repo, 'init', '-q', '-b', 'main');
  const commit = (name, version) => { fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'w', version })); fs.writeFileSync(path.join(repo, 'f.txt'), name); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', name); return git(repo, 'rev-parse', 'HEAD'); };
  const c1 = commit('one', '2.0.0'); git(repo, 'tag', '-a', 'v2.0.0', '-m', 'v2.0.0');
  const c2 = commit('two', '2.1.0'); git(repo, 'tag', 'v2.1.0'); // a lightweight tag resolves too
  git(repo, 'checkout', '-q', '-b', 'side', c1); const side = commit('side', '2.9.0'); git(repo, 'tag', 'v2.9.0'); git(repo, 'checkout', '-q', 'main');
  const c3 = commit('three, untagged', '2.1.0');
  const now = Date.now();
  const assets = new Map(), reads = [];
  const record = (channel, fields = {}) => {
    const major = Number(channel.match(/-(\d+)$/)?.[1] ?? 2);
    const tag = fields.tag ?? (channel.startsWith('stable') ? 'v2.0.0' : 'v2.1.0');
    return { v: 1, channel, major, tag, revision: tag === 'v2.0.0' ? c1 : c2, version: tag.slice(1), seq: 1, issued_at: new Date(now - HOUR).toISOString(), expires_at: new Date(now + 47 * HOUR).toISOString(), ...fields };
  };
  const signed = (rec, key = KEY) => { const body = Buffer.from(JSON.stringify(rec)); return { body, sig: Buffer.from(sign(null, body, key.privateKey).toString('base64')) }; };
  const put = (channel, fields, key) => { const s = signed(record(channel, fields), key); assets.set(`channel-${channel}.json`, s.body); assets.set(`channel-${channel}.json.sig`, s.sig); return s; };
  put('stable'); put('canary');
  const readRecord = async name => { reads.push(name); return assets.get(name) ?? null; };
  const config = (workflow) => ({ workflow: { repo: 'acme/workflow', channel_key: KEY.text, ...workflow } });
  const call = (workflow, extra = {}) => resolve({ config: config(workflow), readRecord, gitUrl: repo, now, retryMs: 0, ...extra });
  return { temp, repo, c1, c2, c3, side, now, assets, reads, record, signed, put, config, call, git: (...a) => git(repo, ...a) };
}
const refusal = (p, re) => assert.rejects(p, e => e instanceof ResolveError && re.test(e.message), `expected a refusal matching ${re}`);

test('a signed record resolves its channel to the tagged revision on main', async t => {
  const w = world(t);
  const stable = await w.call({ channel: 'stable' });
  assert.deepEqual({ ...stable, expires_at: undefined }, { channel: 'stable', revision: w.c1, version: 'v2.0.0', seq: 1, expires_at: undefined }); // annotated tag
  assert.equal((await w.call({ channel: 'canary' })).revision, w.c2); // lightweight tag
  assert.deepEqual(w.reads.slice(0, 2), ['channel-stable.json', 'channel-stable.json.sig']);
  // promotion and rollback are new records, nothing else
  w.put('stable', { tag: 'v2.1.0', seq: 2 });
  assert.equal((await w.call({ channel: 'stable' })).version, 'v2.1.0');
});

test('a forged or missing signature is refused', async t => {
  const w = world(t);
  const good = w.assets.get('channel-stable.json');
  w.assets.set('channel-stable.json', Buffer.from(good.toString().replace(w.c1, w.c2))); // the body edited after signing
  await refusal(w.call({ channel: 'stable' }), /channel-stable\.json is not signed by workflow\.channel_key/);
  w.assets.set('channel-stable.json', good);
  w.assets.set('channel-stable.json.sig', Buffer.from('not a signature'));
  await refusal(w.call({ channel: 'stable' }), /not signed/);
  // the stable signature deleted: the record is then reported missing (the canary's record served as stable is the test below)
  w.assets.delete('channel-stable.json.sig');
  await refusal(w.call({ channel: 'stable' }), /channel-stable\.json or its signature is missing from the channels release/);
});

test('a record signed with another key is refused; a key list carries a rotation', async t => {
  const w = world(t);
  const other = keyPair();
  w.put('stable', {}, other);
  await refusal(w.call({ channel: 'stable' }), /not signed by workflow\.channel_key/);
  assert.equal((await w.call({ channel: 'stable', channel_key: [KEY.text, other.text] })).revision, w.c1); // overlap: old and new
  await refusal(w.call({ channel: 'stable', channel_key: [KEY.text] }), /not signed/);
});

test('an expired, over-long or future record is refused', async t => {
  const w = world(t);
  const iso = ms => new Date(w.now + ms).toISOString();
  w.put('stable', { issued_at: iso(-73 * HOUR), expires_at: iso(-HOUR) });
  await refusal(w.call({ channel: 'stable' }), /expired at .*re-signs it at least daily/);
  w.put('stable', { issued_at: iso(-HOUR), expires_at: iso(-HOUR + MAX_VALIDITY_MS + 1000) });
  await refusal(w.call({ channel: 'stable' }), /more than 72 hours/);
  w.put('stable', { issued_at: iso(HOUR), expires_at: iso(10 * HOUR) });
  await refusal(w.call({ channel: 'stable' }), /in the future/);
  w.put('stable', { issued_at: iso(2 * 60 * 1000), expires_at: iso(10 * HOUR) }); // clock skew is tolerated
  assert.equal((await w.call({ channel: 'stable' })).revision, w.c1);
  // the expiry is checked against the clock of the run, not the record's own claim
  w.put('stable');
  await refusal(w.call({ channel: 'stable' }, { now: w.now + 48 * HOUR }), /expired/);
});

test('a record of another channel or major, or malformed, is refused', async t => {
  const w = world(t);
  const canary = { body: w.assets.get('channel-canary.json'), sig: w.assets.get('channel-canary.json.sig') };
  w.assets.set('channel-stable.json', canary.body); w.assets.set('channel-stable.json.sig', canary.sig);
  await refusal(w.call({ channel: 'stable' }), /signed for channel "canary", not stable/);
  w.put('stable', { major: 3 });
  await refusal(w.call({ channel: 'stable' }), /signed for major 3, not 2/);
  w.put('stable-3', { major: 3 }); // a major-3 record that names a v2 tag
  await refusal(w.call({ channel: 'stable-3' }), /v2\.0\.0, which is not of major 3/);
  w.put('stable', { version: '2.1.0' });
  await refusal(w.call({ channel: 'stable' }), /tag v2\.0\.0 with version "2\.1\.0"/);
  w.put('stable', { extra: true });
  await refusal(w.call({ channel: 'stable' }), /exactly the fields/);
  w.put('stable', { v: 2 });
  await refusal(w.call({ channel: 'stable' }), /record format 2/);
  w.put('stable', { seq: 0 });
  await refusal(w.call({ channel: 'stable' }), /positive integer seq/);
});

test('a revision off main, or not the tag\'s commit, is refused', async t => {
  const w = world(t);
  w.put('stable', { tag: 'v2.9.0', revision: w.side });
  await refusal(w.call({ channel: 'stable' }), /v2\.9\.0 at [0-9a-f]{12}, which is not on main/);
  w.put('stable', { tag: 'v2.1.0', revision: w.c3 }); // on main, right version, but the tag is at c2
  await refusal(w.call({ channel: 'stable' }), new RegExp(`the tag points at ${w.c2.slice(0, 12)}`));
  w.put('stable', { tag: 'v2.2.0', version: '2.2.0', revision: w.c3 }); // no such tag
  await refusal(w.call({ channel: 'stable' }), /the tag does not exist/);
  w.git('tag', 'v2.2.0', w.c3); // the tag exists, but c3's package.json says 2.1.0
  await refusal(w.call({ channel: 'stable' }), /whose package\.json says 2\.1\.0/);
  w.put('stable', { revision: 'f'.repeat(40) });
  await refusal(w.call({ channel: 'stable' }), /not on main/);
});

test('replay: a run reads one record; an older unexpired one verifies unless a seq floor is given', async t => {
  const w = world(t);
  const newer = w.put('stable', { tag: 'v2.1.0', seq: 5 });
  const older = w.signed(w.record('stable', { seq: 4 }));
  // One run's inputs serve the newer record, then the older: the first verified read is used and nothing is read again.
  let n = 0;
  const serve = async name => { n++; return n <= 2 ? (name.endsWith('.sig') ? newer.sig : newer.body) : (name.endsWith('.sig') ? older.sig : older.body); };
  assert.equal((await w.call({ channel: 'stable' }, { readRecord: serve })).seq, 5);
  assert.equal(n, 2);
  // A torn pair (body swapped, signature not yet) is read once more; whatever verifies then is used, here the older one.
  n = 0;
  const torn = async name => { n++; if (n <= 2) return name.endsWith('.sig') ? older.sig : newer.body; return name.endsWith('.sig') ? older.sig : older.body; };
  assert.equal((await w.call({ channel: 'stable' }, { readRecord: torn })).seq, 4);
  // Stateless: a replayed older record within its 72 hours resolves (the accepted residual risk) ...
  w.assets.set('channel-stable.json', older.body); w.assets.set('channel-stable.json.sig', older.sig);
  assert.deepEqual([(await w.call({ channel: 'stable' })).seq, (await w.call({ channel: 'stable' })).version], [4, 'v2.0.0']);
  // ... unless the caller passes the floor it knows.
  await refusal(w.call({ channel: 'stable' }, { minSeq: 5 }), /seq 4, older than the floor 5: a replayed record/);
  await refusal(w.call({ channel: 'stable' }, { minSeq: 0 }), /seq floor is not a positive integer/);
});

test('tags, markers and assets a write user changes cannot choose the revision', async t => {
  const w = world(t);
  // A new higher tag on main, or a tag at an unreleased commit, changes nothing: no record names it.
  w.git('tag', 'v2.99.0', w.c3);
  assert.equal((await w.call({ channel: 'canary' })).version, 'v2.1.0');
  // Release markers (latest, prerelease, draft) are never read: only the two assets of the channel are.
  w.reads.length = 0;
  await w.call({ channel: 'stable' });
  assert.deepEqual(w.reads, ['channel-stable.json', 'channel-stable.json.sig']);
  // Moving the signed tag fails closed instead of choosing the new commit.
  w.git('tag', '-f', 'v2.1.0', w.c3);
  await refusal(w.call({ channel: 'canary' }), new RegExp(`the tag points at ${w.c3.slice(0, 12)}`));
  // Replacing an asset with an unsigned one fails closed; deleting it does too.
  w.assets.set('channel-stable.json', Buffer.from(JSON.stringify(w.record('stable', { tag: 'v2.1.0', seq: 99 }))));
  await refusal(w.call({ channel: 'stable' }), /not signed/);
  w.assets.delete('channel-stable.json');
  await refusal(w.call({ channel: 'stable' }), /missing/);
});

test('a hold returns its revision with the version only as declared', async t => {
  const w = world(t);
  assert.deepEqual(await w.call({ revision: 'a'.repeat(40), version: 'v9.9.9', channel_key: undefined }), { channel: 'hold', revision: 'a'.repeat(40), version: null, declared_version: 'v9.9.9' });
  assert.deepEqual(await w.call({ revision: 'b'.repeat(40) }), { channel: 'hold', revision: 'b'.repeat(40), version: null, declared_version: null });
  assert.deepEqual(w.reads, []);
});

test('the config: one of channel and revision, a channel needs a valid key', () => {
  const cfg = workflow => ({ workflow: { repo: 'acme/workflow', ...workflow } });
  const throws = (workflow, re) => assert.throws(() => readWorkflow(cfg(workflow)), e => e instanceof ResolveError && re.test(e.message));
  throws({ channel: 'stable' }, /needs workflow\.channel_key/);
  throws({ channel: 'stable', channel_key: 'ed25519:short' }, /not ed25519:<base64 of a 32-byte public key>/);
  throws({ channel: 'stable', channel_key: [KEY.text, KEY.text, KEY.text, KEY.text, KEY.text] }, /more than 4 keys/);
  throws({ channel: 'stable', revision: 'a'.repeat(40), channel_key: KEY.text }, /both workflow\.channel and workflow\.revision/);
  throws({}, /neither/);
  throws({ channel: 'stable-2', channel_key: KEY.text }, /not a channel/);
  throws({ channel: 'beta', channel_key: KEY.text }, /not a channel/);
  throws({ revision: 'abc' }, /not a full hash/);
  assert.throws(() => readWorkflow({ workflow: { repo: '../x', revision: 'a'.repeat(40) } }), /owner\/name/);
  assert.equal(readWorkflow(cfg({ channel: 'canary-3', channel_key: KEY.text })).major, 3);
});

const body = (...parts) => new Response(Buffer.concat(parts.map(p => Buffer.from(p))), { status: 200 });

test('records are read from the channels release download URL, with no token', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => { seen.push({ url, opts }); return url.endsWith('.sig') ? new Response(null, { status: 404 }) : body('{}'); };
  const read = githubRecords('acme/workflow', fetchImpl);
  assert.equal((await read('channel-stable.json')).toString(), '{}');
  assert.equal(await read('channel-stable.json.sig'), null);
  assert.equal(seen[0].url, 'https://github.com/acme/workflow/releases/download/channels/channel-stable.json');
  assert.equal(seen[0].opts.headers.Authorization, undefined);
  const failing = githubRecords('acme/workflow', async () => new Response(null, { status: 502 }));
  await refusal(failing('channel-stable.json'), /HTTP 502/);
});

test('an oversized asset body is dropped once past the cap, not buffered', async () => {
  let pulls = 0, cancelled = false;
  const endless = new ReadableStream({
    pull(c) { pulls++; c.enqueue(new Uint8Array(4096)); },
    cancel() { cancelled = true; },
  });
  const read = githubRecords('acme/workflow', async () => new Response(endless, { status: 200 }));
  await refusal(read('channel-stable.json'), /channel-stable\.json is larger than 8192 bytes/);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 6, `the stream was read ${pulls} times; it should stop just past 8192 bytes`);
  // an exactly-8192-byte body is within the cap
  const edge = githubRecords('acme/workflow', async () => body(Buffer.alloc(8192)));
  assert.equal((await edge('channel-stable.json')).length, 8192);
  // a declared length over the cap is refused without reading
  const declared = githubRecords('acme/workflow', async () => new Response('x', { status: 200, headers: { 'content-length': '999999' } }));
  await refusal(declared('channel-stable.json'), /larger than 8192 bytes/);
});

test('an error while reading the body is a fetch failure with its real reason', async () => {
  const broken = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('{"v"')); },
    pull(c) { c.error(new Error('connection reset mid-body')); },
  });
  const read = githubRecords('acme/workflow', async () => new Response(broken, { status: 200 }));
  await assert.rejects(read('channel-stable.json'), e => e instanceof ResolveError && /could not read channel-stable\.json: connection reset mid-body/.test(e.message) && !/JSON/.test(e.message));
  // end to end: the resolver reports the fetch failure, not "not signed" or "not valid JSON"
  const w = world({ after() {} });
  const resolver = githubRecords('acme/workflow', async () => new Response(new ReadableStream({ pull(c) { c.error(new Error('socket hang up')); } }), { status: 200 }));
  await refusal(resolve({ config: w.config({ channel: 'stable' }), readRecord: resolver, gitUrl: w.repo, retryMs: 0 }), /could not read channel-stable\.json: socket hang up/);
  fs.rmSync(w.temp, { recursive: true, force: true });
});

test('git runs with a clean environment: the caller\'s GIT_* variables have no effect', async t => {
  const w = world(t);
  const env = gitEnv({ PATH: '/bin', HOME: '/h', SSL_CERT_FILE: '/c', https_proxy: 'p', GIT_DIR: '/x', GIT_WORK_TREE: '/y', GIT_CONFIG_COUNT: '1', GIT_OBJECT_DIRECTORY: '/z', GIT_ALTERNATE_OBJECT_DIRECTORIES: '/a', SECRET: 's' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', SSL_CERT_FILE: '/c', https_proxy: 'p', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' });
  const saved = { ...process.env };
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); });
  Object.assign(process.env, {
    GIT_DIR: path.join(w.temp, 'no-such-git-dir'), GIT_WORK_TREE: w.temp, GIT_OBJECT_DIRECTORY: path.join(w.temp, 'no-objects'),
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'url.file:///nowhere/.insteadOf', GIT_CONFIG_VALUE_0: w.repo,
  });
  assert.equal((await w.call({ channel: 'stable' })).revision, w.c1);
});

test('a failed tag fetch is a fetch failure, not "the tag does not exist"', async t => {
  const w = world(t);
  const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const shims = path.join(w.temp, 'shims');
  fs.mkdirSync(shims);
  // a git that clones fine but cannot fetch (a network failure after the clone)
  fs.writeFileSync(path.join(shims, 'git'), `#!/bin/sh\nfor a in "$@"; do if [ "$a" = fetch ]; then echo "fatal: unable to access 'x': Could not resolve host" >&2; exit 128; fi; done\nexec ${real} "$@"\n`, { mode: 0o755 });
  const savedPath = process.env.PATH;
  process.env.PATH = `${shims}:${savedPath}`;
  t.after(() => { process.env.PATH = savedPath; });
  await refusal(w.call({ channel: 'stable' }), /fetching tag v2\.0\.0 failed: fatal: unable to access .*Could not resolve host/);
  process.env.PATH = savedPath;
  w.put('stable', { tag: 'v2.2.0', version: '2.2.0', revision: w.c3 });
  await refusal(w.call({ channel: 'stable' }), /the tag does not exist/); // a real missing tag still reads as one
});

test('command line: --base required, test-only options gated, the candidate refused as base', async t => {
  const w = world(t);
  const project = path.join(w.temp, 'project');
  fs.mkdirSync(path.join(project, 'docs/workflow'), { recursive: true });
  git(project, 'init', '-q', '-b', 'main');
  const writeConfig = workflow => { fs.writeFileSync(path.join(project, 'docs/workflow/config.json'), JSON.stringify(w.config(workflow))); git(project, 'add', '-A'); git(project, 'commit', '-qm', 'c'); return git(project, 'rev-parse', 'HEAD'); };
  const older = writeConfig({ channel: 'stable', note: 'older' });
  const base = writeConfig({ channel: 'stable' });
  const candidate = writeConfig({ revision: 'c'.repeat(40), channel_key: undefined }); // the candidate tries a hold
  const records = path.join(w.temp, 'records');
  fs.mkdirSync(records);
  for (const [name, bytes] of w.assets) fs.writeFileSync(path.join(records, name), bytes);
  const test = { WF_RESOLVE_TEST: '1' };
  const opts = ['--git-url', w.repo, '--record-url', records];

  let r = await cli(['--project', project, ...opts], test);
  assert.equal(r.status, 2); assert.match(r.err, /--project needs --base REV/);
  r = await cli(['--project', project, '--base', base, ...opts]);
  assert.equal(r.status, 2); assert.match(r.err, /--git-url is for tests only and needs WF_RESOLVE_TEST=1/);
  r = await cli(['--project', project, '--base', base, '--record-url', records]);
  assert.equal(r.status, 2); assert.match(r.err, /--record-url is for tests only/);
  r = await cli(['--project', project, '--base', base, ...opts], test);
  assert.equal(r.status, 0, r.err);
  assert.equal(JSON.parse(r.out).revision, w.c1);
  r = await cli(['--project', project, '--base', base, '--min-seq', '2', ...opts], test);
  assert.equal(r.status, 2); assert.match(r.err, /older than the floor 2/);
  // In pull request CI, a base that is HEAD is the candidate: refused before its hold is read.
  r = await cli(['--project', project, '--base', 'HEAD'], { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request' });
  assert.equal(r.status, 2); assert.match(r.err, /is the candidate \(HEAD\) in a pull_request run/);
  r = await cli(['--project', project, '--base', candidate], { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request' });
  assert.equal(r.status, 2); assert.match(r.err, /is the candidate/);
  // The base must be exactly the event's pull_request.base.sha: the PR's own head commit (not HEAD, which is the merge
  // commit in a real run) or any other commit is refused. A missing or unreadable event refuses too.
  const eventFile = (name, payload) => { const f = path.join(w.temp, name); fs.writeFileSync(f, typeof payload === 'string' ? payload : JSON.stringify(payload)); return f; };
  const pr = (event, file, extra = {}) => ({ ...test, GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: event, ...(file ? { GITHUB_EVENT_PATH: file } : {}), ...extra });
  const matching = eventFile('event-ok.json', { pull_request: { base: { sha: base } } });
  for (const event of ['pull_request', 'pull_request_target']) {
    r = await cli(['--project', project, '--base', base, ...opts], pr(event, matching));
    assert.equal(r.status, 0, r.err);
    r = await cli(['--project', project, '--base', base, ...opts], pr(event, eventFile('event-upper.json', { pull_request: { base: { sha: base.toUpperCase() } } })));
    assert.equal(r.status, 0, r.err);
    r = await cli(['--project', project, '--base', older, ...opts], pr(event, matching)); // some other commit, not HEAD
    assert.equal(r.status, 2); assert.match(r.err, /is not the event's pull_request\.base\.sha/);
    r = await cli(['--project', project, '--base', base, ...opts], pr(event, eventFile('event-other.json', { pull_request: { base: { sha: older } } })));
    assert.equal(r.status, 2); assert.match(r.err, /is not the event's pull_request\.base\.sha/);
    r = await cli(['--project', project, '--base', base, ...opts], pr(event, eventFile('event-nosha.json', { pull_request: { base: {} } })));
    assert.equal(r.status, 2); assert.match(r.err, /no pull_request\.base\.sha/);
    r = await cli(['--project', project, '--base', base, ...opts], pr(event, eventFile('event-bad.json', 'not json')));
    assert.equal(r.status, 2); assert.match(r.err, /cannot read the .* event/);
    r = await cli(['--project', project, '--base', base, ...opts], pr(event, path.join(w.temp, 'no-event.json')));
    assert.equal(r.status, 2); assert.match(r.err, /cannot read the .* event/);
    r = await cli(['--project', project, '--base', base, ...opts], pr(event));
    assert.equal(r.status, 2); assert.match(r.err, /GITHUB_EVENT_PATH is not set/);
  }
  // Other events (push, schedule) and runs outside Actions keep the plain rule: any commit but HEAD-in-PR-runs.
  r = await cli(['--project', project, '--base', older, ...opts], pr('push', matching));
  assert.equal(r.status, 0, r.err);
  r = await cli(['--project', project, '--base', older, ...opts], test);
  assert.equal(r.status, 0, r.err);
  // A caller's GIT_DIR cannot point the CLI's git at another repository.
  r = await cli(['--project', project, '--base', base, ...opts], { ...test, GIT_DIR: path.join(w.temp, 'no-such-git-dir'), GIT_WORK_TREE: w.temp });
  assert.equal(r.status, 0, r.err);
  // --config is a copy of unknown origin: not in GitHub Actions.
  const copy = path.join(w.temp, 'config.json');
  fs.writeFileSync(copy, JSON.stringify(w.config({ revision: 'd'.repeat(40), version: 'v2.0.0', channel_key: undefined })));
  r = await cli(['--config', copy], { GITHUB_ACTIONS: 'true' });
  assert.equal(r.status, 2); assert.match(r.err, /--config is not accepted in GitHub Actions/);
  r = await cli(['--config', copy]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { channel: 'hold', revision: 'd'.repeat(40), version: null, declared_version: 'v2.0.0' });
  r = await cli(['--config', copy, '--min-seq', 'x']);
  assert.equal(r.status, 2); assert.match(r.err, /not a positive integer/);
  r = await cli(['--help']);
  assert.equal(r.status, 0); assert.match(r.out, /usage: wf-resolve/);
});
