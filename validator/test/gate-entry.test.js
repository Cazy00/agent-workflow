import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../lib/ci-lint.js';

// v2.19.0 part 2: the shared gate. The reusable entry (.github/workflows/wf-gate.yml) runs bin/wf-resolve from the tag
// the caller names over the BASE config, then bin/wf-gate-ci from the resolved revision. These tests run the entry's own
// bash steps, read from the YAML, against a scratch workflow repository (served for https://github.com/ through git's
// url.insteadOf) and a project adopted from it, with a fake pull_request event file. Nothing leaves the machine.
const root = fileURLToPath(new URL('../..', import.meta.url));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const git = (dir, ...args) => { const r = sh('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args]); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const steps = file => Object.values(parseYaml(read(file)).jobs).flatMap(j => j.steps ?? []);
const stepRun = (file, name) => steps(file).find(s => s.name?.startsWith(name)).run;
const KEY = (() => { const { publicKey, privateKey } = generateKeyPairSync('ed25519'); return { privateKey, text: `ed25519:${Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64')}` }; })();

// A workflow repository at "https://github.com/Cazy00/agent-workflow": this checkout's committed HEAD on main at version
// 2.19.0, tagged v2.19.0, and beside it v2.18.3 without bin/wf-gate-ci (a pin from before the shared gate). The entry's
// bin/wf-resolve is a shim that runs the real resolver with its test-only sources (the scratch repository and a directory
// of signed records); the resolver itself is the real one. A project adopted at v2.19.0 in manual mode is the base.
function world(t, { approval = 'manual' } = {}) {
  if (sh('git', ['-C', root, 'rev-parse', 'HEAD']).status !== 0) return null;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-gate-entry-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const wf = path.join(temp, 'gh', 'Cazy00', 'agent-workflow.git');
  // A fresh history from the committed tree, never a clone: CI's checkout is shallow, and a shallow repository served to
  // the resolver's partial clone hangs it.
  fs.mkdirSync(wf, { recursive: true }); git(wf, 'init', '-q', '-b', 'main');
  const tar = sh('sh', ['-c', 'git -C "$1" archive HEAD | tar -x -C "$2"', 'sh', root, wf]);
  assert.equal(tar.status, 0, tar.stderr);
  git(wf, 'add', '-A'); git(wf, 'commit', '-qm', 'this checkout');
  const records = path.join(temp, 'records');
  fs.mkdirSync(records);
  fs.renameSync(path.join(wf, 'bin/wf-resolve'), path.join(wf, 'bin/wf-resolve-real'));
  fs.writeFileSync(path.join(wf, 'bin/wf-resolve'), `import { spawnSync } from 'node:child_process';
const r = spawnSync(process.execPath, [new URL('./wf-resolve-real', import.meta.url).pathname, '--git-url', ${JSON.stringify(wf)}, '--record-url', ${JSON.stringify(records)}, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, WF_RESOLVE_TEST: '1' } });
process.exit(r.status ?? 3);
`, { mode: 0o755 });
  const pkg = path.join(wf, 'package.json');
  fs.writeFileSync(pkg, fs.readFileSync(pkg, 'utf8').replace(/"version": "[^"]+"/, '"version": "2.19.0"'));
  git(wf, 'add', '-A'); git(wf, 'commit', '-qm', 'v2.19.0'); git(wf, 'tag', 'v2.19.0');
  const v219 = git(wf, 'rev-parse', 'HEAD');
  git(wf, 'checkout', '-q', '-b', 'old');
  git(wf, 'rm', '-q', 'bin/wf-gate-ci');
  fs.writeFileSync(pkg, fs.readFileSync(pkg, 'utf8').replace(/"version": "[^"]+"/, '"version": "2.18.3"'));
  git(wf, 'commit', '-qam', 'v2.18.3'); git(wf, 'tag', 'v2.18.3');
  const v2183 = git(wf, 'rev-parse', 'HEAD');
  git(wf, 'checkout', '-q', 'main');

  const project = path.join(temp, 'project');
  fs.mkdirSync(project); git(project, 'init', '-q', '-b', 'main');
  const a = sh(process.execPath, [path.join(root, 'bin/wf-adopt'), '--project', project, '--workflow-repo', wf, '--rev', 'v2.19.0', '--repository', 'acme/shop', '--coordinator', 'owner', '--approval', approval]);
  assert.equal(a.status, 0, a.stdout + a.stderr);
  git(project, 'add', '-A'); git(project, 'commit', '-qm', 'adopted at v2.19.0');

  const configPath = path.join(project, 'docs/workflow/config.json');
  const editConfig = fn => { fs.writeFileSync(configPath, JSON.stringify(fn(JSON.parse(fs.readFileSync(configPath, 'utf8'))), null, 2) + '\n'); };
  const caller = (entry = 'v2.19.0', uses = entry) => read('templates/github/channel/wf-ci.yml').replace(/@__ENTRY__/, `@${uses}`).replace(/__ENTRY__/g, entry).replace(/__TRUSTED_BRANCH__/g, 'main');
  const commit = (message, files = {}) => {
    for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true }); fs.writeFileSync(path.join(project, rel), text); }
    git(project, 'add', '-A'); git(project, 'commit', '-qm', message); return git(project, 'rev-parse', 'HEAD');
  };
  const putRecord = (channel, fields = {}) => {
    const now = Date.now();
    const body = Buffer.from(JSON.stringify({ v: 1, channel, major: 2, tag: 'v2.19.0', revision: v219, version: '2.19.0', seq: 1, issued_at: new Date(now - 3600e3).toISOString(), expires_at: new Date(now + 47 * 3600e3).toISOString(), ...fields }));
    fs.writeFileSync(path.join(records, `channel-${channel}.json`), body);
    fs.writeFileSync(path.join(records, `channel-${channel}.json.sig`), sign(null, body, KEY.privateKey).toString('base64'));
  };

  // Runs one of the entry's bash steps as the runner would, the step's `${{ }}` values given as its environment.
  let n = 0;
  const step = (name, env, file = '.github/workflows/wf-gate.yml') => {
    const runner = path.join(temp, `runner-${++n}`);
    fs.mkdirSync(runner);
    const out = path.join(runner, 'output'), summary = path.join(runner, 'summary');
    const r = sh('bash', ['-c', stepRun(file, name)], { cwd: project, env: {
      PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, HOME: temp,
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.file://${path.join(temp, 'gh')}/.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/',
      GITHUB_ACTIONS: 'true', GITHUB_WORKSPACE: project, RUNNER_TEMP: env.RUNNER_TEMP ?? runner, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary,
      ENTRY: 'v2.19.0', ENTRY_REPO: 'Cazy00/agent-workflow', ...env } });
    const output = fs.existsSync(out) ? Object.fromEntries(fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map(l => l.split('='))) : {};
    return { ...r, runner, output, summary: fs.existsSync(summary) ? fs.readFileSync(summary, 'utf8') : '' };
  };
  // A pull_request run: the fake event file names the base, the resolve step then the gate step run.
  const pullRequest = ({ base, head, eventBase = base, draft = false }) => {
    const event = path.join(temp, `event-${++n}.json`);
    fs.writeFileSync(event, JSON.stringify({ pull_request: { base: { sha: eventBase, ref: 'main' }, head: { sha: head }, draft } }));
    const env = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: event, EVENT: 'pull_request', BASE: base, HEAD_SHA: head, HEAD_REF: 'opt-in', DESCRIPTION: '', WF_DRAFT: String(draft) };
    git(project, 'checkout', '-q', '--detach', head);
    const resolved = step('Resolve the release that judges', env);
    const gate = resolved.status === 0 ? step('Run the gate', { ...env, RUNNER_TEMP: resolved.runner }) : null;
    return { resolved, gate };
  };
  return { temp, wf, v219, v2183, project, editConfig, caller, commit, putRecord, step, pullRequest, base: git(project, 'rev-parse', 'HEAD') };
}

