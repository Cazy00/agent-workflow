import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectAllocationSnapshot } from '../../adapters/speckit/allocation.mjs';
import { fakeExecutable } from './helpers.js';

function fixture(t,scenario='normal') {
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wf-speckit-allocation-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const source=path.join(temp,'source'),bin=path.join(temp,'bin');fs.mkdirSync(source);fs.mkdirSync(bin);
 const realGit=spawnSync('which',['git'],{encoding:'utf8'}).stdout.trim();assert.ok(path.isAbsolute(realGit));
 const git=(repo,...args)=>{const r=spawnSync(realGit,['-C',repo,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 const write=(p,s)=>{fs.mkdirSync(path.dirname(path.join(source,p)),{recursive:true});fs.writeFileSync(path.join(source,p),s);};
 git(source,'init','-q','-b','main');git(source,'config','user.name','Fixture');git(source,'config','user.email','fixture@example.invalid');
 write('docs/workflow/config.json',JSON.stringify({repository:'fixture/project',trusted_branch:'main',approval:{agent_identity:'worker'},records_dir:'docs/workflow'}));
 write('docs/workflow/tasks/T-0017.md','retired task');git(source,'add','.');git(source,'-c','core.hooksPath=/dev/null','commit','-qm','initial');
 git(source,'rm','-q','docs/workflow/tasks/T-0017.md');git(source,'-c','core.hooksPath=/dev/null','commit','-qm','retire T-0017');
 const baseline=git(source,'rev-parse','HEAD');
 git(source,'checkout','-q','-b','codex/T-0020-fixture');write('docs/workflow/tasks/T-0042.md','PR task');git(source,'add','.');git(source,'-c','core.hooksPath=/dev/null','commit','-qm','PR');
 const head=git(source,'rev-parse','HEAD');git(source,'update-ref','refs/pull/7/head',head);git(source,'checkout','-q','main');
 git(source,'remote','add','origin','https://github.com/fixture/project.git');
 const pulls=[{number:7,title:'T-0020 fixture',head:{sha:scenario==='head-moved'?'a'.repeat(40):head,ref:'codex/T-0020-fixture'},base:{repo:{full_name:'fixture/project'}}}];
 const count=path.join(temp,'requests');
 fakeExecutable(path.join(bin,'gh'),`const fs=require('fs');const args=process.argv.slice(2);const endpoint=args.at(-1);let value;
 if(endpoint==='user')value={login:'worker'};
 else if(endpoint==='repos/fixture/project')value={full_name:'fixture/project',owner:{type:'User',login:'fixture'}};
 else if(endpoint.startsWith('repos/fixture/project/pulls?')){let n=fs.existsSync(${JSON.stringify(count)})?+fs.readFileSync(${JSON.stringify(count)},'utf8'):0;fs.writeFileSync(${JSON.stringify(count)},String(n+1));value=${JSON.stringify(scenario==='incomplete'?[]:[pulls])};if(${JSON.stringify(scenario)}==='pull-moved'&&n>0)value[0][0].head.sha='b'.repeat(40);}
 else process.exit(91);process.stdout.write(JSON.stringify(value));\n`);
 fakeExecutable(path.join(bin,'git'),`const {spawnSync}=require('child_process');let args=process.argv.slice(2).map(x=>x==='https://github.com/fixture/project.git'?${JSON.stringify(source)}:x);if(args.some(x=>/^https?:/.test(x)))process.exit(92);let r=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});process.exit(r.status??93);\n`);
 const originalPath=process.env.PATH;process.env.PATH=bin+path.delimiter+originalPath;t.after(()=>{process.env.PATH=originalPath;});
 return {source,baseline,git,temp,collect:()=>collectAllocationSnapshot({repo:source,baseline,token:'synthetic-no-authority-token'})};
}
test('live allocation route scans retired history, PR heads and claims without using caller declarations',t=>{
 const f=fixture(t),snapshot=f.collect();
 assert.deepEqual(snapshot.ids,['T-0017','T-0020','T-0042']);assert.equal(snapshot.complete,true);assert.equal(snapshot.pulls[0].available,true);
 assert.equal(fs.existsSync(path.join(f.source,'docs/workflow/tasks/T-0042.md')),false,'retrieval never writes a PR head into the project');
});
for(const scenario of ['incomplete','head-moved','pull-moved'])test(`allocation stops for ${scenario} with real local Git history`,t=>{
 const f=fixture(t,scenario);assert.throws(()=>f.collect(),/incomplete|moved|changed/);
});
test('allocation rejects a shallow client before requesting remote authority',t=>{
 const f=fixture(t),clone=path.join(f.temp,'shallow');
 const r=spawnSync('git',['clone','--quiet','--depth','1',`file://${f.source}`,clone],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 assert.throws(()=>collectAllocationSnapshot({repo:clone,baseline:f.baseline,token:'synthetic'}),/full local history/);
});

test('allocation reserves unpublished local claims and deleted local history IDs',t=>{
 const f=fixture(t),client=path.join(f.temp,'client');
 f.git(f.temp,'clone','--quiet',f.source,client);
 f.git(client,'config','user.name','Fixture');f.git(client,'config','user.email','fixture@example.invalid');
 f.git(client,'remote','set-url','origin','https://github.com/fixture/project.git');
 f.git(client,'checkout','-q','-b','codex/T-0099-local-claim');
 fs.mkdirSync(path.join(client,'docs/workflow/tasks'),{recursive:true});
 fs.writeFileSync(path.join(client,'docs/workflow/tasks/T-0088.md'),'retired local task');
 f.git(client,'add','.');f.git(client,'-c','core.hooksPath=/dev/null','commit','-qm','local task');
 f.git(client,'rm','-q','docs/workflow/tasks/T-0088.md');f.git(client,'-c','core.hooksPath=/dev/null','commit','-qm','retire local task');
 f.git(client,'checkout','-q','main');
 const snapshot=collectAllocationSnapshot({repo:client,baseline:f.baseline,token:'synthetic-no-authority-token'});
 assert.deepEqual(snapshot.ids,['T-0017','T-0020','T-0042','T-0088','T-0099']);
});
