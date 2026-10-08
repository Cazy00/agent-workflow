import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { adoptArguments, createSetupServer, saveSettings, setFrontMatter, tickStep } from '../../adapters/setup.mjs';
import { dirSource, loadConfig, validateRecords } from '../lib/index.js';

// bin/wf-setup (MAINT-0009): a local page that adopts the workflow and edits its settings later. These tests cover what
// it writes, what it refuses, and that only this server's own page, with its token, can drive it.
const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

function project(t, ...extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-setup-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['-C', dir, 'init', '-q']).status, 0);
  if (extra[0] !== false) {
    const r = spawnSync(process.execPath, [path.join(root, 'bin/wf-adopt'), '--project', dir, '--workflow-repo', root, '--rev', 'HEAD', '--repository', 'acme/shop', '--coordinator', 'owner', ...extra], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  return dir;
}
const form = (overrides = {}) => ({ approval: { label: 'manual', approver: 'owner', agent_identity: '', derived_baselines: false }, project: 'shop', measure: '', required_checks: [], production: loadConfig(dirSource(overrides.dir)).paths.production, trusted_branch: 'main', client: { title: '', exclude: [] }, ...overrides });

test('front matter edits replace or add a line and leave the rest alone', () => {
  const text = '---\nrecord: profile\nproject: old\n# a comment\n---\n# Body\nproject: not front matter\n';
  assert.equal(setFrontMatter(text, { project: 'new', required_checks: ['test', 'lint'] }), '---\nrecord: profile\nproject: new\n# a comment\nrequired_checks: [test, lint]\n---\n# Body\nproject: not front matter\n');
  assert.throws(() => setFrontMatter('# no front matter\n', { a: 'b' }), /no front matter/);
});

test('the adopt form becomes wf-adopt arguments, and bad answers are refused', () => {
  const good = { repository: 'acme/shop', coordinator: 'owner', approval: 'owner-merge', worker: 'agent-bot', lane: 'existing', production: ['**/*.{dart,vue}', '**/*.{dart,vue}'], client_page: true, version: 'v1.11.0' };
  assert.deepEqual(adoptArguments(good, '/p'), ['--project', '/p', '--repository', 'acme/shop', '--coordinator', 'owner', '--rev', 'v1.11.0', '--approval', 'owner-merge', '--worker', 'agent-bot', '--lane', 'existing', '--production', '**/*.{dart,vue}', '--client-page']);
  for (const [change, message] of [[{ repository: 'shop' }, /OWNER\/REPOSITORY/], [{ coordinator: 'two words' }, /not a valid username/], [{ approval: 'enforced' }, /how you approve/], [{ lane: 'maybe' }, /already has code/], [{ worker: 'bad name' }, /agent's GitHub account/]]) {
    assert.throws(() => adoptArguments({ ...good, ...change }, '/p'), message);
  }
});

test('saving settings writes config and profile together, keeps the approval label in sync, and keeps the body', t => {
  const dir = project(t);
  const bodyBefore = read(dir, 'docs/workflow/profile.md').split('\n---\n').slice(1).join('\n---\n');
  const r = saveSettings({ project: dir, form: form({ dir, approval: { label: 'owner-merge', approver: 'owner', agent_identity: '', derived_baselines: false }, measure: 'A customer can order online.', required_checks: ['test', 'lint'], production: [...loadConfig(dirSource(dir)).paths.production, '**/*.{dart,vue}'], client: { title: 'Shop', exclude: ['M-0001'] } }) });
  assert.deepEqual(r.changed, ['docs/workflow/config.json', 'docs/workflow/profile.md']);
  assert.match(r.notes.join(' '), /from manual to owner-merge/);
  assert.match(r.notes.join(' '), /rerun wf-protect --apply/);
  assert.match(r.next, /never commits or pushes/);
  const config = loadConfig(dirSource(dir));
  assert.deepEqual([config.approval.label, config.approval.mechanism, config.client], ['owner-merge', 'owner-merge', { title: 'Shop', exclude: ['M-0001'] }]);
  assert.ok(config.paths.production.includes('**/*.{dart,vue}'), 'a glob may hold a comma');
  const profile = read(dir, 'docs/workflow/profile.md');
  for (const line of ['approval_label: owner-merge', 'approval_mechanism: owner-merge', 'measure: A customer can order online.', 'required_checks: [test, lint]']) assert.ok(profile.includes(`\n${line}\n`), line);
  assert.equal(profile.split('\n---\n').slice(1).join('\n---\n'), bodyBefore, 'the profile body is untouched');
  assert.deepEqual(validateRecords(dirSource(dir), 'docs/workflow').errors, []);
  assert.deepEqual(saveSettings({ project: dir, form: form({ dir, approval: { label: 'owner-merge', approver: 'owner', agent_identity: '', derived_baselines: false }, measure: 'A customer can order online.', required_checks: ['test', 'lint'], production: config.paths.production, client: { title: 'Shop', exclude: ['M-0001'] } }) }).changed, [], 'saving again changes nothing');
});

test('saving refuses what the workflow would reject, and writes nothing then', t => {
  const dir = project(t);
  const before = [read(dir, 'docs/workflow/config.json'), read(dir, 'docs/workflow/profile.md')];
  for (const [change, message] of [
    [{ approval: { label: 'enforced', approver: 'owner', agent_identity: '' } }, /enforced mode needs the agent's own account/],
    [{ approval: { label: 'manual', approver: 'owner', agent_identity: 'OWNER' } }, /must differ from yours/],
    [{ approval: { label: 'strict', approver: 'owner' } }, /choose an approval mode/],
    [{ required_checks: ['a, b'] }, /cannot contain a comma/],
    [{ measure: '[a list]' }, /square brackets/],
    [{ client: { title: '', exclude: ['T-0001'] } }, /milestone IDs/],
    [{ trusted_branch: 'main; rm -rf' }, /plain branch name/],
  ]) assert.throws(() => saveSettings({ project: dir, form: form({ dir, ...change }) }), message);
  assert.deepEqual([read(dir, 'docs/workflow/config.json'), read(dir, 'docs/workflow/profile.md')], before);
  const shared = project(t, '--owner', 'alice', '--owner', 'bob');
  assert.throws(() => saveSettings({ project: shared, form: form({ dir: shared, approval: { label: 'owner-merge', approver: '', agent_identity: '' } }) }), /owner-merge is for one owner/);
});

test('the owner ticks their own steps; agent steps and a stale page are refused', t => {
  const dir = project(t);
  const lines = read(dir, 'docs/workflow/setup.md').split('\n');
  const pilot = lines.findIndex(l => l.includes('11. Your first milestone is the pilot'));
  const agent = lines.findIndex(l => l.startsWith('- [ ] 1. Fill'));
  const text = lines[pilot].slice(6);
  tickStep({ project: dir, index: pilot, done: true, text });
  assert.equal(read(dir, 'docs/workflow/setup.md').split('\n')[pilot], `- [x] ${text}`);
  tickStep({ project: dir, index: pilot, done: false, text });
  assert.equal(read(dir, 'docs/workflow/setup.md').split('\n')[pilot], `- [ ] ${text}`);
  assert.throws(() => tickStep({ project: dir, index: agent, done: true, text: lines[agent].slice(6) }), /ticked by the agent/);
  assert.throws(() => tickStep({ project: dir, index: pilot, done: true, text: 'something else' }), /reload it/);
});

// Requests with full control of the Host header, which fetch does not give.
function request(port, { method = 'GET', path: p = '/', host = `127.0.0.1:${port}`, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: host, ...headers } }, res => { let data = ''; res.on('data', c => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers })); });
    req.on('error', reject);
    req.end(body);
  });
}

