import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {withState} from '../lib/operations-state.js';
const cli=fileURLToPath(new URL('../cli.js',import.meta.url));
function setup(t){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wf-operations-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const project=path.join(temp,'project');fs.mkdirSync(project);const state=path.join(temp,'runtime');const configFile=path.join(temp,'operations.json');
 const config={authorised:true,project_root:project,destination:'Cazy00/agent-workflow',worker:'worker',workflow:{version:'1.1.0-dev.0',revision:'a'.repeat(40)},tools:{codex:['0.155.1']},reports_per_session:2,survey_cooldown_hours:24,limits:{owner_minutes:10}};
 fs.writeFileSync(configFile,JSON.stringify(config));
 const event={id:randomUUID(),session_id:randomUUID(),tool:'codex',tool_version:'0.155.1',step:'readiness',code:'incorrect-block',impact:'minor',catalog_fit:'exact'};
 const input=path.join(temp,'event.json');fs.writeFileSync(input,JSON.stringify(event));
 const run=(args=[],overrides={})=>spawnSync(process.execPath,[cli,'report','--operations-config',configFile,'--state',state,'--repo',project,...args],{encoding:'utf8',env:{...process.env,WF_VALIDATOR_REV:config.workflow.revision,WF_WORKER_TOKEN:'',GH_TOKEN:'owner-canary-never-used',...overrides}});
 return {temp,project,state,configFile,config,event,input,run};
}
test('report CLI queues while readiness config is absent and auth never falls back',t=>{
 const p=setup(t);const r=p.run(['--record',p.input]);assert.equal(r.status,1,r.stderr);const out=JSON.parse(r.stdout);assert.equal(out.status,'queued');assert.equal(out.reason,'missing-worker-token');
 const state=JSON.parse(fs.readFileSync(path.join(p.state,'state.json'),'utf8'));assert.equal(state.reports[p.event.id].status,'queued');assert.deepEqual(fs.readdirSync(p.project),[]);
 const status=p.run(['--action','status','--report-id',p.event.id]);assert.equal(JSON.parse(status.stdout).id,p.event.id);
});
test('external configuration and pinned revision are required',t=>{
 const p=setup(t);assert.equal(p.run(['--record',p.input],{WF_VALIDATOR_REV:'b'.repeat(40)}).status,2);
 p.config.project_root=p.temp;fs.writeFileSync(p.configFile,JSON.stringify(p.config));assert.equal(p.run(['--record',p.input]).status,2);
});
test('private event content is rejected without queuing or publishing',t=>{
 const p=setup(t);fs.writeFileSync(p.input,JSON.stringify({...p.event,narrative:'PRIVATE-CANARY'}));const r=p.run(['--record',p.input]);assert.equal(r.status,2);assert.ok(!r.stdout.includes('PRIVATE-CANARY'));
});
test('runtime locking serialises calls and leaves persisted state readable',async t=>{
 const p=setup(t);fs.mkdirSync(p.state,{mode:0o700});let release;const hold=new Promise(r=>release=r);
 const first=withState(p.state,async(s,save)=>{s.project=p.project;save();await hold;});
 assert.throws(()=>withState(p.state,()=>{}),/locked/);release();await first;assert.ok(fs.existsSync(path.join(p.state,'state.json')));
});
test('runtime refuses symlink state files',async t=>{
 const p=setup(t);fs.mkdirSync(p.state,{mode:0o700});fs.symlinkSync(p.input,path.join(p.state,'state.json'));assert.throws(()=>withState(p.state,()=>{}),/state file/);
});
