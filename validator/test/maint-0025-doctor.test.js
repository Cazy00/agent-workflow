import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lintWorkflow, parseYaml } from '../lib/ci-lint.js';
import { parseMarker } from '../lib/ci-reuse.js';
import { fakeExecutable } from './helpers.js';
import { project } from './helpers/maint-0018.js';

// v2.14.0 (MAINT-0025): `wf doctor` warns when a project's own workflow makes CI wait for no reason, and templates/github/project-ci.yml
// is the shape that raises none of them. The warnings never fail `wf doctor`.
const template = fs.readFileSync(new URL('../../templates/github/project-ci.yml', import.meta.url), 'utf8').replaceAll('__TRUSTED_BRANCH__', 'main');
const lint = (text, opts = {}) => lintWorkflow({ name: 'ci.yml', text, ...opts }).map(w => w.name.replace(/ in ci\.yml$/, ''));

test('the project CI template raises no warning, even for a private repository', () => {
  assert.deepEqual(lintWorkflow({ name: 'ci.yml', text: template, privateRepo: true }), []);
  assert.deepEqual(lintWorkflow({ name: 'ci.yml', text: template, privateRepo: null }), []);
});

test('the reader parses the shapes GitHub workflows use', () => {
  const w = parseYaml(`# c\nname: "x: y"\non: [push, pull_request]\njobs:\n  a:\n    runs-on: [self-hosted, linux]\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n      - run: |\n          echo one # not a comment\n\n          echo two\n      - name: folded\n        run: >-\n          a\n          b\n      - run: echo "# kept" # dropped\n`);
  assert.equal(w.name, 'x: y');
  assert.deepEqual(w.on, ['push', 'pull_request']);
  assert.deepEqual(w.jobs.a['runs-on'], ['self-hosted', 'linux']);
  assert.equal(w.jobs.a.steps[0].with['fetch-depth'], '0');
  assert.equal(w.jobs.a.steps[1].run, 'echo one # not a comment\n\necho two\n');
  assert.equal(w.jobs.a.steps[2].run, 'a b');
  assert.equal(w.jobs.a.steps[3].run, 'echo "# kept"');
  assert.throws(() => parseYaml('a:\n    b: 1\n  c: 2\n'));
});

const wf = (jobs, head = 'on:\n  pull_request:\nconcurrency:\n  group: g\n  cancel-in-progress: true') => `name: ci\n${head}\njobs:\n${jobs}`;

test('a database without tmpfs or fsync off', () => {
  const service = wf('  t:\n    runs-on: x\n    services:\n      db:\n        image: postgres:16\n    steps:\n      - run: npm test');
  assert.deepEqual(lint(service), ['a database on disk']);
  assert.match(lintWorkflow({ name: 'ci.yml', text: service })[0].detail, /takes no command/);
  const run = body => wf(`  t:\n    runs-on: x\n    steps:\n      - run: |\n          ${body}`);
  assert.deepEqual(lint(run('docker run -d -e POSTGRES_PASSWORD=x postgres:18')), ['a database on disk']);
  assert.match(lintWorkflow({ name: 'ci.yml', text: run('docker run -d --tmpfs /var/lib/postgresql postgres:18') })[0].detail, /fsync=off/);
  assert.match(lintWorkflow({ name: 'ci.yml', text: run('docker run -d postgres:18 -c fsync=off') })[0].detail, /--tmpfs/);
  assert.deepEqual(lint(run('docker run -d --tmpfs /var/lib/postgresql postgres:18 -c fsync=off -c synchronous_commit=off -c full_page_writes=off')), []);
  assert.deepEqual(lint(run('docker run -d redis:7')), [], 'not a database this checks');
  assert.deepEqual(lint(wf('  t:\n    runs-on: x\n    services:\n      db:\n        image: mysql:8\n        options: --tmpfs /var/lib/mysql\n    steps:\n      - run: t')), []);
  assert.deepEqual(lint(wf('  t:\n    runs-on: x\n    services:\n      db:\n        image: mariadb:11\n    steps:\n      - run: t')), ['a database on disk']);
});

