import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitSource } from '../lib/index.js';
import { acceptanceEvidenceErrors } from '../lib/acceptance-evidence.js';
import { deepChanges } from '../lib/paths.js';

// MAINT-0018: what M-0004 of a client project (12–14 October 2026) showed the workflow still cost: a Done pull request of
// its own after every task, an acceptance that a workflow upgrade would have voided, test files reviewed as deep, and no
// record of which workflow version any of the work ran under.
import { AREAS, check, cli, evidence, fixture, project, taskPath } from './helpers/maint-0018.js';

// Item 1. A planned task waits as Draft on the trusted branch and is claimed on its own branch (procedures/execute.md), so
// the trusted branch never held it Ready or Active and its Done record needed a pull request of its own: six in M-0004.
test('MAINT-0018: a Draft task claimed in its own pull request carries its Done record as that pull request\'s last commit', t => {
  const p = project(t, { baselineEdit: q => q.edit(taskPath, x => x.replace('status: Ready', 'status: Draft')) });
  p.edit(taskPath, x => x.replace(`governing_baseline_revision: ${p.initial}`, `governing_baseline_revision: ${p.baseline}`).replace('status: Draft', 'status: Active'));
  p.commit('T-0001: start');
  p.write('src/a.js', 'export const result = 1;\n'); const code = p.commit('T-0001: the work');
  p.edit(taskPath, x => x.replace('status: Active', 'status: Done').replace(/^implemented:.*$/m, `implemented: ${code}`)); const done = p.commit('T-0001: Done');
  const r = p.run(['ci', '--baseline', p.baseline, '--candidate', done, '--task', 'T-0001'], { evidence: evidence(done, code) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.out.merge, 'agent', r.stdout);
});

test('MAINT-0018: a Draft task marked Done without its claim in the pull request still fails, and says what is missing', t => {
  const p = project(t, { baselineEdit: q => q.edit(taskPath, x => x.replace('status: Ready', 'status: Draft')) });
  p.edit(taskPath, x => x.replace(`governing_baseline_revision: ${p.initial}`, `governing_baseline_revision: ${p.baseline}`).replace('status: Draft', 'status: Done'));
  p.write('src/a.js', 'export const result = 1;\n'); const head = p.commit('T-0001: the work, Done');
  const r = p.run(['ci', '--baseline', p.baseline, '--candidate', head, '--task', 'T-0001'], { evidence: evidence(head) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.out.findings.join(' | '), /task status is Done \(T-0001\); production changes need Ready or Active, or Done in the pull request that claims the task/);
});

test('MAINT-0018: a Ready record in the trusted branch\'s history is not the pull request\'s claim (review S3)', t => {
  // The task was Ready on the trusted branch, then set back to Draft there; the pull request marks it Done without claiming it.
  const p = project(t);
  p.edit(taskPath, x => x.replace('status: Ready', 'status: Draft')); const draft = p.commit('T-0001 back to Draft');
  p.edit(taskPath, x => x.replace(`governing_baseline_revision: ${p.initial}`, `governing_baseline_revision: ${draft}`).replace('status: Draft', 'status: Done'));
  p.write('src/a.js', 'export const result = 1;\n'); const head = p.commit('T-0001: the work, Done');
  const r = p.run(['ci', '--baseline', draft, '--candidate', head, '--task', 'T-0001'], { evidence: evidence(head) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.out.findings.join(' | '), /task status is Done \(T-0001\); production changes need Ready or Active, or Done in the pull request that claims the task/);
});

// Item 2. The acceptance of M-0004 had to merge before the owner's workflow upgrade (#79): merged first, the upgrade's
// workflow files would have followed the accepted revision and voided its review and walk.
function acceptanceRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-maint-0018-acc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  const commit = m => { git('add', '-A'); git('commit', '-qm', m); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  write('src/a.js', 'a\n'); write('.github/workflows/wf-ci.yml', 'v1\n'); write('docs/workflow/config.json', '{"workflow":{"version":"v2.5.0"}}\n'); write('docs/workflow/milestones/M-0001.md', 'status: Active\n');
  commit('main');
  git('checkout', '-q', '-b', 'accept');
  write('src/a.js', 'the milestone\'s code\n'); write('docs/workflow/milestones/M-0001.md', 'status: Verified\n'); const accepted = commit('the code being accepted');
  write('docs/workflow/milestones/M-0001.md', 'status: Accepted\n'); commit('Accept M-0001');
  return { dir, git, write, commit, accepted, at: rev => gitSource(dir, rev) };
}
const accConfig = { paths: { enforcement: ['.github/**', 'docs/workflow/config.json'], production: ['src/**'], governing: ['docs/workflow/milestones/**'], planning: ['docs/**'] } };
function accEvidence(rev) {
  return {
    schema: 'agent-workflow/acceptance-evidence@1', milestone: 'M-0001', candidate: rev,
    review: { reviewer: 'codex exec, fresh context', model: 'gpt-6.1-sol', revision: rev, report: 'https://github.com/o/r/pull/9#issuecomment-1' },
    walkthrough: { revision: rev, trial_environment: { address: 'https://staging.example.com', build: '1.4.0' }, address: 'https://staging.example.com', build: '1.4.0', environment: 'Chromium 140', walk_data: 'separate', first_load_seconds: 1, unguided: [{ scenario: 'AC-001-1', outcome: 'x', result: 'reached' }], walker: 'trial-walker subagent', languages: ['en'], viewports: ['1366x900'], steps: [{ step: '1', scenario: 'AC-001-1', expected: 'x', observed: 'x', result: 'passed', screenshot: 'https://github.com/o/r/pull/9#step-1' }] },
    deferred: [], tests_changed: [],
  };
}
const accErrors = (r, head, base, config = accConfig) => acceptanceEvidenceErrors({ evidence: accEvidence(r.accepted), milestone: 'M-0001', config, candidate: r.at(head), baseline: r.at(base), records: { tasks: new Map() } });

test('MAINT-0018: a workflow upgrade merged in from the trusted branch after the accepted revision keeps its review and walk', t => {
  const r = acceptanceRepo(t);
  r.git('checkout', '-q', 'main');
  r.write('.github/workflows/wf-ci.yml', 'v2\n'); r.write('docs/workflow/config.json', '{"workflow":{"version":"v2.5.1"}}\n'); const upgrade = r.commit('the owner\'s workflow upgrade');
  r.git('checkout', '-q', 'accept'); r.git('merge', '-q', '--no-edit', 'main'); const head = r.git('rev-parse', 'HEAD');
  assert.deepEqual(accErrors(r, head, upgrade), []);
});

test('MAINT-0018: the project\'s own code merged in after the accepted revision, or a workflow file the pull request changes itself, still needs a new review and walk', t => {
  const code = acceptanceRepo(t);
  code.git('checkout', '-q', 'main'); code.write('src/b.js', 'another task\'s code\n'); const other = code.commit('another change');
  code.git('checkout', '-q', 'accept'); code.git('merge', '-q', '--no-edit', 'main');
  assert.match(accErrors(code, code.git('rev-parse', 'HEAD'), other).join(' | '), /the accepted candidate [0-9a-f]{12} is followed by changes to src\/b\.js/);

  // Other workflow-protected paths (review S1): a project's own deploy workflow or bin/ is not what an upgrade writes.
  const deploy = acceptanceRepo(t);
  deploy.git('checkout', '-q', 'main'); deploy.write('.github/workflows/deploy.yml', 'deploy\n'); deploy.write('bin/www', 'server\n'); const ops = deploy.commit('the owner\'s deploy change');
  deploy.git('checkout', '-q', 'accept'); deploy.git('merge', '-q', '--no-edit', 'main');
  assert.match(accErrors(deploy, deploy.git('rev-parse', 'HEAD'), ops, { ...accConfig, paths: { ...accConfig.paths, enforcement: ['.github/**', 'docs/workflow/config.json', 'bin/**'] } }).join(' | '), /is followed by changes to \.github\/workflows\/deploy\.yml, bin\/www/);

  const own = acceptanceRepo(t);
  own.write('.github/workflows/wf-ci.yml', 'changed by this pull request\n'); const head = own.commit('a workflow edit of its own');
  assert.match(accErrors(own, head, own.git('rev-parse', 'main')).join(' | '), /is followed by changes to \.github\/workflows\/wf-ci\.yml/);
});

test('MAINT-0018: the files an upgrade may bring in under an acceptance are the ones bin/wf-upgrade writes', async () => {
  const { UPGRADE_FILES } = await import('../lib/acceptance-evidence.js');
  const { INSTALLED } = await import('../../adapters/upgrade.mjs');
  assert.deepEqual([...UPGRADE_FILES].sort(), ['docs/workflow/config.json', ...INSTALLED.map(i => i.path)].sort());
});

// Item 3. A client project names `**/*{invoice,numbering,issuer}*` deep, which also matched
// apps/server/test/acceptance/numbering.ts: a test-only task took three deep second-model reviews.
test('MAINT-0018: a deep path glob reaches test files only when it names a test location itself', () => {
  const globs = ['**/*{invoice,numbering,issuer}*', 'apps/server/migrations/**'];
  assert.deepEqual(deepChanges(globs, ['apps/server/src/numbering.ts', 'apps/server/test/acceptance/numbering.ts', 'apps/web/src/invoice.test.tsx', 'apps/web/__tests__/issuer.ts', 'apps/server/migrations/0017.sql']), ['apps/server/src/numbering.ts', 'apps/server/migrations/0017.sql']);
  assert.deepEqual(deepChanges(['apps/server/test/acceptance/**', '**/*.spec.ts'], ['apps/server/test/acceptance/numbering.ts', 'apps/web/src/x.spec.ts', 'apps/web/src/x.ts']), ['apps/server/test/acceptance/numbering.ts', 'apps/web/src/x.spec.ts']);
  assert.deepEqual(deepChanges(undefined, ['src/a.js']), []);
  // Review S5: only code files count as tests, in the usual layouts of several languages.
  assert.deepEqual(deepChanges(['**/*payment*'], ['api/openapi/payment.spec.yaml', 'api/spec/payment.json']), ['api/openapi/payment.spec.yaml', 'api/spec/payment.json']);
  assert.deepEqual(deepChanges(['**/*invoice*', '**/*Invoice*'], ['pkg/invoice_test.go', 'spec/models/invoice_spec.rb', 'src/test/java/InvoiceTest.java', 'tests/test_invoice.py', 'pkg/invoice.go']), ['pkg/invoice.go']);
  assert.deepEqual(deepChanges(['**/*Test*'], ['src/test/java/InvoiceTest.java']), ['src/test/java/InvoiceTest.java']);
  // The fix review: a glob anchored on a folder reaches everything under it, and a production file that only looks like a
  // test stays deep under a name glob too.
  assert.deepEqual(deepChanges(['src/lab/**', 'src/payments/**'], ['src/lab/tests/order.ts', 'src/payments/test_mode.py']), ['src/lab/tests/order.ts', 'src/payments/test_mode.py']);
  const lookalikes = ['src/billing/test_payment_mode.py', 'lib/billing/test_payment_cards.rb', 'src/billing/payment-ab-test.ts', 'src/payment/payment-spec.ts', 'src/main/java/com/acme/payment/spec/PaymentSpecification.java', 'src/main/kotlin/acme/PaymentSpec.kt'];
  assert.deepEqual(deepChanges(['**/*{payment,Payment}*'], lookalikes), lookalikes);
});

// Item 4 and item 13. The launcher is a template now (templates/scripts/wf): an explicit --repo, such as a clean review
// clone, is passed on instead of being doubled (F-0002 of a client project), and it tells `wf next` the newest release.
const root = fileURLToPath(new URL('../..', import.meta.url));
const head = () => { const r = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
const hasLauncher = () => spawnSync('git', ['-C', root, 'cat-file', '-e', 'HEAD:templates/scripts/wf']).status === 0;
function adopted(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-maint-0018-adopt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['-C', dir, 'init', '-q']).status, 0);
  const a = spawnSync(process.execPath, [path.join(root, 'bin/wf-adopt'), '--project', dir, '--workflow-repo', root, '--rev', 'HEAD', '--repository', 'fixture/project', '--coordinator', 'owner'], { encoding: 'utf8' });
  assert.equal(a.status, 0, a.stdout + a.stderr);
  return dir;
}
test('MAINT-0018: the installed launcher passes an explicit --repo on, and tells wf next of a newer release', t => {
  if (!head() || !hasLauncher()) return t.skip('needs a Git checkout whose HEAD holds templates/scripts/wf');
  const dir = adopted(t), other = adopted(t);
  assert.equal(fs.readFileSync(path.join(dir, 'scripts/wf'), 'utf8'), fs.readFileSync(path.join(root, 'templates/scripts/wf'), 'utf8'));
  const wf = (...args) => spawnSync('bash', [path.join(dir, 'scripts/wf'), ...args], { cwd: dir, encoding: 'utf8' });
  const r = wf('records', '--repo', other);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
  // The pin names a release; the installation knows a newer one.
  const configPath = path.join(dir, 'docs/workflow/config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')); config.workflow.version = 'v2.6.0'; fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  assert.equal(spawnSync('git', ['-C', path.join(dir, '.cache/agent-workflow'), 'tag', 'v99.0.0']).status, 0);
  const next = wf('next', '--json');
  assert.equal(next.status, 0, next.stdout + next.stderr);
  assert.equal(JSON.parse(next.stdout).workflow.newer, 'v99.0.0');
  assert.match(wf('next').stdout, /^Workflow: Cazy00\/agent-workflow v2\.6\.0 \([0-9a-f]{40}\)[^\n]*\n {2}A newer release, v99\.0\.0, exists\. Moving to it is the owner's decision/m);
  // Review N2: a pre-release tag is not a release.
  assert.equal(spawnSync('git', ['-C', path.join(dir, '.cache/agent-workflow'), 'tag', 'v99.0.1-rc1']).status, 0);
  assert.equal(JSON.parse(wf('next', '--json').stdout).workflow.newer, 'v99.0.0');
  // Review S2: a read-only installation still runs.
  fs.rmSync(path.join(dir, '.cache/agent-workflow/.git/wf-release-check'), { force: true });
  fs.chmodSync(path.join(dir, '.cache/agent-workflow/.git'), 0o555);
  let readOnly;
  try { readOnly = wf('records'); } finally { fs.chmodSync(path.join(dir, '.cache/agent-workflow/.git'), 0o755); }
  assert.equal(readOnly.status, 0, readOnly.stdout + readOnly.stderr);
});

test('MAINT-0018: wf-upgrade refreshes the launcher an older release wrote, and moves the milestones in progress with the pin', t => {
  if (!head() || !hasLauncher()) return t.skip('needs a Git checkout whose HEAD holds templates/scripts/wf');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-maint-0018-up-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const git = (dir, ...args) => { const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const wfRepo = path.join(temp, 'workflow');
  git(temp, 'clone', '-q', '--no-hardlinks', '--no-tags', root, wfRepo);
  const current = git(wfRepo, 'rev-parse', 'HEAD');
  git(wfRepo, 'rm', '-q', 'templates/scripts/wf'); // releases before v2.6.0 wrote the launcher from bin/wf-adopt's own text
  fs.writeFileSync(path.join(wfRepo, 'package.json'), fs.readFileSync(path.join(wfRepo, 'package.json'), 'utf8').replace(/"version": "[^"]+"/, '"version": "2.5.1"'));
  git(wfRepo, 'commit', '-qam', 'an older release'); git(wfRepo, 'tag', 'v2.5.1');
  git(wfRepo, 'checkout', '-q', current, '--', '.'); git(wfRepo, 'commit', '-qm', 'this release'); git(wfRepo, 'tag', 'v2.6.0');
  const project = path.join(temp, 'project'); fs.mkdirSync(project); git(project, 'init', '-q');
  const a = spawnSync(process.execPath, [path.join(root, 'bin/wf-adopt'), '--project', project, '--workflow-repo', wfRepo, '--rev', 'v2.5.1', '--repository', 'acme/shop', '--coordinator', 'owner'], { encoding: 'utf8' });
  assert.equal(a.status, 0, a.stdout + a.stderr);
  const legacy = fs.readFileSync(path.join(project, 'scripts/wf'), 'utf8');
  assert.match(legacy, /exec node "\$CACHE\/validator\/cli\.js" --repo "\$ROOT" "\$@"\n$/);
  const milestone = (id, status) => fs.readFileSync(path.join(fixture, 'docs/workflow/milestones/M-0001.md'), 'utf8').replaceAll('M-0001', id).replace('status: Authorised', `status: ${status}`);
  fs.writeFileSync(path.join(project, 'docs/workflow/milestones/M-0001.md'), milestone('M-0001', 'Active'));
  fs.writeFileSync(path.join(project, 'docs/workflow/milestones/M-0002.md'), milestone('M-0002', 'Draft'));
  git(project, 'add', '-A'); git(project, 'commit', '-qm', 'adopted, a milestone in progress');
  const up = spawnSync(process.execPath, [path.join(root, 'bin/wf-upgrade'), '--project', project, '--workflow-repo', wfRepo, '--rev', 'v2.6.0', '--apply'], { encoding: 'utf8' });
  assert.match(up.stdout, /update scripts\/wf: still the pinned release's copy/);
  assert.match(up.stdout, /update docs\/workflow\/milestones\/M-0001\.md: M-0001 is Active: it moves to v2\.6\.0 with the pin, which is the owner's decision; merging this change makes it/);
  assert.doesNotMatch(up.stdout, /M-0002\.md/);
  assert.equal(fs.readFileSync(path.join(project, 'scripts/wf'), 'utf8'), fs.readFileSync(path.join(root, 'templates/scripts/wf'), 'utf8'));
  assert.ok(fs.statSync(path.join(project, 'scripts/wf')).mode & 0o111, 'still executable');
  assert.match(fs.readFileSync(path.join(project, 'docs/workflow/milestones/M-0001.md'), 'utf8'), /^status: Active\nworkflow_version: v2\.6\.0$/m);
  assert.doesNotMatch(fs.readFileSync(path.join(project, 'docs/workflow/milestones/M-0002.md'), 'utf8'), /workflow_version/);
});

// Item 5 and item 13. A session names the workflow version it ran under; a missing outcome field says how to fill it in;
// a session that ends on a pull request without a task needs none.
test('MAINT-0018: wf session needs the workflow version the session ran under, and no task unless it is verified-complete', t => {
  const p = project(t);
  const head = p.git('rev-parse', 'HEAD');
  const session = (record, extra = []) => { const file = path.join(p.temp, 'session.json'); fs.writeFileSync(file, JSON.stringify(record)); return p.run(['session', '--baseline', p.baseline, '--candidate', head, '--record', file, ...extra]); };
  const progress = { outcome: 'progress', summary: 'Drafted M-0005', evidence: ['https://github.com/fixture/project/pull/9'], next_action: 'The owner answers M-0005\'s questions', friction: 'none' };
  const missing = session(progress);
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.ok(missing.out.errors.includes(`session requires workflow, the version it ran under: {"version":"v2.6.0","revision":"${'a'.repeat(40)}"} (the pin in docs/workflow/config.json)`), missing.stdout);
  const stamped = session({ ...progress, workflow: { version: 'v2.6.0', revision: 'a'.repeat(40) } });
  assert.equal(stamped.status, 0, stamped.stdout + stamped.stderr);
  assert.match(session({ ...progress, workflow: { version: 'v2.5.1', revision: 'b'.repeat(40) } }).out.errors.join(' | '), /session workflow v2\.5\.1 \(bbbbbbbbbbbb\) is not the pin at the baseline or the candidate/);
  const limit = session({ outcome: 'stopped-by-limit', workflow: { version: 'v2.6.0', revision: 'a'.repeat(40) }, next_action: 'Resume', friction: 'none', usage: { time_seconds: 1 }, checkpoint: head, evidence: ['https://github.com/fixture/project/pull/9'] });
  assert.ok(limit.out.errors.includes('session requires limit: the limit that stopped the session, for example "thirty-minute maintenance limit" or "context limit"'), limit.stdout);
  assert.match(session({ outcome: 'verified-complete', workflow: { version: 'v2.6.0', revision: 'a'.repeat(40) }, next_action: 'x', friction: 'none' }).out.errors.join(' | '), /verified-complete needs the task's lifecycle evidence: run wf session with --task/);
  const template = JSON.parse(fs.readFileSync(path.join(root, 'templates/session.json'), 'utf8'));
  assert.deepEqual([Object.hasOwn(template, 'limit'), Object.keys(template.workflow).sort()], [true, ['revision', 'version']]);
});

test('MAINT-0018: wf next names the workflow version, and a newer release only when it is newer', t => {
  const p = project(t);
  const next = latest => p.run(['next'], { env: { WF_LATEST_RELEASE: latest } }).out.workflow;
  assert.deepEqual(next('v2.7.0'), { repo: 'fixture/agent-workflow', version: 'v2.6.0', revision: 'a'.repeat(40), newer: 'v2.7.0' });
  assert.equal(next('v2.6.0').newer, undefined);
  assert.equal(next('v2.5.9').newer, undefined);
  assert.equal(next('').newer, undefined);
});

test('MAINT-0018: wf ci names the workflow version that judged the change, and the workflow\'s summary repeats it', t => {
  const p = project(t);
  p.write('docs/workflow/tasks/T-0001.md', fs.readFileSync(path.join(p.repo, taskPath), 'utf8').replace('objective: Do the work of T-0001', 'objective: Do the work of T-0001, carefully'));
  const head = p.commit('a records change');
  const r = p.run(['ci', '--baseline', p.baseline, '--candidate', head]);
  assert.deepEqual(r.out.workflow, { version: 'v2.6.0', revision: 'a'.repeat(40) }, r.stdout + r.stderr);
  const template = fs.readFileSync(path.join(root, 'templates/github/wf-ci.yml'), 'utf8');
  const script = template.slice(template.indexOf('# Who merges')).match(/node -e '\n([\s\S]*?)\n\s*' "\$RUNNER_TEMP\/ci\.json"/)[1];
  const file = path.join(p.temp, 'ci.json'), summary = path.join(p.temp, 'summary.md');
  fs.writeFileSync(file, JSON.stringify(r.out)); fs.writeFileSync(summary, '');
  assert.equal(spawnSync(process.execPath, ['-e', script, file], { env: { ...process.env, GITHUB_STEP_SUMMARY: summary } }).status, 0);
  assert.match(fs.readFileSync(summary, 'utf8'), /^Judged by agent-workflow v2\.6\.0 \(aaaaaaaaaaaa\), the base branch’s pin\.$/m);
});

// Item 13. A milestone records the release it runs under; the pin and the milestone move together or not at all.
const milestonePath = 'docs/workflow/milestones/M-0001.md';
test('MAINT-0018: a milestone in progress that names another workflow release than the pin is refused', t => {
  const p = project(t);
  const records = () => p.run(['records']).out;
  p.edit(milestonePath, x => x.replace('status: Authorised', 'status: Authorised\nworkflow_version: v2.5.1'));
  assert.ok(records().errors.some(e => e.startsWith(`${milestonePath}: runs under workflow v2.5.1, but docs/workflow/config.json pins v2.6.0; a milestone in progress stays on its version unless the owner decides otherwise`)), JSON.stringify(records()));
  p.edit(milestonePath, x => x.replace('workflow_version: v2.5.1', 'workflow_version: v2.6.0'));
  assert.equal(records().ok, true, JSON.stringify(records()));
  p.edit(milestonePath, x => x.replace('status: Authorised', 'status: Accepted').replace('workflow_version: v2.6.0', 'workflow_version: v2.4.2'));
  assert.equal(records().ok, true, 'an accepted milestone keeps the version it ran under');
});

test('MAINT-0018: a milestone authorised in a pull request names its workflow release, and moving that line alone stales no task', async t => {
  const p = project(t, { baselineEdit: q => q.edit(milestonePath, x => x.replace('status: Authorised', 'status: Draft')) });
  p.edit(milestonePath, x => x.replace('status: Draft', 'status: Authorised'));
  const bare = p.commit('Authorise M-0001');
  assert.match(p.run(['ci', '--baseline', p.baseline, '--candidate', bare]).out.findings.join(' | '), /M-0001 is authorised here without workflow_version: set workflow_version: v2\.6\.0 in its record/);
  p.edit(milestonePath, x => x.replace('status: Authorised', 'status: Authorised\nworkflow_version: v2.6.0'));
  const stamped = p.commit('Authorise M-0001, with its workflow release');
  assert.doesNotMatch(p.run(['ci', '--baseline', p.baseline, '--candidate', stamped]).out.findings.join(' | '), /without workflow_version/);

  const { governingChanged } = await import('../lib/freshness.js');
  const task = { id: 'T-0001', milestone: 'M-0001', governing: ['PROFILE'] };
  p.edit(milestonePath, x => x.replace('workflow_version: v2.6.0', 'workflow_version: v2.7.0')); const moved = p.commit('the pin moves, and the milestone with it');
  assert.equal(governingChanged({ baseline: gitSource(p.repo, moved), revision: stamped, recordsDir: 'docs/workflow', task, previous: task }), false);
  p.edit(milestonePath, x => x.replace('limits: one bounded task session', 'limits: two sessions')); const limits = p.commit('the milestone\'s limits change');
  assert.equal(governingChanged({ baseline: gitSource(p.repo, limits), revision: moved, recordsDir: 'docs/workflow', task, previous: task }), true);
});
