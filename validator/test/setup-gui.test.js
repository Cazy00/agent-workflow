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
  assert.deepEqual(adoptArguments(good, '/p'), ['--project', '/p', '--repository', 'acme/shop', '--coordinator', 'owner', '--rev', 'v1.11.0', '--approval', 'owner-merge', '--checkpoint', 'milestone', '--worker', 'agent-bot', '--lane', 'existing', '--production', '**/*.{dart,vue}', '--client-page']);
  // MAINT-0010: the page asks when the agent stops (the checkpoint); a signing key is the stricter option, without one.
  assert.deepEqual(adoptArguments({ ...good, checkpoint: 'plan' }, '/p').slice(8, 12), ['--approval', 'owner-merge', '--checkpoint', 'plan']);
  const { approval: _a, ...noApproval } = good;
  assert.deepEqual(adoptArguments(noApproval, '/p').slice(8, 12), ['--approval', 'owner-merge', '--checkpoint', 'milestone'], 'owner-merge with a milestone checkpoint by default');
  assert.ok(!adoptArguments({ ...good, approval: 'manual', checkpoint: 'plan' }, '/p').includes('--checkpoint'), 'manual mode has no checkpoint');
  for (const [change, message] of [[{ repository: 'shop' }, /OWNER\/REPOSITORY/], [{ coordinator: 'two words' }, /not a valid username/], [{ approval: 'enforced' }, /how you approve/], [{ checkpoint: 'sometimes' }, /when the agent stops/], [{ lane: 'maybe' }, /already has code/], [{ worker: 'bad name' }, /agent's GitHub account/]]) {
    assert.throws(() => adoptArguments({ ...good, ...change }, '/p'), message);
  }
});

