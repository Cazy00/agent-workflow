import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// MAINT-0017 A1: every job the scaffold installs runs on GitHub's runner unless the repository variable WF_CI_RUNNER
// names the project's gate runner (server/ci-runner). Deleting the variable is the way back, so no job names a
// runner any other way.
const SWITCH = "    runs-on: ${{ vars.WF_CI_RUNNER || 'ubuntu-latest' }}";
// v2.5.1 review C1: wf ci takes the gate only for a pull request into the trusted branch, since the validator comes from
// the base branch's pin and any other branch could pin its own.
const GATED = "    runs-on: ${{ github.event.pull_request.base.ref == '__TRUSTED_BRANCH__' && vars.WF_CI_RUNNER || 'ubuntu-latest' }}";
const EXPECTED = { 'wf-ci.yml': GATED, 'wf-status.yml': SWITCH, 'wf-client-page.yml': SWITCH };
for (const file of ['wf-ci.yml', 'wf-status.yml', 'wf-client-page.yml']) {
  test(`${file}: every job runs on the WF_CI_RUNNER switch`, () => {
    const yml = fs.readFileSync(new URL(`../../templates/github/${file}`, import.meta.url), 'utf8');
    const jobs = yml.slice(yml.indexOf('\njobs:\n')).split(/\n  (?=[\w-]+:\n)/).slice(1);
    assert.ok(jobs.length > 0, 'jobs found');
    for (const job of jobs) assert.equal(job.match(/^ {4}runs-on: .*$/gm)?.join('\n'), EXPECTED[file], job.split('\n')[0]);
  });
}

test('wf ci runs on the gate only for a pull request into the trusted branch, and only with the variable set', () => {
  const yml = fs.readFileSync(new URL('../../templates/github/wf-ci.yml', import.meta.url), 'utf8');
  const expr = yml.match(/^ {4}runs-on: \$\{\{ (.*) \}\}$/m)[1];
  const js = expr.replaceAll('__TRUSTED_BRANCH__', 'main').replace(/==/g, '===')
    .replace('github.event.pull_request.base.ref', 'ctx.base').replace('vars.WF_CI_RUNNER', 'ctx.runner');
  const runsOn = ctx => new Function('ctx', `return (${js});`)(ctx);
  assert.equal(runsOn({ base: 'main', runner: 'shop-gate' }), 'shop-gate');
  assert.equal(runsOn({ base: 'claude/T-0001-pin', runner: 'shop-gate' }), 'ubuntu-latest', 'a pull request into another branch never reaches the gate');
  assert.equal(runsOn({ base: 'main', runner: '' }), 'ubuntu-latest', 'unset, GitHub\'s runner');
});

test('wf-adopt and wf-upgrade fill the trusted branch into wf-ci.yml', () => {
  assert.match(fs.readFileSync(new URL('../../bin/wf-adopt', import.meta.url), 'utf8'), /write\('\.github\/workflows\/wf-ci\.yml', pinned\.ci\.replaceAll\('__TRUSTED_BRANCH__', trusted\)\)/);
  assert.match(fs.readFileSync(new URL('../../adapters/upgrade.mjs', import.meta.url), 'utf8'), /\{ path: '\.github\/workflows\/wf-ci\.yml', template: 'templates\/github\/wf-ci\.yml', branch: true \}/);
});
