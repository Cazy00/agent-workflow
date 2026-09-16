import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const wrapper = fileURLToPath(new URL('../../bin/wf', import.meta.url));
function setup(t) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wf-wrapper-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const workflow=path.join(temp,'workflow');fs.mkdirSync(path.join(workflow,'validator'),{recursive:true});
  const git=(...args)=>{const r=spawnSync('git',['-C',workflow,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  fs.writeFileSync(path.join(workflow,'validator/cli.js'),'console.log("approved executable");\n');
  git('add','.');git('commit','-qm','approved validator');const revision=git('rev-parse','HEAD');
  fs.writeFileSync(path.join(workflow,'validator/cli.js'),'console.log("tampered cache executable");\n');
  const project=path.join(temp,'project');fs.mkdirSync(path.join(project,'docs/workflow'),{recursive:true});
  fs.writeFileSync(path.join(project,'docs/workflow/config.json'),JSON.stringify({workflow:{repo:'attacker/repo',revision:'attacker-ref'}}));
  const run=env=>spawnSync('bash',[wrapper,'records'],{cwd:project,encoding:'utf8',env:{...process.env,WF_LOCAL:'',WF_VALIDATOR_REPO:workflow,WF_VALIDATOR_REV:revision,...env}});
  return {run};
}
test('launcher uses pinned committed code despite changed cache files and candidate configuration', t=>{const p=setup(t);const r=p.run();assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'approved executable');});
test('launcher refuses local executable override',t=>{const p=setup(t);const r=p.run({WF_LOCAL:'/tmp/untrusted'});assert.equal(r.status,2);assert.equal(r.stdout,'');});
test('launcher refuses symbolic or abbreviated adoption references',t=>{const p=setup(t);assert.equal(p.run({WF_VALIDATOR_REV:'main'}).status,2);});
