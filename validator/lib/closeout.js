// `wf closeout`: the mechanical steps after the owner signs a round (procedures/approval-evidence.md *Closeout*), as
// one read-only command instead of a model session. Given the trusted branch's approved tip (baseline) and the
// revision the round ends at (candidate):
// - the tasks the round marks Done form one chain from the tip: each was gated against the tip or the previous task's
//   work (`baseline_revision`), on a candidate (`implemented`, which the receipts name) that holds everything before
//   it. `implemented` is read rather than `verified`, which would raise the stage the task's own `wf ci` judges at;
// - `wf ci` passes again for each, at those revisions, on the signed receipts;
// - no production or generated path changes outside those candidates, so every line of code in the round passed a gate;
// - each milestone the round accepts or releases has the owner's acceptance (and release) receipt;
// - the round's end is an approved baseline, by receipt or derivation, and the local trusted branch is at the tip;
// - the clone is complete (not shallow), Git answers every question it asks, and replace refs and grafts are ignored.
// It changes nothing. When every step passes on signed receipts it prints the fast-forward, shell-quoted, for the
// operator to run; a dry run on unsigned payloads prints none.
import { gitSource } from './sources.js';
import { list, loadAll, loadConfig, validateRecords } from './records.js';
import { classifyPaths } from './paths.js';
import { evaluateCi } from './ci.js';
import { ancestorIn, gitIn, quote, trustedBranchState } from './derived.js';
import { payloadProblems } from './payloads.js';

const SHA = /^[0-9a-f]{40,64}$/;

