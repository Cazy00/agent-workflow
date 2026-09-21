import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareNodeEvidence} from '../lib/evidence.js';
const revision='a'.repeat(40),root='/fixture';
const opts={revision,repository:'fixture/project',environment:'isolated fixture',checkName:'unit',expiresAt:'2099-01-01T00:00:00Z',projectRoot:root};
const events=(extra={})=>[{type:'wf:context',revision,clean:true},{type:'test:pass',data:{file:'/fixture/test.js',name:'required behavior',...extra}},{type:'wf:complete',revision,clean:true,count:1}];
const raw=x=>x.map(r=>JSON.stringify(r)).join('\n')+'\n';
test('evidence preparation preserves exact results and raw artifacts without signing',()=>{
 const r=prepareNodeEvidence({...opts,raw:raw(events())});assert.equal(r.ok,true);assert.equal(r.draft,true);assert.equal(r.payload.execution.tests[0].file,'test.js');assert.equal(r.signature,undefined);assert.equal(Object.values(r.payload.artifacts)[0],raw(events()));
});
test('skipped, failed, stale, dirty, duplicate and truncated execution cannot become passing evidence',()=>{
 assert.equal(prepareNodeEvidence({...opts,raw:raw(events({skip:true}))}).ok,false);
 const failed=events();failed[1].type='test:fail';assert.equal(prepareNodeEvidence({...opts,raw:raw(failed)}).ok,false);
 assert.throws(()=>prepareNodeEvidence({...opts,revision:'b'.repeat(40),raw:raw(events())}));
 const dirty=events();dirty[2].clean=false;assert.throws(()=>prepareNodeEvidence({...opts,raw:raw(dirty)}));
 const dup=events();dup.splice(2,0,dup[1]);dup.at(-1).count=2;assert.throws(()=>prepareNodeEvidence({...opts,raw:raw(dup)}),/duplicate/);
 assert.throws(()=>prepareNodeEvidence({...opts,raw:raw(events().slice(0,2))}),/incomplete/);
});
test('real Node reporter captures clean Git identity and produces usable CLI evidence',t=>{
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),'wf-reporter-'));t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));
 const git=(...args)=>{const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(repo,'test.cjs'),"const test=require('node:test');const assert=require('node:assert/strict');test('rule',()=>assert.equal(2+2,4));\n");
 git('add','.');git('-c','core.hooksPath=/dev/null','commit','-qm','fixture');const rev=git('rev-parse','HEAD');
 const reporter=fileURLToPath(new URL('../reporters/node-test.js',import.meta.url));
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const r=spawnSync(process.execPath,['--test',`--test-reporter=${reporter}`,'test.cjs'],{cwd:repo,encoding:'utf8',env});assert.equal(r.status,0,r.stderr);
 const result=prepareNodeEvidence({...opts,revision:rev,projectRoot:fs.realpathSync(repo),raw:r.stdout});assert.equal(result.ok,true);assert.equal(result.summary.tests,1);assert.equal(result.payload.execution.tests[0].name,'rule');
 const log=path.join(os.tmpdir(),`wf-evidence-${Date.now()}-${process.pid}.ndjson`);t.after(()=>fs.rmSync(log,{force:true}));fs.writeFileSync(log,r.stdout);
 const cli=fileURLToPath(new URL('../cli.js',import.meta.url));
 const converted=spawnSync(process.execPath,[cli,'prepare-evidence','--raw-log',log,'--candidate',rev,'--repo',repo,'--repository','fixture/project','--environment','isolated','--check-name','unit','--expires-at',opts.expiresAt],{encoding:'utf8'});
 assert.equal(converted.status,0,converted.stderr);assert.equal(JSON.parse(converted.stdout).draft,true);
});
