import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// MAINT-0017 A1: every job the scaffold installs runs on GitHub's runner unless the repository variable WF_CI_RUNNER
// names the project's gate runner (server/ci-runner). Deleting the variable is the way back, so no job names a
// runner any other way.
const SWITCH = "    runs-on: ${{ vars.WF_CI_RUNNER || 'ubuntu-latest' }}";
for (const file of ['wf-ci.yml', 'wf-status.yml', 'wf-client-page.yml']) {
  test(`${file}: every job runs on the WF_CI_RUNNER switch`, () => {
    const yml = fs.readFileSync(new URL(`../../templates/github/${file}`, import.meta.url), 'utf8');
    const jobs = yml.slice(yml.indexOf('\njobs:\n')).split(/\n  (?=[\w-]+:\n)/).slice(1);
    assert.ok(jobs.length > 0, 'jobs found');
    for (const job of jobs) assert.equal(job.match(/^ {4}runs-on: .*$/gm)?.join('\n'), SWITCH, job.split('\n')[0]);
  });
}