export function evaluateCloseout(args) {
  try { return closeout(args); }
  catch (e) { return { ok: false, baseline: args.baseline.name, candidate: args.candidate.name, steps: [{ name: 'closeout could read the history', ok: false, detail: [e.message] }], notes: [], fast_forward: null }; }
}
function closeout({ repo, origin = repo, baseline, candidate, trust }) {
  const steps = [];
  const step = (name, ok, detail = []) => { steps.push({ name, ok, ...(detail.length ? { detail } : {}) }); return ok; };
  const git = gitIn(repo);
  const ancestor = ancestorIn(git);
  const shallow = git('rev-parse', '--is-shallow-repository');
  if (!shallow.ok || shallow.out.trim() !== 'false') throw new Error('the clone is shallow or unreadable: closeout needs the full history');
  const changed = (from, to) => { const d = git('diff-tree', '-r', '--no-renames', '--name-only', '-z', from, to, '--'); return d.ok ? d.out.split('\0').filter(Boolean) : null; };
  const config = loadConfig(baseline);
  const endConfig = (() => { try { return loadConfig(candidate); } catch { return config; } })();
  const rd = config.records_dir ?? 'docs/workflow';
  const branch = config.trusted_branch ?? 'main';
  const productionLike = p => [config, endConfig].some(c => ['production', 'generated'].includes(classifyPaths(c, [p])[0].category));

  const approvedBase = trust.allows('baseline', baseline.name);
  step('the baseline is approved', approvedBase, approvedBase ? [] : ['owner approval evidence for the baseline is missing or invalid']);
  const state = trustedBranchState({ repo: origin, branch, trust });
  step(`the local ${branch} is at the baseline`, !!state && state.tip === baseline.name, !state ? [`there is no local branch ${branch} (or its name is not a valid branch)`] : state.tip === baseline.name ? [] : [`${branch} is at ${state.tip.slice(0, 12)}; run closeout against the trusted branch's actual tip`]);
  const descends = candidate.isAncestor(baseline.name);
  step('the candidate descends from the baseline', descends, descends ? [] : ['the trusted branch can only fast-forward; rebuild the round on the current baseline']);
  const records = validateRecords(candidate, rd);
  step('the candidate records validate', records.ok, records.errors);

  // The tasks this round completes, as one chain from the tip.
  const before = loadAll(baseline, rd);
  const after = loadAll(candidate, rd);
  const finished = [...after.tasks.values()].map(r => r.data).filter(t => t?.id && t.status === 'Done' && before.tasks.get(t.id)?.data?.status !== 'Done');
  // A record removed in a round that changes production content could take its gate with it: such a round keeps the
  // records of tasks not Done at the tip; a round without production changes may drop them (a Draft cut from the plan).
  const removed = [...before.tasks.values()].map(r => r.data).filter(t => t?.id && !after.tasks.has(t.id) && t.status !== 'Done').map(t => t.id);
  const roundPaths = changed(baseline.name, candidate.name);
  if (!roundPaths) throw new Error('cannot compute the round\'s changes');
  const productionInRound = roundPaths.some(productionLike);
  let chained = step('no task record is removed in a round that changes production content', !(removed.length && productionInRound), removed.length && productionInRound ? [`${removed.join(', ')} ${removed.length > 1 ? 'are' : 'is'} not Done at the trusted tip and gone at the round's end; remove Done records in a later records-only round, after closeout`] : []);
  const groups = new Map();
  for (const t of finished) {
    if (!SHA.test(t.baseline_revision ?? '') || !SHA.test(t.implemented ?? '')) { chained = step(`${t.id} records the revisions it was gated at`, false, ['a Done task records baseline_revision (the approved baseline its wf ci ran against) and implemented (the candidate its receipts name)']) && chained; continue; }
    const key = `${t.baseline_revision} ${t.implemented}`;
    groups.set(key, [...(groups.get(key) ?? []), t.id]);
  }
  const chain = [...groups.entries()].map(([key, ids]) => { const [from, to] = key.split(' '); return { from, to, ids }; });
  chain.sort((a, b) => (a.to === b.to ? 0 : ancestor(a.to, b.to) ? -1 : 1));
  const order = [];
  let previous = baseline.name;
  for (const g of chain) {
    const problems = [];
    if (!ancestor(previous, g.from)) problems.push(`it was gated against ${g.from.slice(0, 12)}, which does not contain ${previous === baseline.name ? 'the trusted tip' : `the earlier task's candidate ${previous.slice(0, 12)}`}; rebase it and gate it again`);
    if (!ancestor(g.from, g.to)) problems.push('its candidate does not contain the baseline it was gated against');
    if (!candidate.isAncestor(g.to)) problems.push('its candidate is not in the history of the round\'s end');
    order.push([previous, g.from]);
    if (problems.length) chained = step(`${g.ids.join(', ')} follow${g.ids.length > 1 ? '' : 's'} the round's chain`, false, problems) && chained;
    previous = g.to;
  }
  order.push([previous, candidate.name]);
  for (const g of chain) {
    const name = `wf ci for ${g.ids.join(', ')} at ${g.to.slice(0, 12)} against ${g.from.slice(0, 12)}`;
    let base, cand;
    try { base = gitSource(repo, g.from); cand = gitSource(repo, g.to); } catch (e) { step(name, false, [e.message]); continue; }
    const paths = changed(g.from, g.to);
    if (!paths) { step(name, false, ['cannot compute the task diff']); continue; }
    const result = evaluateCi({ baseline: base, candidate: cand, ...(g.ids.length > 1 ? { tasks: g.ids } : { task: g.ids[0] }), trust, changed: paths });
    step(name, result.verdict === 'pass', result.verdict === 'pass' ? [] : result.findings.filter(f => !/^(planning|production|generated|governing|enforcement): /.test(f)));
  }
  // Every production or generated change in the round lies inside a gated candidate: none between them or after the last.
  if (chained) {
    const outside = [];
    for (const [from, to] of order) {
      if (from === to) continue;
      const paths = changed(from, to);
      if (!paths) { outside.push(`cannot compute ${from.slice(0, 12)}..${to.slice(0, 12)}`); continue; }
      for (const p of paths.filter(productionLike)) outside.push(`${p} changes in ${from.slice(0, 12)}..${to.slice(0, 12)}, outside any task this round gates`);
    }
    step('every production change in the round passed a task gate', !outside.length, outside);
  }

  // Milestones the round accepts or releases.
  const inRound = x => SHA.test(x) && candidate.isAncestor(x) && ancestor(baseline.name, x) && x !== baseline.name;
  const receipts = purpose => [...trust.revisions()].filter(inRound).map(x => ({ x, p: trust.peek(purpose, x)?.payload })).filter(r => r.p && !payloadProblems(r.p).length);
  for (const m of [...after.milestones.values()].map(r => r.data).filter(m => m?.id && ['Accepted', 'Released'].includes(m.status) && before.milestones.get(m.id)?.data?.status !== m.status)) {
    const needed = list(m.acceptance);
    const acceptance = receipts('acceptance').find(({ p }) => p.decision === 'accepted' && needed.every(id => p.scenarios.includes(id)));
    if (acceptance) trust.claim('acceptance', acceptance.x);
    if (!['Accepted', 'Released'].includes(before.milestones.get(m.id)?.data?.status)) step(`${m.id} acceptance covers ${needed.join(', ') || 'no scenarios'}`, !!acceptance, acceptance ? [] : ['no owner acceptance receipt in this round names every scenario of the milestone']);
    if (m.status === 'Released') {
      const release = receipts('release').find(({ x, p }) => p.candidate_revision === x);
      if (release) trust.claim('release', release.x);
      step(`${m.id} release authority`, !!release, release ? [] : ['no owner release receipt in this round']);
    }
  }

  const approval = trust.derivation ? trust.derivation(candidate.name) : { approved: trust.allows('baseline', candidate.name), via: 'receipt' };
  step(`the candidate is an approved baseline${approval.approved ? ` (${approval.via})` : ''}`, approval.approved, approval.reasons ?? []);

  const provisional = trust.provisional?.().length > 0;
  const ok = steps.every(s => s.ok);
  const notes = provisional ? ['a dry run on unsigned payloads: nothing may move until the owner signs and closeout passes on the receipts'] : [];
  // The clone's own branch moves, with its hooks off: the command runs where the agent's config lives.
  const current = gitIn(origin)('branch', '--show-current').out.trim();
  const fastForward = !ok || provisional ? null
    : current === branch ? `git -c core.hooksPath=/dev/null -C ${quote(origin)} merge --ff-only ${candidate.name}`
    : `git -c core.hooksPath=/dev/null -C ${quote(origin)} update-ref ${quote(`refs/heads/${branch}`)} ${candidate.name} ${baseline.name}`;
  return { ok, baseline: baseline.name, candidate: candidate.name, branch, steps, notes, fast_forward: fastForward, limitation: 'Read-only. It re-runs the recorded gates on the signed receipts and prints the fast-forward; it moves no branch and publishes nothing.' };
}
