// `wf closeout`: the mechanical steps after the owner signs a round (procedures/approval-evidence.md *Closeout*), as
// one read-only command instead of a model session. Given the trusted branch's current approved tip (baseline) and
// the revision the round ends at (candidate), it re-runs `wf ci` for every task the round marks Done, at the
// baseline and candidate its own record names (`baseline_revision`, `verified`), checks the owner's acceptance for
// every milestone the round marks Accepted, and requires the candidate itself to be an approved baseline, by receipt or
// derivation. It changes nothing: when every step passes it prints the fast-forward for the operator to run.
import { gitSource } from './sources.js';
import { list, loadAll, loadConfig, validateRecords } from './records.js';
import { evaluateCi } from './ci.js';
import { gitIn, trustedBranchState } from './derived.js';

const SHA = /^[0-9a-f]{40,64}$/;

export function evaluateCloseout({ repo, baseline, candidate, trust }) {
  const steps = [];
  const step = (name, ok, detail = []) => { steps.push({ name, ok, ...(detail.length ? { detail } : {}) }); return ok; };
  const git = gitIn(repo);
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  const branch = config.trusted_branch ?? 'main';
  const approvedBase = trust.allows('baseline', baseline.name);
  step('the baseline is approved', approvedBase, approvedBase ? [] : ['owner approval evidence for the baseline is missing or invalid']);
  const descends = candidate.isAncestor(baseline.name);
  step('the candidate descends from the baseline', descends, descends ? [] : ['the trusted branch can only fast-forward; rebuild the round on the current baseline']);
  const records = validateRecords(candidate, rd);
  step('the candidate records validate', records.ok, records.errors);

  const before = loadAll(baseline, rd);
  const after = loadAll(candidate, rd);
  const finished = [...after.tasks.values()].map(r => r.data).filter(t => t?.id && t.status === 'Done' && before.tasks.get(t.id)?.data?.status !== 'Done');
  const groups = new Map();
  for (const t of finished) {
    if (!SHA.test(t.baseline_revision ?? '') || !SHA.test(t.verified ?? '')) { step(`${t.id} records the revisions it was gated at`, false, ['a Done task needs baseline_revision and verified (the candidate its receipts name)']); continue; }
    const key = `${t.baseline_revision} ${t.verified}`;
    groups.set(key, [...(groups.get(key) ?? []), t.id]);
  }
  for (const [key, ids] of groups) {
    const [from, to] = key.split(' ');
    const name = `wf ci for ${ids.join(', ')} at ${to.slice(0, 12)} against ${from.slice(0, 12)}`;
    if (!candidate.isAncestor(to)) { step(name, false, ['the verified candidate is not in the history of the revision being closed']); continue; }
    let base, cand;
    try { base = gitSource(repo, from); cand = gitSource(repo, to); } catch (e) { step(name, false, [e.message]); continue; }
    if (!cand.isAncestor(base.name)) { step(name, false, ['the verified candidate does not contain its recorded baseline']); continue; }
    const diff = git('diff', '--no-renames', '--name-only', '-z', from, to, '--');
    if (!diff.ok) { step(name, false, ['cannot compute the task diff']); continue; }
    const result = evaluateCi({ baseline: base, candidate: cand, ...(ids.length > 1 ? { tasks: ids } : { task: ids[0] }), trust, changed: diff.out.split('\0').filter(Boolean) });
    step(name, result.verdict === 'pass', result.verdict === 'pass' ? [] : result.findings.filter(f => !/^(planning|production|generated|governing|enforcement): /.test(f)));
  }

  const receiptRevisions = [...trust.revisions()].filter(x => SHA.test(x) && candidate.isAncestor(x) && git('merge-base', '--is-ancestor', baseline.name, x).ok);
  for (const m of [...after.milestones.values()].map(r => r.data).filter(m => m?.id && m.status === 'Accepted' && before.milestones.get(m.id)?.data?.status !== 'Accepted')) {
    const needed = list(m.acceptance);
    const covering = receiptRevisions.find(x => {
      const a = trust.peek('acceptance', x)?.payload;
      return a?.decision === 'accepted' && needed.every(id => a.scenarios?.includes(id));
    });
    if (covering) trust.claim('acceptance', covering);
    step(`${m.id} acceptance covers ${needed.join(', ') || 'no scenarios'}`, !!covering, covering ? [] : ['no owner acceptance receipt in this round names every scenario of the milestone']);
  }

  const approval = trust.derivation ? trust.derivation(candidate.name) : { approved: trust.allows('baseline', candidate.name), via: 'receipt' };
  step(`the candidate is an approved baseline${approval.approved ? ` (${approval.via})` : ''}`, approval.approved, approval.reasons ?? []);

  const ok = steps.every(s => s.ok);
  const state = trustedBranchState({ repo, branch, trust });
  const current = git('branch', '--show-current').out.trim();
  const notes = [];
  const moved = state && state.tip !== baseline.name;
  if (moved) notes.push(`the local ${branch} is at ${state.tip.slice(0, 12)}, not the baseline given; run closeout against its actual tip`);
  if (!state) notes.push(`there is no local branch ${branch}`);
  const fastForward = !ok || moved ? null
    : current === branch ? `git -C ${JSON.stringify(repo)} merge --ff-only ${candidate.name}`
    : `git -C ${JSON.stringify(repo)} update-ref refs/heads/${branch} ${candidate.name}${state ? ` ${baseline.name}` : ''}`;
  return { ok, baseline: baseline.name, candidate: candidate.name, branch, steps, notes, fast_forward: fastForward, limitation: 'Read-only. It re-runs the recorded gates on the signed receipts and prints the fast-forward; it moves no branch and publishes nothing.' };
}
