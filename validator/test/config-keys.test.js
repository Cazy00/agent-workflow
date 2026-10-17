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
    [{ reviewer: 'x' }, /review may contain only second_model, deep_paths, reviewer_command/],
    [{ second_model: { tool: 'codex' } }, /review\.second_model\.model must be a plain name/],
    [{ second_model: { tool: 'codex', model: 'gpt 6' } }, /review\.second_model\.model must be a plain name/],
    [{ second_model: { tool: 'codex', model: 'gpt-6.1-sol', max_effort: 'extreme' } }, /max_effort must be one of low, medium, high, xhigh, max/],
    [{ deep_paths: 'src/**' }, /review\.deep_paths must be an array of glob strings/],
  ]) assert.throws(configWith(t, c => ({ ...c, review })), pattern);
});

test('MAINT-0021: review.reviewer_command is one line of at most 300 characters naming {role}', t => {
  const good = { reviewer_command: 'review run --role {role} --level {level}' };
  assert.deepEqual(configWith(t, c => ({ ...c, review: good }))().review, good);
  const pattern = /review\.reviewer_command must be one line of at most 300 characters containing \{role\}/;
  for (const bad of ['review run --level {level}', 'review run --role {role}\nrm -rf /', `review --role {role} ${'x'.repeat(290)}`, 7, '']) {
    assert.throws(configWith(t, c => ({ ...c, review: { reviewer_command: bad } })), pattern, JSON.stringify(bad));
  }
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