test('the opt-in pull request passes: its base is still the v2.19.0 pin, which the entry resolves as a hold', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  w.editConfig(c => { const { revision, version, ...rest } = c.workflow; return { ...c, workflow: { ...rest, channel: 'stable', channel_key: KEY.text } }; });
  const head = w.commit('opt in', { '.github/workflows/wf-ci.yml': w.caller() });
  const { resolved, gate } = w.pullRequest({ base: w.base, head });
  assert.equal(resolved.status, 0, resolved.stdout + resolved.stderr);
  assert.deepEqual(resolved.output, { channel: 'hold', revision: w.v219, version: 'v2.19.0' }, 'the base pin judges, not the candidate channel');
  const record = JSON.parse(fs.readFileSync(path.join(resolved.runner, 'resolved.json'), 'utf8'));
  assert.match(record.resolved_at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  assert.match(gate.summary, /Judged by agent-workflow v2\.19\.0 \([0-9a-f]{12}\), a hold \(the base branch’s pin\), resolved at \d{4}-/);
});

test('a channel base resolves through its signed record, and the candidate cannot change it', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  w.putRecord('stable');
  w.editConfig(c => { const { revision, version, ...rest } = c.workflow; return { ...c, workflow: { ...rest, channel: 'stable', channel_key: KEY.text } }; });
  const base = w.commit('on stable', { '.github/workflows/wf-ci.yml': w.caller() });
  w.editConfig(c => ({ ...c, workflow: { repo: c.workflow.repo, revision: w.v2183, version: 'v2.18.3' } })); // a candidate hold
  const head = w.commit('the candidate pins itself');
  const { resolved, gate } = w.pullRequest({ base, head });
  assert.equal(resolved.status, 0, resolved.stdout + resolved.stderr);
  assert.deepEqual(resolved.output, { channel: 'stable', revision: w.v219, version: 'v2.19.0' });
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  assert.match(gate.summary, /channel stable, resolved at/);
  // without a record the channel fails closed
  fs.rmSync(path.join(w.temp, 'records', 'channel-stable.json'));
  const gone = w.pullRequest({ base, head });
  assert.notEqual(gone.resolved.status, 0);
  assert.match(gone.resolved.stderr, /channel-stable\.json or its signature is missing/);
});