test('a serial chain without data dependency; data, artifacts, results and deploys are not one', () => {
  const chain = (second, extra = '') => wf(`  a:\n    runs-on: x\n    steps:\n      - run: build${extra}\n  b:\n    needs: a\n    runs-on: x\n${second}`);
  const steps = '    steps:\n      - run: test\n';
  assert.deepEqual(lint(chain(steps)), ['a serial chain']);
  assert.match(lintWorkflow({ name: 'ci.yml', text: chain(steps) })[0].detail, /job b needs a but uses nothing from it/);
  assert.deepEqual(lint(chain('    steps:\n      - run: echo ${{ needs.a.outputs.v }}\n')), [], 'an output');
  assert.deepEqual(lint(chain('    if: needs.a.result == \'success\'\n' + steps)), [], 'its result');
  assert.deepEqual(lint(chain('    steps:\n      - run: echo ${{ needs[\'a\'].result }}\n')), [], 'bracket form');
  assert.deepEqual(lint(chain('    steps:\n      - uses: actions/download-artifact@v4\n', '\n      - uses: actions/upload-artifact@v4')), [], 'an artifact');
  assert.deepEqual(lint(chain('    steps:\n      - uses: actions/download-artifact@v4\n')), ['a serial chain'], 'a download of nothing the first job uploads');
  assert.deepEqual(lint(wf(`  a:\n    runs-on: x\n    steps:\n      - run: t\n  deploy:\n    needs: a\n    runs-on: x\n${steps}`)), [], 'a deploy waits on purpose');
  assert.deepEqual(lint(wf(`  a:\n    runs-on: x\n    steps:\n      - run: t\n  b:\n    needs: a\n    environment: production\n    runs-on: x\n${steps}`)), [], 'a protected environment');
  assert.deepEqual(lint(chain('    steps:\n      - run: echo ${{ toJSON(needs) }}\n')), [], 'the whole needs context');
  assert.deepEqual(lint(wf(`  a:\n    runs-on: x\n    steps:\n      - run: t\n  b:\n    runs-on: x\n    steps:\n      - run: t\n  gate:\n    needs: [a, b]\n    runs-on: x\n    steps:\n      - run: echo \${{ join(needs.*.result, ' ') }}`)), [], 'a gate over several results');
  assert.deepEqual(lint(wf(`  a:\n    runs-on: x\n    steps:\n      - run: t\n  b:\n    needs: a-missing\n    runs-on: x\n${steps}`)), [], 'a name that is not a job is not judged');
});

test('no concurrency, or concurrency that cancels nothing', () => {
  const job = '  a:\n    runs-on: x\n    steps:\n      - run: t';
  assert.deepEqual(lint(wf(job, 'on:\n  pull_request:')), ['no concurrency']);
  assert.deepEqual(lint(wf(job, 'on: pull_request')), ['no concurrency']);
  assert.deepEqual(lint(wf(job, 'on:\n  workflow_dispatch:')), [], 'no pull request to supersede');
  assert.deepEqual(lint(wf(job, 'on:\n  pull_request:\nconcurrency: ci')), ['no cancel-in-progress']);
  assert.deepEqual(lint(wf(job, 'on:\n  pull_request:\nconcurrency:\n  group: g\n  cancel-in-progress: false')), ['no cancel-in-progress']);
  assert.deepEqual(lint(wf(job, 'on:\n  pull_request:\nconcurrency:\n  group: g\n  cancel-in-progress: ${{ github.event_name == \'pull_request\' }}')), []);
  assert.deepEqual(lint(wf('  a:\n    runs-on: x\n    concurrency:\n      group: g\n      cancel-in-progress: true\n    steps:\n      - run: t', 'on:\n  pull_request:')), [], 'a job\'s own concurrency counts');
});

