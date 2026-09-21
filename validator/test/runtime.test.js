import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runtimeEvent} from '../lib/runtime.js';
const fresh=()=>({reports:{},runs:[],surveys:{},claims:{}});
const config={limits:{owner_minutes:10,retries:2},survey_cooldown_hours:24};
const event=(type,extra={})=>({id:randomUUID(),type,milestone:'M-0001',...extra});
test('surveys are optional, once per milestone, cooled down and unanswered means unknown',()=>{
 const s=fresh();assert.equal(runtimeEvent(s,event('survey-offer'),config,100).ask,true);assert.equal(s.surveys['M-0001'].answer,'unknown');
 assert.equal(runtimeEvent(s,event('survey-offer'),config,200).ask,false);
 assert.equal(runtimeEvent(s,event('survey-offer',{milestone:'M-0002'}),config,200).ask,false);
 runtimeEvent(s,event('survey-optout',{value:true}),config);assert.equal(runtimeEvent(s,event('survey-offer',{milestone:'M-0002'}),config,100000000).ask,false);
});
test('unknown cost stays unknown, retries aggregate and replay cannot double-count',()=>{
 const s=fresh();const e=event('usage',{owner_minutes:null,api_list_cost_usd:1,actual_cost_usd:null,tokens:50,retries:2,signatures:1,resigns:0,elapsed_seconds:10});
 let r=runtimeEvent(s,e,config);assert.equal(r.totals.owner_minutes,null);assert.equal(r.totals.actual_cost_usd,null);assert.equal(r.budget_status,'exhausted');assert.deepEqual(r.exhausted,['retries']);
 runtimeEvent(s,e,config);assert.equal(s.runs.length,1);
 assert.throws(()=>runtimeEvent(s,{...e,retries:0},config),/content changed/);
});
test('serial claim survives in state and requires explicit matching release',()=>{
 const s=fresh();runtimeEvent(s,event('claim',{task:'T-0001',worker:'codex'}),config);
 assert.throws(()=>runtimeEvent(s,event('claim',{task:'T-0002',worker:'claude'}),config),/another task/);
 assert.throws(()=>runtimeEvent(s,event('release-claim',{task:'T-0001',worker:'claude'}),config),/mismatch/);
 runtimeEvent(s,event('release-claim',{task:'T-0001',worker:'codex'}),config);runtimeEvent(s,event('claim',{task:'T-0002',worker:'claude'}),config);
});
test('exposure observations accompany report counts without granting completion authority',()=>{
 const s=fresh();const r=runtimeEvent(s,event('exposure',{task:'T-0001',result:'attempted'}),config);assert.equal(r.exposure.attempted,1);assert.equal(r.exposure.completed,0);
});