test('the fake event decides the base: a --base other than pull_request.base.sha is refused', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  const head = w.commit('a change', { 'notes.txt': 'x\n' });
  const { resolved } = w.pullRequest({ base: head, head, eventBase: w.base });
  assert.notEqual(resolved.status, 0);
  assert.match(resolved.stderr, /is the candidate \(HEAD\)|is not the event's pull_request\.base\.sha/);
});

test('a pin from before the shared gate is refused with the first opt-in step', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  w.editConfig(c => ({ ...c, workflow: { ...c.workflow, revision: w.v2183, version: 'v2.18.3' } }));
  const base = w.commit('pinned to v2.18.3');
  const head = w.commit('opt in too early', { '.github/workflows/wf-ci.yml': w.caller() });
  const { resolved } = w.pullRequest({ base, head });
  assert.notEqual(resolved.status, 0);
  assert.match(resolved.stdout + resolved.stderr, /has no bin\/wf-gate-ci: move the pin to v2\.19\.0 or later first/);
});

test('the head caller must name the entry at an accepted release tag, repeated as entry', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  for (const [caller, why] of [
    [w.caller('main'), /names the entry at main: name a release tag vX\.Y\.Z/],
    [w.caller('v2.18.0'), /older than v2\.19\.0, the oldest entry this release accepts/],
    [w.caller('v2.19.0', 'v2.20.0'), /must repeat the entry's tag as `with: entry: v2\.20\.0` \(found v2\.19\.0\)/],
    [w.caller().replace('uses: Cazy00/', 'uses: mallory/'), /calls mallory\/agent-workflow\/\.github\/workflows\/wf-gate\.yml, not Cazy00/],
  ]) {
    git(w.project, 'checkout', '-q', 'main');
    const head = w.commit('a caller', { '.github/workflows/wf-ci.yml': caller });
    const { resolved, gate } = w.pullRequest({ base: w.base, head });
    assert.equal(resolved.status, 0, resolved.stderr);
    assert.equal(gate.status, 2, String(why) + gate.stdout + gate.stderr + git(w.project, 'show', `${head}:.github/workflows/wf-ci.yml`).slice(-300));
    assert.match(gate.stderr, why);
    assert.match(gate.summary, /### wf ci: fail/);
    git(w.project, 'checkout', '-q', 'main'); git(w.project, 'reset', '-q', '--hard', w.base);
  }
  // a draft reports the same and does not fail
  const head = w.commit('a draft', { '.github/workflows/wf-ci.yml': w.caller('main') });
  const { gate } = w.pullRequest({ base: w.base, head, draft: true });
  assert.equal(gate.status, 0);
  assert.match(gate.summary, /### wf ci \(draft\): fail/);
});

test('a scheduled or dispatched run judges the trusted branch head with its own config', t => {
  const w = world(t); if (!w) return t.skip('not a Git checkout');
  for (const event of ['schedule', 'repository_dispatch']) {
    const env = { GITHUB_EVENT_NAME: event, EVENT: event, BASE: w.base, HEAD_SHA: w.base, HEAD_REF: '' };
    const resolved = w.step('Resolve the release that judges', env);
    assert.equal(resolved.status, 0, resolved.stderr);
    const gate = w.step('Run the gate', { ...env, RUNNER_TEMP: resolved.runner });
    assert.equal(gate.status, 0, gate.stdout + gate.stderr);
    assert.match(gate.stdout, /a trusted-branch run: checking the records at its head/);
    assert.match(gate.summary, /### wf records: pass\nJudged by agent-workflow v2\.19\.0/);
  }
  const refused = w.step('Refuse any event', { EVENT: 'schedule', TRUSTED: 'main', GITHUB_REF: 'refs/heads/other' });
  assert.equal(refused.status, 1);
  assert.equal(w.step('Refuse any event', { EVENT: 'pull_request_target', TRUSTED: 'main' }).status, 1);
  assert.equal(w.step('Refuse any event', { EVENT: 'pull_request', TRUSTED: 'main', GATE: 'on', GITHUB_BASE_REF: 'MAIN' }).status, 1);
  assert.equal(w.step('Refuse any event', { EVENT: 'pull_request', TRUSTED: 'main', GATE: 'on', GITHUB_BASE_REF: 'main' }).status, 0);
});

test('in a pull-request mode wf ci runs, and its JSON names the resolved channel, revision and version', t => {
  const w = world(t, { approval: 'owner-merge' }); if (!w) return t.skip('not a Git checkout');
  const head = w.commit('a caller', { '.github/workflows/wf-ci.yml': w.caller() });
  const { resolved, gate } = w.pullRequest({ base: w.base, head });
  assert.equal(resolved.status, 0, resolved.stderr);
  const json = JSON.parse(gate.stdout.slice(gate.stdout.indexOf('{'), gate.stdout.lastIndexOf('}') + 1));
  assert.ok(['pass', 'fail'].includes(json.verdict));
  assert.deepEqual({ ...json.workflow, resolved_at: undefined }, { channel: 'hold', revision: w.v219, version: 'v2.19.0', resolved_at: undefined });
  assert.match(gate.summary, new RegExp(`### wf ci: ${json.verdict}[\\s\\S]*Judged by agent-workflow v2\\.19\\.0`));
});

test('the thin callers carry only triggers, permissions, concurrency and the entry at a release tag', () => {
  for (const [file, entry] of [['templates/github/channel/wf-ci.yml', 'wf-gate.yml'], ['templates/github/channel/wf-status.yml', 'wf-status.yml']]) {
    const y = parseYaml(read(file));
    const jobs = Object.values(y.jobs);
    assert.equal(jobs.length, 1, file);
    assert.equal(jobs[0].uses, `Cazy00/agent-workflow/.github/workflows/${entry}@__ENTRY__`, file);
    assert.equal(jobs[0].with.entry, '__ENTRY__', file);
    assert.equal(jobs[0].with.trusted_branch, '__TRUSTED_BRANCH__', file);
    assert.ok(!jobs[0].steps, `${file}: no steps of its own`);
    assert.deepEqual(y.on.repository_dispatch.types, ['wf-channel'], file);
    assert.ok(y.on.schedule?.length === 1 && /^\d+ \d+ \* \* \*$/.test(y.on.schedule[0].cron), `${file}: a daily schedule`);
    assert.ok('workflow_dispatch' in y.on, file);
    assert.equal(y.permissions.checks, 'write', `${file}: the wf resolved check run`);
    assert.equal(y.permissions.contents, 'read', file);
  }
  assert.ok(parseYaml(read('templates/github/channel/wf-ci.yml')).on.pull_request, 'the gate judges pull requests');
});

test('both entries are reusable only, and resolve and record what judged with the same steps', () => {
  const gate = parseYaml(read('.github/workflows/wf-gate.yml')), status = parseYaml(read('.github/workflows/wf-status.yml'));
  for (const y of [gate, status]) {
    assert.deepEqual(Object.keys(y.on), ['workflow_call']);
    assert.equal(y.on.workflow_call.inputs.entry.required, true);
  }
  for (const name of ['Resolve the release that judges', 'Record what judged']) {
    assert.equal(stepRun('.github/workflows/wf-status.yml', name), stepRun('.github/workflows/wf-gate.yml', name), name);
  }
  const names = steps('.github/workflows/wf-gate.yml').map(s => s.name ?? s.uses);
  assert.ok(names.indexOf('Resolve the release that judges') < names.indexOf('Run the gate'));
  assert.match(stepRun('.github/workflows/wf-gate.yml', 'Resolve'), /"\$RUNNER_TEMP\/entry\/bin\/wf-resolve" --project "\$GITHUB_WORKSPACE" --base "\$BASE"/, 'the resolver comes from the entry tag');
  assert.match(stepRun('.github/workflows/wf-gate.yml', 'Run the gate'), /"\$RUNNER_TEMP\/wf\/bin\/wf-gate-ci"/, 'the gate script comes from the resolved revision');
  assert.match(read('.github/workflows/wf-gate.yml'), /BASE: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.sha \}\}/);
  assert.match(stepRun('.github/workflows/wf-gate.yml', 'Record what judged'), /name: "wf resolved"/);
});

test('the shared client page: a thin caller, and an entry that resolves like the gate and records nothing, then renders from the resolved revision', () => {
  const y = parseYaml(read('templates/github/channel/wf-client-page.yml'));
  const jobs = Object.values(y.jobs);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].uses, 'Cazy00/agent-workflow/.github/workflows/wf-client-page.yml@__ENTRY__');
  assert.equal(jobs[0].with.entry, '__ENTRY__'); assert.equal(jobs[0].with.trusted_branch, '__TRUSTED_BRANCH__');
  assert.ok(!jobs[0].steps);
  assert.deepEqual(y.on.repository_dispatch.types, ['wf-channel']);
  for (const k of ['actions', 'pages', 'id-token']) assert.equal(y.permissions[k], 'write', k);
  assert.equal(y.permissions.checks, undefined, 'a page build is not a judgment: no wf resolved check run');
  assert.equal(y.permissions.contents, 'read');
  const entry = parseYaml(read('.github/workflows/wf-client-page.yml'));
  assert.deepEqual(Object.keys(entry.on), ['workflow_call']);
  assert.equal(entry.on.workflow_call.inputs.entry.required, true);
  assert.equal(stepRun('.github/workflows/wf-client-page.yml', 'Resolve the release that judges'), stepRun('.github/workflows/wf-gate.yml', 'Resolve the release that judges'));
  assert.doesNotMatch(read('.github/workflows/wf-client-page.yml'), /wf resolved"/, 'the page records no judgment');
  assert.match(stepRun('.github/workflows/wf-client-page.yml', 'Render the client page'), /"\$RUNNER_TEMP\/wf\/validator\/cli\.js" --repo "\$GITHUB_WORKSPACE" status --client --live/, 'rendered by the resolved revision');
  assert.match(entry.jobs.build.if, /github\.event_name != 'pull_request'/, 'a pull request never builds or deploys');
  assert.deepEqual(entry.jobs.deploy.needs, 'build');
  assert.equal(entry.jobs.dispatch.permissions.actions, 'write');
});
