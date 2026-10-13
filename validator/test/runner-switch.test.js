import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// MAINT-0017 A1: every job the scaffold installs runs on GitHub's runner unless the repository variable WF_GATE
// switches on the project's gate runner (server/ci-runner). Deleting the variable is the way back, so no job names a
// runner any other way.
// v2.5.1 (home-server session's finding): a write collaborator can set Actions variables, so the label lives in the file
// and the variable is only an on/off switch. No variable value can send a job to any runner but wf-gate.
const SWITCH = "    runs-on: ${{ vars.WF_GATE == 'on' && 'wf-gate' || 'ubuntu-latest' }}";
// v2.5.1 review C1: wf ci takes the gate only for a pull request into the trusted branch, since the validator comes from
// the base branch's pin and any other branch could pin its own.
const GATED = "    runs-on: ${{ github.event.pull_request.base.ref == '__TRUSTED_BRANCH__' && vars.WF_GATE == 'on' && 'wf-gate' || 'ubuntu-latest' }}";
const EXPECTED = { 'wf-ci.yml': GATED, 'wf-status.yml': SWITCH, 'wf-client-page.yml': SWITCH };
for (const file of ['wf-ci.yml', 'wf-status.yml', 'wf-client-page.yml']) {
  test(`${file}: every job runs on the WF_GATE switch`, () => {
    const yml = fs.readFileSync(new URL(`../../templates/github/${file}`, import.meta.url), 'utf8');
    const jobs = yml.slice(yml.indexOf('\njobs:\n')).split(/\n  (?=[\w-]+:\n)/).slice(1);
    assert.ok(jobs.length > 0, 'jobs found');
    for (const job of jobs) assert.equal(job.match(/^ {4}runs-on: .*$/gm)?.join('\n'), EXPECTED[file], job.split('\n')[0]);
  });
}

test('wf ci runs on the gate only for a pull request into the trusted branch, and only with the switch on', () => {
  const yml = fs.readFileSync(new URL('../../templates/github/wf-ci.yml', import.meta.url), 'utf8');
  const expr = yml.match(/^ {4}runs-on: \$\{\{ (.*) \}\}$/m)[1];
  // GitHub compares strings ignoring case (its expression docs), so the model does too.
  const js = expr.replaceAll('__TRUSTED_BRANCH__', 'main').replace(/==/g, '===')
    .replace('github.event.pull_request.base.ref', 'ctx.base.toLowerCase()').replace('vars.WF_GATE', 'ctx.gate.toLowerCase()');
  const runsOn = ctx => new Function('ctx', `return (${js});`)(ctx);
  assert.equal(runsOn({ base: 'main', gate: 'on' }), 'wf-gate');
  assert.equal(runsOn({ base: 'claude/T-0001-pin', gate: 'on' }), 'ubuntu-latest', 'a pull request into another branch never reaches the gate');
  assert.equal(runsOn({ base: 'main', gate: '' }), 'ubuntu-latest', 'off, GitHub\'s runner');
  for (const gate of ['wf-build', 'shop-ci', 'self-hosted', 'yes']) assert.equal(runsOn({ base: 'main', gate }), 'ubuntu-latest', `no variable value reaches another runner (${gate})`);
  assert.equal(runsOn({ base: 'MAIN', gate: 'on' }), 'wf-gate', 'runs-on alone lets a branch named MAIN through: the first step must refuse it');
});

test('wf-adopt and wf-upgrade fill the trusted branch into wf-ci.yml', () => {
  assert.match(fs.readFileSync(new URL('../../bin/wf-adopt', import.meta.url), 'utf8'), /write\('\.github\/workflows\/wf-ci\.yml', pinned\.ci\.replaceAll\('__TRUSTED_BRANCH__', trusted\)\)/);
  assert.match(fs.readFileSync(new URL('../../adapters/upgrade.mjs', import.meta.url), 'utf8'), /\{ path: '\.github\/workflows\/wf-ci\.yml', template: 'templates\/github\/wf-ci\.yml', branch: true \}/);
});

// v2.5.1 second review C1-bis: every job that can land on the gate checks the branch name exactly (a shell comparison,
// case-sensitive) in its first step, before anything is checked out or fetched. A token without the Workflows
// permission can't remove the step.
const firstStep = (yml, job) => {
  const body = yml.slice(yml.indexOf(`\n  ${job}:\n`) + 1).split(/\n  (?=[\w-]+:\n)/)[0];
  return body.split(/^ {6}- /m)[1];
};
const runStep = (step, env) => {
  const script = step.match(/^ {8}run: '(.*)'$/m)[1].replaceAll('__TRUSTED_BRANCH__', 'main');
  return spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } }).status;
};
test('on the gate, wf ci\'s first step refuses a pull request into any branch but exactly the trusted one', () => {
  const yml = fs.readFileSync(new URL('../../templates/github/wf-ci.yml', import.meta.url), 'utf8');
  const step = firstStep(yml, 'ci');
  assert.match(step, /^name: Refuse/);
  assert.match(step, /^ {8}if: github\.event\.pull_request\.base\.ref == '__TRUSTED_BRANCH__' && vars\.WF_GATE == 'on'$/m, 'it runs wherever runs-on sent the job to the gate');
  assert.equal(runStep(step, { GITHUB_BASE_REF: 'main' }), 0);
  for (const base of ['MAIN', 'Main', 'main2', '']) assert.notEqual(runStep(step, { GITHUB_BASE_REF: base }), 0, base);
});
for (const [file, job] of [['wf-status.yml', 'status'], ['wf-client-page.yml', 'build']]) {
  test(`${file}: the ${job} job's first step refuses any ref but exactly the trusted branch`, () => {
    const step = firstStep(fs.readFileSync(new URL(`../../templates/github/${file}`, import.meta.url), 'utf8'), job);
    assert.match(step, /^name: Refuse/);
    assert.equal(runStep(step, { GITHUB_REF: 'refs/heads/main' }), 0);
    for (const ref of ['refs/heads/MAIN', 'refs/heads/Main', 'refs/heads/main2']) assert.notEqual(runStep(step, { GITHUB_REF: ref }), 0, ref);
  });
}