test('saving settings writes config and profile together, keeps the approval label in sync, and keeps the body', t => {
  const dir = project(t, '--approval', 'manual');
  const bodyBefore = read(dir, 'docs/workflow/profile.md').split('\n---\n').slice(1).join('\n---\n');
  const r = saveSettings({ project: dir, form: form({ dir, approval: { label: 'owner-merge', approver: 'owner', agent_identity: '', derived_baselines: false }, measure: 'A customer can order online.', required_checks: ['test', 'lint'], production: [...loadConfig(dirSource(dir)).paths.production, '**/*.{dart,vue}'], client: { title: 'Shop', exclude: ['M-0001'] } }) });
  assert.deepEqual(r.changed, ['docs/workflow/config.json', 'docs/workflow/profile.md']);
  assert.match(r.notes.join(' '), /Your own merge is now the approval/);
  assert.match(r.notes.join(' '), /rerun the protection command/);
  assert.doesNotMatch(r.notes.join(' '), /setup\.md|step \d/, 'plain words, no file names or step numbers for the owner');
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

test('saving works once the project has acceptance examples and test mappings (MAINT-0009 review B1)', t => {
  const dir = project(t, '--approval', 'manual');
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  write('docs/specs/orders.md', '# Orders\n');
  write('tests/acceptance/orders.test.js', "test('AC-001-1 a customer orders', () => {});\n");
  write('docs/workflow/acceptance.json', JSON.stringify({ examples: [{ id: 'AC-001-1', requirement: 'docs/specs/orders.md', method: 'automated' }] }));
  write('tests/acceptance-map.json', JSON.stringify([{ acceptance: 'AC-001-1', file: 'tests/acceptance/orders.test.js', name: 'AC-001-1 a customer orders' }]));
  assert.deepEqual(validateRecords(dirSource(dir), 'docs/workflow').errors, []);
  const r = saveSettings({ project: dir, form: form({ dir, measure: 'A customer can order online.' }) });
  assert.deepEqual(r.changed, ['docs/workflow/profile.md']);
});

test('switching to enforced needs both accounts and records the matching mechanism; dependent files are named', t => {
  const dir = project(t, '--worker', 'agent-bot', '--approval', 'manual');
  assert.throws(() => saveSettings({ project: dir, form: form({ dir, approval: { label: 'enforced', approver: '', agent_identity: 'agent-bot' } }) }), /needs your GitHub username/);
  const r = saveSettings({ project: dir, form: form({ dir, approval: { label: 'enforced', approver: 'owner-2', agent_identity: 'agent-bot' }, trusted_branch: 'trunk' }) });
  const config = loadConfig(dirSource(dir));
  assert.deepEqual([config.approval.label, config.approval.mechanism], ['enforced', 'github-rulesets-codeowners']);
  assert.match(read(dir, 'docs/workflow/profile.md'), /^approval_mechanism: github-rulesets-codeowners$/m);
  const notes = r.notes.join(' ');
  assert.match(notes, /your step "Switch to enforced mode" is done first/);
  assert.match(notes, /Tell the agent to update CODEOWNERS/);
  assert.match(notes, /change it in the GitHub workflows/);
  assert.doesNotMatch(notes, /your setup steps/, 'the enforced switch follows its own step, not a rewrite of the checklist');
  const merge = project(t, '--approval', 'manual');
  assert.match(saveSettings({ project: merge, form: form({ dir: merge, approval: { label: 'owner-merge', approver: 'owner', agent_identity: '' } }) }).notes.join(' '), /Tell the agent to update its instructions on merging \(AGENTS\.md\) and your setup steps to match/);
});

test('the page sends only what it shows, and saving keeps the agent\'s settings and the client theme', async t => {
  const dir = project(t);
  const configPath = path.join(dir, 'docs/workflow/config.json');
  const config = JSON.parse(read(dir, 'docs/workflow/config.json'));
  config.paths.production.push('**/*.dart');
  config.trusted_branch = 'trunk';
  config.approval.derived_baselines = true;
  config.client = { theme: { colors: { brand: '#174A7C' } } };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(dir, 'docs/workflow/profile.md'), read(dir, 'docs/workflow/profile.md').replace('required_checks: []', 'required_checks: [test]'));
  fs.writeFileSync(path.join(dir, 'docs/workflow/milestones/M-0001.md'), '---\nrecord: milestone\nid: M-0001\noutcome: Customers order online.\nstatus: Draft\ncoordinator: agent\nowner: owner\nscope: [src]\ngoverning: [PROFILE]\nacceptance: []\nauthority: owner\nlimits: x\ndemonstration: x\nstop_conditions: x\nrelease_authority: owner\ntasks: []\n---\n# M-0001 — Online ordering\n');
  // Exactly what the page sends.
  saveSettings({ project: dir, form: { approval: { label: 'owner-merge', approver: 'owner', agent_identity: '' }, project: 'shop', measure: 'A customer can order online.', client: { title: 'Shop', language: 'ar', detail: 'parts', exclude: ['M-0001'] } } });
  const after = loadConfig(dirSource(dir));
  assert.ok(after.paths.production.includes('**/*.dart'), 'code paths are the agent\'s, untouched');
  assert.deepEqual([after.trusted_branch, after.approval.derived_baselines], ['trunk', true], 'the trusted branch and derived baselines are kept');
  assert.deepEqual(after.client, { title: 'Shop', language: 'ar', detail: 'parts', exclude: ['M-0001'], theme: { colors: { brand: '#174A7C' } } }, 'the theme is kept');
  assert.throws(() => saveSettings({ project: dir, form: { approval: { label: 'owner-merge', approver: 'owner', agent_identity: '' }, client: { detail: 'everything' } } }), /how much the client page shows/);
  assert.match(read(dir, 'docs/workflow/profile.md'), /^required_checks: \[test\]$/m, 'required checks are the agent\'s, untouched');
  assert.throws(() => saveSettings({ project: dir, form: { approval: { label: 'manual', approver: 'owner', agent_identity: '' }, client: { language: 'fr' } } }), /language must be one of en, ar/);
  const { readState } = await import('../../adapters/setup.mjs');
  const state = await readState({ project: dir, workflowRepo: root });
  assert.deepEqual(state.settings.milestones, [{ id: 'M-0001', title: 'Online ordering' }], 'stages are named, not numbered');
  assert.deepEqual([state.settings.client.language, state.settings.client.detail, state.settings.client.themed], ['ar', 'parts', true]);
  assert.equal(state.suggested_checks, undefined, 'no inspection once adopted');
});

test('the owner ticks their own steps; agent steps and a stale page are refused', t => {
  const dir = project(t);
  const lines = read(dir, 'docs/workflow/setup.md').split('\n');
  const pilot = lines.findIndex(l => l.includes('5. **Protect the main branch.**')); // an optional step can be ticked too
  const agent = lines.findIndex(l => l.startsWith('- [ ] 1. **Write the project profile.**'));
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
    const req = http.request({ host: '127.0.0.1', port, method, path: p, agent: false, headers: { Host: host, ...headers } }, res => { let data = ''; res.on('data', c => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers })); });
    req.on('error', reject);
    req.end(body);
  });
}

