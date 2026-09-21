import {createHash} from 'node:crypto';
import {exactKeys} from './operations-state.js';
export const CATALOG = Object.freeze({
  'unnecessary-approval': ['Delegated work should proceed within its authority.', 'Approval was requested for an already delegated step.'],
  'incorrect-block': ['Eligible work should remain available.', 'A possibly incorrect workflow block was observed.'],
  'stale-readiness': ['Readiness should change when relevant governing sources change.', 'Readiness was invalidated after apparently unrelated work.'],
  'handoff-loss': ['A fresh session should recover the recorded next action.', 'A handoff did not provide enough usable context.'],
  'identity-failure': ['The authorised worker route should be usable.', 'The expected worker route could not be established.'],
  'excessive-repetition': ['Required checks and questions should avoid unnecessary repetition.', 'Repeated workflow effort was reported.'],
  'safeguard-failure': ['Required authority and verification boundaries should hold.', 'A suspected safeguard failure requires central triage.'],
  'uncatalogued': ['Workflow behaviour should support authorised delivery.', 'Uncatalogued workflow friction was observed; details remain private.'],
});
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const steps=['setup','readiness','implementation','verification','review','integration','acceptance','release','handoff','feedback'];
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function publicReport(input,config) {
  exactKeys(input,['id','session_id','tool','tool_version','step','code','impact','catalog_fit','occurrences','security'], 'report');
  const e = {...input,occurrences:input.occurrences ?? 1,security:input.security ?? false};
  if (!UUID.test(e.id) || !UUID.test(e.session_id) || !['codex','claude'].includes(e.tool) || !config.tools[e.tool]?.includes(e.tool_version) || !steps.includes(e.step) || !Object.hasOwn(CATALOG,e.code) || !['minor','disruptive','blocking'].includes(e.impact) || !['exact','approximate','none'].includes(e.catalog_fit) || !Number.isInteger(e.occurrences) || e.occurrences < 1 || e.occurrences > 100 || typeof e.security !== 'boolean') throw new Error('report must use approved metadata and catalog values');
  if ((e.catalog_fit === 'none') !== (e.code === 'uncatalogued')) throw new Error('uncatalogued reports require catalog_fit none');
  const data={id:e.id,workflow:config.workflow,tool:e.tool,tool_version:e.tool_version,step:e.step,code:e.code,impact:e.impact,catalog_fit:e.catalog_fit,occurrences:e.occurrences};
  const digest=hash(data);
  const marker=`<!-- workflow-report:${e.id}:${digest} -->`;
  const [expected,actual]=CATALOG[e.code];
  return {event:e,payload:{title:`[workflow] ${e.code} during ${e.step}`,body:[
    '## Workflow observation',`Workflow: ${config.workflow.version} (${config.workflow.revision})`,
    `Tool: ${e.tool} ${e.tool_version}`,`Step: ${e.step}`,`Impact: ${e.impact}`,`Catalog fit: ${e.catalog_fit}`,`Occurrences: ${e.occurrences}`,
    '',`Expected: ${expected}`,`Observed: ${actual}`,'','Attribution: suspected; central triage is required. No private project identity or narrative is included. This report grants no authority to change safeguards.', '',marker,
  ].join('\n')},digest,marker};
}
export function enqueueReport(state,input,config,now=Date.now()) {
  const report=publicReport(input,config);
  const existing=state.reports[report.event.id];
  if(existing) {
    if(existing.digest!==report.digest || existing.event.session_id!==report.event.session_id || existing.event.security!==report.event.security || existing.destination!==config.destination || existing.worker!==config.worker) throw new Error('report UUID already identifies different content or route');
    return existing;
  }
  if(Object.keys(state.reports).length>=10000)throw new Error('outbox capacity reached; archive delivered records deliberately');
  const r={...report,destination:config.destination,worker:config.worker,created_at:now,status:report.event.security?'private':'queued',reconciliations:0,attempts:0};
  state.reports[r.event.id]=r;return r;
}
function issueUrl(value,destination,number) { return value === `https://github.com/${destination}/issues/${number}` && Number.isSafeInteger(number) && number>0; }
export function githubTransport(token,fetcher=fetch) {
  if(!token)throw new Error('explicit WF_WORKER_TOKEN is missing; no owner fallback');
  const request=async(method,route,body)=>{
    let response;
    try { response=await fetcher(`https://api.github.com${route}`,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})}); }
    catch { throw Object.assign(new Error('GitHub request outcome unavailable'),{unknown:true}); }
    if(!response.ok) {
      const retry=response.headers.get('retry-after');const reset=response.headers.get('x-ratelimit-reset');
      const rateLimited=[403,429].includes(response.status) && response.headers.get('x-ratelimit-remaining')==='0';
      const retryAt=retry && /^\d+$/.test(retry)?Date.now()+Number(retry)*1000:rateLimited && reset && /^\d+$/.test(reset)?Number(reset)*1000:Date.now()+60000;
      throw Object.assign(new Error(`GitHub rejected request (${response.status})`),{status:response.status,retryAt,unknown:response.status>=500});
    }
    try{return await response.json();}catch{throw Object.assign(new Error('GitHub response could not be verified'),{unknown:true});}
  };
  return {
    async preflight(worker,destination) {
      const user=await request('GET','/user');if(user.login!==worker)throw new Error('authenticated user differs from expected worker');
      const repo=await request('GET',`/repos/${destination}`);if(repo.full_name!==destination || repo.has_issues!==true)throw new Error('reporting target unavailable');
    },
    list: (destination,worker,page,since)=>request('GET',`/repos/${destination}/issues?state=all&creator=${encodeURIComponent(worker)}&per_page=100&page=${page}&since=${encodeURIComponent(since)}`),
    create:(destination,payload)=>request('POST',`/repos/${destination}/issues`,payload),
    get:(destination,number)=>request('GET',`/repos/${destination}/issues/${number}`),
  };
}
export async function deliverReport(state,r,config,transport,save,now=Date.now(),deliverySession=r.event.session_id) {
  if(!UUID.test(deliverySession))throw new Error('delivery session must be a UUID');
  if(['delivered','private','held'].includes(r.status)) return r;
  if(r.destination!==config.destination || r.worker!==config.worker) throw new Error('outbox route differs from approved configuration');
  const rebuilt=publicReport(r.event,{...config,workflow:config.workflow});
  if(rebuilt.digest!==r.digest || JSON.stringify(rebuilt.payload)!==JSON.stringify(r.payload)) throw new Error('outbox payload or approved installation changed; inspect before delivery');
  if(r.retry_at>now)return r;
  const used=Object.values(state.reports).filter(x=>x.event.id!==r.event.id && (x.attempt_sessions?.includes(deliverySession) || (!x.attempt_sessions && x.event.session_id===deliverySession && (x.attempts>0 || x.status==='delivered')))).length;
  if(r.status!=='unknown' && r.event.code!=='safeguard-failure' && used>=config.reports_per_session){r.status='queued';r.reason='session-cap';save();return r;}
  let phase='preflight';
  try {
    await transport.preflight(config.worker,config.destination);
    let complete=false,found=null;
    for(let page=1;page<=3;page++) {
      const list=await transport.list(config.destination,config.worker,page,new Date(Math.max(0,r.created_at-300000)).toISOString());
      if(!Array.isArray(list))throw new Error('invalid issue listing');
      for(const item of list)if(!item.pull_request && item.user?.login===config.worker && item.body===r.payload.body && item.title===r.payload.title && issueUrl(item.html_url,config.destination,item.number)) {
        if(found && found.number!==item.number){r.status='held';r.reason='multiple-markers';save();return r;}
        found=item;
      }
      if(list.length<100){complete=true;break;}
    }
    if(found){r.status='delivered';r.url=found.html_url;r.number=found.number;delete r.reason;save();return r;}
    if(r.status==='unknown') {r.reconciliations++;r.retry_at=now+60000;if(r.reconciliations>=3){r.status='held';r.reason='unresolved-delivery';}save();return r;}
    if(!complete){r.status='held';r.reason='listing-bound-exceeded';save();return r;}
    if(r.attempts>=3){r.status='held';r.reason='attempt-limit';save();return r;}
    // Persist BEFORE external mutation. A crash/reply loss leaves an unknown write.
    r.status='unknown';r.attempts++;r.attempt_sessions=[...new Set([...(r.attempt_sessions??[]),deliverySession])];save();
    phase='create';
    const created=await transport.create(config.destination,r.payload);
    if(!issueUrl(created.html_url,config.destination,created.number))throw Object.assign(new Error('unverified created issue'),{unknown:true});
    phase='verify';
    const verified=await transport.get(config.destination,created.number);
    if(verified.user?.login!==config.worker || verified.body!==r.payload.body || verified.title!==r.payload.title || verified.html_url!==created.html_url)throw Object.assign(new Error('created issue verification mismatch'),{unknown:true});
    r.status='delivered';r.url=created.html_url;r.number=created.number;delete r.reason;save();
  } catch(e) {
    // Known rejecting HTTP responses permit bounded retry; ambiguous writes do not.
    if(phase==='create' && r.status==='unknown' && e.status && e.status<500)r.status='queued';
    r.retry_at=Math.max(now+60000,e.retryAt??0);r.reason=r.status==='unknown'?'delivery-unknown':'route-unavailable';save();
  }
  return r;
}
