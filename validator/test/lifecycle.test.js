import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLifecycle, evaluateSession } from '../lib/lifecycle.js';
import { fixtureTrust } from './helpers.js';
const candidate = { name: 'candidate', exists: p => p === 'evidence/log.txt', read: p => p === 'evidence/log.txt' ? 'Observed output' : null };
const scope = { owner: 'implementer', acceptance: ['AC-001-1'] };
const checks = { environment: 'isolated test environment', checks: [{ name: 'unit', result: 'passed', evidence: 'evidence/log.txt' }] };
const review = { purpose: 'review', revision: 'candidate', reviewer: 'reviewer', implementer: 'implementer', separate_context: 'review-context-42', evidence: 'evidence/log.txt', coverage: ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'], findings: [] };
function run(extra = [], stage = 'verify') { return evaluateLifecycle({ candidate, task: scope, requiredChecks: ['unit'], stage, trust: fixtureTrust(candidate, candidate, [{ purpose: 'verification', revision: 'candidate', ...checks }, ...extra]) }); }
test('independent review is required even after all implementation checks pass', () => assert.equal(run().ok, false));
test('verified checks and separate review allow technical completion', () => assert.equal(run([review]).ok, true));
test('implementer cannot substitute their own review', () => assert.equal(run([{ ...review, reviewer: 'implementer' }]).ok, false));
test('open material review findings block completion', () => assert.equal(run([{ ...review, findings: [{ severity: 'high', status: 'open' }] }]).ok, false));
test('changed candidate invalidates earlier review', () => assert.equal(run([{ ...review, revision: 'old-candidate' }]).ok, false));
test('acceptance needs assembled verification and owner decision', () => assert.equal(run([review], 'accept').ok, false));
test('release needs readiness and explicit authority beyond acceptance', () => assert.equal(run([review, { purpose: 'integration', revision: 'candidate', ...checks }, { purpose: 'acceptance', revision: 'candidate', scenarios: ['AC-001-1'], decision: 'accepted' }], 'release').ok, false));
test('clean exit and a status field alone are not progress', () => assert.equal(evaluateSession({ record: { outcome: 'verified-complete', exit_code: 0 }, candidate }).ok, false));
test('read-only findings are progress when evidence and next action are preserved', () => assert.equal(evaluateSession({ record: { outcome: 'progress', summary: 'Reproduced the validator bypass', evidence: ['evidence/log.txt'], next_action: 'Fix the reproduced gate', friction: 'F-0001' }, candidate }).ok, true));
test('a legitimate blocker is a valid session outcome', () => assert.equal(evaluateSession({ record: { outcome: 'blocked', prerequisite: 'D-0001', impact: 'Cannot implement payment rule', responsible: 'owner', next_action: 'Resolve D-0001', friction: 'none' }, candidate }).ok, true));
test('a limit outcome records usage and a saved checkpoint', () => assert.equal(evaluateSession({ record: { outcome: 'stopped-by-limit', next_action: 'Resume', friction: 'none' }, candidate }).ok, false));
test('integration stage requires a fresh assembled-candidate check receipt', () => assert.equal(run([review], 'integrate').ok, false));
test('an integration receipt permits the assembled verification stage', () => assert.equal(run([review, { purpose: 'integration', revision: 'candidate', ...checks }], 'integrate').ok, true));
test('signed raw post-commit evidence can be collected outside the tested tree', () => {
  const noLogs = { name: 'candidate', read: () => null };
  const artifacts = { 'evidence/log.txt': 'Raw execution and review output collected after the commit.' };
  const trust = fixtureTrust(noLogs, noLogs, [
    { purpose: 'verification', revision: 'candidate', ...checks, artifacts },
    { ...review, artifacts },
  ]);
  assert.equal(evaluateLifecycle({ candidate: noLogs, task: scope, requiredChecks: ['unit'], trust }).ok, true);
});
