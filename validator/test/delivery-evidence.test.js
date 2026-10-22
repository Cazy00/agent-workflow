import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evidenceErrors, fixedAfterError, isBlocking, reviewLevelErrors } from '../lib/delivery-evidence.js';

// The agent's delivery evidence (lib/delivery-evidence.js), the only evidence check in the pull-request modes: every gap
// is an error, never an `unverified` item (MAINT-0010; kept from the routine lane's tests by the MAINT-0011 review, S3).
const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const check = name => ({ name, result: 'passed', reference: `https://github.com/o/r/actions/runs/1#${encodeURIComponent(name)}` });
function evidence() {
  return {
    schema: 'agent-workflow/delivery-evidence@1', candidate: SHA, assurance: 'agent-attested', tasks: ['T-0001'],
    verification: { revision: SHA, environment: 'ubuntu-24.04 node 22', checks: [check('wf ci'), check('test')], execution: { revision: SHA, tests: [] } },
    integration: { revision: SHA, environment: 'ubuntu-24.04 node 22', checks: [check('wf ci'), check('test')] },
    review: {
      reviewer: 'independent-reviewer', implementer: 'agent-worker', separate_context: true,
      context: { provider: 'claude-code subagent', context_id: 'ctx-1', inherited_context: false, candidate: SHA, launch_evidence: 'https://github.com/o/r/pull/7#issuecomment-1' },
      coverage: ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'],
      findings: [{ id: 'F1', severity: 'low', status: 'resolved', resolution: 'fixed in the head commit' }],
      tasks: ['T-0001'], report: 'https://github.com/o/r/pull/7#issuecomment-2',
    },
  };
}
const errorsFor = (e, over = {}) => evidenceErrors({ evidence: e, revision: SHA, taskIds: ['T-0001'], owner: 'agent-worker', requiredChecks: ['wf ci', 'test'], ...over });

test('complete evidence for the exact candidate has no errors, and a finding accepted with a resolution is allowed', () => {
  assert.deepEqual(errorsFor(evidence()), []);
  const accepted = evidence(); accepted.review.findings = [{ id: 'F2', status: 'accepted', resolution: 'kept: the fix costs more than the risk' }];
  assert.deepEqual(errorsFor(accepted), []);
});

test('evidence that is stale, inherited, self-reviewed, incomplete or unresolved fails', () => {
  const mutate = f => { const e = structuredClone(evidence()); f(e); return e; };
  const cases = [
    [null, /evidence is missing/],
    [mutate(e => { e.candidate = OTHER; }), /not for this candidate/],
    [mutate(e => { e.integration.revision = OTHER; }), /integration evidence is not for this candidate/],
    [mutate(e => { e.review.context.candidate = OTHER; }), /review was not of this candidate/],
    [mutate(e => { e.review.context.inherited_context = true; }), /inherit/],
    [mutate(e => { delete e.review.context; }), /context is missing/],
    [mutate(e => { e.review.separate_context = false; }), /separate context/],
    [mutate(e => { e.review.reviewer = 'agent-worker'; }), /differ from the implementer/],
    [mutate(e => { e.review.implementer = 'someone'; }), /implementer must be/],
    [mutate(e => { e.verification.checks = [check('wf ci')]; }), /required check test did not pass/],
    [mutate(e => { e.integration.checks[1].result = 'skipped'; }), /did not pass/],
    [mutate(e => { e.verification.checks[0].reference = 'local log'; }), /https reference/],
    [mutate(e => { e.verification.environment = ''; }), /environment/],
    [mutate(e => { e.review.findings = [{ id: 'F2', status: 'accepted' }]; }), /not resolved, or accepted with a resolution/],
    [mutate(e => { e.review.findings = [{ id: 'F3', status: 'open' }]; }), /not resolved/],
    [mutate(e => { e.review.coverage = ['scope', 'correctness']; }), /did not cover security/],
    [mutate(e => { e.review.tasks = []; }), /review must cover exactly/],
    [mutate(e => { e.tasks = ['T-0001', 'T-0009']; }), /name exactly/],
    [mutate(e => { e.review.report = ''; }), /report/],
    [mutate(e => { e.assurance = 'authenticated'; }), /assurance/],
    [mutate(e => { e.extra = true; }), /unknown field extra/],
  ];
  for (const [e, pattern] of cases) assert.match(errorsFor(e).join('\n'), pattern, String(pattern));
  assert.match(errorsFor(evidence(), { requiredChecks: [] }).join('\n'), /no required checks/);
});

