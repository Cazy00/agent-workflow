import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectIdentity } from '../../adapters/identity.mjs';
const expected = { repository: 'owner/project', worker: 'worker', branch: 'codex/T-0001-work' };
function route(user = 'worker') {
  return (tool, args) => {
    if (tool === 'gh' && args[1] === 'user') return JSON.stringify({ login: user });
    if (tool === 'gh') return JSON.stringify({ full_name: 'owner/project', owner: { login: 'owner', type: 'User' } });
    if (args.includes('ls-remote')) return 'a'.repeat(40) + '\tHEAD\n';
    if (args.includes('--show-current')) return expected.branch;
    if (args.includes('get-url')) return 'https://github.com/owner/project.git';
    throw new Error('unexpected route');
  };
}
test('explicit worker credential verifies API and HTTPS Git routes', () => assert.equal(inspectIdentity({ expected, token: 'fixture-token', run: route() }).ok, true));
test('missing worker credential stops before any owner credential fallback', () => {
  let contacted = false;
  const r = inspectIdentity({ expected, token: '', run: () => { contacted = true; throw new Error('owner route must not run'); } });
  assert.equal(r.ok, false); assert.equal(contacted, false);
});
test('owner identity cannot masquerade as worker access', () => assert.equal(inspectIdentity({ expected, token: 'fixture-token', run: route('owner') }).ok, false));
test('expired worker credential is a failure and does not trigger another account', () => {
  let calls = 0;
  const r = inspectIdentity({ expected, token: 'fixture-token', run: () => { calls++; throw new Error('401'); } });
  assert.equal(r.ok, false); assert.equal(calls, 1);
});
test('publishing to a different branch is rejected', () => assert.equal(inspectIdentity({ expected: { ...expected, branch: 'main' }, token: 'fixture-token', run: route() }).ok, false));
test('multiple push URLs cannot hide an unapproved second destination', () => {
  const original = route();
  // Match Git's actual contract: without --all only the first push URL is returned.
  const run = (tool, args) => args.includes('get-url')
    ? 'https://github.com/owner/project.git' + (args.includes('--all') ? '\nhttps://github.com/unrelated/repo.git\n' : '\n')
    : original(tool,args);
  assert.equal(inspectIdentity({expected,token:'fixture-token',run}).ok,false);
});
