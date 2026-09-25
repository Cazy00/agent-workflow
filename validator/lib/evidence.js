import path from 'node:path';
import {createHash} from 'node:crypto';
export function prepareNodeEvidence({raw,revision,repository,environment,checkName,expiresAt,projectRoot}) {
  if(!/^[a-f0-9]{40}$/.test(revision??'') || !/^[\w.-]+\/[\w.-]+$/.test(repository??'') || !environment || !checkName || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt)<=Date.now())throw new Error('evidence needs exact revision, repository, environment, check name and future expiry');
  const rows=raw.trim().split('\n').map(line=>JSON.parse(line));
  const first=rows[0],last=rows.at(-1);
  if(first?.type!=='wf:context' || last?.type!=='wf:complete' || first.revision!==revision || last.revision!==revision || first.clean!==true || last.clean!==true)throw new Error('test evidence is incomplete, dirty or from another revision');
  if(rows.filter(r=>r.type==='wf:context').length!==1 || rows.filter(r=>r.type==='wf:complete').length!==1)throw new Error('ambiguous test stream');
  const events=rows.filter(r=>['test:pass','test:fail'].includes(r.type));
  if(last.count!==events.length || !events.length)throw new Error('test stream count mismatch or no executed tests');
  const seen=new Set();const tests=[];
  for(const {type,data:d} of events) {
    if(d?.details?.type==='suite')continue;
    if(typeof d?.file!=='string' || typeof d.name!=='string' || !d.name)throw new Error('test result is missing file or name');
    const file=path.relative(projectRoot,path.resolve(projectRoot,d.file)).split(path.sep).join('/');
    if(file==='..'||file.startsWith('../')||!file)throw new Error('test result path is outside the project');
    const key=JSON.stringify([file,d.name]);if(seen.has(key))throw new Error('duplicate test names in a file; use unique names before mapping acceptance');seen.add(key);
    tests.push({file,name:d.name,status:d.skip||d.todo?'skipped':type==='test:pass'?'passed':'failed'});
  }
  if(!tests.length)throw new Error('no leaf tests recorded');
  const ok=tests.every(t=>t.status==='passed') && events.every(e=>e.type==='test:pass');
  const digest=createHash('sha256').update(raw).digest('hex');
  const evidence=`node-results-${digest}.ndjson`;
  const payload={purpose:'verification',repository,revision,expires_at:expiresAt,environment,checks:[{name:checkName,result:ok?'passed':'failed',evidence}],execution:{revision,tests},artifacts:{[evidence]:raw}};
  return {draft:true,ok,payload,summary:{tests:tests.length,passed:tests.filter(t=>t.status==='passed').length,failed:tests.filter(t=>t.status==='failed').length,skipped:tests.filter(t=>t.status==='skipped').length,raw_sha256:digest},limitation:'Unsigned preparation only. The owner-controlled collector must authenticate the runner, process exit, environment and raw evidence before signing. Only the supplied Node test reporter is supported; no product runner compatibility is inferred.'};
}