test('the evidence template holds placeholders only, which never pass', () => {
  const template = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../templates/delivery-evidence.json', import.meta.url)), 'utf8'));
  const errors = errorsFor(template).join('\n');
  for (const pattern of [/not for this candidate/, /did not pass/, /separate context/, /inherit/, /not resolved/, /report/]) assert.match(errors, pattern);
});

// MAINT-0016: under auto-merge GitHub requires the profile's checks before any merge, so the evidence may say so rather
// than wait for them; the agent still lists a check it ran itself.
const enforced = name => ({ name, result: 'enforced', reference: 'https://github.com/o/r/pull/7/checks' });
test('under auto-merge a required check may be enforced, but verification still lists a check the agent ran', () => {
  const e = evidence();
  e.integration.checks = [enforced('wf ci'), enforced('test')];
  e.verification.checks = [check('npm test'), enforced('wf ci'), enforced('test')];
  assert.deepEqual(errorsFor(e, { enforcedChecks: true }), []);
  assert.match(errorsFor(e).join(' | '), /check "wf ci" is "enforced", which only a project with approval\.auto_merge may use/);
  e.verification.checks = e.verification.checks.slice(1);
  assert.match(errorsFor(e, { enforcedChecks: true }).join(' | '), /verification lists no check the agent ran and saw pass/);
  e.verification.checks.push(check('npm test'), enforced('lint'));
  assert.match(errorsFor(e, { enforcedChecks: true }).join(' | '), /check "lint" did not pass/, 'only a required check can be enforced');
});

test('verification and review of an earlier revision count only when ci.js found that they carry over; integration never does', () => {
  const e = evidence();
  e.verification.revision = OTHER; e.review.context.candidate = OTHER;
  assert.match(errorsFor(e).join(' | '), /verification evidence is not for this candidate revision/);
  assert.match(errorsFor(e).join(' | '), /review was not of this candidate revision/);
  assert.deepEqual(errorsFor(e, { carried: { verification: OTHER, review: OTHER } }), []);
  e.integration.revision = OTHER;
  assert.match(errorsFor(e, { carried: { verification: OTHER, review: OTHER } }).join(' | '), /integration evidence is not for this candidate revision/);
});

