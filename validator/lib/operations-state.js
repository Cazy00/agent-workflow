import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error(`invalid ${label} fields`);
}
const within = (root, file) => file === root || file.startsWith(root + path.sep);
export function loadOperations(file, stateDir, repo, pin) {
  const project = fs.realpathSync(repo);
  if (!file || !stateDir) throw new Error('external --operations-config and --state are required');
  const configPath = fs.realpathSync(file);
  if (within(project, configPath) || fs.lstatSync(file).isSymbolicLink()) throw new Error('operations config must be a regular file outside the project');
  const c = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  exactKeys(c, ['authorised','project_root','destination','worker','workflow','tools','reports_per_session','survey_cooldown_hours','limits'], 'operations config');
  if (c.authorised !== true || fs.realpathSync(c.project_root) !== project || c.destination !== 'Cazy00/agent-workflow' || !/^[A-Za-z0-9-]{1,39}$/.test(c.worker ?? '')) throw new Error('operations authority, project or destination is invalid');
  exactKeys(c.workflow, ['version','revision'], 'workflow identity');
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(c.workflow.version ?? '') || !/^[a-f0-9]{40}$/.test(pin ?? '') || c.workflow.revision !== pin) throw new Error('operations workflow must match the externally pinned installation');
  exactKeys(c.tools, ['codex','claude'], 'tools');
  if (!Object.keys(c.tools).length || Object.values(c.tools).some(a => !Array.isArray(a) || !a.length || a.some(v => !/^\d+\.\d+\.\d+$/.test(v)))) throw new Error('record approved installed tool versions');
  if (!Number.isInteger(c.reports_per_session) || c.reports_per_session < 1 || c.reports_per_session > 20 || !Number.isFinite(c.survey_cooldown_hours) || c.survey_cooldown_hours < 24) throw new Error('invalid reporting limits or survey cooldown');
  exactKeys(c.limits, ['owner_minutes','api_list_cost_usd','actual_cost_usd','retries'], 'limits');
  if (!Object.keys(c.limits).length || Object.values(c.limits).some(v => !Number.isFinite(v) || v < 0)) throw new Error('set explicit nonnegative runtime limits');
  const requested = path.resolve(stateDir);
  // Check an existing ancestor before creating anything; then recheck the real path.
  let ancestor = requested;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (within(project, fs.realpathSync(ancestor)) || within(project, requested)) throw new Error('runtime state must stay outside product source');
  fs.mkdirSync(requested, {recursive:true,mode:0o700});
  const dir = fs.realpathSync(requested);
  if (within(project, dir) || fs.lstatSync(requested).isSymbolicLink()) throw new Error('runtime state must be an external directory, not a symlink');
  if (fs.statSync(dir).mode & 0o077) throw new Error('runtime directory must have owner-only permissions (0700)');
  return {config:c, dir, project};
}
export function withState(dir, fn) {
  const lock = path.join(dir, 'lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); } catch { throw new Error('runtime is locked; inspect the prior process before manual recovery'); }
  try {
    fs.writeFileSync(fd, JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}));fs.fsyncSync(fd);
    const file = path.join(dir, 'state.json');
    if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())) throw new Error('invalid state file');
    const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : {version:1, reports:{}, runs:[], surveys:{}, claims:{}};
    if (state.version !== 1 || !state.reports || !Array.isArray(state.runs) || !state.surveys || !state.claims) throw new Error('invalid runtime state; preserve it for inspection');
    const save = () => {
      const tmp = path.join(dir, `state-${randomUUID()}.tmp`);
      const f = fs.openSync(tmp,'wx',0o600);
      try { fs.writeFileSync(f,JSON.stringify(state,null,2)+'\n');fs.fsyncSync(f); } finally { fs.closeSync(f); }
      fs.renameSync(tmp,file);
      const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
    };
    return Promise.resolve(fn(state,save)).finally(()=>{fs.closeSync(fd);fs.unlinkSync(lock);});
  } catch(e) { fs.closeSync(fd);fs.unlinkSync(lock);throw e; }
}
