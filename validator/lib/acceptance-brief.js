// MAINT-0020 P3: `wf brief --acceptance --milestone M-NNNN`, the brief a coordinator hands the fresh helpers that do a milestone's
// closing work (its review, the acceptance package and its evidence, the trial walk, the next milestone's draft), so its own context
// grows by their results only. In M-0005 of a client project the coordinator drafted M-0006, set up the trial server and wrote the
// acceptance package itself, and grew to 708 K, rebuilt thirteen times (record §§ 1, 9). It grants nothing and no gate reads it.
import { list, loadAll, loadConfig } from './records.js';
import { byMilestone, byWhom, effortOf, launchName, resolveRoles, reviewerCommand, secondModelLaunch, secondModelOf } from './roles.js';
import { READ_ONCE, WAIT_COMMANDS, waitLine } from './lead-brief.js';
import { nextIds } from './next.js';
import { FIRST_LOAD_LIMIT } from './acceptance-evidence.js';

const bullets = items => items.map(i => `- ${i}`).join('\n');
const byId = (a, b) => String(a.id).localeCompare(String(b.id));

export function renderAcceptanceBrief({ baseline, candidate = baseline, milestone }) {
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  const records = loadAll(candidate, rd), trusted = loadAll(baseline, rd);
  const m = records.milestones.get(milestone)?.data;
  if (!m) throw new Error(`milestone ${milestone} not found`);
  // Its tasks as the candidate has them, else as the trusted branch does; planned are those its approved `tasks:` names, or
  // without that list those with no found_from (next.js reads found tasks so).
  const tasks = [...new Map([...trusted.tasks, ...records.tasks]).values()].map(r => r.data).filter(t => t?.id && t.milestone === milestone).sort(byId);
  const listed = trusted.milestones.get(milestone)?.data?.tasks ?? m.tasks;
  const planned = listed == null ? tasks.filter(t => !t.found_from).map(t => t.id) : list(listed);
  const status = id => tasks.find(t => t.id === id)?.status ?? 'no record';
  const found = tasks.filter(t => !planned.includes(t.id));
  // The findings owed at acceptance, read from both sides as the acceptance evidence's check reads them (acceptance-evidence.js);
  // a carried one (P11) is a found task's found_from.
  const owed = new Map();
  for (const t of [trusted, records].flatMap(r => [...r.tasks.values()]).map(r => r.data).filter(t => t?.milestone === milestone)) for (const f of list(t.accepted_findings)) owed.set(f, (owed.get(f) ?? new Set()).add(t.id));
  const carrier = f => tasks.find(t => t.found_from === f)?.id;
  const prMode = ['enforced', 'owner-merge'].includes(config.approval?.label);
  const evidence = prMode && config.acceptance_evidence === true;
  const base = baseline.kind === 'git' ? baseline.name : 'TRUSTED_TIP';
  const roles = resolveRoles(config);
  const setting = (role, key) => `model ${role.model ?? 'inherit'}, effort ${effortOf(role) ?? 'inherit'} (roles.${key})`;
  const second = secondModelOf(config, { milestone: true }); // the owner's rule of 17 October 2026: final_model, else model
  const name = role => `\`${launchName(milestone, role)}\``;
  // MAINT-0022: under review.cadence milestone this is the only review of the milestone's code (acceptance-evidence.js).
  const onlyReview = byMilestone(config) ? `its one review (review.cadence milestone: its tasks had none), from a base at or before the milestone's authorisation on the trusted branch (the evidence's review.base), with a security focus on review.deep_paths (${list(config.review?.deep_paths).join(', ') || 'none set'}), which the evidence's review.deep_paths lists where the diff reaches them; ${reviewerCommand(config, 'milestone') ? '' : 'after findings, one fix check, recorded as review.fix_check; no round three; '}` : '';
  // v2.9.0 review S3-5: the next milestone is a Draft one already here, else the next free ID past every milestone the history
  // added, as wf next prints it (a removed record keeps its number: ci.js refuses a reused one).
  const draft = [...new Map([...trusted.milestones, ...records.milestones]).values()].map(r => r.data).filter(d => d?.id && d.status === 'Draft').sort(byId)[0]?.id;
  const next = draft ?? nextIds([baseline, candidate], rd)?.milestone ?? `M-${String(Number(milestone.slice(2)) + 1).padStart(4, '0')}`;
  // v2.9.0 review S3-3: wf usage needs a session or a start time (cli.js), so the command names both, for the helper to fill.
  // The milestone record holds no date: its authorisation time is the trusted branch's first commit that set it Authorised.
  const usage = `wf usage --milestone ${milestone} --claude-session COORDINATOR_SESSION.jsonl --since AUTHORISED_AT`;
  const authorised = `git log --first-parent --diff-merges=first-parent --reverse -G'^status: Authorised' --format=%cI ${base} -- ${rd}/milestones/${milestone}.md | head -1`;
  // MAINT-0020 P7: the walker walks what the owner will trial, each scenario once without the steps (acceptance-evidence.js).
  // v2.9.0 review S4-1, S4-4: in its own demo accounts and business, so the owner starts cold; on a local production build when that
  // is what the owner is given; and no environment to give the owner is a blocker the plan's question raised.
  return `# ${milestone} acceptance

${m.outcome ?? ''}

## How this milestone is closed
You are the coordinator. Fresh helpers do the milestone's closing work, one job each (below), and you post their results on the acceptance pull request; do not write the package or walk the trial yourself, so your context grows by their results only (procedures/accept-release.md). Each launch's description starts with its name below, for \`wf usage\`. Each helper returns text and links (its posted comment, its commits, the screenshots), not the files it read; tell each: ${READ_ONCE}.

## The milestone (status ${m.status ?? '?'})
${bullets([
    `Measure: ${m.measure ?? '—'}`,
    `Acceptance: ${list(m.acceptance).join(', ') || 'none'}`,
    `Planned tasks: ${planned.map(id => `${id} (${status(id)})`).join(', ') || 'none listed'}`,
    `Found tasks: ${found.map(t => `${t.id} (${t.status ?? '?'}), found from ${t.found_from ?? '— (no found_from)'}`).join('; ') || 'none'}`,
    `Accepted findings owed at acceptance, each in the package's *Decided for your acceptance*${evidence ? ' and the evidence\'s `deferred`' : ''}: ${[...owed].map(([f, by]) => `${f} (${[...by].sort().join(', ')}${carrier(f) ? `; carried by ${carrier(f)}` : ''})`).join(', ') || 'none'}`,
    config.approval?.defer_to_acceptance === true
      ? `Left for the owner by approval.defer_to_acceptance: those findings, and each task pull request's \`deferred\` from \`wf ci\` (acceptance tests changed, scenarios that waited on found work, tasks appended to the milestone's tasks:)${evidence ? ', in the evidence\'s `deferred` and `tests_changed`' : ''}`
      : 'approval.defer_to_acceptance is off: the owner merged each of those already',
  ])}

## Helpers
1. ${name('reviewer')}: the milestone review of the whole milestone diff (procedures/review.md), ${onlyReview}${reviewerCommand(config, 'milestone') ? `${byWhom(config)}: \`${reviewerCommand(config, 'milestone')}\`; after ${onlyReview ? 'findings' : 'a blocking finding'}, one fix check: \`${reviewerCommand(config, 'fixcheck')}\`${onlyReview ? ', recorded as review.fix_check; no round three' : ''}. If no reviewer can run, the review is missing: stop at the gate.` : second ? `by the second model (review.second_model${config.review.second_model.final_model ? ', its final_model' : ''}): model ${second.model}, effort ${second.effort}: ${secondModelLaunch(second, launchName(milestone, 'reviewer'))}. Where it cannot run, the next reviewer of another vendor (procedures/review.md *Who reviews*), and review.fallback says why; with none, the review is missing: stop at the gate.` :'by another vendor\'s model (neither review.reviewer_command nor review.second_model is set: procedures/review.md *Who reviews*), at its highest effort.'}
2. ${name('acceptance')}: the owner's trial environment with demo data, and the walker's own demo accounts and demo business (or tenant), never those the owner will use (a local production build counts when that is what the owner is given: it starts it and keeps it running for the walker; with no environment the owner can be given, the walk is unavailable, a blocker for the plan's question from \`wf doctor\`); and the acceptance package (templates/acceptance.md) naming its address and build, with its trial steps. Once the review and the walk are back, a fresh one completes the package${evidence ? ' and its evidence (templates/acceptance-evidence.json)' : ''} from their results, fixing or listing for the owner what the walk found${evidence ? ' (each scenario still stuck, and a slow first load, in `deferred`)' : ''}, with the usage table the \`wf usage\` command below prints, and resets or reseeds a shared dataset after the last walk, before the owner is told the trial is ready: ${setting(roles.acceptance, 'acceptance')}.
3. ${name('walker')}: the trial walk on that environment, the address and build the owner will be given, never a development server, in its own demo accounts and business, a fresh one for each unguided pass: each scenario first from its outcome sentence alone, from a fresh sign-in, then those steps; it records the first page's load time, and over ${FIRST_LOAD_LIMIT} s is a finding to report. Once the review's fixes are merged, in the background (procedures/accept-release.md): ${setting(roles.walker, 'walker')}.

The next milestone's draft goes to a fresh helper, \`${launchName(next, 'plan')}\`, following procedures/readiness.md; it returns the draft's pull request.

## Commands
${bullets([
    `${usage}  (the milestone's usage table, which the acceptance package carries: MAINT-0020 P14). COORDINATOR_SESSION.jsonl is your Claude Code session file, one --claude-session for each session that coordinated ${milestone}: ~/.claude/projects/<this checkout's path, each character but a letter or digit as ->/<session ID>.jsonl, whose folder of the same name holds its helpers'. AUTHORISED_AT is when ${milestone} was authorised: \`${authorised}\``,
    evidence ? `wf ci --baseline ${base} --candidate HEAD --delivery-evidence PR_DESCRIPTION_FILE  (checks the acceptance evidence in the pull request description, as the wf ci check does)` : 'no acceptance evidence to check: the project sets no acceptance_evidence, or approves without pull requests',
    ...(prMode ? WAIT_COMMANDS : []),
  ])}

${waitLine(prMode)}
`;
}