test('a review states its level, model and any fallback; a deep path needs a deep review by the second model or a reason', () => {
  const r = evidence().review;
  const second = { tool: 'codex', model: 'gpt-6.1-sol', max_effort: 'high' };
  const deep = ['src/auth/a.js'];
  assert.deepEqual(reviewLevelErrors({ review: r }), []);
  assert.match(reviewLevelErrors({ review: { ...r, level: 'heavy' } }).join(), /level must be one of none, light, standard, deep/);
  assert.match(reviewLevelErrors({ review: { ...r, model: ' ' } }).join(), /review model must be a non-empty text/);
  assert.match(reviewLevelErrors({ review: { ...r, level: 'light' }, deep }).join(), /need a deep review \(review\.deep_paths\): src\/auth\/a\.js; this review's level is light/);
  assert.match(reviewLevelErrors({ review: { ...r, level: 'deep' }, deep, secondModel: second }).join(), /a deep review is by gpt-6\.1-sol/);
  assert.deepEqual(reviewLevelErrors({ review: { ...r, level: 'deep', model: 'gpt-6.1-sol' }, deep, secondModel: second }), []);
  assert.deepEqual(reviewLevelErrors({ review: { ...r, level: 'deep', model: 'claude-opus-5-5', fallback: 'codex: usage limit reached' }, deep, secondModel: second }), []);
  assert.deepEqual(reviewLevelErrors({ review: { ...r, level: 'deep' }, deep }), [], 'without a second model any deep review will do');
});

test('MAINT-0021: a test-only change may leave the review out or name level none; other changes may not', () => {
  const none = evidence(); delete none.review;
  assert.deepEqual(errorsFor(none, { reviewOptional: true }), []);
  const levelNone = evidence(); levelNone.review = { level: 'none' };
  assert.deepEqual(errorsFor(levelNone, { reviewOptional: true }), []);
  const full = evidence(); full.review.level = 'none';
  assert.match(errorsFor(full).join(), /review level none is only for a test-only change \(procedures\/review\.md\)/);
  assert.match(errorsFor(none).join(), /independent review evidence is missing/);
  assert.deepEqual(reviewLevelErrors({ review: { ...evidence().review, level: 'none' } }), []);
});

test('MAINT-0021: the reviewer is from another vendor when both vendors are given', () => {
  const e = evidence(); e.review.vendor = 'OpenAI'; e.review.implementer_vendor = 'Anthropic';
  assert.deepEqual(errorsFor(e), []);
  e.review.vendor = ' anthropic ';
  assert.match(errorsFor(e).join(), /the reviewer's vendor must differ from the implementer's/);
  e.review.vendor = ''; assert.match(errorsFor(e).join(), /review vendor must be a non-empty text/);
  const one = evidence(); one.review.vendor = 'Google';
  assert.deepEqual(errorsFor(one), [], 'one vendor alone is not compared');
});

// MAINT-0022 (the owner's review diet, 22 October 2026): with review.same_vendor separate-session, a reviewer of the implementer's
// vendor counts when the evidence records a fresh session: a new process with none of the implementer's conversation.
test('MAINT-0022: same vendor needs separate-session and a fresh session', () => {
  const same = (fresh) => { const e = evidence(); e.review.vendor = 'Anthropic'; e.review.implementer_vendor = 'anthropic'; if (fresh !== undefined) e.review.context.fresh_session = fresh; return e; };
  const never = /the reviewer's vendor must differ from the implementer's \(procedures\/review\.md\)/;
  const unfresh = /the reviewer is of the implementer's vendor: review\.same_vendor separate-session accepts that only with review\.context\.fresh_session true, a new session with none of the implementer's conversation \(procedures\/review\.md\)/;
  assert.match(errorsFor(same(true)).join(), never, 'never, the default');
  assert.match(errorsFor(same(true), { sameVendor: 'never' }).join(), never);
  assert.deepEqual(errorsFor(same(true), { sameVendor: 'separate-session' }), []);
  for (const fresh of [undefined, false]) assert.match(errorsFor(same(fresh), { sameVendor: 'separate-session' }).join(), unfresh, String(fresh));
  assert.match(errorsFor(same('yes'), { sameVendor: 'separate-session' }).join(), /review context fresh_session must be true or false when given/);
  const other = evidence(); other.review.context.fresh_session = true;
  assert.deepEqual(errorsFor(other), [], 'fresh_session alone changes nothing');
});

test('MAINT-0022: a fix check of the implementer\'s vendor needs separate-session and a fresh session', () => {
  const review = fresh => ({
    level: 'deep', implementer_vendor: 'Anthropic', findings: [{ id: 'F1', severity: 'blocking' }], fixes_after: { tests: ['test/a.test.js'] },
    fix_check: { candidate: SHA, reviewer: 'codereview', model: 'claude:opus', vendor: 'anthropic', report: 'https://github.com/o/r/pull/7#issuecomment-3', ...(fresh === undefined ? {} : { fresh_session: fresh }) },
  });
  const after = (fresh, sameVendor) => fixedAfterError({ review: review(fresh), candidate: SHA, from: OTHER, isAncestor: () => true, carries: () => false, ...(sameVendor ? { sameVendor } : {}) });
  assert.match(after(true), /the fix check's vendor must differ from the implementer's/, 'never, the default');
  assert.equal(after(true, 'separate-session'), null);
  assert.match(after(undefined, 'separate-session'), /the fix check is of the implementer's vendor: review\.same_vendor separate-session accepts that only with review\.fix_check\.fresh_session true/);
  assert.match(after('yes', 'separate-session'), /review\.fix_check\.fresh_session must be true or false when given/);
});

test('blocking, critical and high are blocking severities; should fix, note, medium and low are not', () => {
  for (const s of ['blocking', 'Blocking', 'critical', 'high']) assert.equal(isBlocking({ severity: s }), true, s);
  for (const s of ['should fix', 'note', 'medium', 'low', undefined]) assert.equal(isBlocking({ severity: s }), false, String(s));
});
