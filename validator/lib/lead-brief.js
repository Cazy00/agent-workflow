// `wf brief --lead` (MAINT-0018 B1): the brief a coordinator hands a task lead, from the records, so the coordinator does
// not write it by hand and the lead does not read whole records to find its part. In M-0004 of mateen-systems the briefs
// said "Build it": seven of eight leads implemented their tasks themselves and grew to 400–635 K tokens. The brief says who
// implements, what the lead must not edit, the task's own records and the commands with their revisions. It grants nothing.
import { list, loadAll, loadConfig } from './records.js';

const bullets = items => items.map(i => `- ${i}`).join('\n');
export function renderLeadBrief({ baseline, candidate = baseline, task }) {
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  const records = loadAll(candidate, rd);
  const t = records.tasks.get(task)?.data;
  if (!t) throw new Error(`task ${task} not found`);
  const m = records.milestones.get(t.milestone)?.data ?? {};
  let examples = [];
  try { examples = JSON.parse(candidate.read(`${rd}/acceptance.json`) ?? '{"examples":[]}').examples ?? []; } catch { examples = []; }
  const acceptance = list(t.acceptance).map(id => { const e = examples.find(x => x?.id === id); return e ? `${id}: ${e.requirement ?? ''}${e.method ? ` (${e.method})` : ''}` : id; });
  const base = baseline.kind === 'git' ? baseline.name : 'TRUSTED_TIP';
  const governing = [...(config.paths?.governing ?? []), ...(config.paths?.enforcement ?? [])].map(g => (typeof g === 'string' ? g : g.pattern));
  const deep = config.review?.deep_paths ?? [];
  const evidence = ['enforced', 'owner-merge'].includes(config.approval?.label) ? ' --delivery-evidence PR_DESCRIPTION_FILE' : '';
  const pin = config.workflow ?? {};
  const session = { outcome: 'ready-for-review', workflow: { version: pin.version ?? '', revision: pin.revision ?? '' }, implementer: 'helper', summary: '', candidate: '', evidence: ['<the pull request>'], next_action: '', friction: 'none' };
  return `# ${task}: ${t.title ?? ''}

${t.objective ?? ''}

## How this task is done
You are the task lead. A fresh helper implements the task; each fix round goes to a new helper given the record, the review and the head; a small one writes the closing paperwork (the delivery evidence, the pull request description, the handoff and the session outcome). You hold the results, not the files and logs they read: keep your own context small (procedures/execute.md *Coordinate and delegate*).

## The task's records
- Task record: ${rd}/tasks/${task}.md (status ${t.status ?? '?'}; scope ${list(t.scope).join(', ') || '—'})
- Milestone ${t.milestone ?? '—'}: ${m.outcome ?? ''}
  - limits: ${m.limits ?? '—'}
  - stop conditions: ${m.stop_conditions ?? '—'}
- Acceptance:
${bullets(acceptance.length ? acceptance : ['none'])}
- Governing, read only what the task needs: ${list(t.governing).join(', ') || '—'}${t.design ? `; design ${list(t.design).join(', ')}` : ''}

## Do not edit, in this task's pull request: ${governing.join(', ') || 'nothing listed'}
A governing clarification nothing waits on goes into the milestone's acceptance pull request; one this task needs is the owner's decision first.

## Review
${deep.length ? `A change to these paths needs a deep review (review.deep_paths): ${deep.join(', ')}. Otherwise the level follows the change (procedures/review.md).` : 'The level follows the change (procedures/review.md).'} One review of the final code, at most one review of a fix.

## Commands
${bullets([
    `wf readiness --baseline ${base} --task ${task}`,
    `wf ci --baseline ${base} --candidate HEAD --task ${task}${evidence}`,
    `wf evidence --baseline ${base} --candidate HEAD --task ${task}  (starts the delivery evidence)`,
    `wf done --task ${task} --implemented SHA  (the Done record, as the pull request's last commit)`,
    'wf wait --pr N  (until its checks finish; --merged until it merges)',
    `wf session --baseline ${base} --candidate HEAD --task ${task} --record FILE`,
  ])}

## Session outcome to return
\`\`\`json
${JSON.stringify(session, null, 2)}
\`\`\`
`;
}
