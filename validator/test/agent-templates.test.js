import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseFrontMatter } from '../lib/index.js';

// MAINT-0016: the agents a scaffold installs for Claude Code. The trial walker walks the owner's trial in a browser
// before the owner does and changes nothing; the reviewer is told its level and to review what the change can break.
const read = rel => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test('the trial walker is a fresh-context agent that walks every step as a person would and changes no tracked file', () => {
  const text = read('templates/claude/agents/trial-walker.md');
  assert.equal(parseFrontMatter(text).data.name, 'trial-walker');
  assert.match(text, /never modify a tracked file/i);
  assert.match(text, /Do not call the app's API or change its database to make a step pass/);
  assert.match(text, /an unavailable walkthrough is a blocker, not a pass/);
});

test('the independent reviewer is told its level and to review what the change can break', () => {
  const text = read('templates/claude/agents/independent-reviewer.md');
  assert.match(text, /`light`[\s\S]*`standard`[\s\S]*`deep`/);
  assert.match(text, /review the change and what it can break/);
});

test('a new scaffold asks for acceptance evidence, and the task template lists accepted findings', () => {
  assert.equal(JSON.parse(read('config.default.json')).acceptance_evidence, true);
  assert.match(read('templates/task.md'), /^accepted_findings: \[\]$/m);
  assert.match(read('templates/delivery-evidence.json'), /"level": /);
});

// The independent review of MAINT-0016 (I2, I3, M1, M6): the procedures and the policy state the limits of the new
// owner-merge controls where they describe them, and claim no more than the checks do.
test('the auto-merge guard\'s limit, what deferral cross-checks and the unseen ruleset are stated where they are described', () => {
  const evidence = read('procedures/approval-evidence.md'), policy = read('POLICY.md'), schema = read('SCHEMA.md');
  for (const [name, text] of [['approval-evidence.md', evidence], ['POLICY.md', policy]]) assert.match(text, /auto-merge turned on after every required check has passed merges at once/, name);
  assert.match(read('templates/github/wf-ci.yml'), /that has it on\s*#?\s*while its checks still run/);
  assert.match(schema, /Only `accepted_findings` is cross-checked/);
  assert.match(schema, /The validator cannot see the ruleset/);
  assert.doesNotMatch(policy, /where every one is listed|where every change to them is listed/);
  assert.match(policy, /The agent that writes the code then cannot also rewrite the tests that judge it\. In owner-merge mode the owner may instead approve them at the milestone's acceptance/);
  assert.match(read('procedures/execute.md'), /Under `approval\.auto_merge`, never wait for checks to merge/);
});

// GitHub matches a required status check by its job's name, and a job skipped by its condition counts as passed. The client
// page's jobs were `build` and `deploy`, so on every pull request its skipped `deploy` answered for a project's own required
// `deploy` check (mateen-systems, 12 October 2026), which could let auto-merge land a change before the real one finished.
test('the client page workflow names every job, so none can answer for a project\'s required check of the same name', () => {
  const yml = read('templates/github/wf-client-page.yml');
  const jobs = yml.slice(yml.indexOf('\njobs:\n')).split(/\n  (?=[a-z][\w-]*:\n)/).slice(1);
  assert.deepEqual(jobs.map(j => j.match(/^([\w-]+):/)[1]), ['dispatch', 'build', 'deploy']);
  for (const j of jobs) assert.match(j, /\n    name: client page [a-z]+\n/, j.split('\n')[0]);
});

// The minor findings of MAINT-0016's independent review (M2–M5), closed in v2.4.2.
test('the review template has a slot for the level, and the carry-over, accepted-findings and setup-page texts say what the checks do', () => {
  // MAINT-0021: the slot also names a fix check, and the next line asks for both vendors.
  assert.match(read('templates/review.md'), /^Review level \(light, standard or deep, or a fix check; `procedures\/review\.md`\) and why:\nImplementer's vendor and reviewer's vendor \(they differ\):$/m, 'M2');
  for (const [name, text] of [['procedures/review.md', read('procedures/review.md')], ['SCHEMA.md', read('SCHEMA.md')]]) assert.match(text, /a planning record, or one the pull request had not touched/, `M3: ${name}`);
  assert.match(read('SCHEMA.md'), /Only the part after `\/` is matched/, 'M5');
  assert.match(read('adapters/setup-page.html'), /Require the trial walk and the milestone review before you accept/, 'M4');
});