test('a full rerun on push to the trusted branch, unless the pull request\'s result is reused', () => {
  const job = '  a:\n    runs-on: x\n    steps:\n      - run: t';
  const both = 'on:\n  pull_request:\n  push:\n    branches: [main]\nconcurrency:\n  group: g\n  cancel-in-progress: true';
  assert.deepEqual(lint(wf(job, both)), ['a full rerun on push']);
  assert.deepEqual(lint(wf(job, both.replace('[main]', '[main, release]'))), ['a full rerun on push']);
  assert.deepEqual(lint(wf(job, both.replace('    branches: [main]\n', '').replace('push:', 'push:'))), ['a full rerun on push'], 'every branch');
  assert.deepEqual(lint(wf(job, both.replace('[main]', '[staging]'))), [], 'another branch');
  assert.deepEqual(lint(wf(job, both.replace('  pull_request:\n', ''))), [], 'no pull request result to reuse');
  assert.deepEqual(lint(wf('  a:\n    runs-on: x\n    steps:\n      - run: scripts/wf reuse --candidate "$GITHUB_SHA" --marker none', both)), []);
  assert.deepEqual(lintWorkflow({ name: 'ci.yml', text: wf(job, both.replace('[main]', '[trunk]')), trustedBranch: 'trunk' }).map(w => w.name), ['a full rerun on push in ci.yml']);
});

test('ubuntu-latest on a private repository, and only there; a switch with a fallback, deploys and wf-* files are left alone', () => {
  const job = label => wf(`  a:\n    runs-on: ${label}\n    steps:\n      - run: t`);
  assert.deepEqual(lint(job('ubuntu-latest'), { privateRepo: true }), ['GitHub-hosted runner on a private repository']);
  assert.deepEqual(lint(job('ubuntu-24.04'), { privateRepo: true }), ['GitHub-hosted runner on a private repository']);
  assert.deepEqual(lint(job('[ubuntu-latest]'), { privateRepo: true }), ['GitHub-hosted runner on a private repository']);
  assert.deepEqual(lint(job('ubuntu-latest'), { privateRepo: false }), [], 'a public repository');
  assert.deepEqual(lint(job('ubuntu-latest'), { privateRepo: null }), [], 'privacy unknown');
  assert.deepEqual(lint(job('wf-build'), { privateRepo: true }), []);
  assert.deepEqual(lint(job("${{ vars.CI_BUILD == 'on' && 'wf-build' || 'ubuntu-latest' }}"), { privateRepo: true }), []);
  assert.deepEqual(lint(wf('  a:\n    runs-on: ubuntu-latest\n    environment: production\n    steps:\n      - run: t'), { privateRepo: true }), []);
  assert.deepEqual(lint(wf('  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: deploy\n        env:\n          K: ${{ secrets.K }}'), { privateRepo: true }), []);
});

test('a file the reader cannot parse is skipped, not guessed at', () => {
  assert.deepEqual(lintWorkflow({ name: 'x.yml', text: 'jobs:\n    a: 1\n  b: 2\n' }), []);
  assert.deepEqual(lintWorkflow({ name: 'x.yml', text: 'not a workflow' }), []);
});

