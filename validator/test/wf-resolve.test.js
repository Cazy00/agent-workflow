import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, readWorkflow, pickToken, DEFAULT_API, ResolveError } from '../../adapters/resolve.mjs';

// bin/wf-resolve (channel-resolve v2): the base config's channel or hold -> {channel, revision, version}, or a refusal.
// A channel is a marker on a GitHub release: stable = the release marked latest, canary = the newest published one.
// Each test builds a workflow repository in a scratch directory, and a local server standing in for GitHub's API
// (releases, tag refs, rulesets); nothing leaves the machine. The server runs in this process, so the command line is run
// asynchronously.
const root = fileURLToPath(new URL('../..', import.meta.url));
const bin = path.join(root, 'bin/wf-resolve');
const IDENTITY = 'agent-workflow-executor[bot]';
const git = (dir, ...args) => { const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const cli = (args, env = {}) => new Promise(done => {
  const p = spawn(process.execPath, [bin, ...args], { env: { ...process.env, WF_RELEASE_IDENTITY: '', GITHUB_TOKEN: '', GH_TOKEN: '', ...env } });
  let out = '', err = '';
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
  p.on('close', status => done({ status, out, err }));
});
const TAG_RULESET = { id: 7, target: 'tag', enforcement: 'active', conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } }, rules: [{ type: 'update' }, { type: 'deletion' }, { type: 'non_fast_forward' }] };

