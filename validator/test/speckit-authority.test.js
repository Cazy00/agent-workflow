import test from 'node:test';
import assert from 'node:assert/strict';
import { authorityMetadata, renderAuthorityPointer } from '../../adapters/speckit/authority.mjs';

test('authority pointer binds both canonical contents and core revision without copying policy',()=>{
 const input={coreRevision:'a'.repeat(40),policyText:'Policy requiring approval',profileText:'Project delegation'};
 const metadata=authorityMetadata(input),pointer=renderAuthorityPointer(metadata);
 assert.match(pointer,/not an independent constitution/);assert.match(pointer,/docs\/workflow\/profile.md/);
 assert.doesNotMatch(pointer,/Policy requiring approval/);assert.doesNotMatch(pointer,/Project delegation/);
 for(const delta of [{policyText:'Changed policy'},{profileText:'Changed profile'},{coreRevision:'b'.repeat(40)}])
  assert.notEqual(renderAuthorityPointer(authorityMetadata({...input,...delta})),pointer);
 assert.throws(()=>renderAuthorityPointer({...metadata,profile:{path:'other.md',sha256:metadata.profile.sha256}}),/invalid/);
});
