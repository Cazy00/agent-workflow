import fs from 'node:fs';
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
  for(const p of ['.gitignore','scripts/wf','AGENTS.md','CLAUDE.md','.cache/agent-workflow','docs/workflow/config.json','docs/workflow/setup.md',
    'docs/workflow/acceptance.json','tests/acceptance-map.json','.github/workflows/wf-status.yml','.claude/agents/independent-reviewer.md',
    'docs/workflow/milestones','docs/workflow/tasks','docs/workflow/decisions','docs/workflow/feedback/inbox','docs/workflow/inbox/done','docs/workflow/inbox/README.md']) contained(project,p);
  const staged=stageInstallation({directory,python,coreRevision,profileText:effective});
  preflightStagedInstallation({stage:staged.directory,repo:project});
  return {stage:staged.directory,ignoreRules,apply:()=>applyStagedInstallation({stage:staged.directory,repo:project})};
}