// A workflow repository on main: v2.0.0 (annotated), v2.1.0 (lightweight), then an untagged commit still at 2.1.0, and a
// side commit main never reaches. Each commit's package.json carries its version. `releases` lists what the fake API
// reports, oldest first: {tag, author, draft, prerelease, latest}. `rulesets` replaces the tag ruleset; `apiTags`
// {tag: commit} overrides where the API says a tag points.
async function world(t, { releases, rulesets, apiTags = {} } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-resolve-test-'));
  const repo = path.join(temp, 'workflow');
  fs.mkdirSync(repo); git(repo, 'init', '-q', '-b', 'main');
  const commit = (name, version) => { fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'w', version })); fs.writeFileSync(path.join(repo, 'f.txt'), name); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', name); return git(repo, 'rev-parse', 'HEAD'); };
  const c1 = commit('one', '2.0.0'); git(repo, 'tag', '-a', 'v2.0.0', '-m', 'v2.0.0');
  const c2 = commit('two', '2.1.0'); git(repo, 'tag', 'v2.1.0'); // a lightweight tag resolves too
  git(repo, 'checkout', '-q', '-b', 'side', c1); const side = commit('side', '2.9.0'); git(repo, 'checkout', '-q', 'main');
  const c3 = commit('three, untagged', '2.1.0');
  const state = {
    releases: releases ?? [{ tag: 'v2.0.0', author: IDENTITY, latest: true }, { tag: 'v2.1.0', author: IDENTITY }],
    rulesets: rulesets ?? [TAG_RULESET], apiTags, status: 0, showDrafts: false
  };
  const seen = [];
  const rg = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  const asRelease = r => ({ tag_name: r.tag, draft: Boolean(r.draft), prerelease: Boolean(r.prerelease), author: { login: r.author } });
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    const send = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    if (state.status) return send(state.status, {});
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/repos/acme/workflow/releases/latest') {
      const l = state.releases.find(r => r.latest);
      return l ? send(200, asRelease(l)) : send(404, { message: 'Not Found' });
    }
    if (p === '/repos/acme/workflow/releases') return send(200, state.releases.filter(r => !r.draft || state.showDrafts).map(asRelease).reverse());
    if (p === '/repos/acme/workflow/rulesets') return send(200, state.rulesets.map(({ id, target, enforcement }) => ({ id, target, enforcement })));
    let m;
    if ((m = p.match(/^\/repos\/acme\/workflow\/rulesets\/(\d+)$/))) {
      const r = state.rulesets.find(x => String(x.id) === m[1]);
      return r ? send(200, r) : send(404, { message: 'Not Found' });
    }
    if ((m = p.match(/^\/repos\/acme\/workflow\/git\/ref\/tags\/(.+)$/))) {
      const tag = decodeURIComponent(m[1]);
      if (state.apiTags[tag]) return send(200, { ref: `refs/tags/${tag}`, object: { type: 'commit', sha: state.apiTags[tag] } });
      const sha = rg('rev-parse', '--verify', '-q', `refs/tags/${tag}`).stdout.trim();
      if (!sha) return send(404, { message: 'Not Found' });
      return send(200, { ref: `refs/tags/${tag}`, object: { type: rg('cat-file', '-t', sha).stdout.trim(), sha } });
    }
    if ((m = p.match(/^\/repos\/acme\/workflow\/git\/tags\/([0-9a-f]+)$/))) {
      const sha = rg('rev-parse', '--verify', '-q', `${m[1]}^{commit}`).stdout.trim();
      return sha ? send(200, { object: { type: 'commit', sha } }) : send(404, { message: 'Not Found' });
    }
    send(404, { message: 'Not Found' });
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  t.after(() => { server.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  const api = `http://127.0.0.1:${server.address().port}`;
  const config = (workflow) => ({ workflow: { repo: 'acme/workflow', ...workflow } });
  const call = (workflow, extra = {}) => resolve({ config: config(workflow), releaseIdentity: IDENTITY, gitUrl: repo, api, ...extra });
  const release = tag => state.releases.find(r => r.tag === tag);
  const markLatest = tag => { for (const r of state.releases) r.latest = r.tag === tag; };
  return { temp, repo, api, c1, c2, c3, side, state, config, call, seen, release, markLatest, commit, git: (...a) => git(repo, ...a) };
}
const refusal = (p, re) => assert.rejects(p, e => e instanceof ResolveError && re.test(e.message), `expected a refusal matching ${re}`);

test('stable is the release marked latest; canary is the newest published release', async t => {
  const w = await world(t);
  assert.deepEqual(await w.call({ channel: 'stable' }), { channel: 'stable', revision: w.c1, version: 'v2.0.0' }); // annotated tag
  assert.deepEqual(await w.call({ channel: 'canary' }), { channel: 'canary', revision: w.c2, version: 'v2.1.0' }); // lightweight tag
  w.markLatest('v2.1.0'); // promotion: mark the canary's release latest
  assert.equal((await w.call({ channel: 'stable' })).version, 'v2.1.0');
  // newest is by version, not by list order, and drafts and prereleases are not published
  w.state.releases.push({ tag: 'v2.0.5', author: IDENTITY });
  w.git('tag', 'v2.9.9', w.c3);
  w.state.releases.push({ tag: 'v2.9.9', author: IDENTITY, prerelease: true }, { tag: 'v2.9.8', author: IDENTITY, draft: true });
  w.state.showDrafts = true; // a reader with push access sees drafts in the list
  assert.equal((await w.call({ channel: 'canary' })).version, 'v2.1.0');
});

test('rollback markers: stable goes back by marking the previous release latest, canary by marking the bad one a prerelease or draft', async t => {
  const w = await world(t, { releases: [{ tag: 'v2.0.0', author: IDENTITY }, { tag: 'v2.1.0', author: IDENTITY, latest: true }] });
  assert.equal((await w.call({ channel: 'stable' })).version, 'v2.1.0');
  w.markLatest('v2.0.0');
  assert.deepEqual(await w.call({ channel: 'stable' }), { channel: 'stable', revision: w.c1, version: 'v2.0.0' });
  assert.equal((await w.call({ channel: 'canary' })).version, 'v2.1.0');
  w.release('v2.1.0').prerelease = true;
  assert.equal((await w.call({ channel: 'canary' })).version, 'v2.0.0');
  w.release('v2.1.0').prerelease = false; w.release('v2.1.0').draft = true;
  assert.equal((await w.call({ channel: 'canary' })).version, 'v2.0.0');
  // a latest marker on a prerelease, or nothing marked latest, resolves nothing
  w.release('v2.1.0').draft = false; w.release('v2.1.0').prerelease = true; w.markLatest('v2.1.0');
  await refusal(w.call({ channel: 'stable' }), /marked latest \(v2\.1\.0\) is not a published/);
  w.markLatest('none');
  await refusal(w.call({ channel: 'stable' }), /no release marked latest/);
  for (const r of w.state.releases) r.prerelease = true;
  await refusal(w.call({ channel: 'canary' }), /canary has no published release of major 2/);
});

test('channels are per major: a later major never reaches stable or canary, and stable-N waits for its promotion', async t => {
  const w = await world(t);
  const c4 = w.commit('four', '3.0.0'); w.git('tag', 'v3.0.0', c4);
  w.state.releases.push({ tag: 'v3.0.0', author: IDENTITY });
  assert.equal((await w.call({ channel: 'canary' })).version, 'v2.1.0');
  assert.equal((await w.call({ channel: 'canary-3' })).version, 'v3.0.0');
  await refusal(w.call({ channel: 'stable-3' }), /stable has no release of major 3 yet: the latest is v2\.0\.0/);
  w.markLatest('v3.0.0');
  assert.deepEqual(await w.call({ channel: 'stable-3' }), { channel: 'stable-3', revision: c4, version: 'v3.0.0' });
  assert.equal((await w.call({ channel: 'stable' })).version, 'v2.1.0', 'an older major: its newest published release');
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
  for (const name of ['hold', 'beta', '../main', 'Stable', 'stable-', 'stable-2', 'stable-1', 'stable-03', 'canary-x', 'x y']) bad({ repo: 'acme/workflow', channel: name }, /is not a channel/);
  bad({ repo: 'acme/workflow', channel: 3 }, /is not a channel/);
  assert.throws(() => readWorkflow({}), /no workflow section/);
  assert.deepEqual(readWorkflow({ workflow: { repo: 'acme/workflow', channel: 'stable-3' } }), { kind: 'channel', repo: 'acme/workflow', channel: 'stable-3', marker: 'stable', major: 3 });
  assert.equal(readWorkflow({ workflow: { repo: 'acme/workflow', channel: 'canary' } }).major, 2);
});

test('a moved tag is refused: the tagged commit must carry the tag\'s version and be on main', async t => {
  const w = await world(t);
  w.state.apiTags['v2.0.0'] = w.c3; // an admin moved v2.0.0 to a later commit on main
  await refusal(w.call({ channel: 'stable' }), /stable is v2\.0\.0 at [0-9a-f]{12}, whose package\.json says 2\.1\.0: the tag was moved or the release renamed/);
  w.state.apiTags['v2.0.0'] = w.side; // ... or off main
  await refusal(w.call({ channel: 'stable' }), /is not on main/);
  w.state.apiTags['v2.0.0'] = 'f'.repeat(40); // ... or to a commit the repository does not have
  await refusal(w.call({ channel: 'stable' }), /is not on main/);
  delete w.state.apiTags['v2.0.0'];
  assert.equal((await w.call({ channel: 'stable' })).revision, w.c1, 'the tag where it was made resolves');
});

test('a renamed release tag is refused: the release keeps its author, but the new tag\'s commit does not carry that version', async t => {
  const w = await world(t);
  w.git('tag', 'v2.0.1', w.c3); // someone with write creates a tag at an unreleased commit ...
  w.release('v2.0.0').tag = 'v2.0.1'; // ... and edits the identity's latest release to name it
  await refusal(w.call({ channel: 'stable' }), /stable is v2\.0\.1 at [0-9a-f]{12}, whose package\.json says 2\.1\.0/);
  w.git('tag', 'v2.1.1', w.c3); w.state.releases.push({ tag: 'v2.1.1', author: IDENTITY }); // and for canary
  await refusal(w.call({ channel: 'canary' }), /canary is v2\.1\.1 at [0-9a-f]{12}, whose package\.json says 2\.1\.0/);
  w.release('v2.1.1').tag = 'v2.2.9'; // a name with no tag at all
  await refusal(w.call({ channel: 'canary' }), /canary is v2\.2\.9, which has no tag ref on GitHub/);
});

test('a release by another author is refused, also when it carries a marker', async t => {
  const w = await world(t);
  w.git('tag', 'v2.2.0', w.c3); w.state.releases.push({ tag: 'v2.2.0', author: 'someone-else' });
  w.markLatest('v2.2.0');
  await refusal(w.call({ channel: 'stable' }), /stable is v2\.2\.0, whose release was made by someone-else, not the release identity/);
  await refusal(w.call({ channel: 'canary' }), /canary is v2\.2\.0, whose release was made by someone-else/);
  await refusal(w.call({ channel: 'stable' }, { releaseIdentity: '' }), /no release identity/);
});

test('a missing, inactive, narrow, leaky or unreadable tag ruleset is refused', async t => {
  const rule = (over) => ({ ...TAG_RULESET, ...over });
  for (const [rulesets, re] of [
    [[], /no active tag ruleset forbids updating, deleting and force-pushing acme\/workflow's v\* tags$/],
    [[rule({ enforcement: 'evaluate' })], /no active tag ruleset/],
    [[rule({ enforcement: 'disabled' })], /no active tag ruleset/],
    [[rule({ target: 'branch' })], /no active tag ruleset/],
    [[rule({ conditions: { ref_name: { include: ['refs/tags/release-*'], exclude: [] } } })], /does not cover refs\/tags\/v\*/],
    [[rule({ conditions: { ref_name: { include: ['refs/tags/v*'], exclude: ['refs/tags/v2*'] } } })], /excludes refs\/tags\/v2\*/],
    [[rule({ rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }] })], /does not forbid update/],
    [[rule({ bypass_actors: [{ actor_type: 'Integration', actor_id: 99, bypass_mode: 'always' }] })], /lets Integration 99 bypass it/]
  ]) {
    const w = await world(t, { rulesets });
    await refusal(w.call({ channel: 'stable' }), re);
  }
  const admins = await world(t, { rulesets: [rule({ bypass_actors: [{ actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'always' }] })] });
  assert.equal((await admins.call({ channel: 'stable' })).version, 'v2.0.0', 'admins may bypass');
  const all = await world(t, { rulesets: [rule({ id: 8, target: 'branch' }), rule({ conditions: { ref_name: { include: ['~ALL'], exclude: [] } } })] });
  assert.equal((await all.call({ channel: 'stable' })).version, 'v2.0.0', '~ALL covers v* tags');
  const unreadable = await world(t);
  await refusal(unreadable.call({ channel: 'stable' }, { fetchImpl: async (url, o) => /\/rulesets/.test(url) ? { ok: false, status: 404 } : fetch(url, o) }), /rulesets of acme\/workflow are not readable/);
  await refusal(unreadable.call({ channel: 'stable' }, { fetchImpl: async (url, o) => /\/rulesets/.test(url) ? { ok: false, status: 403 } : fetch(url, o) }), /could not read the rulesets of acme\/workflow: HTTP 403/);
});

