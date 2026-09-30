// Derived baseline approval (POLICY § 7, procedures/approval-evidence.md *Derived baselines*), for manual mode when
// the approved baseline's config sets `approval.derived_baselines: true`. A baseline receipt approves a revision's
// governing content; a revision the owner has already approved piece by piece needs no receipt of its own. A revision
// R is an approved baseline when its nearest explicitly approved first-parent ancestor A has that setting and every
// path that differs between A and R is covered by an owner receipt at some revision X between them, with the path
// unchanged from X to R:
//   governing path   a governing-change receipt at X listing it
//   enforcement path a workflow-change receipt at X listing it
//   production path  verification, review and integration receipts at X (the evidence `wf ci` requires), complete,
//                    with every check and test passed and the approved profile's required checks among them
//   planning path    nothing, as for a planning-only change in `wf ci` and a records-only merge in enforced mode
//   unclassified     never
// and R's records validate. Classification uses A's config. Nothing is derived in enforced mode, where the fetched
// branch is already the approved baseline. A derivation that relied on an unsigned payload is provisional.
import { spawnSync } from 'node:child_process';
import { gitSource } from './sources.js';
import { list, loadAll, loadConfig, validateRecords } from './records.js';
import { classifyPaths } from './paths.js';
import { payloadProblems } from './payloads.js';

const SHA = /^[0-9a-f]{40,64}$/;
export const MAX_WALK = 1000;
const PURPOSE = { governing: 'governing-change', enforcement: 'workflow-change' };
const EVIDENCE = ['verification', 'review', 'integration'];

