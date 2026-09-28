import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { preflightScaffoldTargets } from '../../adapters/speckit/scaffold.mjs';
function project(t) {const repo=fs.mkdtempSync(path.join(os.tmpdir(),'wf-speckit-targets-'));t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));return repo;}
test('optional scaffold refuses conflicting file/directory types before setup writes',t=>{
 for(const [rel,directory] of [['.gitignore',true],['AGENTS.md',true],['docs/workflow/setup.md',true],['.cache/agent-workflow',false],['docs/workflow/tasks',false]]) {
  const repo=project(t),target=path.join(repo,rel);fs.mkdirSync(path.dirname(target),{recursive:true});
  if(directory)fs.mkdirSync(target);else fs.writeFileSync(target,'user content');
  assert.throws(()=>preflightScaffoldTargets({project:repo,coreRevision:'a'.repeat(40)}),/incompatible/);
  assert.equal(fs.existsSync(path.join(repo,'docs/workflow/config.json')),false);
  if(!directory)assert.equal(fs.readFileSync(target,'utf8'),'user content');
 }
});
test('optional scaffold retains only the exact clean existing installation cache',t=>{
 const repo=project(t),cache=path.join(repo,'.cache/agent-workflow');fs.mkdirSync(cache,{recursive:true});
 assert.throws(()=>preflightScaffoldTargets({project:repo,coreRevision:'a'.repeat(40)}),/not a pinned/);
 const git=(...args)=>{const r=spawnSync('git',['-C',cache,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git('init','-q');fs.writeFileSync(path.join(cache,'source'),'pinned');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','commit','-qm','fixture');
 const revision=git('rev-parse','HEAD');
 assert.throws(()=>preflightScaffoldTargets({project:repo,coreRevision:'a'.repeat(40)}),/exact clean pin/);
 assert.doesNotThrow(()=>preflightScaffoldTargets({project:repo,coreRevision:revision}));
 fs.writeFileSync(path.join(cache,'source'),'changed');
 assert.throws(()=>preflightScaffoldTargets({project:repo,coreRevision:revision}),/exact clean pin/);
});