test('only this server\'s own page, with its token, can read or change anything', async t => {
  const dir = project(t, false);
  let quit = false;
  const { server, token } = createSetupServer({ project: dir, workflowRepo: root, onQuit: () => { quit = true; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const json = { 'Content-Type': 'application/json' };
  assert.equal((await request(port, { path: '/' })).status, 403, 'no token');
  assert.equal((await request(port, { path: `/?t=${'0'.repeat(token.length)}` })).status, 403, 'wrong token');
  assert.equal((await request(port, { path: `/?t=${token}`, host: 'evil.example:80' })).status, 403, 'another host name (DNS rebinding)');
  const page = await request(port, { path: `/?t=${token}` });
  assert.equal(page.status, 200);
  assert.match(page.body, new RegExp(`const TOKEN = '${token}'`));
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal((await request(port, { method: 'POST', path: `/api/adopt?t=${token}`, headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415, 'a plain form post');
  assert.equal((await request(port, { method: 'POST', path: `/api/adopt?t=${token}`, headers: { ...json, Origin: 'https://evil.example' }, body: '{}' })).status, 403, 'another origin');
  const state = JSON.parse((await request(port, { path: `/api/state?t=${token}` })).body);
  assert.equal(state.adopted, false);
  const adopted = JSON.parse((await request(port, { method: 'POST', path: `/api/adopt?t=${token}`, headers: json, body: JSON.stringify({ repository: 'acme/shop', coordinator: 'owner', approval: 'owner-merge', lane: 'new', production: [], version: 'HEAD' }) })).body);
  assert.equal(adopted.ok, true, adopted.output);
  assert.equal(loadConfig(dirSource(dir)).approval.label, 'owner-merge');
  const again = await request(port, { method: 'POST', path: `/api/adopt?t=${token}`, headers: json, body: JSON.stringify({}) });
  assert.equal(again.status, 400);
  assert.match(again.body, /adopted already/);
  const settings = JSON.parse((await request(port, { path: `/api/state?t=${token}` })).body);
  assert.deepEqual([settings.adopted, settings.settings.approval.label, settings.checklist.some(s => s.who === 'owner')], [true, 'owner-merge', true]);
  assert.equal((await request(port, { method: 'POST', path: `/api/quit?t=${token}`, headers: json, body: '{}' })).status, 200);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(quit, true);
});
