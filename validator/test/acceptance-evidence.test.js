import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitSource } from '../lib/index.js';
import { ACCEPTANCE_MARKER, acceptanceEvidenceErrors, parseAcceptanceEvidence } from '../lib/acceptance-evidence.js';

// MAINT-0016: the pull request that accepts a milestone carries the milestone's review, the trial walked in a browser
// before the owner tries it, and what the agent decided for the owner's acceptance, each bound to the code being accepted.
const config = { paths: { production: ['src/**'], governing: ['docs/workflow/milestones/**'], planning: ['docs/**'] } };
function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-acceptance-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  const commit = m => { git('add', '-A'); git('commit', '-qm', m); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  write('src/a.js', 'a\n'); write('docs/workflow/milestones/M-0001.md', 'status: Verified\n');
  const accepted = commit('the code being accepted');
  write('docs/workflow/milestones/M-0001.md', 'status: Accepted\n');
  const head = commit('Accept M-0001');
  return { write, commit, accepted, head, at: rev => gitSource(dir, rev) };
}
function evidence(rev) {
  return {
    schema: 'agent-workflow/acceptance-evidence@1', milestone: 'M-0001', candidate: rev,
    review: { reviewer: 'codex exec, fresh context', model: 'gpt-6.1-sol', revision: rev, report: 'https://github.com/o/r/pull/9#issuecomment-1' },
    walkthrough: {
      revision: rev, trial_environment: { address: 'https://staging.example.com', build: '1.4.0' }, address: 'https://staging.example.com', build: '1.4.0', environment: 'Chromium 140', walk_data: 'separate', first_load_seconds: 1.2, walker: 'trial-walker subagent', languages: ['en', 'ar'], viewports: ['1366x900', '390x844'],
      unguided: [{ scenario: 'AC-001-1', outcome: 'The owner imports a list', result: 'reached' }],
      steps: [{ step: '1. Import the list', scenario: 'AC-001-1', expected: 'two added, one duplicate', observed: 'two added, one duplicate', result: 'passed', screenshot: 'https://github.com/o/r/pull/9#step-1' }],
    },
    deferred: ['R-0001/N1: a cleanup failure can go unreported (test helper only)'],
    tests_changed: [],
  };
}
const records = (accepted = ['R-0001/N1']) => ({ tasks: new Map([['T-0001', { data: { milestone: 'M-0001', accepted_findings: accepted } }], ['T-0002', { data: { milestone: 'M-0002', accepted_findings: ['R-0009/X1'] } }]]) });
const errorsAt = (r, rev, e, rec = records()) => acceptanceEvidenceErrors({ evidence: e, milestone: 'M-0001', config, candidate: r.at(rev), records: rec });

test('complete acceptance evidence for the code being accepted has no errors', t => {
  const r = repo(t);
  assert.deepEqual(errorsAt(r, r.head, evidence(r.accepted)), []);
  assert.deepEqual(errorsAt(r, r.head, evidence(r.head)), [], 'the head itself, when only records changed');
});

test('a production change after the accepted, reviewed or walked revision fails', t => {
  const r = repo(t);
  r.write('src/a.js', 'changed after the walkthrough\n'); const later = r.commit('a late fix');
  const errors = errorsAt(r, later, evidence(r.accepted)).join(' | ');
  assert.match(errors, /the accepted candidate [0-9a-f]{12} is followed by changes to src\/a\.js/);
  assert.match(errors, /the milestone review's revision [0-9a-f]{12} is followed by changes to src\/a\.js/);
  assert.match(errors, /the walkthrough's revision [0-9a-f]{12} is followed by changes to src\/a\.js/);
});

test('a step that did not pass, a missing screenshot, or an empty not_applicable fails', t => {
  const r = repo(t);
  const failed = evidence(r.accepted); failed.walkthrough.steps[0].result = 'failed';
  assert.match(errorsAt(r, r.head, failed).join(' | '), /walkthrough step 1 did not pass: fix it, or correct the step, and walk it again/);
  const noShot = evidence(r.accepted); delete noShot.walkthrough.steps[0].screenshot;
  assert.match(errorsAt(r, r.head, noShot).join(' | '), /walkthrough step 1 needs an https screenshot reference/);
  const na = evidence(r.accepted); na.walkthrough = { not_applicable: ' ' };
  assert.match(errorsAt(r, r.head, na).join(' | '), /a walkthrough that does not apply says only why, in not_applicable/);
  na.walkthrough = { not_applicable: 'the project has no user interface: it is a command-line tool' };
  assert.deepEqual(errorsAt(r, r.head, na), []);
});

test('deferred names every finding the milestone\'s tasks accepted rather than fixed, and only that milestone\'s', t => {
  const r = repo(t);
  assert.match(errorsAt(r, r.head, evidence(r.accepted), records(['R-0001/N1', 'R-0002/F7'])).join(' | '), /deferred must list the findings the milestone's tasks accepted rather than fixed: R-0002\/F7/);
  assert.deepEqual(errorsAt(r, r.head, evidence(r.accepted), records([])), [], 'T-0002 belongs to another milestone');
});

test('the wrong milestone, an unknown field or a missing review fails; the block is read from a pull request description', t => {
  const r = repo(t);
  const e = evidence(r.accepted);
  assert.match(errorsAt(r, r.head, { ...e, milestone: 'M-0002' }).join(' | '), /must name the milestone this pull request accepts, M-0001/);
  assert.match(errorsAt(r, r.head, { ...e, extra: 1 }).join(' | '), /unknown field extra/);
  assert.match(errorsAt(r, r.head, { ...e, review: undefined }).join(' | '), /the milestone review is missing/);
  assert.deepEqual(parseAcceptanceEvidence(`Accept M-0001.\n\n${ACCEPTANCE_MARKER}\n\`\`\`json\n${JSON.stringify(e)}\n\`\`\`\n`), e);
  assert.equal(parseAcceptanceEvidence('no block here'), null);
});

test('the acceptance evidence template has exactly the checked fields', () => {
  const t = JSON.parse(fs.readFileSync(new URL('../../templates/acceptance-evidence.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(t), ['schema', 'milestone', 'candidate', 'review', 'walkthrough', 'deferred', 'tests_changed']);
  assert.equal(t.schema, 'agent-workflow/acceptance-evidence@1');
});

// The independent review of MAINT-0016 (I1): the acceptance pull request may also remove the milestone's Done task
// records, so the findings they accepted are read from the trusted branch's records as well as the candidate's.
test('findings accepted on the trusted branch are owed even when the candidate no longer has the task record', t => {
  const r = repo(t);
  const trusted = records(['R-0001/N1']), candidate = { tasks: new Map() };
  assert.match(errorsAt(r, r.head, { ...evidence(r.accepted), deferred: [] }, [trusted, candidate]).join(' | '), /deferred must list the findings the milestone's tasks accepted rather than fixed: R-0001\/N1/);
  assert.deepEqual(errorsAt(r, r.head, evidence(r.accepted), [trusted, candidate]), []);
});
