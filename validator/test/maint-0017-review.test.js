import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The independent review of MAINT-0017 v2.5.0 (C1, I2–I6; M1 and M5 re-graded Important). I1 is in client-plan.test.js.
const root = fileURLToPath(new URL('../..', import.meta.url));
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('C1: the gate is described as reachable by any account that can push, and registers no default labels', () => {
  for (const f of ['templates/github/wf-ci.yml', 'server/ci-runner/README.md', 'procedures/operate.md', 'docs/proposals/MAINT-0017-own-machines-owner-assistant.md']) {
    assert.doesNotMatch(read(f), /product code and its packages never run|which the build\/gate split provides|product code never runs in the gate/i, f);
    assert.match(read(f), /any account that can push/i, f);
  }
  assert.match(read('server/ci-runner/runner-setup'), /--no-default-labels/);
});

test('I2: the runners are for private repositories only, and register refuses a public one before asking for a token', () => {
  const c = read('server/ci-runner/ci-runner');
  const check = c.indexOf('https://api.github.com/repos/'), prompt = c.indexOf('read -rsp');
  assert.ok(check > 0 && check < prompt, 'the public check comes before the token prompt');
  assert.match(c, /== 404 \]\]/, 'only a 404 (a repository unseen without a token) lets registration go on');
  for (const f of ['server/ci-runner/README.md', 'procedures/setup.md']) assert.match(read(f), /private repositories only/i, f);
});

test('I3: a job holding deployment secrets stays off the build runner, and the Docker hook says what it keeps', () => {
  for (const f of ['server/ci-runner/README.md', 'procedures/operate.md']) assert.match(read(f), /deployment secrets/i, f);
  assert.doesNotMatch(read('server/ci-runner/ci-build.yaml'), /as a fresh GitHub runner has it/);
});

test('I4: WF_READ_TOKEN is named exactly, with who can read it, its Dependabot copy and its expiry', () => {
  const setup = read('procedures/setup.md');
  assert.match(setup, /fine-grained token[^.]*Contents: Read-only/);
  assert.match(setup, /Dependabot secret/);
  assert.match(setup, /any account that can push can read it/);
  assert.match(read('procedures/operate.md'), /WF_READ_TOKEN[^.]*expir/);
  for (const f of ['templates/github/wf-ci.yml', 'templates/github/wf-status.yml', 'templates/github/wf-client-page.yml']) assert.doesNotMatch(read(f), /alone sees it|only the fetch step sees/, f);
});

test('I5: install-host stops unless ufw is active, and puts the LAN deny first', () => {
  const h = read('server/ci-runner/install-host.sh');
  const active = h.indexOf('Status: active'), firstRule = h.indexOf('sudo ufw allow');
  assert.ok(active > 0 && active < firstRule, 'the check comes before any rule');
  assert.match(h, /^sudo ufw route insert 1 deny in on lxdbr0 /m);
});

test('I6: the setup record has a line for the project\'s runners', () => {
  assert.match(read('templates/setup.md'), /^\| CI runners: .*`CI_RUNNER`.*`WF_CI_RUNNER`.* \| \|$/m);
});

test('I6: the status workflow\'s fetch step fetches the pinned revision into the cache, again with the cache present, and fails on a revision it cannot find', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-prefetch-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const git = (cwd, ...args) => { const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, HOME: tmp, GIT_CONFIG_NOSYSTEM: '1' } }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  // A stand-in for github.com/owner/workflow, reached through url.insteadOf.
  const wf = path.join(tmp, 'owner', 'workflow.git');
  fs.mkdirSync(wf, { recursive: true });
  git(wf, 'init', '-q'); fs.writeFileSync(path.join(wf, 'marker'), 'pinned\n');
  git(wf, 'add', '.'); git(wf, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'pin');
  const rev = git(wf, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(tmp, '.gitconfig'), `[url "file://${tmp}/"]\n\tinsteadOf = https://github.com/\n`);
  const project = path.join(tmp, 'project');
  fs.mkdirSync(path.join(project, 'docs/workflow'), { recursive: true });
  const pin = revision => fs.writeFileSync(path.join(project, 'docs/workflow/config.json'), JSON.stringify({ workflow: { repo: 'owner/workflow', revision } }));
  const yml = read('templates/github/wf-status.yml');
  const step = yml.slice(yml.indexOf('- name: Fetch the pinned workflow'));
  const script = step.match(/run: \|\n((?: {10}.*\n)+)/)[1].replace(/^ {10}/gm, '');
  const run = () => spawnSync('bash', ['-c', script], { cwd: project, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', WF_READ_TOKEN: '' } });
  pin(rev);
  for (const attempt of ['fresh', 'cache present']) {
    const r = run();
    assert.equal(r.status, 0, `${attempt}: ${r.stderr}`);
    assert.equal(git(path.join(project, '.cache/agent-workflow'), 'rev-parse', 'HEAD'), rev, attempt);
    assert.equal(fs.readFileSync(path.join(project, '.cache/agent-workflow/marker'), 'utf8'), 'pinned\n');
  }
  pin('0'.repeat(40));
  assert.notEqual(run().status, 0, 'a revision the repository lacks fails the step');
});

test('M1 (re-graded): no text still promises a rebuild within minutes of any push', () => {
  for (const f of ['templates/github/wf-client-page.yml', 'QUICKSTART.md', 'AGENTS.md']) assert.doesNotMatch(read(f), /within\s+(?:#\s*)?minutes/, f);
});

test('M5 (re-graded): the runner-down steps cancel the waiting run first and name re-registration', () => {
  for (const f of ['procedures/operate.md', 'server/ci-runner/README.md']) {
    assert.match(read(f), /cancel the waiting run/i, f);
    assert.match(read(f), /14 days/, f);
  }
});
