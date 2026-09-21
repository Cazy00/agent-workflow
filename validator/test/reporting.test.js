import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {publicReport,enqueueReport,deliverReport,githubTransport} from '../lib/reporting.js';
const config={destination:'Cazy00/agent-workflow',worker:'worker',workflow:{version:'1.1.0-dev.0',revision:'a'.repeat(40)},tools:{codex:['0.155.1'],claude:['2.1.274']},reports_per_session:1};
const event=(extra={})=>({id:randomUUID(),session_id:randomUUID(),tool:'codex',tool_version:'0.155.1',step:'readiness',code:'incorrect-block',impact:'blocking',catalog_fit:'exact',...extra});
const setup=(extra={})=>{
 const state={reports:{}};const r=enqueueReport(state,event(extra),config,0);let writes=0;let issues=[];let saves=0;
 const transport={preflight:async()=>{},list:async()=>issues,create:async(dest,payload)=>{writes++;const i={...payload,number:writes,html_url:`https://github.com/${dest}/issues/${writes}`,user:{login:'worker'}};issues.push(i);return i;},get:async(dest,n)=>issues.find(i=>i.number===n)};
 const deliver=(now=0)=>deliverReport(state,r,config,transport,()=>saves++,now);
 return {state,r,transport,deliver,writes:()=>writes,saves:()=>saves};
};
test('public payload rejects private fields and unapproved tool versions',()=>{
 assert.throws(()=>publicReport(event({narrative:'PRIVATE-CANARY'}),config),/fields/);
 assert.throws(()=>publicReport(event({tool_version:'secret'}),config),/metadata/);
 const p=publicReport(event(),config);assert.ok(!p.payload.body.includes(p.event.session_id));assert.ok(!p.payload.body.includes('project_root'));
});
test('uncatalogued reports use only a fixed statement',()=>{
 const p=publicReport(event({code:'uncatalogued',catalog_fit:'none'}),config);assert.match(p.payload.body,/details remain private/);
 assert.throws(()=>publicReport(event({code:'uncatalogued'}),config));
});
test('repeated UUID produces one verified issue and persists before mutation',async()=>{
 const p=setup();const create=p.transport.create;p.transport.create=async(...args)=>{assert.equal(p.r.status,'unknown');assert.ok(p.saves()>0);return create(...args);};
 await p.deliver();await p.deliver();assert.equal(p.writes(),1);assert.equal(p.r.status,'delivered');
 assert.equal(enqueueReport(p.state,p.r.event,config),p.r);
 assert.throws(()=>enqueueReport(p.state,{...p.r.event,impact:'minor'},config),/different/);
});
test('server success followed by lost response reconciles without another POST',async()=>{
 const p=setup();const create=p.transport.create;p.transport.create=async(...args)=>{await create(...args);throw new Error('lost response');};
 await p.deliver();assert.equal(p.r.status,'unknown');await p.deliver(61000);assert.equal(p.r.status,'delivered');assert.equal(p.writes(),1);
});
test('unreconciled delivery holds after bounded attempts without blind retry',async()=>{
 const p=setup();p.transport.create=async()=>{throw new Error('connection lost');};
 await p.deliver();for(let n=1;n<=3;n++)await p.deliver(n*61000);
 assert.equal(p.r.status,'held');assert.equal(p.r.attempts,1);assert.equal(p.r.reconciliations,3);
});
test('preflight failure during unknown delivery cannot make a retry safe',async()=>{
 const p=setup();p.transport.create=async()=>{throw new Error('lost response');};await p.deliver();
 p.transport.preflight=async()=>{throw Object.assign(new Error('forbidden'),{status:403});};await p.deliver(61000);assert.equal(p.r.status,'unknown');assert.equal(p.r.attempts,1);
});
test('readback failure after successful POST remains unknown',async()=>{
 const p=setup();p.transport.get=async()=>{throw Object.assign(new Error('forbidden'),{status:403});};await p.deliver();assert.equal(p.r.status,'unknown');await p.deliver(61000);assert.equal(p.r.status,'delivered');assert.equal(p.writes(),1);
});
test('security flagged reports never touch the transport',async()=>{
 const p=setup({security:true,code:'safeguard-failure'});p.transport.preflight=()=>assert.fail('network access');await p.deliver();assert.equal(p.r.status,'private');assert.equal(p.writes(),0);
});
test('session cap queues ordinary reports but urgent reports preserve privacy controls',async()=>{
 const p=setup();await p.deliver();const r=enqueueReport(p.state,event({session_id:p.r.event.session_id}),config);
 await deliverReport(p.state,r,config,p.transport,()=>{});assert.equal(r.reason,'session-cap');assert.equal(p.writes(),1);
 const urgent=enqueueReport(p.state,event({session_id:p.r.event.session_id,code:'safeguard-failure'}),config);
 await deliverReport(p.state,urgent,config,p.transport,()=>{});assert.equal(urgent.status,'delivered');assert.equal(p.writes(),2);
});
test('bounded listing cannot silently assume an old event does not exist',async()=>{
 const p=setup();let lists=0;p.transport.list=async()=>{lists++;return Array.from({length:100},()=>({}));};await p.deliver();assert.equal(lists,3);assert.equal(p.r.status,'held');assert.equal(p.writes(),0);
});
test('new reports do not trust third-party issue markers or instructions',async()=>{
 const p=setup();p.transport.list=async()=>[{...p.r.payload,user:{login:'attacker'},number:99,html_url:'https://github.com/Cazy00/agent-workflow/issues/99'}];await p.deliver();assert.equal(p.writes(),1);assert.equal(p.r.number,1);
});
test('route preflight rejects wrong identity and token absence without owner fallback',async()=>{
 assert.throws(()=>githubTransport(''),/no owner fallback/);let calls=0;
 const t=githubTransport('fixture-token',async()=>{calls++;return new Response(JSON.stringify({login:'owner'}),{status:200});});
 await assert.rejects(t.preflight('worker',config.destination),/differs/);assert.equal(calls,1);
});
test('rate-limited writes wait and bound known rejected retries',async()=>{
 const p=setup();let calls=0;p.transport.create=async()=>{calls++;throw Object.assign(new Error('rate limit'),{status:429,retryAt:120000});};
 await p.deliver(0);assert.equal(p.r.status,'queued');await p.deliver(61000);assert.equal(calls,1);await p.deliver(120001);assert.equal(calls,2);
});
test('a later real delivery session can drain a capped event without changing its identity',async()=>{
 const p=setup();await p.deliver();const r=enqueueReport(p.state,event({session_id:p.r.event.session_id}),config);
 await deliverReport(p.state,r,config,p.transport,()=>{},0);assert.equal(r.reason,'session-cap');
 const original=r.event.id;const session=randomUUID();await deliverReport(p.state,r,config,p.transport,()=>{},61000,session);
 assert.equal(r.status,'delivered');assert.equal(r.event.id,original);assert.equal(r.event.session_id,p.r.event.session_id);assert.deepEqual(r.attempt_sessions,[session]);
});
test('a stable UUID is mandatory before any queue or write',()=>{
 const input=event();delete input.id;assert.throws(()=>publicReport(input,config),/metadata/);
});
test('rate reset headers delay only an actually exhausted primary limit',async()=>{
 const now=Date.now(),reset=Math.floor((now+3600000)/1000).toString();
 for(const status of [401,404,422]) {
  const transport=githubTransport('fixture',async()=>new Response('{}',{status,headers:{'x-ratelimit-reset':reset,'x-ratelimit-remaining':'10'}}));
  await assert.rejects(transport.preflight('worker',config.destination),e=>e.retryAt<now+120000);
 }
 const limited=githubTransport('fixture',async()=>new Response('{}',{status:403,headers:{'x-ratelimit-reset':reset,'x-ratelimit-remaining':'0'}}));
 await assert.rejects(limited.preflight('worker',config.destination),e=>e.retryAt===Number(reset)*1000);
});
test('reconciliation uses the persisted enqueue window instead of account lifetime',async()=>{
 const p=setup();const when=Date.now();p.r.created_at=when;
 let since;p.transport.list=async(dest,worker,page,window)=>{since=window;return [];};await p.deliver(when);
 assert.equal(since,new Date(when-300000).toISOString());assert.equal(p.r.status,'delivered');
 let url;const t=githubTransport('fixture',async(u)=>{url=u;return new Response('[]',{status:200});});await t.list(config.destination,'worker',1,since);assert.equal(new URL(url).searchParams.get('since'),since);
});
