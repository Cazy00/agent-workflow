import {exactKeys} from './operations-state.js';
import {UUID} from './reporting.js';
const metrics=['owner_minutes','api_list_cost_usd','actual_cost_usd','tokens','retries','signatures','resigns','elapsed_seconds'];
export function runtimeSummary(state, config, milestone) {
  const rows=state.runs.filter(r=>r.milestone===milestone && r.type==='usage');
  const totals=Object.fromEntries(metrics.map(k=>[k,rows.length && rows.every(r=>r[k]!==null)?rows.reduce((n,r)=>n+r[k],0):null]));
  const exhausted=Object.entries(config.limits).filter(([k,v])=>totals[k]!==null && totals[k]>=v).map(([k])=>k);
  const unknown=Object.keys(config.limits).filter(k=>totals[k]===null);
  return {exposure:Object.fromEntries(['attempted','completed','blocked'].map(k=>[k,state.runs.filter(r=>r.milestone===milestone && r.type==='exposure' && r.result===k).length])),totals,exhausted,unknown_limits:unknown,budget_status:exhausted.length?'exhausted':unknown.length?'unknown':'within-recorded-limits',limitation:'Assisted accounting from recorded observations, not an unattended budget enforcer. Unknown usage is not zero.'};
}
export function runtimeEvent(state,input,config,now=Date.now()) {
  exactKeys(input,['id','type','milestone','task','worker','answer','value','result',...metrics],'runtime event');
  if(!UUID.test(input.id??'') || !/^M-\d{4}$/.test(input.milestone??''))throw new Error('runtime event requires UUID and milestone');
  const old=state.runs.find(r=>r.id===input.id);
  if(old){const {recorded_at,...original}=old;if(JSON.stringify(original)!==JSON.stringify(input))throw new Error('runtime UUID content changed');return {duplicate:true,...runtimeSummary(state,config,input.milestone)};}
  if(state.runs.length>=10000)throw new Error('runtime log capacity reached; archive deliberately');
  const allowed={exposure:['id','type','milestone','task','result'],usage:['id','type','milestone',...metrics],claim:['id','type','milestone','task','worker'],'release-claim':['id','type','milestone','task','worker'],'survey-offer':['id','type','milestone'],'survey-answer':['id','type','milestone','answer'],'survey-optout':['id','type','milestone','value'],status:['id','type','milestone']};
  if(!Object.hasOwn(allowed,input.type))throw new Error('unknown runtime event type');
  exactKeys(input,allowed[input.type],'runtime event type');
  let result={};
  if(input.type==='exposure') {
    if(!/^T-\d{4}$/.test(input.task??'') || !['attempted','completed','blocked'].includes(input.result))throw new Error('invalid exposure observation');
  } else if(input.type==='usage') {
    for(const k of metrics)if(input[k]!==null && (!Number.isFinite(input[k]) || input[k]<0))throw new Error('usage requires all metric fields; unknown values must be null');
  } else if(['claim','release-claim'].includes(input.type)) {
    if(!/^T-\d{4}$/.test(input.task??'') || !['codex','claude'].includes(input.worker))throw new Error('invalid claim');
    const current=Object.values(state.claims).find(c=>c.active);
    if(input.type==='claim') {
      if(current)throw new Error('another task is claimed; inspect and explicitly release it before claiming work');
      state.claims[input.task]={active:true,milestone:input.milestone,worker:input.worker};
    } else {
      const claim=state.claims[input.task];
      if(!claim?.active || claim.worker!==input.worker || claim.milestone!==input.milestone)throw new Error('claim owner or milestone mismatch');
      claim.active=false;
    }
  } else if(input.type==='survey-optout') {
    if(typeof input.value!=='boolean')throw new Error('survey opt-out needs a boolean');
    state.surveys.optout=input.value;
  } else if(input.type==='survey-offer') {
    const prior=state.surveys[input.milestone];
    const recent=Number.isFinite(state.surveys.last_offered_at) && now-state.surveys.last_offered_at<config.survey_cooldown_hours*3600000;
    if(state.surveys.optout || prior || recent)result={ask:false,reason:state.surveys.optout?'opted-out':prior?'already-offered':'cooldown'};
    else {
      state.surveys[input.milestone]={offered_at:now,answer:'unknown'};state.surveys.last_offered_at=now;
      result={ask:true,question:'How did the amount of check-ins feel: too little, about right, or too much?',answers:['too-little','about-right','too-much']};
    }
  } else if(input.type==='survey-answer') {
    if(!['too-little','about-right','too-much','unknown'].includes(input.answer) || !state.surveys[input.milestone])throw new Error('answer requires an offered survey and categorical response');
    state.surveys[input.milestone].answer=input.answer;
  }
  state.runs.push({...input,recorded_at:now});
  return {...result,...runtimeSummary(state,config,input.milestone)};
}
