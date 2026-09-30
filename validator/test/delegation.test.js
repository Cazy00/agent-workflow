import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateDelegation, evidenceErrors, fixedReserved, patternError } from '../lib/delegation.js';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const routine = () => ({ enabled: true, paths: ['app/components/**', 'app/styles/**'], reserved_paths: ['app/components/admin/**', 'app/lib/orders.ts'], max_files: 10, max_changed_lines: 200, evidence_assurance: 'agent-attested' });
const config = (r = routine()) => ({ trusted_branch: 'main', delegation: { routine: r } });
const task = (over = {}) => ({ id: 'T-0001', status: 'Ready', owner: 'agent-worker', milestone: 'M-0001', scope: ['app/components', 'app/styles'], governing: ['PROFILE'], acceptance: ['AC-001-1'], prerequisites: [], decisions: [], deferred_inputs: [], risks: [], ...over });
const check = name => ({ name, result: 'passed', reference: `https://github.com/o/r/actions/runs/1#${encodeURIComponent(name)}` });
function evidence(over = {}) {
  return {
    schema: 'agent-workflow/delivery-evidence@1', candidate: SHA, assurance: 'agent-attested', tasks: ['T-0001'],
    verification: { revision: SHA, environment: 'ubuntu-24.04 node 22', checks: [check('wf ci'), check('test')] },
    integration: { revision: SHA, environment: 'ubuntu-24.04 node 22', checks: [check('wf ci'), check('test')] },
    review: {
      reviewer: 'independent-reviewer', implementer: 'agent-worker', separate_context: true,
      context: { provider: 'claude-code subagent', context_id: 'ctx-1', inherited_context: false, candidate: SHA, launch_evidence: 'https://github.com/o/r/pull/7#issuecomment-1' },
      coverage: ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'],
      findings: [{ id: 'F1', severity: 'low', status: 'resolved', resolution: 'fixed in the head commit' }],
      tasks: ['T-0001'], report: 'https://github.com/o/r/pull/7#issuecomment-2',
    },
    ...over,
  };
}
const routineChange = [{ path: 'app/components/Button.tsx', category: 'production' }, { path: 'docs/workflow/tasks/T-0001.md', category: 'planning' }];
const input = (over = {}) => ({ config: config(), baselineTasks: [task()], tasks: [task({ status: 'Done' })], taskIds: ['T-0001'], classes: routineChange, revision: SHA, changedLines: 24, evidence: evidence(), requiredChecks: ['wf ci', 'test'], ...over });
const blocked = (r, pattern) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.approval_basis, 'owner-review'); if (pattern) assert.match(r.errors.join('\n'), pattern); };

test('delegation is off unless the baseline config enables it, and adds nothing when off', () => {
  for (const cfg of [{}, undefined, { trusted_branch: 'main' }, { delegation: { routine: { enabled: false } } }, { delegation: { routine: { enabled: false, paths: ['src/**'] } } }]) {
    const r = evaluateDelegation(input({ config: cfg, evidence: null, classes: [{ path: 'src/anything.ts', category: 'production' }] }));
    assert.deepEqual([r.enabled, r.ok, r.errors], [false, true, []]);
  }
  // Only the config passed in counts: a candidate's copy is never read by this module, so the caller must pass the baseline.
  const baselineOff = evaluateDelegation(input({ config: { trusted_branch: 'main' }, tasks: [task({ status: 'Done' })], evidence: evidence() }));
  assert.equal(baselineOff.enabled, false);
  assert.notEqual(baselineOff.approval_basis, 'delegated-routine', 'candidate evidence cannot switch the lane on');
});