test('only this server\'s own page, with its token, can read or change anything', async t => {
  const dir = project(t, false);
  let quit = false;
  // A copy of the workflow at its own release: tags are made on GitHub, so a fresh clone is tagged here.
  const release = `v${JSON.parse(read(root, 'package.json')).version}`;
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-setup-release-'));
  t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
  for (const args of [['clone', '-q', '--no-hardlinks', root, copy], ['-C', copy, 'tag', '-f', release]]) assert.equal(spawnSync('git', args).status, 0);
  const { server, token } = createSetupServer({ project: dir, workflowRepo: copy, onQuit: () => { quit = true; } });
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
  assert.equal((await request(port, { method: 'OPTIONS', path: `/api/adopt?t=${token}`, headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } })).headers['access-control-allow-origin'], undefined, 'no CORS preflight is granted');
  assert.equal((await request(port, { path: `/?t=${token}`, host: `[::1]:${port}` })).status, 403, 'only the address it listens on');
  assert.equal((await request(port, { path: `/?t=${token}`, host: `localhost:${port}` })).status, 200);
  assert.equal((await request(port, { method: 'POST', path: `/api/settings?t=${token}`, headers: json, body: 'x'.repeat(70000) })).status, 413, 'an oversized body is refused with 413, not a dropped connection');
  assert.throws(() => adoptArguments({ repository: 'acme/shop', coordinator: 'owner', approval: 'manual', lane: 'new', version: '--workflow-repo' }, dir), /choose a workflow release/);
  const state = JSON.parse((await request(port, { path: `/api/state?t=${token}` })).body);
  assert.equal(state.adopted, false);
  assert.deepEqual([state.defaults.version, state.defaults.release.outdated], [release, false]);
  assert.equal(state.defaults.warnings, undefined, 'the inspection\'s technical warnings stay with the agent');
  const adopted = JSON.parse((await request(port, { method: 'POST', path: `/api/adopt?t=${token}`, headers: json, body: JSON.stringify({ repository: 'acme/shop', coordinator: 'owner', approval: 'owner-merge', lane: 'new', production: [], version: release }) })).body);
  assert.equal(adopted.ok, true, adopted.output);
  assert.deepEqual([loadConfig(dirSource(dir)).approval.label, loadConfig(dirSource(dir)).approval.checkpoint], ['owner-merge', 'milestone']);
  const again = await request(port, { method: 'POST', path: `/api/adopt?t=${token}`, headers: json, body: JSON.stringify({}) });
  assert.equal(again.status, 400);
  assert.match(again.body, /adopted already/);
  const settings = JSON.parse((await request(port, { path: `/api/state?t=${token}` })).body);
  assert.deepEqual([settings.adopted, settings.settings.approval.label, settings.checklist.some(s => s.who === 'owner')], [true, 'owner-merge', true]);
  assert.equal((await request(port, { method: 'POST', path: `/api/quit?t=${token}`, headers: json, body: '{}' })).status, 200);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(quit, true);
});

test('a copy of the workflow behind its own release cannot set a project up, and says how to update', async t => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-setup-stale-'));
  t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['clone', '-q', '--no-hardlinks', root, copy]).status, 0);
  for (const tag of spawnSync('git', ['-C', copy, 'tag'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)) spawnSync('git', ['-C', copy, 'tag', '-d', tag]);
  assert.equal(spawnSync('git', ['-C', copy, 'tag', 'v1.0.0']).status, 0); // older than its package.json version
  const dir = project(t, false);
  const { readState, adopt } = await import('../../adapters/setup.mjs');
  const state = await readState({ project: dir, workflowRepo: copy });
  assert.deepEqual([state.defaults.release.outdated, state.defaults.release.newest], [true, 'v1.0.0']);
  assert.throws(() => adopt({ project: dir, workflowRepo: copy, form: { repository: 'acme/shop', coordinator: 'owner', approval: 'manual', lane: 'new', version: 'v1.0.0' } }), /git pull --tags/);
  assert.ok(!fs.existsSync(path.join(dir, 'docs/workflow')), 'nothing is written');
});

test('the checkpoint is saved with owner-merge, dropped with another mode, checked, and explained', t => {
  const dir = project(t);
  const save = approval => saveSettings({ project: dir, form: form({ dir, approval: { approver: 'owner', agent_identity: '', ...approval } }) });
  const plan = save({ label: 'owner-merge', checkpoint: 'plan' });
  assert.match(plan.notes.join(' '), /works through every milestone you have approved without stopping/);
  assert.equal(loadConfig(dirSource(dir)).approval.checkpoint, 'plan');
  assert.equal(save({ label: 'owner-merge' }).changed.length, 0, 'a form without a checkpoint keeps the one there');
  assert.throws(() => save({ label: 'owner-merge', checkpoint: 'sometimes' }), /when the agent stops/);
  assert.equal(loadConfig(dirSource(dir)).approval.checkpoint, 'plan', 'nothing written on a refusal');
  save({ label: 'manual', checkpoint: 'plan' });
  assert.equal(loadConfig(dirSource(dir)).approval.checkpoint, undefined, 'manual mode has no checkpoint');
});
