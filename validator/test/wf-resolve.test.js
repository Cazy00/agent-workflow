import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, readWorkflow, pickToken, DEFAULT_API, ResolveError } from '../../adapters/resolve.mjs';

// bin/wf-resolve (channel-resolve v1): the base config's channel or hold -> {channel, revision, version}, or a refusal.
// Each test builds a workflow repository in a scratch directory, and a local server standing in for GitHub's release API;
// nothing leaves the machine. The server runs in this process, so the command line is run asynchronously.
const root = fileURLToPath(new URL('../..', import.meta.url));
const bin = path.join(root, 'bin/wf-resolve');
const IDENTITY = 'agent-workflow-release[bot]';
const git = (dir, ...args) => { const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const cli = (args, env = {}) => new Promise(done => {
  const p = spawn(process.execPath, [bin, ...args], { env: { ...process.env, WF_RELEASE_IDENTITY: '', GITHUB_TOKEN: '', GH_TOKEN: '', ...env } });
  let out = '', err = '';
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
  p.on('close', status => done({ status, out, err }));
});

// A workflow repository: main with v1.0.0 and v1.1.0 (annotated), a side commit no tag reaches main from, and the
// releases the fake API will report.
async function world(t, { releases, apiTags } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-resolve-test-'));
  const repo = path.join(temp, 'workflow');
  fs.mkdirSync(repo); git(repo, 'init', '-q', '-b', 'main');
  const commit = (name) => { fs.writeFileSync(path.join(repo, 'f.txt'), name); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', name); return git(repo, 'rev-parse', 'HEAD'); };
  const c1 = commit('one'); git(repo, 'tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
  const c2 = commit('two'); git(repo, 'tag', 'v1.1.0'); // a lightweight tag resolves too
  git(repo, 'checkout', '-q', '-b', 'side', c1); const side = commit('side'); git(repo, 'checkout', '-q', 'main');
  const c3 = commit('three, untagged');
  const table = releases ?? { 'v1.0.0': { author: IDENTITY }, 'v1.1.0': { author: IDENTITY } };
  const seen = [];
  // The fake API answers like GitHub: the release by tag name, the tag's ref (a tag object for an annotated tag, which
  // /git/tags/<sha> dereferences), all read from the repository. `apiTags` {tag: commit} overrides where the API says a tag points.
  const rg = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    const send = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    if (table.__status) return send(table.__status, {});
    let m = req.url.match(/^\/repos\/acme\/workflow\/releases\/tags\/(.+)$/);
    if (m) {
      const tag = decodeURIComponent(m[1]), r = table[tag];
      return r ? send(200, { tag_name: r.tag_name ?? tag, draft: Boolean(r.draft), prerelease: Boolean(r.prerelease), author: { login: r.author } }) : send(404, { message: 'Not Found' });
    }
    if ((m = req.url.match(/^\/repos\/acme\/workflow\/git\/ref\/tags\/(.+)$/))) {
      const tag = decodeURIComponent(m[1]);
      if (apiTags?.[tag]) return send(200, { ref: `refs/tags/${tag}`, object: { type: 'commit', sha: apiTags[tag] } });
      const sha = rg('rev-parse', '--verify', '-q', `refs/tags/${tag}`).stdout.trim();
      if (!sha) return send(404, { message: 'Not Found' });
      return send(200, { ref: `refs/tags/${tag}`, object: { type: rg('cat-file', '-t', sha).stdout.trim(), sha } });
    }
    if ((m = req.url.match(/^\/repos\/acme\/workflow\/git\/tags\/([0-9a-f]+)$/))) {
      const sha = rg('rev-parse', '--verify', '-q', `${m[1]}^{commit}`).stdout.trim();
      return sha ? send(200, { object: { type: 'commit', sha } }) : send(404, { message: 'Not Found' });
    }
    send(404, { message: 'Not Found' });
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  t.after(() => { server.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  const api = `http://127.0.0.1:${server.address().port}`;
  const channel = (name, hash) => git(repo, 'update-ref', `refs/heads/channel/${name}`, hash);
  const config = (workflow) => ({ workflow: { repo: 'acme/workflow', ...workflow } });
  const call = (workflow, extra = {}) => resolve({ config: config(workflow), releaseIdentity: IDENTITY, gitUrl: repo, api, ...extra });
  return { temp, repo, api, c1, c2, c3, side, channel, config, call, seen, git: (...a) => git(repo, ...a) };
}
const refusal = (p, re) => assert.rejects(p, e => e instanceof ResolveError && re.test(e.message), `expected a refusal matching ${re}`);

test('a channel at a tagged release made by the release identity resolves to its commit and tag', async t => {
  const w = await world(t);
  w.channel('stable', w.c1); // annotated tag: the commit is on the peeled line
  assert.deepEqual(await w.call({ channel: 'stable' }), { channel: 'stable', revision: w.c1, version: 'v1.0.0' });
  w.channel('canary', w.c2); // lightweight tag
  assert.deepEqual(await w.call({ channel: 'canary' }), { channel: 'canary', revision: w.c2, version: 'v1.1.0' });
});

test('a hold returns its pin without asking the network, and a hold without a version says null', async t => {
  const hash = 'a'.repeat(40);
  assert.deepEqual(await resolve({ config: { workflow: { repo: 'acme/workflow', revision: hash, version: 'v1.2.3' } }, gitUrl: '/nonexistent', api: 'http://127.0.0.1:9' }), { channel: 'hold', revision: hash, version: 'v1.2.3' });
  assert.deepEqual(await resolve({ config: { workflow: { repo: 'acme/workflow', revision: 'b'.repeat(64) } } }), { channel: 'hold', revision: 'b'.repeat(64), version: null });
});

test('the config must name exactly one of a channel and a full revision, and name them well', () => {
  const bad = (workflow, re) => assert.throws(() => readWorkflow({ workflow }), e => e instanceof ResolveError && re.test(e.message));
  bad({ repo: 'acme/workflow', channel: 'stable', revision: 'a'.repeat(40) }, /both workflow\.channel and workflow\.revision/);
  bad({ repo: 'acme/workflow' }, /neither/);
  bad({ repo: 'acme/workflow', revision: 'abc123' }, /not a full hash/);
  bad({ repo: 'acme/workflow', revision: 'A'.repeat(40) }, /not a full hash/);
  bad({ repo: 'acme', channel: 'stable' }, /workflow\.repo/);
  bad({ channel: 'stable' }, /workflow\.repo/);
  for (const repo of ['acme/..', '../workflow', './workflow', 'acme/.']) bad({ repo, channel: 'stable' }, /workflow\.repo/); // no dot segments
  for (const name of ['hold', '../main', 'a/b', 'Stable', '-x', 'x-', 'a--b', 'x y']) bad({ repo: 'acme/workflow', channel: name }, /not a channel name/);
  bad({ repo: 'acme/workflow', channel: 3 }, /not a channel name/);
  assert.throws(() => readWorkflow({}), /no workflow section/);
  assert.equal(readWorkflow({ workflow: { repo: 'acme/workflow', channel: 'stable-3' } }).channel, 'stable-3');
});

test('every failure refuses with its reason and falls back to nothing', async t => {
  const w = await world(t);
  await refusal(w.call({ channel: 'stable' }), /no channel\/stable/); // the branch does not exist
  w.channel('stable', w.c3);
  await refusal(w.call({ channel: 'stable' }), /not at any release tag/); // a commit with no tag
  w.channel('stable', w.c1);
  await refusal(w.call({ channel: 'stable' }, { releaseIdentity: '' }), /no release identity/);
  await refusal(w.call({ channel: 'stable' }, { gitUrl: path.join(w.temp, 'missing') }), /listing the workflow repository failed/);
  await refusal(w.call({ channel: 'stable' }, { api: 'http://127.0.0.1:9' }), /could not read the release of v1\.0\.0/); // the API is down
  assert.deepEqual(await w.call({ channel: 'stable' }), { channel: 'stable', revision: w.c1, version: 'v1.0.0' }, 'and the refusals changed nothing');
});

test('a tag without its release, or a release by another author, a draft or a prerelease, is refused', async t => {
  for (const [, releases, re] of [
    ['no release', {}, /v1\.0\.0 has no GitHub release/],
    ['another author', { 'v1.0.0': { author: 'someone-else' } }, /made by someone-else, not the release identity/],
    ['a draft', { 'v1.0.0': { author: IDENTITY, draft: true } }, /is a draft/],
    ['a prerelease', { 'v1.0.0': { author: IDENTITY, prerelease: true } }, /is a prerelease/],
    ['a release for another tag', { 'v1.0.0': { author: IDENTITY, tag_name: 'v9.9.9' } }, /is for v9\.9\.9/],
    ['the API refusing', { __status: 500 }, /HTTP 500/]
  ]) {
    const w = await world(t, { releases });
    w.channel('stable', w.c1);
    await refusal(w.call({ channel: 'stable' }), re);
  }
});

test('a rogue tag on the channel commit counts for nothing: only a tag with an identity-made release resolves', async t => {
  const w = await world(t, { releases: { 'v1.0.0': { author: IDENTITY } } });
  w.git('tag', 'v9.9.9', w.c1); // pushed by someone else, with no release
  w.git('tag', 'v1.0.0-rc1', w.c1); // not vX.Y.Z at all
  w.channel('stable', w.c1);
  assert.deepEqual(await w.call({ channel: 'stable' }), { channel: 'stable', revision: w.c1, version: 'v1.0.0' });
  const rogue = await world(t, { releases: { 'v1.0.0': { author: 'someone-else' } } });
  rogue.git('tag', 'v9.9.9', rogue.c1);
  rogue.channel('stable', rogue.c1);
  await refusal(rogue.call({ channel: 'stable' }), /no release made by the release identity: v9\.9\.9 has no GitHub release; the release of v1\.0\.0 was made by someone-else/);
});

test('a release commit that is not on main is refused', async t => {
  const w = await world(t, { releases: { 'v2.0.0': { author: IDENTITY } } });
  w.git('tag', 'v2.0.0', w.side);
  w.channel('stable', w.side);
  await refusal(w.call({ channel: 'stable' }), /is not on main/);
});

test('the release is tied to the commit: the API\'s tag must point at the channel commit, else the release counts for nothing', async t => {
  // a release exists for v1.0.0 and the mirror agrees with the channel, but the API says the tag now points elsewhere
  const moved = await world(t, { apiTags: { 'v1.0.0': 'f'.repeat(40) } });
  moved.channel('stable', moved.c1);
  await refusal(moved.call({ channel: 'stable' }), /v1\.0\.0 points at f{12}.* on the API, not at the channel commit/);
  // an annotated tag is dereferenced through its tag object; a lightweight one is read directly
  const w = await world(t);
  w.channel('stable', w.c1); await w.call({ channel: 'stable' });
  assert.ok(w.seen.some(s => /\/git\/ref\/tags\/v1\.0\.0$/.test(s.url)) && w.seen.some(s => /\/git\/tags\/[0-9a-f]+$/.test(s.url)), 'annotated: ref, then tag object');
  w.seen.length = 0; w.channel('canary', w.c2); await w.call({ channel: 'canary' });
  assert.ok(w.seen.every(s => !/\/git\/tags\//.test(s.url)), 'lightweight: no tag object');
  // the API has no such tag ref at all
  const none = await world(t);
  none.channel('stable', none.c1);
  await refusal(none.call({ channel: 'stable' }, { fetchImpl: async (url, o) => /\/git\/ref\//.test(url) ? { ok: false, status: 404 } : fetch(url, o) }), /v1\.0\.0 has no tag ref on the API/);
});

test('a mirror (--git-url) cannot map a tag to another commit: the API\'s tag commit is compared with the mirror\'s', async t => {
  // GitHub says v1.0.0 -> c1 (with its release). The mirror serves v1.0.0 -> c3 and channel/stable -> c3.
  const apiTags = {};
  const w = await world(t, { releases: { 'v1.0.0': { author: IDENTITY } }, apiTags });
  apiTags['v1.0.0'] = w.c1;
  w.git('tag', '-f', 'v1.0.0', w.c3);
  w.channel('stable', w.c3);
  await refusal(w.call({ channel: 'stable' }), /v1\.0\.0 points at .* on the API, not at the channel commit/);
  w.channel('stable', w.c1); // an honest mirror resolves
  w.git('tag', '-f', 'v1.0.0', w.c1);
  assert.equal((await w.call({ channel: 'stable' })).revision, w.c1);
});

test('many tags at the channel commit cost a bounded number of API calls, then refuse', async t => {
  const w = await world(t, { releases: {} });
  for (let i = 0; i < 100; i++) w.git('tag', `v99.0.${i}`, w.c1);
  w.channel('stable', w.c1);
  await refusal(w.call({ channel: 'stable' }), /no release made by the release identity/);
  assert.ok(w.seen.length <= 10, `${w.seen.length} API calls`);
  // a genuine release among the highest few still resolves
  const ok = await world(t, { releases: { 'v1.0.0': { author: IDENTITY }, 'v1.0.1': { author: IDENTITY } } });
  ok.git('tag', 'v1.0.1', ok.c1); ok.git('tag', 'v9.0.0', ok.c1);
  ok.channel('stable', ok.c1);
  assert.equal((await ok.call({ channel: 'stable' })).version, 'v1.0.1');
});

test('the API token goes only to GitHub, never to another host', async t => {
  const w = await world(t);
  w.channel('stable', w.c1);
  await w.call({ channel: 'stable' }, { token: 'secret-token' });
  assert.ok(w.seen.length > 0 && w.seen.every(s => s.auth === undefined));
});

test('the token IS sent to the default GitHub API, on every call', async t => {
  const w = await world(t);
  w.channel('stable', w.c1);
  const calls = [];
  const fetchImpl = async (url, o) => { calls.push({ url, auth: o.headers.Authorization }); return fetch(url.replace(DEFAULT_API, w.api), { headers: o.headers }); };
  assert.equal((await resolve({ config: w.config({ channel: 'stable' }), releaseIdentity: IDENTITY, gitUrl: w.repo, token: 'secret-token', fetchImpl })).version, 'v1.0.0');
  assert.ok(calls.length >= 3 && calls.every(c => c.url.startsWith(`${DEFAULT_API}/`) && c.auth === 'Bearer secret-token'));
  calls.length = 0;
  await resolve({ config: w.config({ channel: 'stable' }), releaseIdentity: IDENTITY, gitUrl: w.repo, fetchImpl });
  assert.ok(calls.length > 0 && calls.every(c => c.auth === undefined), 'no token, no header');
});

test('the token is GITHUB_TOKEN, else GH_TOKEN, and an empty one counts as unset', () => {
  assert.equal(pickToken({ GITHUB_TOKEN: '', GH_TOKEN: 'x' }), 'x');
  assert.equal(pickToken({ GITHUB_TOKEN: 'a', GH_TOKEN: 'x' }), 'a');
  assert.equal(pickToken({}), '');
});

test('an unexpected error exits 3, apart from a refusal (2)', async t => {
  const w = await world(t);
  w.channel('stable', w.c1);
  const file = path.join(w.temp, 'config.json');
  fs.writeFileSync(file, JSON.stringify(w.config({ channel: 'stable' })));
  const stub = path.join(w.temp, 'stub.mjs');
  fs.writeFileSync(stub, 'globalThis.fetch = async () => undefined;\n'); // a bug-shaped answer: not a refusal
  const r = await new Promise(done => {
    const p = spawn(process.execPath, ['--import', stub, bin, '--config', file, '--git-url', w.repo, '--release-identity', IDENTITY]);
    let err = ''; p.stderr.on('data', d => { err += d; }); p.on('close', status => done({ status, err }));
  });
  assert.equal(r.status, 3); assert.match(r.err, /^wf-resolve: unexpected: /);
});

test('--base is a revision, never an option', async t => {
  const w = await world(t);
  const r = await cli(['--project', w.repo, '--base', '-p', '--git-url', w.repo]);
  assert.equal(r.status, 2); assert.match(r.err, /--base -p is not a revision/);
  const g = spawnSync('git', ['-C', w.repo, 'show', '--end-of-options', '-p:docs/workflow/config.json'], { encoding: 'utf8' });
  assert.notEqual(g.status, 0); assert.doesNotMatch(g.stderr, /unrecognized|unknown option/i);
});

test('the command prints the three fields as JSON and refuses with exit status 2', async t => {
  const w = await world(t);
  w.channel('stable', w.c1);
  const file = path.join(w.temp, 'config.json');
  fs.writeFileSync(file, JSON.stringify(w.config({ channel: 'stable' })));
  const ok = await cli(['--config', file, '--git-url', w.repo, '--api-url', w.api], { WF_RELEASE_IDENTITY: IDENTITY });
  assert.equal(ok.status, 0, ok.err);
  assert.deepEqual(JSON.parse(ok.out), { channel: 'stable', revision: w.c1, version: 'v1.0.0' });
  const flag = await cli(['--config', file, '--git-url', w.repo, '--api-url', w.api, '--release-identity', IDENTITY]);
  assert.equal(flag.status, 0, flag.err);
  const none = await cli(['--config', file, '--git-url', w.repo, '--api-url', w.api]);
  assert.equal(none.status, 2); assert.equal(none.out, ''); assert.match(none.err, /^wf-resolve: no release identity/);
  const other = await cli(['--config', file, '--git-url', w.repo, '--api-url', w.api, '--release-identity', 'someone-else']);
  assert.equal(other.status, 2); assert.match(other.err, /not the release identity someone-else/);
  fs.writeFileSync(file, '{not json');
  assert.match((await cli(['--config', file])).err, /not valid JSON/);
  assert.equal((await cli([])).status, 2);
  assert.equal((await cli(['--config', file, '--project', w.repo])).status, 2);
  assert.equal((await cli(['--config', file, '--base', 'HEAD'])).status, 2);
  assert.equal((await cli(['--config', file, '--bogus'])).status, 2);
});

test('--project reads the config of the base commit, not the candidate working tree or head', async t => {
  const w = await world(t);
  w.channel('stable', w.c1);
  const project = path.join(w.temp, 'project');
  fs.mkdirSync(path.join(project, 'docs/workflow'), { recursive: true }); git(project, 'init', '-q', '-b', 'main');
  const cfg = path.join(project, 'docs/workflow/config.json');
  fs.writeFileSync(cfg, JSON.stringify(w.config({ channel: 'stable' }))); git(project, 'add', '-A'); git(project, 'commit', '-qm', 'base');
  const base = git(project, 'rev-parse', 'HEAD');
  fs.writeFileSync(cfg, JSON.stringify(w.config({ channel: 'main-now' }))); git(project, 'commit', '-qam', 'a candidate renames the channel');
  const args = ['--project', project, '--git-url', w.repo, '--api-url', w.api, '--release-identity', IDENTITY];
  const atBase = await cli([...args, '--base', base]);
  assert.equal(atBase.status, 0, atBase.err); assert.equal(JSON.parse(atBase.out).channel, 'stable');
  const atHead = await cli(args);
  assert.equal(atHead.status, 2); assert.match(atHead.err, /no channel\/main-now/);
  const nowhere = await cli([...args, '--base', 'nonesuch']);
  assert.equal(nowhere.status, 2); assert.match(nowhere.err, /cannot read docs\/workflow\/config\.json at nonesuch/);
});
