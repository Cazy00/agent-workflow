import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const taskPath = 'docs/workflow/tasks/T-0001.md';
function setup(t, { automated = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-git-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'project'); fs.cpSync(fixture, repo, { recursive: true });
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(repo,p)), { recursive: true }); fs.writeFileSync(path.join(repo,p),text); };
  const edit = (p, fn) => write(p, fn(fs.readFileSync(path.join(repo,p),'utf8')));
  const git = (...args) => { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); assert.equal(r.status,0,r.stderr); return r.stdout.trim(); };
  git('init','-q'); git('config','user.name','Test Worker'); git('config','user.email','worker@example.invalid');
  edit('docs/workflow/config.json', text => JSON.stringify({ ...JSON.parse(text), repository: 'fixture/project' }));
  if (automated) {
    edit('docs/workflow/acceptance.json', x => x.replace('inspection','automated'));
    write('tests/acceptance-map.json', JSON.stringify([{ acceptance: 'AC-001-1', file: 'tests/feature.js', name: 'required scenario' }]));
    write('tests/feature.js', 'actual test file\n');
  }
  git('add','.'); git('commit','-qm','initial'); const initial = git('rev-parse','HEAD');
  edit(taskPath,x => x.replaceAll('fixture-rev', initial));
  git('add','.'); git('commit','-qm','authorised baseline'); const baseline = git('rev-parse','HEAD');
  edit(taskPath,x => x.replace(`governing_baseline_revision: ${initial}`,`governing_baseline_revision: ${baseline}`));
  write('src/a.js','export const result = 1;\n');
  git('add','.'); git('commit','-qm','T-0001: candidate'); const candidate = git('rev-parse','HEAD');
  const keys = generateKeyPairSync('ed25519'); const key = path.join(temp,'owner.pem');
  fs.writeFileSync(key,keys.publicKey.export({ type:'spki',format:'pem' }));
  const receiptPath = path.join(temp,'receipts.json');
  const check = { environment:'isolated', checks:[{ name:'unit',result:'passed',evidence:'evidence/log.txt' }] };
  const claims = [
    { purpose:'baseline',revision:baseline },
    { purpose:'verification',revision:candidate,...check,execution:{ revision:candidate,tests:[] } },
    { purpose:'integration',revision:candidate,...check },
    { purpose:'review',revision:candidate,reviewer:'independent',implementer:'agent',separate_context:'review-2',evidence:'evidence/log.txt',coverage:['scope','correctness','maintainability','security','regression','test-fidelity'],findings:[] },
  ];
  const receipts = (items=claims) => fs.writeFileSync(receiptPath,JSON.stringify(items.map(c => {
    const payload={...c,repository:'fixture/project',expires_at:'2099-01-01T00:00:00Z'};
    return {payload,signature:sign(null,Buffer.from(JSON.stringify(payload)),keys.privateKey).toString('base64')};
  })));
  receipts();
  const run = (...args) => spawnSync(process.execPath,[cli,...args,'--repo',repo,'--baseline',baseline,'--candidate',candidate,'--task','T-0001','--trust-key',key,'--receipts',receiptPath,'--repository','fixture/project','--json'], { encoding:'utf8' });
  return { temp,repo,git,edit,write,baseline,candidate,claims,receipts,run,key };
}
test('real Git CI validates the exact candidate with trusted receipts', t => { const p=setup(t);const r=p.run('ci');assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(JSON.parse(r.stdout).readiness.baseline,p.baseline); });
test('real Git CI rejects missing assembled-candidate verification', t => { const p=setup(t);p.receipts(p.claims.filter(c=>c.purpose!=='integration'));const r=p.run('ci');assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stdout,/integration/); });
test('uncommitted task edits cannot disguise a committed candidate', t => { const p=setup(t);p.edit(taskPath,x=>x.replace('status: Ready','status: Blocked\nresume_condition: never'));assert.equal(p.run('ci').status,0); });
test('trusted gates cannot be supplied a hand-picked changed-path list', t => {const p=setup(t);assert.equal(p.run('ci','--changed','README.md').status,2);});
test('a trust key stored inside the candidate repo is rejected', t => { const p=setup(t);fs.copyFileSync(p.key,path.join(p.repo,'owner.pem'));const r=spawnSync(process.execPath,[cli,'readiness','--repo',p.repo,'--baseline',p.baseline,'--task','T-0001','--trust-key',path.join(p.repo,'owner.pem'),'--receipts',path.join(p.temp,'receipts.json'),'--repository','fixture/project'],{encoding:'utf8'});assert.equal(r.status,2); });
test('lifecycle and session completion cannot omit required acceptance execution', t => {
  const p=setup(t,{automated:true});
  const life=p.run('lifecycle');assert.equal(life.status,1,life.stdout+life.stderr);assert.match(life.stdout,/required test did not run/);
  const record=path.join(p.temp,'session.json');fs.writeFileSync(record,JSON.stringify({outcome:'verified-complete',next_action:'owner acceptance',friction:'none'}));
  const session=p.run('session','--record',record);assert.equal(session.status,1,session.stdout+session.stderr);
});
test('renaming production code to a planning path retains the removed production path in the diff', t => {
  const p=setup(t);p.git('mv','src/a.js','docs/a.md');p.git('commit','-qm','T-0001: rename');
  const next=p.git('rev-parse','HEAD');
  const r=spawnSync(process.execPath,[cli,'paths','--repo',p.repo,'--baseline',p.candidate,'--candidate',next,'--json'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);const classes=JSON.parse(r.stdout).classes;assert.ok(classes.some(c=>c.path==='src/a.js'&&c.category==='production'));
});
test('an authorised task can record its actual baseline on a milestone branch', t => {
  const p=setup(t);
  const start=p.candidate;
  p.edit(taskPath,x=>x.replace(/^start_revision:.*$/m,`start_revision: ${start}`).replace(/^baseline_revision:.*$/m,`baseline_revision: ${start}`));
  p.git('add','.');p.git('commit','-qm','T-0001: record assembled starting point');const next=p.git('rev-parse','HEAD');
  p.receipts(p.claims.map(c=>c.purpose==='baseline'?c:{...c,revision:next,...(c.execution?{execution:{...c.execution,revision:next}}:{})}));
  const r=spawnSync(process.execPath,[cli,'ci','--repo',p.repo,'--baseline',p.baseline,'--candidate',next,'--task','T-0001','--trust-key',p.key,'--receipts',path.join(p.temp,'receipts.json'),'--repository','fixture/project','--json'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr);
});