test('the template\'s shape: parallel jobs on one scope, a RAM database, one run per pull request, the marker, a deploy that always runs', () => {
  const w = parseYaml(template);
  assert.deepEqual(['lint', 'unit', 'database'].map(j => w.jobs[j].needs), ['scope', 'scope', 'scope'], 'no job waits for another product job');
  assert.equal(w.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
  assert.match(w.concurrency.group, /github\.event\.pull_request\.number \|\| github\.sha/, 'a push to the trusted branch is never replaced');
  const db = w.jobs.database.steps.find(s => /docker run/.test(s.run ?? '')).run;
  for (const needed of ['--tmpfs /var/lib/postgresql', '-c fsync=off', '-c synchronous_commit=off', '-c full_page_writes=off']) assert.ok(db.includes(needed), needed);
  assert.equal(w.jobs.database.services, undefined, 'a service container takes no command');
  for (const j of ['scope', 'lint', 'unit', 'database', 'result']) assert.match(w.jobs[j]['runs-on'], /'wf-build'/, `${j}: the fixed label`);
  assert.deepEqual(new Set(Object.values(w.jobs).map(j => j['runs-on']).filter(r => !/wf-build/.test(r))), new Set(['ubuntu-latest']), 'only the deploy, which holds secrets, uses GitHub\'s runner');
  // The deploy is never skipped by records-only or reuse: it depends on the result job, not on the scope output.
  assert.doesNotMatch(JSON.stringify(w.jobs.deploy), /needs\.scope|outputs|reuse/);
  assert.match(w.jobs.deploy.if, /github\.event_name == 'push' && needs\.result\.result == 'success'/);
  // The marker the pull request run writes is the format `wf reuse` reads; the push decides with wf reuse on the PR head's status.
  const written = w.jobs.result.steps[0].run.match(/description="([^"]+)"/)[1];
  const filled = written.replace('$tree', 'a'.repeat(40)).replace('$GITHUB_SHA', 'b'.repeat(40));
  assert.deepEqual(parseMarker(filled), { tree: 'a'.repeat(40), merge: 'b'.repeat(40) });
  assert.match(w.jobs.scope.steps.at(-1).run, /wf reuse --candidate "\$GITHUB_SHA" --marker/);
  assert.match(w.jobs.scope.steps.at(-1).run, /context == \\"wf-tested-tree\\"/);
  assert.match(w.jobs.scope.steps.at(-1).run, /creator\.login == \\"github-actions\[bot\]\\"/, 'only the workflow\'s own token');
  assert.match(w.jobs.scope.steps.at(-1).run, /startswith\(\\"\$runs\\"\)/, 'a run of this repository\'s Actions');
  assert.match(w.jobs.result.steps[0].run, /target_url=/);
  assert.match(w.jobs.result.steps[0].run, /context=wf-tested-tree/);
  assert.match(w.jobs.result.permissions.statuses, /write/);
  assert.equal(w.permissions.statuses, 'read', 'only the result job writes statuses');
});

test('wf doctor puts the workflow findings in warnings, never in the exit code, and skips the installed wf-* files', t => {
  const p = project(t, { configEdit: c => ({ ...c, repository: 'fixture/project' }) });
  const bin = path.join(p.temp, 'bin'); fs.mkdirSync(bin);
  fakeExecutable(path.join(bin, 'gh'), `const a = process.argv.slice(2).join(' ');
if (a === '--version') console.log('gh version 2.40.0 (2023-12-01)');
else if (a.startsWith('api user')) console.log('agent');
else if (a.startsWith('api')) console.log(JSON.stringify({ full_name: 'fixture/project', private: process.env.FAKE_PRIVATE !== 'no', permissions: { push: true } }));
else process.exit(1);`);
  const env = { PATH: `${bin}:/usr/bin:/bin` };
  p.write('.github/workflows/ci.yml', 'name: ci\non:\n  pull_request:\n  push:\n    branches: [main]\njobs:\n  a:\n    runs-on: ubuntu-latest\n    services:\n      db:\n        image: postgres:16\n    steps:\n      - run: t\n  b:\n    needs: a\n    runs-on: ubuntu-latest\n    steps:\n      - run: t\n');
  p.write('.github/workflows/wf-ci.yml', 'name: wf\non:\n  pull_request:\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: t\n');
  const r = p.run(['doctor'], { env, cwd: p.repo });
  const warned = r.out.warnings.map(w => w.name);
  for (const what of ['a database on disk', 'a serial chain', 'no concurrency', 'a full rerun on push', 'GitHub-hosted runner on a private repository']) assert.ok(warned.some(n => n === `${what} in ci.yml`), `${what}: ${warned.join(' | ')}`);
  assert.ok(warned.every(n => n.endsWith(' in ci.yml')), 'wf-ci.yml is the workflow\'s own');
  assert.equal(r.out.warnings.every(w => w.needed_for === 'CI time'), true);
  assert.match(r.out.next, /warning\(s\) do not fail this check/);
  assert.equal(r.out.ok, true, 'warnings do not change ok');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const open = p.run(['doctor'], { env: { ...env, FAKE_PRIVATE: 'no' }, cwd: p.repo });
  assert.ok(!open.out.warnings.some(w => w.name.startsWith('GitHub-hosted runner')), 'a public repository pays no minutes');
  fs.rmSync(path.join(p.repo, '.github'), { recursive: true });
  assert.deepEqual(p.run(['doctor'], { env, cwd: p.repo }).out.warnings, []);
});