test('an enabled but malformed configuration blocks, even with owner approval', () => {
  const bad = [
    { paths: ['src/**'] }, { paths: ['**'] }, { paths: ['app/*.tsx'] }, { paths: ['app/../secrets/**'] }, { paths: [] }, { paths: ['/app/x/**'] },
    { reserved_paths: [] }, { reserved_paths: undefined }, { max_files: 0 }, { max_files: 1e6 }, { max_changed_lines: 1.5 }, { max_changed_lines: '100' },
    { evidence_assurance: 'authenticated' }, { evidence_assurance: undefined }, { enabled: 'true' }, { daily_cap: 3 },
  ];
  for (const change of bad) {
    const r = evaluateDelegation(input({ config: config({ ...routine(), ...change }), ownerApproved: true }));
    assert.equal(r.enabled, true); blocked(r, /delegation/);
  }
  blocked(evaluateDelegation(input({ config: { delegation: { routine: routine(), other: {} } }, ownerApproved: true })), /only hold routine/);
  blocked(evaluateDelegation(input({ revision: 'HEAD', ownerApproved: true })), /full commit hash/);
  assert.equal(patternError('app/components/**'), null);
  assert.equal(patternError('app/styles/site.css'), null);
  assert.match(patternError('src/**'), /two path components/);
});

test('a small routine change with complete evidence for the exact candidate uses the routine lane, and says what is unverified', () => {
  const r = evaluateDelegation(input());
  assert.deepEqual([r.ok, r.approval_basis, r.errors], [true, 'delegated-routine', []]);
  assert.ok(r.unverified.some(u => /agent-attested and unauthenticated/.test(u)));
  assert.ok(r.unverified.some(u => /acceptance and release are not delegated/.test(u)));
  const records = evaluateDelegation(input({ classes: [{ path: 'docs/workflow/tasks/T-0002.md', category: 'planning' }], evidence: null, taskIds: [] }));
  assert.deepEqual([records.ok, records.approval_basis], [true, 'records-only'], 'planning record updates need no per-step approval');
});

test('anything outside the routine lane needs authenticated owner approval, which evidence cannot supply', () => {
  const cases = [
    [{ classes: [...routineChange, { path: 'docs/workflow/profile.md', category: 'governing' }] }, /governing path/],
    [{ classes: [...routineChange, { path: 'docs/workflow/config.json', category: 'enforcement' }] }, /enforcement path/],
    [{ classes: [...routineChange, { path: 'new/thing.xyz', category: 'unclassified' }] }, /unclassified path/],
    [{ classes: [...routineChange, { path: 'dist/app.js', category: 'generated' }] }, /generated path/],
    [{ classes: [{ path: 'app/lib/util.ts', category: 'production' }] }, /outside delegation.routine.paths/],
    [{ classes: [{ path: 'app/components/admin/Panel.tsx', category: 'production' }] }, /reserved path/],
    [{ classes: [{ path: 'app/components/Button.test.tsx', category: 'production' }] }, /test, dependency/],
    [{ classes: [{ path: 'app/components/package.json', category: 'production' }] }, /test, dependency/],
    [{ classes: [{ path: 'app/components/CheckoutButton.tsx', category: 'production' }] }, /money/],
    [{ classes: [{ path: 'app/components/auth/Login.tsx', category: 'production' }] }, /authentication/],
    [{ classes: [{ path: 'app/styles/migrations/001.sql', category: 'production' }] }, /migration/],
    [{ classes: [...routineChange, { path: 'tests/acceptance-map.json', category: 'production' }] }, /test, dependency/],
  ];
  for (const [change, pattern] of cases) {
    const forged = evidence(); forged.owner_approved = true; forged.review.owner_approved = true;
    blocked(evaluateDelegation(input({ ...change, evidence: forged })), pattern);
    const approved = evaluateDelegation(input({ ...change, ownerApproved: true }));
    assert.deepEqual([approved.ok, approved.approval_basis], [true, 'owner-review'], pattern.source);
  }
  blocked(evaluateDelegation(input({ ownerApproved: 'true', classes: [{ path: 'app/lib/util.ts', category: 'production' }] })), /owner approval/);
  blocked(evaluateDelegation(input({ evidence: { ...evidence(), owner_approved: true }, classes: [{ path: 'app/lib/util.ts', category: 'production' }] })));
  assert.ok(fixedReserved('app/components/PriceTag.tsx') && fixedReserved('app/components/userPermissions.ts') && !fixedReserved('app/components/Button.tsx'));
});

