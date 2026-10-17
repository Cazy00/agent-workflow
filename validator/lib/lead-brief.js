// `wf brief --lead` (MAINT-0018 B1): the brief a coordinator hands a task lead, from the records, so the coordinator does
// not write it by hand and the lead does not read whole records to find its part. In M-0004 of mateen-systems the briefs
// said "Build it": seven of eight leads implemented their tasks themselves and grew to 400–635 K tokens. The brief says who
// implements, what the lead must not edit, the task's own records and the commands with their revisions. It grants nothing.
// MAINT-0020 P1: it also splits the task into slices, one fresh helper each: M-0005's four implementing helpers grew to 571–814 K
// and spent 37 % of the cache reads, a quarter to a half of their reading a re-read of a file they had read (record §§ 1, 9).
import { list, loadAll, loadConfig } from './records.js';
import { ACCEPTANCE } from './acceptance-files.js';
import { effortOf, launchName, resolveRoles, reviewerCommand, reviewLevel, secondModelLaunch, secondModelOf } from './roles.js';

const bullets = items => items.map(i => `- ${i}`).join('\n');
// The slices of a task: its acceptance entries (else its scope entries), one slice each, at most MAX_SLICES, the entries beyond
// that grouped in order, the first groups taking the extra; one slice for a light task or fewer than two entries.
export const MAX_SLICES = 4;
export function sliceTask(items, level) {
  const k = level === 'light' ? 1 : Math.min(items.length, MAX_SLICES) || 1;
  let at = 0;
  return Array.from({ length: k }, (_, i) => items.slice(at, at += Math.floor(items.length / k) + (i < items.length % k ? 1 : 0)));
}
// The waiting and reading lines, which the acceptance brief shares (acceptance-brief.js) so they are written once.
export const WAIT_COMMANDS = ['wf wait --pr N  (returns within 270 s; pending, exit 4, means run it again; --merged waits for the merge)', 'wf wait --commit SHA  (the same for the trusted branch\'s checks on a commit)'];
export const waitLine = prMode => `No command waits longer than four and a half minutes, within the five-minute prompt cache: a test run longer than about four minutes starts in the background and is checked every four minutes. Never wait in a loop of your own${prMode ? ': use \`wf wait\`' : ''}; tell each helper this.`;
export const READ_ONCE = 'read a file once, by range (find with `grep -n`, read with `sed -n a,bp`); do not re-read what is in your context';
export function renderLeadBrief({ baseline, candidate = baseline, task }) {
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  const records = loadAll(candidate, rd);
  const t = records.tasks.get(task)?.data;
  if (!t) throw new Error(`task ${task} not found`);
  const m = records.milestones.get(t.milestone)?.data ?? {};
  let examples = [];
  try { examples = JSON.parse(candidate.read(ACCEPTANCE) ?? '{"examples":[]}').examples ?? []; } catch { examples = []; }
  const acceptance = list(t.acceptance).map(id => { const e = examples.find(x => x?.id === id); return e ? `${id}: ${e.requirement ?? ''}${e.method ? ` (${e.method})` : ''}` : id; });
  const base = baseline.kind === 'git' ? baseline.name : 'TRUSTED_TIP';
  const governing = [...(config.paths?.governing ?? []), ...(config.paths?.enforcement ?? [])].map(g => (typeof g === 'string' ? g : g.pattern));
  const deep = config.review?.deep_paths ?? [];
  const prMode = ['enforced', 'owner-merge'].includes(config.approval?.label);
  // Manual mode signs rounds: the trust options, and no pull-request commands (as wf next prints them).
  const trust = prMode ? '' : ' --trust-key … --receipts … --repository …';
  const pin = config.workflow ?? {};
  // MAINT-0020 P4: what each helper is launched with (F12: no brief carried an effort). The implementer's effort follows the
  // task's review level; a level that cannot be read is the default, standard, and the brief says why.
  const roles = resolveRoles(config);
  const { level, why } = reviewLevel(t, deep);
  const setting = (role, at) => `model ${role.model ?? 'inherit'}, effort ${effortOf(role, at) ?? 'inherit'}`;
  const second = secondModelOf(config), final = config.review?.second_model?.final_model; // a task's deep review keeps review.second_model.model (roles.js)
  // MAINT-0020 P14: each helper's launch name (roles.js), which `wf usage` reads to attribute its cost to the task and role.
  const name = (role, slice) => `\`${launchName(task, role, slice)}\``;
  // MAINT-0020 P1: slice 1 gets the record; a later slice also the earlier checkpoints and the work so far, never a conversation.
  const slices = sliceTask(acceptance.length ? acceptance : list(t.scope).map(s => `scope ${s}`), level);
  const given = n => `the task record${n > 1 ? `, the checkpoint commit${n > 2 ? 's' : ''} of ${n > 2 ? `slices 1–${n - 1}` : 'slice 1'} and \`git diff ${base}..HEAD --stat\`` : ''}`;
  // MAINT-0020 P13: friction starts empty and `wf session` refuses it empty, so "none" is a statement the lead makes (F13: all
  // 13 outcomes of M-0005 kept a pre-filled "none").
  const session = { outcome: 'ready-for-review', workflow: { version: pin.version ?? '', revision: pin.revision ?? '' }, implementer: 'helper', summary: '', candidate: '', evidence: ['<the pull request>'], next_action: '', friction: '', models: Object.fromEntries(['lead', 'implementer', 'paperwork'].map(r => [r, { model: '', effort: '' }])) };
  return `# ${task}: ${t.title ?? ''}

