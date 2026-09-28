import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirSource, gitSource } from '../../validator/lib/sources.js';
import { loadConfig } from '../../validator/lib/records.js';
import { resolveFeatureContext } from './context.mjs';
import { prepareDraftTasks, writeDraftBatch, validateDraftCandidate } from './task-plan.mjs';
import { collectAllocationSnapshot, validateAllocationSnapshot } from './allocation.mjs';
import { renderTaskProjection, verifyTaskProjection } from './projection.mjs';
import { contained, digest, read, writeNew } from './files.mjs';

function git(repo, args, accepted = [0]) {
  // check-ignore takes filesystem paths and rejects Git's literal pathspec
  // magic. Its input here is a validated, fixed feature/runtime path.
  const literal = args[0] === 'check-ignore' ? [] : ['--literal-pathspecs'];
  const r = spawnSync('git', [...literal,'-C',repo,...args], {encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  if (!accepted.includes(r.status)) throw new Error(`Git ${args[0]} operation failed`);
  return {code:r.status,stdout:r.stdout.trim()};
}
function withOperation(repo, fn) {
  const lock = git(repo,['rev-parse','--path-format=absolute','--git-path','wf-speckit-operation.lock']).stdout;
  try { fs.mkdirSync(lock); } catch (e) { if(e.code==='EEXIST') throw new Error('another operation or interrupted operation exists; inspect its Git-metadata intent before recovery');throw e; }
  let intent = false, complete = false;
  try {
    const result = fn(value => { fs.writeFileSync(path.join(lock,'intent.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});intent=true; });
    complete=true;return result;
  } finally {
    if (complete || !intent) fs.rmSync(lock,{recursive:true,force:true});
  }
}
export function writeDraftTasks({ repo, baseline, plan, openPulls, integration, python }) {
  return withOperation(repo, markIntent => {
    const contextArgs={repo,baseline,feature:plan.feature,milestone:plan.milestone,seeds:plan.tasks,integration,python};
    const context=resolveFeatureContext(contextArgs);
    const snapshot=collectAllocationSnapshot({repo,baseline,expectedSnapshot:openPulls});
    const config=loadConfig(gitSource(repo,baseline));
    validateAllocationSnapshot(snapshot,{repository:config.repository,baseline});
    const source=dirSource(repo);
    for(const p of [context.spec_path,context.plan_path]) if(!source.exists(p)) throw new Error(`missing canonical source: ${p}`);
    const drafts=prepareDraftTasks({plan,sourceDigest:context.source_digest,usedIds:snapshot.ids,exists:p=>{contained(repo,p);return source.exists(p);}});
    validateDraftCandidate({source,drafts});
    if(resolveFeatureContext(contextArgs).source_digest!==context.source_digest) throw new Error('canonical sources changed during allocation; refresh before writing');
    validateAllocationSnapshot(snapshot,{repository:config.repository,baseline});
    markIntent({schema:'wf-speckit-draft-intent/v1',baseline,plan_digest:digest(plan),allocation_digest:digest(snapshot),drafts});
    const created=writeDraftBatch({repo,drafts});
    return {created,allocation_digest:digest(snapshot),snapshot,authority:'draft-only',publication:'recheck live ID collisions before publishing'};
  });
}
function requireIgnored(repo, rel) {
  contained(repo,rel);
  if(git(repo,['ls-files','--error-unmatch','--',rel],[0,1]).code===0) throw new Error(`projection/runtime path is tracked: ${rel}`);
  if(git(repo,['check-ignore','--no-index','-q','--',rel],[0,1]).code!==0) throw new Error(`projection/runtime path must be explicitly ignored: ${rel}`);
}
export function taskProjection({repo,baseline,feature,task,integration,python,write=false,regenerate=false}) {
  const execute = markIntent => {
    const context=resolveFeatureContext({repo,baseline,feature,integration,python});
    const args={sources:context.sources,selectedTask:task,lockDigest:context.lock_digest};
    const relative=`${feature}/tasks.md`,target=contained(repo,relative);
    requireIgnored(repo,relative);
    const previous=fs.existsSync(target)?read(repo,relative).toString('utf8'):null;
    if(!write) return previous===null?{ok:false,reasons:['projection_missing']}:verifyTaskProjection({...args,bytes:previous});
    const rendered=renderTaskProjection(args);
    let recovery=null;
    if(previous!==null && previous!==rendered.bytes && !regenerate) throw new Error('projection differs; explicitly regenerate to preserve a recovery copy before replacing it');
    if(previous!==rendered.bytes) {
      if(previous!==null) { recovery=`${feature}/.wf-speckit/recovery/${randomUUID()}.md`;requireIgnored(repo,recovery); }
      const temporary=`${feature}/.wf-speckit/${randomUUID()}.tmp`;requireIgnored(repo,temporary);
      markIntent({schema:'wf-speckit-projection-intent/v1',relative,previous_digest:previous===null?null:digest(previous),recovery,temporary,source_digest:rendered.sourceDigest});
      if(recovery)writeNew(repo,recovery,previous);
      writeNew(repo,temporary,rendered.bytes);
      if((fs.existsSync(target)?read(repo,relative).toString('utf8'):null)!==previous) throw new Error('projection changed concurrently; inspect recovery and temporary files');
      fs.renameSync(contained(repo,temporary),target);
    }
    return {path:relative,source_digest:rendered.sourceDigest,content_digest:rendered.contentDigest,recovery,authority:'derived-only'};
  };
  return write?withOperation(repo,execute):execute(()=>{});
}
