import test from 'node:test';
import assert from 'node:assert/strict';
import { readOwnerApproval } from '../lib/github-approval.js';
const revision = 'a'.repeat(40), baseline = 'b'.repeat(40);
const args = { repository: 'owner/repo', pullRequest: 12, revision, baseline, branch: 'main', approver: 'Owner', worker: 'worker' };
const pr = { number: 12, state: 'open', draft: false, head: { sha: revision, repo: { full_name: 'owner/repo' } }, base: { sha: baseline, ref: 'main', repo: { full_name: 'owner/repo' } }, updated_at: '2026-09-30T00:00:00Z' };
const review = { id: 1, user: { login: 'Owner' }, state: 'APPROVED', commit_id: revision, submitted_at: '2026-09-30T00:00:00Z' };
function check({ pull = pr, reviews = [review], current = pull, ...options } = {}) {
  let reads = 0;
  return readOwnerApproval({ ...args, get: endpoint => endpoint.includes('/reviews?') ? reviews : reads++ ? current : pull, ...options });
}
test('only an authenticated exact-head owner review grants owner approval', () => {
  assert.equal(check().approved, true);
  assert.equal(check({ reviews: [{ ...review, user: { login: 'worker' } }] }).approved, false);
  assert.equal(check({ reviews: [{ ...review, commit_id: baseline }] }).approved, false);
  assert.equal(check({ reviews: [] }).approved, false);
});
test('dismissal and a later change request supersede an earlier approval; comments do not grant or revoke approval', () => {
  for (const state of ['CHANGES_REQUESTED', 'DISMISSED']) assert.equal(check({ reviews: [review, { ...review, id: 2, state }] }).approved, false);
  assert.equal(check({ reviews: [{ ...review, state: 'COMMENTED' }] }).approved, false);
  assert.equal(check({ reviews: [review, { ...review, id: 2, state: 'COMMENTED' }] }).approved, true);
});
test('wrong candidate, baseline, branch, repo, fork, draft or closed PR supplies no authority', () => {
  const bad = [ { ...pr, state: 'closed' }, { ...pr, draft: true }, { ...pr, head: { ...pr.head, sha: baseline } }, { ...pr, base: { ...pr.base, sha: revision } }, { ...pr, base: { ...pr.base, ref: 'other' } }, { ...pr, head: { ...pr.head, repo: { full_name: 'fork/repo' } } }, { ...pr, base: { ...pr.base, repo: { full_name: 'other/repo' } } } ];
  for (const pull of bad) assert.equal(check({ pull }).approved, false);
});
test('changed PR and duplicate review pages cannot supply approval', () => {
  assert.equal(check({ current: { ...pr, updated_at: 'later' } }).approved, false);
  assert.throws(() => check({ reviews: [review, review] }), /duplicate/);
});
test('invalid identities, selectors or API errors fail closed', () => {
  for (const opts of [{ approver: 'worker' }, { revision: 'HEAD' }, { pullRequest: '../1' }, { repository: '../repo' }, { approver: '' }, { branch: '' }]) assert.throws(() => check(opts));
  assert.throws(() => check({ get: () => { throw new Error('API failed'); } }), /API failed/);
});

test('delivery evidence comes from the latest marked worker comment and never grants owner approval', async () => {
  const { readDeliveryEvidence, DELIVERY_MARKER } = await import('../lib/github-approval.js');
  const input = { repository: 'owner/repo', pullRequest: 12, worker: 'worker' };
  const comment = (id, user, value) => ({ id, user: { login: user }, body: DELIVERY_MARKER + '\n' + JSON.stringify(value) });
  const value = { candidate: revision, owner_approved: true };
  const got = readDeliveryEvidence({ ...input, get: () => [comment(1, 'worker', value), comment(2, 'outsider', { fake: true })] });
  assert.deepEqual(got.evidence, value, 'untrusted fields remain data for the evaluator to reject');
  assert.equal(got.approved, undefined);
  assert.match(got.source, /issuecomment-1$/);
  assert.equal(readDeliveryEvidence({ ...input, get: () => [comment(2, 'outsider', value)] }).evidence, null);
  assert.throws(() => readDeliveryEvidence({ ...input, get: () => [comment(1, 'worker', value), { id: 2, user: { login: 'worker' }, body: DELIVERY_MARKER + '\ninvalid' }] }), /latest.*not valid JSON/);
  assert.deepEqual(readDeliveryEvidence({ ...input, get: () => [comment(1, 'worker', value), comment(2, 'worker', { candidate: baseline })] }).evidence, { candidate: baseline }, 'never falls back to the older matching report');
});
