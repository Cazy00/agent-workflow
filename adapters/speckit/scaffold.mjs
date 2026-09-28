import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { stageInstallation, preflightStagedInstallation, applyStagedInstallation } from './staging.mjs';
import { contained } from './files.mjs';
import { loadRecord } from '../../validator/lib/records.js';

export const ignoreRules = '\n# Spec Kit local selection and generated planning views\n/.specify/integration.json\n/.specify/feature.json\n/docs/specs/*/tasks.md\n/docs/specs/*/research.md\n/docs/specs/*/analysis.md\n/docs/specs/*/checklists/\n/docs/specs/*/.wf-speckit/\n';
export function prepareScaffold({project,directory,python,coreRevision,profileText}) {
  // The legacy scaffold preserves existing files; bind the pointer to the
  // profile that will actually remain, and reject links before any write.
  const profile=contained(project,'docs/workflow/profile.md');
  const effective=fs.existsSync(profile)?fs.readFileSync(profile,'utf8'):profileText;
  const record=loadRecord({read:()=>effective},'docs/workflow/profile.md','profile');
  if(record.errors.length || (record.data.owners?.length ?? 0)>0) throw new Error('Spec Kit scaffold requires a valid one-owner profile');
  preflightScaffoldTargets({project,coreRevision});
  const staged=stageInstallation({directory,python,coreRevision,profileText:effective});
  preflightStagedInstallation({stage:staged.directory,repo:project});
  return {stage:staged.directory,ignoreRules,apply:()=>applyStagedInstallation({stage:staged.directory,repo:project})};
}

export function preflightScaffoldTargets({project,coreRevision}) {
  const files=['.gitignore','scripts/wf','AGENTS.md','CLAUDE.md','docs/workflow/profile.md','docs/workflow/config.json','docs/workflow/setup.md',
    'docs/workflow/acceptance.json','tests/acceptance-map.json','.github/workflows/wf-status.yml','.claude/agents/independent-reviewer.md','docs/workflow/inbox/README.md'];
  const directories=['.cache/agent-workflow','docs/workflow/milestones','docs/workflow/tasks','docs/workflow/decisions','docs/workflow/feedback/inbox','docs/workflow/inbox/done'];
  for(const [paths,directory] of [[files,false],[directories,true]])for(const p of paths) {
    const target=contained(project,p);
    if(fs.existsSync(target) && (directory?!fs.statSync(target).isDirectory():!fs.statSync(target).isFile())) throw new Error(`incompatible scaffold target type: ${p}`);
  }
  const cache=contained(project,'.cache/agent-workflow');
  if(fs.existsSync(cache)) {
    const metadata=contained(project,'.cache/agent-workflow/.git');
    if(!fs.existsSync(metadata)||!fs.statSync(metadata).isDirectory())throw new Error('existing workflow cache is not a pinned installation');
    const git=(...args)=>spawnSync('git',['-C',cache,...args],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
    const head=git('rev-parse','HEAD'),state=git('status','--porcelain','--untracked-files=all');
    if(head.status!==0||head.stdout.trim()!==coreRevision||state.status!==0||state.stdout.trim())throw new Error('existing workflow cache differs from the exact clean pin');
  }
}