test('many tag rulesets cost a bounded number of API calls', async t => {
  const w = await world(t, { rulesets: Array.from({ length: 50 }, (_, i) => ({ ...TAG_RULESET, id: 100 + i, rules: [] })) });
  await refusal(w.call({ channel: 'stable' }), /no active tag ruleset/);
  assert.ok(w.seen.filter(s => /\/rulesets\/\d+/.test(s.url)).length <= 5, 'at most five rulesets read in detail');
});

test('every failure refuses with its reason and falls back to nothing', async t => {
  const w = await world(t);
  await refusal(w.call({ channel: 'stable' }, { gitUrl: path.join(w.temp, 'missing') }), /fetching main failed/);
  await refusal(w.call({ channel: 'stable' }, { gitUrl: '-u' }), /not a repository address/);
  await refusal(w.call({ channel: 'stable' }, { api: 'http://127.0.0.1:9' }), /could not read the latest release/); // the API is down
  w.state.status = 500;
  await refusal(w.call({ channel: 'canary' }), /could not read the releases of acme\/workflow: HTTP 500/);
  w.state.status = 0;
  assert.deepEqual(await w.call({ channel: 'stable' }), { channel: 'stable', revision: w.c1, version: 'v2.0.0' }, 'and the refusals changed nothing');
});

