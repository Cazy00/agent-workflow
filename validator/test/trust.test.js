import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createTrust } from '../lib/trust.js';
const keys = generateKeyPairSync('ed25519');
const repository = 'owner/project';
const payload = { purpose: 'baseline', repository, revision: 'a'.repeat(40), expires_at: '2099-01-01T00:00:00Z' };
const envelope = data => ({ payload: data, signature: sign(null, Buffer.from(JSON.stringify(data)), keys.privateKey).toString('base64') });
const trust = (items, key = keys.publicKey) => createTrust({ publicKey: key, repository, envelopes: items });
test('owner-signed exact revision provides approval evidence', () => assert.equal(trust([envelope(payload)]).allows('baseline', payload.revision), true));
test('a self-declared passed or approved field supplies no approval', () => assert.equal(trust([{ payload, passed: true, approved: true }]).allows('baseline', payload.revision), false));
test('altered approval content is rejected', () => { const e = envelope(payload); e.payload = { ...payload, revision: 'b'.repeat(40) }; assert.equal(trust([e]).allows('baseline', e.payload.revision), false); });
test('wrong key, purpose, repository, revision and expired approvals are rejected', () => {
  assert.equal(trust([envelope(payload)], generateKeyPairSync('ed25519').publicKey).allows('baseline', payload.revision), false);
  assert.equal(trust([envelope(payload)]).allows('release', payload.revision), false);
  assert.equal(trust([envelope({ ...payload, repository: 'other/repo' })]).allows('baseline', payload.revision), false);
  assert.equal(trust([envelope(payload)]).allows('baseline', 'b'.repeat(40)), false);
  assert.equal(trust([envelope({ ...payload, expires_at: '2000-01-01T00:00:00Z' })]).allows('baseline', payload.revision), false);
});