test('a large, binary or unmeasured change needs the owner', () => {
  blocked(evaluateDelegation(input({ changedLines: 201 })), /exceed max_changed_lines/);
  blocked(evaluateDelegation(input({ changedLines: null })), /unknown/);
  blocked(evaluateDelegation(input({ changedLines: -1 })), /unknown/);
  const many = Array.from({ length: 11 }, (_, i) => ({ path: `app/styles/s${i}.css`, category: i ? 'production' : 'planning' }));
  blocked(evaluateDelegation(input({ classes: many })), /exceed max_files/, 'every changed file counts, planning included');
});

test('candidate task records cannot invent a task, erase a risk or widen authority', () => {
  blocked(evaluateDelegation(input({ baselineTasks: [], tasks: [task()] })), /not on the baseline/);
  blocked(evaluateDelegation(input({ baselineTasks: [task({ status: 'Draft' })] })), /Draft on the baseline/);
  blocked(evaluateDelegation(input({ baselineTasks: [task({ risks: ['money'] })], tasks: [task({ risks: [] })] })), /changes its risks|records risks/);
  blocked(evaluateDelegation(input({ tasks: [task({ risks: ['cross-component'] })] })), /records risks/);
  blocked(evaluateDelegation(input({ baselineTasks: [task({ decisions: ['D-0001'] })], tasks: [task({ decisions: ['D-0001'] })] })), /records decisions/);
  blocked(evaluateDelegation(input({ baselineTasks: [task({ deferred_inputs: ['D-0002@verify'] })], tasks: [task({ deferred_inputs: ['D-0002@verify'] })] })), /records deferred inputs/);
  blocked(evaluateDelegation(input({ tasks: [task({ scope: ['app'] })] })), /changes its scope/);
  blocked(evaluateDelegation(input({ tasks: [task({ owner: 'someone-else' })] })), /changes its owner/);
  blocked(evaluateDelegation(input({ baselineTasks: [task({ scope: ['app/styles'] })], tasks: [task({ scope: ['app/styles'] })] })), /outside every named task's baseline scope/);
  blocked(evaluateDelegation(input({ taskIds: [] })), /no task is named/);
  const two = [task(), task({ id: 'T-0002', owner: 'other-worker' })];
  blocked(evaluateDelegation(input({ baselineTasks: two, tasks: two, taskIds: ['T-0001', 'T-0002'] })), /different owners/);
});

test('routine evidence that is stale, inherited, self-reviewed, incomplete or unresolved fails instead of passing unverified', () => {
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
    [mutate(e => { e.review.findings = [{ id: 'F2', status: 'accepted', resolution: 'risk accepted' }]; }), /not resolved/],
    [mutate(e => { e.review.findings = [{ id: 'F3', status: 'open' }]; }), /not resolved/],
    [mutate(e => { e.review.coverage = ['scope', 'correctness']; }), /did not cover security/],
    [mutate(e => { e.review.tasks = []; }), /review must cover exactly/],
    [mutate(e => { e.tasks = ['T-0001', 'T-0009']; }), /name exactly/],
    [mutate(e => { e.review.report = ''; }), /report/],
    [mutate(e => { e.assurance = 'authenticated'; }), /assurance/],
  ];
  for (const [e, pattern] of cases) blocked(evaluateDelegation(input({ evidence: e })), pattern);
  blocked(evaluateDelegation(input({ requiredChecks: [] })), /no required checks/);
  const withOwner = evaluateDelegation(input({ evidence: null, ownerApproved: true }));
  assert.deepEqual([withOwner.ok, withOwner.approval_basis], [true, 'owner-review'], 'authenticated owner approval is the fallback');
});

test('the evidence template holds placeholders only, which never pass', () => {
  const template = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../templates/delivery-evidence.json', import.meta.url)), 'utf8'));
  const errors = evidenceErrors({ evidence: template, revision: SHA, taskIds: ['T-0001'], owner: 'agent-worker', requiredChecks: ['wf ci'] });
  for (const pattern of [/not for this candidate/, /did not pass/, /separate context/, /inherit/, /not resolved/, /report/]) assert.match(errors.join('\n'), pattern);
  blocked(evaluateDelegation(input({ evidence: template })));
});