test('a mirror (--git-url) cannot choose the commit: it comes from the API\'s tag ref', async t => {
  const w = await world(t);
  w.state.apiTags['v2.0.0'] = w.c1;
  w.git('tag', '-f', 'v2.0.0', w.c3); // the mirror maps v2.0.0 elsewhere; the API still says c1
  assert.equal((await w.call({ channel: 'stable' })).revision, w.c1);
});

test('the API token goes only to GitHub, never to another host', async t => {
  const w = await world(t);
  await w.call({ channel: 'stable' }, { token: 'secret-token' });
  assert.ok(w.seen.length > 0 && w.seen.every(s => s.auth === undefined));
});

test('the token IS sent to the default GitHub API, on every call', async t => {
  const w = await world(t);
  const calls = [];
  const fetchImpl = async (url, o) => { calls.push({ url, auth: o.headers.Authorization }); return fetch(url.replace(DEFAULT_API, w.api), { headers: o.headers }); };
  assert.equal((await resolve({ config: w.config({ channel: 'stable' }), releaseIdentity: IDENTITY, gitUrl: w.repo, token: 'secret-token', fetchImpl })).version, 'v2.0.0');
  assert.ok(calls.length >= 4 && calls.every(c => c.url.startsWith(`${DEFAULT_API}/`) && c.auth === 'Bearer secret-token'));
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
  const file = path.join(w.temp, 'config.json');
  fs.writeFileSync(file, JSON.stringify(w.config({ channel: 'stable' })));
  const ok = await cli(['--config', file, '--git-url', w.repo, '--api-url', w.api], { WF_RELEASE_IDENTITY: IDENTITY });
  assert.equal(ok.status, 0, ok.err);
  assert.deepEqual(JSON.parse(ok.out), { channel: 'stable', revision: w.c1, version: 'v2.0.0' });
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
  assert.equal(atHead.status, 2); assert.match(atHead.err, /"main-now" is not a channel/);
  const nowhere = await cli([...args, '--base', 'nonesuch']);
  assert.equal(nowhere.status, 2); assert.match(nowhere.err, /cannot read docs\/workflow\/config\.json at nonesuch/);
});
