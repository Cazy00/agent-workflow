import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {gitSource} from '../lib/sources.js';
import {evaluateReadiness} from '../lib/readiness.js';
import {fixtureTrust} from './helpers.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
function setup(t) {
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),'wf-freshness-'));t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));
 fs.cpSync(path.join(root,'fixtures/04a-accepted-decision-permits/baseline'),repo,{recursive:true});
 const git=(...args)=>{const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 const write=(p,s)=>{fs.mkdirSync(path.dirname(path.join(repo,p)),{recursive:true});fs.writeFileSync(path.join(repo,p),s);};
 const edit=(p,f)=>write(p,f(fs.readFileSync(path.join(repo,p),'utf8')));
 const commit=()=>{git('add','.');git('-c','core.hooksPath=/dev/null','commit','-qm','synthetic fixture');return git('rev-parse','HEAD');};
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');const initial=commit();
 edit('docs/workflow/tasks/T-0001.md',s=>s.replaceAll('fixture-rev',initial));commit();
 const run=()=>{const b=gitSource(repo,'HEAD');return evaluateReadiness({baseline:b,candidate:b,task:'T-0001',trust:fixtureTrust(b)});};
 assert.equal(run().outcome,'Ready');return {repo,write,edit,commit,run};
}
const decision=(id,extra)=>`---\nrecord: decision\nid: ${id}\nquestion: Fixture\ntype: decision\nowner: owner\nstatus: Open\nrequired_before: implement\n${extra}\n---\n`;
test('unrelated milestones and operational run logs do not invalidate readiness',t=>{
 const p=setup(t);const m=fs.readFileSync(path.join(p.repo,'docs/workflow/milestones/M-0001.md'),'utf8');
 p.write('docs/workflow/milestones/M-0002.md',m.replaceAll('M-0001','M-0002'));p.write('docs/workflow/runs/session.json','{"usage":20}');p.commit();assert.equal(p.run().outcome,'Ready');
});
test('new applicable decisions invalidate readiness without explicit task references',t=>{
 const p=setup(t);p.write('docs/workflow/decisions/D-0002.md',decision('D-0002','affects: [paths:src]'));p.commit();assert.ok(p.run().reasons.some(s=>s.includes('stale')));
});
test('new superseder invalidates readiness even without affects',t=>{
 const p=setup(t);p.write('docs/workflow/decisions/D-0002.md',decision('D-0002','supersedes: D-0001').replace('status: Open','status: Resolved'));p.commit();assert.ok(p.run().reasons.some(s=>s.includes('stale')));
});
test('removed applicable decision is compared from the old as well as new baseline',t=>{
 const p=setup(t);fs.unlinkSync(path.join(p.repo,'docs/workflow/decisions/D-0001.md'));p.commit();assert.ok(p.run().reasons.some(s=>s.includes('stale')));
});
test('feature readiness and milestone authority edits invalidate readiness',t=>{
 const p=setup(t);p.edit('docs/specs/feature.md',s=>s+'\nNew permission requirement.');p.commit();assert.ok(p.run().reasons.some(s=>s.includes('stale')));
});
test('new unrelated decision does not invalidate readiness',t=>{
 const p=setup(t);p.write('docs/workflow/decisions/D-0002.md',decision('D-0002','affects: [paths:unrelated]'));p.commit();assert.equal(p.run().outcome,'Ready');
});
test('actual extracted CLI runs with automatic module detection disabled',t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wf-real-wrapper-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const workflow=path.join(temp,'workflow');fs.mkdirSync(workflow);fs.cpSync(path.join(root,'validator'),path.join(workflow,'validator'),{recursive:true});
 const git=(...a)=>{const r=spawnSync('git',['-C',workflow,...a],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('add','.');git('-c','core.hooksPath=/dev/null','commit','-qm','fixture');const rev=git('rev-parse','HEAD');
 const project=path.join(temp,'project');fs.cpSync(path.join(root,'fixtures/04a-accepted-decision-permits/baseline'),project,{recursive:true});
 const cp=path.join(project,'docs/workflow/config.json');const c=JSON.parse(fs.readFileSync(cp,'utf8'));c.workflow={revision:rev};fs.writeFileSync(cp,JSON.stringify(c));
 const r=spawnSync('bash',[path.join(root,'bin/wf'),'records'],{cwd:project,encoding:'utf8',env:{...process.env,WF_VALIDATOR_REPO:workflow,WF_VALIDATOR_REV:rev,WF_LOCAL:'',NODE_OPTIONS:'--no-experimental-detect-module'}});
 assert.equal(r.status,0,r.stderr+r.stdout);assert.equal(JSON.parse(r.stdout).ok,true);
 // An explicit target must work even when the caller is outside that project.
 const opts={cwd:temp,encoding:'utf8',env:{...process.env,WF_VALIDATOR_REPO:workflow,WF_VALIDATOR_REV:rev,WF_LOCAL:'',NODE_OPTIONS:'--no-experimental-detect-module'}};
 const explicit=spawnSync('bash',[path.join(root,'bin/wf'),'records','--repo',project],opts);
 assert.equal(explicit.status,0,explicit.stderr+explicit.stdout);assert.equal(JSON.parse(explicit.stdout).ok,true);
 const duplicate=spawnSync('bash',[path.join(root,'bin/wf'),'records','--repo',project,'--repo',project],opts);
 assert.equal(duplicate.status,2);assert.match(duplicate.stderr,/duplicate option: --repo/);
 const missing=spawnSync('bash',[path.join(root,'bin/wf'),'records','--repo'],opts);
 assert.equal(missing.status,2);assert.match(missing.stderr,/missing value.*--repo/);
});
test('new decisions affecting a transitive prerequisite invalidate dependent readiness',t=>{
 const p=setup(t);const tp='docs/workflow/tasks/T-0001.md';
 const task=fs.readFileSync(path.join(p.repo,tp),'utf8');
 p.write('docs/workflow/tasks/T-0002.md',task.replaceAll('T-0001','T-0002').replace('status: Ready','status: Done'));
 p.edit(tp,s=>s.replace('prerequisites: []','prerequisites: [T-0002]'));
 const established=p.commit();p.edit(tp,s=>s.replace(/^governing_baseline_revision:.*$/m,`governing_baseline_revision: ${established}`));p.commit();
 assert.equal(p.run().outcome,'Ready');
 p.write('docs/workflow/decisions/D-0002.md',decision('D-0002','affects: [T-0002]'));p.commit();assert.ok(p.run().reasons.some(s=>s.includes('stale')));
});
test('candidate pathspec exclusions cannot suppress a real governing change',t=>{
 const p=setup(t);p.edit('docs/specs/feature.md',s=>s+'\nChanged requirement.');
 p.edit('docs/workflow/tasks/T-0001.md',s=>s.replace('review: independent context required','review: independent context required\ndesign: :(exclude)docs/workflow'));
 p.commit();assert.throws(()=>p.run(),/invalid repository path/);
 // The underlying Git source treats even unvalidated pathspecs literally.
 const b=gitSource(p.repo,'HEAD');const tp=fs.readFileSync(path.join(p.repo,'docs/workflow/tasks/T-0001.md'),'utf8');const prior=tp.match(/governing_baseline_revision: ([a-f0-9]+)/)[1];
 assert.equal(b.changedSince(prior,['docs/specs/feature.md',':(exclude)docs']),true);
});
test('root-level governing requirements are freshness dependencies',t=>{
 const p=setup(t);const tp='docs/workflow/tasks/T-0001.md';p.write('REQUIREMENTS.md','Approved behavior.');p.edit(tp,s=>s.replace('governing: [PROFILE]','governing: [PROFILE, REQUIREMENTS.md]'));
 const rev=p.commit();p.edit(tp,s=>s.replace(/^governing_baseline_revision:.*$/m,`governing_baseline_revision: ${rev}`));p.commit();assert.equal(p.run().outcome,'Ready');
 p.edit('REQUIREMENTS.md',s=>s+'\nNew behavior.');p.commit();assert.ok(p.run().reasons.some(s=>s.includes('stale')));
});
test('freshness and readiness share normalization for new applicable decisions',t=>{
 const p=setup(t);p.write('docs/workflow/decisions/D-0002.md',decision('D-0002','affects: [paths:./src]').replace('status: Open','status: Resolved'));p.commit();assert.ok(p.run().reasons.some(s=>s.includes('stale')));
});
test('a realistic unrelated milestone with its own acceptance examples remains unrelated',t=>{
 const p=setup(t);const m=fs.readFileSync(path.join(p.repo,'docs/workflow/milestones/M-0001.md'),'utf8');
 p.write('docs/workflow/milestones/M-0002.md',m.replaceAll('M-0001','M-0002').replaceAll('AC-001-1','AC-002-1'));
 p.edit('docs/workflow/acceptance.json',s=>{const a=JSON.parse(s);a.examples.push({id:'AC-002-1',requirement:'docs/specs/other.md',method:'inspection'});return JSON.stringify(a);});p.write('docs/specs/other.md','Unrelated requirement.');p.commit();assert.equal(p.run().outcome,'Ready');
 p.edit('docs/workflow/acceptance.json',s=>{const a=JSON.parse(s);a.examples[0].method='automated';return JSON.stringify(a);});p.commit();assert.ok(p.run().reasons.some(s=>s.includes('stale')));
});