export function gitIn(repo) {
  return (...args) => {
    const r = spawnSync('git', ['--literal-pathspecs', '-C', repo, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
    return { ok: r.status === 0, out: r.stdout ?? '' };
  };
}
const names = out => out.split('\0').filter(Boolean);

// The nearest first-parent ancestor of revision (itself excluded) whose baseline approval is a receipt, and the
// number of commits between them. `look(purpose, revision)` returns a usable payload or null.
function nearestReceipted(git, look, revision) {
  const walk = git('rev-list', '--first-parent', `--max-count=${MAX_WALK}`, revision);
  if (!walk.ok) return null;
  const chain = walk.out.split('\n').filter(Boolean);
  for (let i = 1; i < chain.length; i++) if (look('baseline', chain[i])) return { revision: chain[i], ahead: i };
  return null;
}
// A receipt counts toward a derivation only when the gates would accept its content, not merely its signature.
const passed = p => (p.checks ?? []).every(c => c?.result === 'passed') && (p.execution?.tests ?? []).every(t => t?.status === 'passed');
function sound(p, requiredChecks) {
  if (!p || payloadProblems(p).length) return false;
  if (!['verification', 'integration'].includes(p.purpose)) return true;
  return passed(p) && requiredChecks.every(name => p.checks.some(c => c?.name === name && c.result === 'passed'));
}

export function withDerivedBaselines(trust, repo) {
  if (!trust || trust.mode === 'enforced' || typeof trust.peek !== 'function') return trust;
  const git = gitIn(repo);
  const ancestor = (older, newer) => git('merge-base', '--is-ancestor', older, newer).ok;
  // Explains, and with `record` claims the receipts it used (so an unsigned one marks the gate provisional). With
  // `signedOnly` unsigned payloads count for nothing, as for the trusted-branch report.
  const explain = (revision, { record = true, signedOnly = false } = {}) => {
    const look = (purpose, rev) => { const f = trust.peek(purpose, rev); return f && (!signedOnly || f.level === 'signed') ? f.payload : null; };
    const take = (purpose, rev) => (look(purpose, rev) && record ? trust.claim(purpose, rev) : look(purpose, rev));
    if (!SHA.test(revision ?? '')) return { approved: false, via: null, reasons: ['not an immutable revision'] };
    if (take('baseline', revision)) return { approved: true, via: 'receipt', revision };
    const base = nearestReceipted(git, look, revision);
    if (!base) return { approved: false, via: null, revision, reasons: [`no baseline receipt on this revision or its last ${MAX_WALK} first-parent ancestors`] };
    const from = base.revision;
    const reasons = [];
    let config;
    try { config = loadConfig(gitSource(repo, from)); } catch (e) { return { approved: false, via: null, revision, from, reasons: [e.message] }; }
    if (config.approval?.derived_baselines !== true) return { approved: false, via: null, revision, from, reasons: [`derived baselines are not enabled by approval.derived_baselines in the config approved at ${from.slice(0, 12)}`] };
    const diff = git('diff', '--no-renames', '--name-only', '-z', from, revision, '--');
    if (!diff.ok) return { approved: false, via: null, revision, from, reasons: ['cannot compute the difference from the approved baseline'] };
    // Receipted revisions strictly after the approved baseline and no later than this one, with what changed after each.
    const later = [...trust.revisions()].filter(x => SHA.test(x) && x !== from && ancestor(from, x) && ancestor(x, revision))
      .map(x => ({ x, after: new Set(names(git('diff', '--no-renames', '--name-only', '-z', x, revision, '--').out)) }));
    const covering = (p, test) => later.find(({ x, after }) => !after.has(p) && test(x));
    let requiredChecks = [];
    try { requiredChecks = list(loadAll(gitSource(repo, from), config.records_dir ?? 'docs/workflow').profile?.data?.required_checks); } catch { /* no profile: nothing extra required */ }
    const covered = [];
    for (const c of classifyPaths(config, names(diff.out))) {
      if (c.category === 'planning') continue;
      if (c.category === 'unclassified') { reasons.push(`${c.path} is unclassified`); continue; }
      const purposes = PURPOSE[c.category] ? [PURPOSE[c.category]] : EVIDENCE;
      const hit = covering(c.path, x => purposes.every(purpose => {
        const found = look(purpose, x);
        return sound(found, requiredChecks) && (!PURPOSE[c.category] || found.paths.includes(c.path));
      }));
      if (!hit) { reasons.push(`${c.category} path ${c.path} has no complete, passing ${purposes.join('/')} receipt at a revision where it already had its current content`); continue; }
      for (const purpose of purposes) take(purpose, hit.x);
      covered.push({ path: c.path, category: c.category, receipt: hit.x });
    }
    let records;
    try { records = validateRecords(gitSource(repo, revision), config.records_dir ?? 'docs/workflow'); } catch (e) { records = { errors: [e.message] }; }
    for (const e of records.errors) reasons.push(`record: ${e}`);
    if (reasons.length) return { approved: false, via: null, revision, from, reasons };
    take('baseline', from);
    return { approved: true, via: 'derived', revision, from, covered };
  };
  return Object.freeze({
    ...(trust.mode ? { mode: trust.mode } : {}),
    claim: trust.claim, peek: trust.peek, revisions: trust.revisions, provisional: trust.provisional,
    allows: (purpose, revision) => (purpose === 'baseline' ? explain(revision).approved : trust.allows(purpose, revision)),
    derivation: explain,
  });
}

// Where the local trusted branch stands against approval (manual mode). `ahead` counts first-parent commits past the
// newest baseline receipt when the tip itself is not approved, explicitly or by derivation. Reading never records a
// claim, so an unsigned payload cannot turn this report into a provisional gate.
export function trustedBranchState({ repo, branch, trust }) {
  if (!trust || trust.mode === 'enforced' || typeof branch !== 'string' || !branch.trim()) return null;
  const git = gitIn(repo);
  const tip = git('rev-parse', '--verify', '--quiet', '--end-of-options', `refs/heads/${branch}^{commit}`);
  if (!tip.ok) return null;
  const revision = tip.out.trim();
  const signed = (purpose, rev) => (trust.peek?.(purpose, rev)?.level === 'signed' ? trust.peek(purpose, rev).payload : null);
  const approved = trust.derivation ? trust.derivation(revision, { record: false, signedOnly: true }).approved : !!signed('baseline', revision);
  if (approved) return { branch, tip: revision, approved: true, ahead: 0, newest_receipt: revision };
  const base = nearestReceipted(git, signed, revision);
  return { branch, tip: revision, approved: false, ahead: base?.ahead ?? null, newest_receipt: base?.revision ?? null };
}
