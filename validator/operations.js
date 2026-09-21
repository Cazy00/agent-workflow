import fs from 'node:fs';
import {loadOperations,withState} from './lib/operations-state.js';
import {enqueueReport,deliverReport,githubTransport,UUID} from './lib/reporting.js';
import {runtimeEvent} from './lib/runtime.js';
export async function runOperations(command,options) {
  const {config,dir,project}=loadOperations(options['operations-config'],options.state,options.repo??process.cwd(),process.env.WF_VALIDATOR_REV);
  return withState(dir,async(state,save)=>{
    if(state.project && state.project!==project)throw new Error('runtime directory belongs to a different project');
    state.project=project;
    if(command==='runtime') {
      if(!options.record)throw new Error('--record is required');
      const result=runtimeEvent(state,JSON.parse(fs.readFileSync(options.record,'utf8')),config);save();return result;
    }
    const action=options.action??'submit';
    if(!['submit','enqueue','deliver','status'].includes(action))throw new Error('unknown report action');
    let r;
    if(action==='submit'||action==='enqueue') {
      if(!options.record)throw new Error('--record is required');
      r=enqueueReport(state,JSON.parse(fs.readFileSync(options.record,'utf8')),config);save();
    } else {
      if(!UUID.test(options['report-id']??''))throw new Error('--report-id UUID is required');
      r=state.reports[options['report-id']];if(!r)throw new Error('report not found in this project outbox');
    }
    if(action==='submit'||action==='deliver') {
      if(!process.env.WF_WORKER_TOKEN && !['delivered','private','held'].includes(r.status)){r.reason='missing-worker-token';save();}
      else if(process.env.WF_WORKER_TOKEN) await deliverReport(state,r,config,githubTransport(process.env.WF_WORKER_TOKEN),save);
    }
    return {id:r.event.id,status:r.status,url:r.url??null,reason:r.reason??null,attempts:r.attempts,reconciliations:r.reconciliations,limitation:'Central issue delivery is separate from readiness, approval and resolution. Held/unknown reports need inspection; no automatic cross-machine exactly-once claim.'};
  });
}