${t.objective ?? ''}

## How this task is done
You are the task lead. Fresh helpers implement the task, one per slice (below); each fix round goes to a new helper given the record, the review and the head; a small one writes the closing paperwork (the delivery evidence, the pull request description, the handoff and the session outcome). You hold the results, not the files and logs they read: keep your own context small (procedures/execute.md *Coordinate and delegate*).

Launch with these settings (\`roles\` in the config; a model is the harness's own name, inherit leaves it to the session):
${bullets([
    `you, the lead (the coordinator launches you so): ${setting(roles.lead)}`,
    `the implementer and each fix round: ${setting(roles.implementer, level)} (review level ${level ?? 'standard, not read'}: ${why})`,
    `the paperwork helper: ${setting(roles.paperwork)}`,
    // v2.9.0 final review S2: final_model is named only as the milestone's. MAINT-0021: the fallback is another vendor's next model, never the lead's own tool.
    // MAINT-0021: with review.reviewer_command, every level is reviewed by another vendor's model through that command, with no
    // fallback to the lead's own tool; it replaces the second model's line.
    ...(reviewerCommand(config, level) && level !== 'none' ? [`the task's review (level ${level ?? 'standard'}, procedures/review.md), by another vendor's model: \`${reviewerCommand(config, level)}\`; after a blocking finding at deep, one fix check: \`${reviewerCommand(config, 'fixcheck')}\`. If no reviewer can run, the review is missing: stop at the gate`] : []),
    ...(second && !reviewerCommand(config, level) ? [`a deep review and its fix review, by the second model (review.second_model): model ${second.model}, effort ${second.effort}: ${secondModelLaunch(second, launchName(task, 'reviewer'))}. Where it cannot run, the next reviewer of another vendor (procedures/review.md *Who reviews*), and review.fallback says why; with none, the review is missing: stop at the gate${final && final !== second.model ? `; never ${final}, its final_model, which is the milestone review's alone` : ''}`] : []),
  ])}

Name each launch for \`wf usage\`: its description starts ${name('lead')} (yours), ${name('implementer')}, ${name('fix')} (each fix round), ${name('reviewer')} (a Claude reviewer) or ${name('paperwork')}, then a few words.

## Slices (${slices.length})
Give each slice to its own fresh implementing helper, in order, ending at a checkpoint commit (its message starts \`${task}\`); a helper gets what its slice lists, never an earlier helper's conversation.
${slices.map((s, i) => `${i + 1}. ${name('implementer', [i + 1, slices.length])}, given ${given(i + 1)}\n${bullets(s.length ? s : ['the whole task']).replace(/^/gm, '   ')}`).join('\n')}

Tell each implementing helper, a fix round's too: ${READ_ONCE}; put the files and ranges you relied on in your checkpoint commit's message, so the next slice starts from them.

## The task's records
- Task record: ${rd}/tasks/${task}.md (status ${t.status ?? '?'}; scope ${list(t.scope).join(', ') || '—'})
- Milestone ${t.milestone ?? '—'}: ${m.outcome ?? ''}
  - limits: ${m.limits ?? '—'}
  - stop conditions: ${m.stop_conditions ?? '—'}
- Acceptance: ${acceptance.length ? 'in the slices above' : 'none'}
- Governing, read only what the task needs: ${list(t.governing).join(', ') || '—'}${t.design ? `; design ${list(t.design).join(', ')}` : ''}

## Do not edit, in this task's pull request: ${governing.join(', ') || 'nothing listed'}
A governing clarification nothing waits on goes into the milestone's acceptance pull request; one this task needs is the owner's decision first.

## Review
${deep.length ? `A change to these paths needs a deep review (review.deep_paths): ${deep.join(', ')}. Otherwise the level follows the change (procedures/review.md).` : 'The level follows the change (procedures/review.md).'} One review of the final code, at most one review of a fix. After merging the trusted branch into the task branch, run \`wf ci\` first and review only what it says does not carry over.

## Commands
${bullets([
    `wf readiness --baseline ${base} --task ${task}${trust}`,
    `wf ci --baseline ${base} --candidate HEAD --task ${task}${prMode ? ' --delivery-evidence PR_DESCRIPTION_FILE' : `${trust} --unsigned-receipts ROUND_FILE`}`,
    ...(prMode ? [`wf evidence --baseline ${base} --candidate HEAD --task ${task}  (starts the delivery evidence)`] : []),
    `wf done --task ${task} --implemented SHA  (the Done record, as ${prMode ? 'the pull request\'s last commit' : 'the task branch\'s last commit'})`,
    ...(prMode ? WAIT_COMMANDS : []),
    `wf session --baseline ${base} --candidate HEAD --task ${task}${trust} --record FILE`,
  ])}

${waitLine(prMode)}

## Session outcome to return
\`\`\`json
${JSON.stringify(session, null, 2)}
\`\`\`
`;
}
