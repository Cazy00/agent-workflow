#!/usr/bin/env node
import fs from 'node:fs';
import { Blocked } from './speckit/errors.mjs';
import { pathToFileURL } from 'node:url';
import { verifyInstallation } from './speckit/verify.mjs';
export { verifyInstallation } from './speckit/verify.mjs';

import path from 'node:path';
import { resolveFeatureContext, verifyAdoptedInstallation } from './speckit/context.mjs';
import { collectAllocationSnapshot } from './speckit/allocation.mjs';
import { writeDraftTasks, taskProjection } from './speckit/operations.mjs';
import { proposeAuthority, activateIntegration } from './speckit/maintenance.mjs';
export { resolveFeatureContext } from './speckit/context.mjs';
export { writeDraftTasks } from './speckit/operations.mjs';
export { renderTaskProjection, verifyTaskProjection } from './speckit/projection.mjs';

const commands = {
  'check-install': ['repo','integration','lock','python'],
  'context': ['repo','integration','baseline','feature','python'],
  'allocation-snapshot': ['repo','baseline','integration','python'],
  'propose-authority': ['repo','baseline','integration','python'],
  'activate': ['repo','baseline','integration','python'],
  'write-tasks': ['repo','integration','baseline','plan','open-pulls','python'],
  'project': ['repo','integration','baseline','feature','task','python'],
  'check-projection': ['repo','integration','baseline','feature','task','python'],
};
function externalJson(file,repo) {
  const resolved=fs.realpathSync(file),root=fs.realpathSync(repo),relative=path.relative(root,resolved);
  if(relative===''||(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))) throw new Error('temporary plan/allocation JSON must stay outside the repository');
  if(fs.statSync(resolved).size>1024*1024)throw new Error('temporary JSON exceeds 1 MiB');
  return JSON.parse(fs.readFileSync(resolved,'utf8'));
}
export function main(argv) {
  try {
    const [command,...rest]=argv,required=commands[command];
    if(!required)throw new Error('unknown adapter command');
    const optional=command==='context'?['milestone','plan']:command==='project'?['regenerate']:[];
    const options={};
    for(let i=0;i<rest.length;i++) {
      const key=rest[i]?.replace(/^--/,'');
      if(!rest[i].startsWith('--')||![...required,...optional].includes(key)||key in options)throw new Error(`unknown or duplicate option: ${rest[i]}`);
      if(key==='regenerate'){options[key]=true;continue;}
      if(!rest[i+1]||rest[i+1].startsWith('--'))throw new Error(`missing value: ${rest[i]}`);
      options[key]=rest[++i];
    }
    for(const key of required)if(!options[key])throw new Error(`required option: --${key}`);
    let result;
    if(command==='check-install')result=verifyInstallation({...options,lock:JSON.parse(fs.readFileSync(options.lock,'utf8'))});
    else if(command==='propose-authority')result=proposeAuthority(options);
    else if(command==='activate')result=activateIntegration(options);
    else if(command==='allocation-snapshot'){verifyAdoptedInstallation(options);result=collectAllocationSnapshot(options);}
    else if(command==='context') {
      const plan=options.plan?externalJson(options.plan,options.repo):null;
      const context=resolveFeatureContext({...options,milestone:plan?.milestone??options.milestone,seeds:plan?.tasks??[]});
      const {sources,...summary}=context;result={...summary,source_count:sources.length};
    } else if(command==='write-tasks')result=writeDraftTasks({...options,plan:externalJson(options.plan,options.repo),openPulls:externalJson(options['open-pulls'],options.repo)});
    else result=taskProjection({...options,write:command==='project'});
    return {code:result.ok===false?1:0,result};
  } catch(error){return {code:error instanceof Blocked?1:2,result:{ok:false,error:error.message}};}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, result } = main(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = code;
}
