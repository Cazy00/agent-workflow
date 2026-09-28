import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { verifyAdoptedInstallation } from './context.mjs';
import { withOperation } from './operations.mjs';
import { authorityMetadata, renderAuthorityPointer, readPinnedPolicy } from './authority.mjs';
import { verifyInstallation } from './verify.mjs';
import { cleanEnvironment } from './runtime.mjs';
import { contained, read, sha256, digest } from './files.mjs';
import { loadRecord } from '../../validator/lib/records.js';
import { Blocked } from './errors.mjs';

const POINTER='.specify/memory/constitution.md', METADATA='.specify/memory/.constitution-template.json';
function pointerFiles(authority) {
  const text=renderAuthorityPointer(authority);
  return [{path:POINTER,text},{path:METADATA,text:JSON.stringify({sha256:sha256(text),source:'preset:agent-workflow'},null,2)+'\n'}];
}

// Only draft bytes. Does not modify the project or grant an adoption/approval.
// Working profile drift is permitted here, never in a planning context.
export function proposeAuthority(args) {
  const {lock}=verifyAdoptedInstallation({...args,allowWorkingProfileDrift:true});
  const profileText=read(args.repo,'docs/workflow/profile.md').toString('utf8');
  const profile=loadRecord({read:()=>profileText},'docs/workflow/profile.md','profile');
  if(profile.errors.length || (profile.data.owners?.length ?? 0)>0) throw new Error('authority proposal requires a valid one-owner profile');
  const authority=authorityMetadata({coreRevision:lock.core.revision,policyText:readPinnedPolicy(lock.core.revision),profileText});
  const files=pointerFiles(authority), proposed=structuredClone(lock);
  proposed.authority=authority;
  for(const file of files) {
    const entry=proposed.managed_files.find(f=>f.path===file.path);
    entry.sha256=sha256(file.text);delete entry.integration_sha256;
  }
  files.push({path:'docs/workflow/speckit.lock.json',text:JSON.stringify(proposed,null,2)+'\n'});
  return {authority:'proposal-only',changed:files.some(f=>!read(args.repo,f.path).equals(Buffer.from(f.text))),files,
    next:'Review these bytes with the governing profile change under the existing owner approval rules; context stays blocked until that exact baseline is adopted.'};
}

// Switch only the preapproved byte variants after verifying the whole current
// installation. Restore Codex before a task checkpoint, leaving no shared-file
// switching diff to misclassify as a new instruction change.
export function activateIntegration({repo,baseline,integration,python}) {
  if(!['codex','claude'].includes(integration)) throw new Error('unsupported integration');
  return withOperation(repo,markIntent=>{
    const previous=JSON.parse(read(repo,'.specify/integration.json')).integration;
    const {lock}=verifyAdoptedInstallation({repo,baseline,integration:previous,python,allowWorkingProfileDrift:true});
    if(previous===integration)return {integration,changed:false,authority:'local-integrity-only'};
    markIntent({schema:'wf-speckit-activation-intent/v1',baseline,from:previous,to:integration,lock_digest:digest(lock)});
    const launch="import pathlib,sys; sys.path.insert(0,str(pathlib.Path(sys.executable).parent.parent/'lib'/('python%d.%d'%sys.version_info[:2])/'site-packages')); from specify_cli import main; main()";
    const result=spawnSync(python,['-I','-S','-c',launch,'integration','use',integration],{cwd:repo,env:cleanEnvironment(),encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
    if(result.error || result.status!==0)throw new Error('integration activation failed; inspect retained Git-metadata intent');
    // Upstream refresh may reset the template pointer. Restore only the exact
    // deterministic bytes already admitted by the baseline lock.
    for(const file of pointerFiles(lock.authority)) {
      if(lock.managed_files.find(f=>f.path===file.path)?.sha256!==sha256(file.text))throw new Blocked('pointer restoration differs from approved lock');
      fs.writeFileSync(contained(repo,file.path),file.text);
    }
    const checked=verifyInstallation({repo,lock,integration,python});
    if(!checked.ok)throw new Blocked(checked.mismatches.join('; '));
    return {integration,changed:true,authority:'local-integrity-only',checkpoint:'Restore codex before committing; never commit runtime switching differences.'};
  });
}
