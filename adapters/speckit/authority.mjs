import { digest, sha256 } from './files.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function readPinnedPolicy(revision) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('exact core revision required');
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const result=spawnSync('git',['-C',root,'show',`${revision}:POLICY.md`],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  if(result.status!==0)throw new Error('pinned core policy is unavailable in the trusted adapter installation');
  return result.stdout;
}


export function authorityMetadata({ coreRevision, policyText, profileText }) {
  if (!/^[a-f0-9]{40}$/.test(coreRevision) || typeof policyText !== 'string' || typeof profileText !== 'string') throw new Error('exact core and canonical policy/profile sources required');
  return { schema:'wf-speckit-authority/v1', core_revision:coreRevision,
    policy:{path:'POLICY.md',sha256:sha256(policyText)}, profile:{path:'docs/workflow/profile.md',sha256:sha256(profileText)} };
}
export function renderAuthorityPointer(authority) {
  if(authority?.schema!=='wf-speckit-authority/v1'||!/^[a-f0-9]{40}$/.test(authority.core_revision)||authority.policy?.path!=='POLICY.md'||authority.profile?.path!=='docs/workflow/profile.md'||
    !/^[a-f0-9]{64}$/.test(authority.policy.sha256)||!/^[a-f0-9]{64}$/.test(authority.profile.sha256)) throw new Error('invalid authority pointer metadata');
  return ['# Workflow authority pointer','',`source_digest: ${digest(authority)}`,'',
    'This generated entry is not an independent constitution and grants no approval.',
    `Read the trusted installed POLICY.md at core revision ${authority.core_revision}.`,
    `Policy SHA-256: ${authority.policy.sha256}.`,
    'Read project docs/workflow/profile.md; policy governs conflicts.',
    `Profile SHA-256: ${authority.profile.sha256}.`,
    'Use the native workflow to propose changes. Update this pointer and its protected lock in the same reviewed change as its governing sources.',
    'Command completion, a matching digest and a Ready field never establish owner approval.',''].join('\n');
}
