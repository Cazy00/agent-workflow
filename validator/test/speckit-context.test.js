import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectFeatureSources } from '../../adapters/speckit/context.mjs';
import { digest } from '../../adapters/speckit/files.mjs';
const root = fileURLToPath(new URL('../../',import.meta.url));
function setup(t) {
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),'wf-speckit-context-'));t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));
 fs.cpSync(path.join(root,'fixtures/04a-accepted-decision-permits/baseline'),repo,{recursive:true});
 const git=(...args)=>{const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 const write=(p,text)=>{fs.mkdirSync(path.dirname(path.join(repo,p)),{recursive:true});fs.writeFileSync(path.join(repo,p),text);};
 for(const p of ['spec.md','plan.md','contracts/one.json','contracts/two.json'])write(`docs/specs/orders/${p}`,p);
 const tp=path.join(repo,'docs/workflow/tasks/T-0001.md');fs.writeFileSync(tp,fs.readFileSync(tp,'utf8').replace('record: task','record: task\nfeature: docs/specs/orders'));
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('add','.');git('-c','core.hooksPath=/dev/null','commit','-qm','fixture');
 const baseline=git('rev-parse','HEAD');
 const collect=()=>collectFeatureSources({repo,baseline,feature:'docs/specs/orders',milestone:'M-0001'});
 return {repo,write,baseline,collect};
}
test('feature closure sees uncommitted changes and removed baseline contracts',t=>{
 const f=setup(t),before=f.collect();
 fs.unlinkSync(path.join(f.repo,'docs/specs/orders/contracts/one.json'));
 f.write('docs/specs/orders/contracts/new.json','new');
 const after=f.collect();assert.notEqual(digest(after),digest(before));
 assert.ok(after.some(s=>s.path==='docs/specs/orders/contracts/one.json'&&s.version==='baseline'));
 assert.ok(!after.some(s=>s.path==='docs/specs/orders/contracts/one.json'&&s.version==='working'));
 assert.ok(after.some(s=>s.path==='docs/specs/orders/contracts/new.json'&&s.version==='working'));
});
test('temporary projections and unrelated features do not enter the governing closure',t=>{
 const f=setup(t),before=f.collect();
 f.write('docs/specs/orders/tasks.md','user edited projection');f.write('docs/specs/orders/research.md','temporary');
 f.write('docs/specs/unrelated/plan.md','unrelated');
 assert.deepEqual(f.collect(),before);
});
test('source namespace retains both baseline and working records without collision',t=>{
 const f=setup(t);f.write('docs/specs/orders/spec.md','changed');const sources=f.collect();
 const spec=sources.filter(s=>s.path==='docs/specs/orders/spec.md');assert.equal(spec.length,2);
 assert.notEqual(spec[0].text,spec[1].text);assert.deepEqual(new Set(spec.map(s=>s.version)),new Set(['working','baseline']));
});
test('feature symlinks are refused before reading through them',t=>{
 const f=setup(t);fs.symlinkSync('/tmp',path.join(f.repo,'docs/specs/orders/outside'));
 assert.throws(()=>f.collect(),/symlink/);
});
