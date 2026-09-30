import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDelivery } from '../lib/delivery-check.js';
const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const opts = { repository: 'fixture/project', revision: sha, workflow: '.github/workflows/verify.yml', branch: 'main', requiredChecks: ['verify'] };
const run = { id: 1, run_number: 1, run_attempt: 1, head_sha: sha, head_branch: 'main', event: 'push', path: opts.workflow, repository: { full_name: 'fixture/project' }, status: 'completed', conclusion: 'success', updated_at: '2026-09-30T00:00:00Z' };
const job = { id: 1, run_id: 1, head_sha: sha, name: 'verify', status: 'completed', conclusion: 'success' };
function snapshot({ runs = [run], jobs = [job], current = runs[0] } = {}) {
  const endpoints = [];
  const get = endpoint => {
    endpoints.push(endpoint);
    if (endpoint.includes('/runs?')) return { total_count: runs.length, workflow_runs: runs };
    if (endpoint.includes('/jobs?')) return { total_count: jobs.length, jobs };
    return current;
  };
  return { get, endpoints };
}
const check = (data, args = {}) => checkDelivery({ ...opts, ...snapshot(data), ...args });
test('exact-revision green requires the named workflow, event, branch and required jobs', () => {
  const s = snapshot();
  const r = checkDelivery({ ...opts, ...s });
  assert.equal(r.ok, true);
  assert.equal(r.run.attempt, 1);
  assert.match(r.limitation, /does not identify the deployed artifact/);
  assert.equal(s.endpoints.length, 3, 'bounded query, jobs and race check, no polling loop');
  assert.match(s.endpoints[0], /head_sha=aaa.*branch=main&event=push/);
});
test('missing, other-revision, pull-request, other-branch and other-repository runs are not delivered-main evidence', () => {
  for (const runs of [[], [{ ...run, head_sha: other }], [{ ...run, event: 'pull_request' }], [{ ...run, head_branch: 'feature' }], [{ ...run, path: '.github/workflows/fake.yml' }], [{ ...run, repository: { full_name: 'other/project' } }]]) assert.equal(check({ runs }).ok, false);
});
test('a newer pending or failed run cannot be replaced with an earlier green run', () => {
  for (const conclusion of [null, 'failure', 'cancelled', 'timed_out', 'skipped', 'neutral']) {
    const later = { ...run, id: 2, run_number: 2, conclusion, status: conclusion ? 'completed' : 'queued' };
    const r = check({ runs: [run, later], jobs: [{ ...job, run_id: 2 }], current: later });
    assert.equal(r.ok, false);
    assert.equal(r.run.id, 2);
  }
});
test('a rerun attempt must still pass and cannot change while the snapshot is collected', () => {
  assert.equal(check({ current: { ...run, run_attempt: 2 } }).ok, false);
  assert.equal(check({ current: { ...run, status: 'in_progress', conclusion: null } }).ok, false);
  assert.equal(check({ current: { ...run, updated_at: '2026-09-30T00:01:00Z' } }).ok, false);
});
test('missing, skipped, duplicate-named and failing required jobs block even if run says success', () => {
  for (const jobs of [[], [{ ...job, name: 'other' }], [{ ...job, conclusion: 'skipped' }], [{ ...job, conclusion: 'failure' }], [job, { ...job, id: 2 }]]) assert.equal(check({ jobs }).ok, false);
  assert.throws(() => check({ jobs: [{ ...job, head_sha: other }] }), /do not belong/);
});
test('incomplete, duplicate or changing pagination cannot silently drop a failing check', () => {
  assert.throws(() => check(undefined, { get: () => ({ total_count: 1, workflow_runs: [] }) }), /pagination/);
  assert.throws(() => check({ runs: [run, run] }), /duplicate/);
  const get = endpoint => {
    if (endpoint.includes('/runs?')) return { total_count: 1, workflow_runs: [run] };
    if (endpoint.includes('/jobs?')) return { total_count: 101, jobs: endpoint.endsWith('&page=1') ? Array.from({ length: 100 }, (_, id) => ({ ...job, id, name: `job-${id}` })) : [{ ...job, id: 100, conclusion: 'failure' }] };
    return run;
  };
  assert.equal(check(undefined, { get }).ok, false, 'required failure on the second page is included');
});
test('ambiguous identities and invalid arguments fail closed before any network read', () => {
  for (const args of [{ revision: 'main' }, { repository: '../project' }, { workflow: '../../fake' }, { branch: '' }, { requiredChecks: [] }, { requiredChecks: ['verify', 'verify'] }, { event: 'unknown' }]) assert.throws(() => check(undefined, { ...args, get: () => { assert.fail('no request for invalid args'); } }));
  assert.throws(() => check(undefined, { get: () => { throw new Error('API unavailable'); } }), /API unavailable/);
});
