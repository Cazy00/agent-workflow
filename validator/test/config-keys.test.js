import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dirSource, loadConfig, loadRecord } from '../lib/index.js';

// MAINT-0016: the settings that let the agent's pull requests merge themselves, move some approvals to the milestone's
// acceptance, shape review and require acceptance evidence; each is refused where it would not mean what it says.
function configWith(t, edit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = JSON.parse(fs.readFileSync(new URL('../../config.default.json', import.meta.url), 'utf8'));
  fs.mkdirSync(path.join(dir, 'docs/workflow'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/workflow/config.json'), JSON.stringify(edit(base)));
  return () => loadConfig(dirSource(dir));
}
const ownerMerge = (c, approval = {}) => ({ ...c, approval: { ...c.approval, label: 'owner-merge', mechanism: 'owner-merge', checkpoint: 'milestone', ...approval } });

test('auto_merge and defer_to_acceptance are true or false, and true only where the agent merges its own pull requests', t => {
  for (const key of ['auto_merge', 'defer_to_acceptance']) {
    assert.equal(configWith(t, c => ownerMerge(c, { [key]: true }))().approval[key], true);
    assert.equal(configWith(t, c => ownerMerge(c, { checkpoint: 'plan', [key]: true }))().approval[key], true);
    assert.equal(configWith(t, c => ownerMerge(c, { checkpoint: 'change', [key]: false }))().approval[key], false, 'false is allowed anywhere');
    assert.throws(configWith(t, c => ownerMerge(c, { [key]: 'yes' })), new RegExp(`approval\\.${key} must be true or false`));
    assert.throws(configWith(t, c => ownerMerge(c, { checkpoint: 'change', [key]: true })), /needs owner-merge approval with checkpoint milestone or plan/);
    assert.throws(configWith(t, c => ({ ...c, approval: { ...c.approval, [key]: true } })), /needs owner-merge approval/, 'manual mode');
  }
});

test('review names an optional second model and the paths that always need a deep review', t => {
  const good = { second_model: { tool: 'codex', model: 'gpt-6.1-sol', max_effort: 'high' }, deep_paths: ['src/auth/**'] };
  assert.deepEqual(configWith(t, c => ({ ...c, review: good }))().review, good);
  assert.ok(configWith(t, c => ({ ...c, review: { second_model: null } }))(), 'no second model');
  for (const [review, pattern] of [
    [{ reviewer: 'x' }, /review may contain only second_model, deep_paths, reviewer_command, cadence, same_vendor, plan_command/],
    [{ second_model: { tool: 'codex' } }, /review\.second_model\.model must be a plain name/],
    [{ second_model: { tool: 'codex', model: 'gpt 6' } }, /review\.second_model\.model must be a plain name/],
    [{ second_model: { tool: 'codex', model: 'gpt-6.1-sol', max_effort: 'extreme' } }, /max_effort must be one of low, medium, high, xhigh, max/],
    [{ deep_paths: 'src/**' }, /review\.deep_paths must be an array of glob strings/],
  ]) assert.throws(configWith(t, c => ({ ...c, review })), pattern);
});

// MAINT-0022: {level} alone is enough too, so a command that takes levels (codereview run --level {level}) can be the reviewer.
test('MAINT-0021: review.reviewer_command is one line of at most 300 characters naming {role} or {level}', t => {
  for (const good of [{ reviewer_command: 'review run --role {role} --level {level}' }, { reviewer_command: 'codereview run --level {level} --author-vendor anthropic' }]) {
    assert.deepEqual(configWith(t, c => ({ ...c, review: good }))().review, good);
  }
  const pattern = /review\.reviewer_command must be one line of at most 300 characters containing \{role\} or \{level\}/;
  for (const bad of ['review run --role', 'review run --role {role}\nrm -rf /', `review --role {role} ${'x'.repeat(290)}`, 7, '']) {
    assert.throws(configWith(t, c => ({ ...c, review: { reviewer_command: bad } })), pattern, JSON.stringify(bad));
  }
});

// MAINT-0022: the owner's review diet of 22 October 2026. One review per milestone (review.cadence), a reviewer of the
// implementer's vendor from a fresh session (review.same_vendor), and the plan review's command (review.plan_command). The
// milestone cadence holds only where wf ci checks that one review: a pull-request mode with acceptance evidence.
test('MAINT-0022: review.cadence, review.same_vendor and review.plan_command', t => {
  const review = { cadence: 'milestone', same_vendor: 'separate-session', plan_command: 'codereview plan --file {file} --author-vendor anthropic --project p', reviewer_command: 'codereview run --level {level}' };
  const diet = (c, more = {}) => ({ ...ownerMerge(c), acceptance_evidence: true, review: { ...review, ...more } });
  assert.deepEqual(configWith(t, diet)().review, review);
  assert.ok(configWith(t, c => ({ ...c, approval: { ...c.approval, label: 'enforced', mechanism: 'github-rulesets-codeowners' }, review: { cadence: 'milestone' } }))(), 'enforced mode');
  for (const r of [{ cadence: 'task' }, { same_vendor: 'never' }, { plan_command: 'review plan {file}' }]) assert.ok(configWith(t, c => ({ ...c, review: r }))(), JSON.stringify(r));
  const command = /review\.plan_command must be one line of at most 300 characters containing \{file\}/;
  const cadence = /review\.cadence milestone needs a pull-request mode \(approval label enforced or owner-merge\) and acceptance_evidence: true, so wf ci checks the milestone's one review/;
  for (const [edit, pattern] of [
    [c => diet(c, { cadence: 'weekly' }), /review\.cadence must be task or milestone/],
    [c => diet(c, { same_vendor: 'always' }), /review\.same_vendor must be never or separate-session/],
    [c => diet(c, { plan_command: 'codereview plan' }), command],
    [c => diet(c, { plan_command: 'review plan {file}\nrm -rf /' }), command],
    [c => diet(c, { plan_command: `review plan {file} ${'x'.repeat(290)}` }), command],
    [c => ({ ...diet(c), acceptance_evidence: false }), cadence],
    [c => ({ ...c, acceptance_evidence: true, review: { cadence: 'milestone' } }), cadence],
  ]) assert.throws(configWith(t, edit), pattern);
});

test('MAINT-0022: a milestone\'s plan_review is the https link to its plan\'s review', () => {
  const record = line => loadRecord({ read: () => `---\nrecord: milestone\nid: M-0001\noutcome: o\nstatus: Draft\n${line}---\n# M-0001\n` }, 'docs/workflow/milestones/M-0001.md', 'milestone');
  const bad = /plan_review must be the https link to the review of the milestone's plan \(procedures\/readiness\.md\)/;
  assert.doesNotMatch(record('plan_review: https://github.com/o/r/pull/3#issuecomment-1\n').errors.join(), bad);
  assert.doesNotMatch(record('plan_review:\n').errors.join(), bad, 'empty is absent');
  for (const v of ['done', 'http://github.com/o/r/pull/3', 'https://user:pw@github.com/x']) assert.match(record(`plan_review: ${v}\n`).errors.join(), bad, v);
});

test('acceptance_evidence is true or false', t => {
  assert.equal(configWith(t, c => ({ ...c, acceptance_evidence: true }))().acceptance_evidence, true);
  assert.throws(configWith(t, c => ({ ...c, acceptance_evidence: 'on' })), /acceptance_evidence must be true or false/);
});

test('a task record lists the findings it accepted rather than fixed as REVIEW/FINDING', () => {
  const record = text => loadRecord({ read: () => text }, 'docs/workflow/tasks/T-0001.md', 'task');
  const head = '---\nrecord: task\nid: T-0001\ntitle: t\nstatus: Active\nowner: a\nobjective: o\n';
  assert.deepEqual(record(`${head}accepted_findings: [R-0030/N1, R-0031/F7]\n---\n`).errors, []);
  assert.deepEqual(record(`${head}accepted_findings: []\n---\n`).errors, []);
  assert.match(record(`${head}accepted_findings: [N1]\n---\n`).errors.join(' | '), /accepted_findings entries must look like R-0030\/N1/);
});
