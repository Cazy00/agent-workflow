// Derived baseline approval (POLICY § 7, procedures/approval-evidence.md *Derived baselines*), manual mode only. A
// baseline receipt approves a revision's governing content; a revision whose every difference from the owner's newest
// explicit approval is already approved by the owner's other receipts needs no baseline receipt of its own.
//
// R is derived-approved when all of these hold:
// - Its history holds baseline receipts and exactly one of them, A, has every other one in its history: the newest
//   approval governs, whatever route (a merge, a dropped branch) reaches it. Receipts that do not form one line, or an
//   ambiguous receipt at or after A, refuse derivation rather than step around it to an older, looser approval.
// - Both A's config and R's config set `approval.derived_baselines: true`: the owner can turn it off in either.
// - Every path that differs between A and R is classified by both configs, and meets what each category needs:
//     task or feedback record          nothing (records-only merges need no owner review in enforced mode either)
//     other planning path              covered as below by an evidence set or a change receipt listing it
//     governing / enforcement path     a governing-change / workflow-change receipt listing it
//     production / generated path      a complete evidence set (verification, review, integration) the gates accept
//   where "covered at X" means the receipt is at a revision X after A and no later than R, and the path is unchanged
//   from X to R. A path name that could pass for another (git.js unsafePath) is never derived.
// - When production content changed, one evidence set at a revision X has R's production content exactly, so the
//   assembled whole, not only its parts, was verified and integrated.
// - R's records validate.
// Git failures and shallow clones fail closed; Git reads are hardened against the clone's own config (git.js). A derivation
// that relied on an unsigned payload is provisional (never exit 0).
import { gitSource } from './sources.js';
import { gitRunner, unsafePath } from './git.js';
import { list, loadAll, loadConfig, validateRecords } from './records.js';
import { classifyPaths, isAcceptanceTest } from './paths.js';
import { payloadProblems } from './payloads.js';
import { mappedIds, pendingChange } from './acceptance.js';

const SHA = /^[0-9a-f]{40,64}$/;
const CHANGE = { governing: 'governing-change', enforcement: 'workflow-change' };
const EVIDENCE = ['verification', 'review', 'integration'];
const REVIEW_OWNED = ['Ready', 'Active', 'Done'];

export function gitIn(repo) {
  const run = gitRunner(repo); // lib/git.js: hostile clone config cannot change answers or run programs
  return (...args) => { const r = run(...args); return { ok: r.status === 0, status: r.status, out: r.stdout ?? '' }; };
}
// `merge-base --is-ancestor` exits 1 for "no"; anything else is an error, never an answer.
export function ancestorIn(git) {
  return (older, newer) => {
    if (older === newer) return true;
    const r = git('merge-base', '--is-ancestor', older, newer);
    if (r.status === 0 || r.status === 1) return r.status === 0;
    throw new Error(`git cannot tell whether ${String(older).slice(0, 12)} precedes ${String(newer).slice(0, 12)}`);
  };
}
const names = out => out.split('\0').filter(Boolean);
export const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

export function withDerivedBaselines(trust, repo) {
  if (!trust || trust.mode === 'enforced' || typeof trust.peek !== 'function') return trust;
  const git = gitIn(repo);
  const memo = new Map();
  const remember = (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); };
  const isAncestor = ancestorIn(git);
  const ancestor = (older, newer) => remember(`a ${older} ${newer}`, () => isAncestor(older, newer));
  const changedBetween = (from, to) => remember(`d ${from} ${to}`, () => { const d = git('diff-tree', '-r', '--no-renames', '--name-only', '-z', from, to, '--'); return d.ok ? new Set(names(d.out)) : null; });
  // Every commit in a revision's history, from one walk that fails if any of them is missing: a receipt for a commit
  // outside it (rebased away, pruned, never fetched) is simply not in that history.
  const historyOf = rev => remember(`h ${rev}`, () => { const r = git('rev-list', rev); if (!r.ok) throw new Error(`cannot walk the history of ${rev.slice(0, 12)}`); return new Set(r.out.split('\n').filter(Boolean)); });
  const source = rev => remember(`s ${rev}`, () => gitSource(repo, rev));
  const configAt = rev => remember(`c ${rev}`, () => { try { return loadConfig(source(rev)); } catch { return null; } });

  const compute = (revision, signedOnly) => {
    try { return derive(revision, signedOnly); } catch (e) { return { result: { approved: false, via: null, revision, reasons: [`git failed during derivation: ${e.message}`] }, used: [] }; }
  };
  const derive = (revision, signedOnly) => {
    const used = [];
    const look = (purpose, rev) => { const f = trust.peek(purpose, rev); return f && (!signedOnly || f.level === 'signed') ? f.payload : null; };
    const take = (purpose, rev) => { const p = look(purpose, rev); if (p) used.push([purpose, rev]); return p; };
    const refuse = (reasons, extra = {}) => ({ result: { approved: false, via: null, revision, ...extra, reasons }, used: [] });
    if (!SHA.test(revision ?? '')) return refuse(['not an immutable revision']);
    const shallow = git('rev-parse', '--is-shallow-repository');
    if (!shallow.ok || shallow.out.trim() !== 'false') return refuse(['the clone is shallow or unreadable: derivation needs the full history']);
    if (trust.ambiguous('baseline', revision)) return refuse(['the baseline receipts for this revision are ambiguous']);
    if (take('baseline', revision)) return { result: { approved: true, via: 'receipt', revision }, used };

    const history = historyOf(revision);
    const approvals = [...trust.revisions()].filter(x => SHA.test(x) && x !== revision && history.has(x) && (look('baseline', x) || trust.ambiguous('baseline', x)));
    if (!approvals.length) return refuse(['no baseline receipt in this revision\'s history']);
    const newest = approvals.filter(a => approvals.every(b => ancestor(b, a)));
    if (newest.length !== 1) return refuse(['the baseline receipts in this history do not form one line; the owner signs a baseline for the merge']);
    const from = newest[0];
    if (trust.ambiguous('baseline', from)) return refuse([`the newest baseline receipt in this history, at ${from.slice(0, 12)}, is ambiguous`], { from });
    const configs = [configAt(from), configAt(revision)];
    if (configs.some(c => c === null)) return refuse(['cannot read docs/workflow/config.json at the approved baseline and this revision'], { from });
    if (!configs.every(c => c.approval?.derived_baselines === true)) return refuse([`derived baselines need approval.derived_baselines: true in the config approved at ${from.slice(0, 12)} and in this revision's`], { from });
    const diff = changedBetween(from, revision);
    if (!diff) return refuse(['cannot compute the difference from the approved baseline'], { from });

    const records = new Set(configs.flatMap(c => ['tasks', 'feedback/inbox'].map(d => `${c.records_dir ?? 'docs/workflow'}/${d}/`)));
    const isRecord = p => [...records].some(dir => p.startsWith(dir) && !p.slice(dir.length).includes('/') && p.endsWith('.md'));
    const requiredChecks = [...new Set(configs.flatMap((c, i) => { try { return list(loadAll(source(i ? revision : from), c.records_dir ?? 'docs/workflow').profile?.data?.required_checks); } catch { return []; } }))];
    // Revisions after the approved baseline, no later than R, holding receipts; and what changed from each to R.
    const later = [...trust.revisions()].filter(x => SHA.test(x) && x !== from && history.has(x) && ancestor(from, x))
      .map(x => ({ x, after: changedBetween(x, revision) })).filter(l => l.after !== null);
    const evidenceAt = x => remember(`e ${x} ${signedOnly} ${JSON.stringify(requiredChecks)}`, () => EVIDENCE.every(purpose => sound(look(purpose, x), x)));
    function sound(p, x) {
      if (!p || payloadProblems(p).length) return false;
      const at = source(x);
      const resolves = ref => typeof ref === 'string' && ((typeof p.artifacts?.[ref] === 'string' && !!p.artifacts[ref].trim()) || (() => { try { return at.isFile(ref) && !!at.read(ref)?.trim(); } catch { return false; } })());
      if (p.purpose === 'review') {
        // As lifecycle.js: the implementer is the task's owner, the reviewer is not, and the evidence resolves.
        let owners = [];
        try { owners = [...loadAll(at, configAt(x)?.records_dir ?? 'docs/workflow').tasks.values()].map(r => r.data).filter(t => REVIEW_OWNED.includes(t?.status)).map(t => t.owner); } catch { return false; }
        return owners.includes(p.implementer) && !owners.includes(p.reviewer) && resolves(p.evidence);
      }
      if (!p.checks.every(c => c?.result === 'passed' && resolves(c.evidence)) || !requiredChecks.every(name => p.checks.some(c => c?.name === name))) return false;
      if (p.purpose !== 'verification') return true;
      // As acceptance.js: every test the revision's map names ran exactly once and passed; others may be skipped. A
      // pending test (MAINT-0012) is not excused here: a revision whose evidence has one is approved by an explicit
      // baseline receipt, never derived.
      let map;
      try { const raw = at.read('tests/acceptance-map.json'); map = raw == null ? [] : JSON.parse(raw); } catch { return false; }
      if (!Array.isArray(map)) return false;
      return map.every(m => { const r = p.execution.tests.filter(t => t?.file === m?.file && t?.name === m?.name); return r.length === 1 && r[0].status === 'passed'; });
    }
    const unchangedAt = (p, test) => later.find(({ x, after }) => !after.has(p) && test(x));
    const changeListing = (purpose, p) => x => { const c = look(purpose, x); return !!c && !payloadProblems(c).length && c.paths.includes(p); };
    const productionLike = p => configs.some(c => ['production', 'generated'].includes(classifyPaths(c, [p])[0].category));

    const reasons = [];
    const covered = [];
    let production = false;
    for (const p of diff) {
      if (unsafePath(p)) { reasons.push(`path ${JSON.stringify(p)} could pass for another (a backslash, a control, format or invisible character, or unusual whitespace) and is never derived`); continue; }
      const categories = new Set(configs.map(c => classifyPaths(c, [p])[0].category));
      if (categories.has('unclassified')) { reasons.push(`${p} is unclassified`); continue; }
      for (const category of categories) {
        let hit;
        if (category === 'planning') hit = isRecord(p) ? { x: null } : unchangedAt(p, x => evidenceAt(x) || changeListing('governing-change', p)(x) || changeListing('workflow-change', p)(x));
        else if (CHANGE[category]) hit = unchangedAt(p, changeListing(CHANGE[category], p));
        else { hit = unchangedAt(p, evidenceAt); production = true; }
        if (!hit) reasons.push(`${category} path ${p} is not covered by an owner receipt at a revision where it already had its current content`);
        else if (hit.x) covered.push({ path: p, category, receipt: hit.x });
      }
      // An owner-approved acceptance test (paths.acceptance_tests in either config) also needs the governing-change.
      if (configs.some(c => isAcceptanceTest(c, p)) && !categories.has('governing')) {
        const hit = unchangedAt(p, changeListing('governing-change', p));
        if (!hit) reasons.push(`acceptance test ${p} is not covered by the owner's governing-change receipt at a revision where it already had its current content`);
        else covered.push({ path: p, category: 'governing', receipt: hit.x });
      }
    }
    if (production && !reasons.length) {
      const assembled = later.find(({ x, after }) => evidenceAt(x) && ![...after].some(productionLike));
      if (!assembled) reasons.push('no complete evidence set was given at a revision with this revision\'s production content, so the assembled whole was never verified and integrated');
      else covered.push({ path: '(assembled production content)', category: 'production', receipt: assembled.x });
    }
    let validation;
    try { validation = validateRecords(source(revision), configs[1].records_dir ?? 'docs/workflow'); } catch (e) { validation = { errors: [e.message] }; }
    for (const e of validation.errors) reasons.push(`record: ${e}`);
    // Task records ride along without a receipt, but which scenarios with a mapped test wait for which tasks is the
    // owner's (MAINT-0012): records the round changes must not make one wait for a new task, nor, in a round with no
    // production content, complete one without a test run. A milestone record is a governing path, covered above.
    try {
      const rds = configs.map(c => c.records_dir ?? 'docs/workflow');
      const [was, is] = [loadAll(source(from), rds[0]), loadAll(source(revision), rds[1])];
      const waits = pendingChange(was, is, mappedIds(source(from)), mappedIds(source(revision)));
      const changedTask = id => [was.tasks.get(id)?.path, is.tasks.get(id)?.path].some(p => p && diff.has(p));
      const added = waits.added.filter(w => changedTask(w.task)).map(w => `${w.acceptance} for ${w.task}`);
      // A round with production content was verified above with every mapped test passed, so only a records-only one
      // completes a scenario without a test run.
      const completed = production ? [] : waits.completed.filter(w => w.tasks.some(changedTask)).map(w => w.acceptance);
      if (added.length) reasons.push(`records make acceptance scenarios wait for tasks they did not wait for at the approved baseline (${added.join(', ')}); only an explicit baseline receipt approves that`);
      if (completed.length) reasons.push(`records complete acceptance scenarios without a test run (${completed.join(', ')}); only an explicit baseline receipt approves that`);
    } catch (e) { reasons.push(`cannot compare which acceptance scenarios wait for tasks: ${e.message}`); }
    if (reasons.length) return refuse(reasons, { from });
    // Claim what the derivation used, so a gate that relied on an unsigned payload is provisional.
    take('baseline', from);
    for (const { receipt, category, path } of covered) {
      if (CHANGE[category]) take(CHANGE[category], receipt);
      else if (category === 'planning' && !evidenceAt(receipt)) Object.values(CHANGE).forEach(purpose => { if (changeListing(purpose, path)(receipt)) take(purpose, receipt); });
      else EVIDENCE.forEach(purpose => take(purpose, receipt));
    }
    return { result: { approved: true, via: 'derived', revision, from, covered }, used };
  };

  const explain = (revision, { record = true, signedOnly = false } = {}) => {
    const { result, used } = remember(`x ${revision} ${signedOnly}`, () => compute(revision, signedOnly));
    if (record) for (const [purpose, rev] of used) trust.claim(purpose, rev);
    return result;
  };
  return Object.freeze({
    ...(trust.mode ? { mode: trust.mode } : {}),
    claim: trust.claim, peek: trust.peek, ambiguous: trust.ambiguous, revisions: trust.revisions, provisional: trust.provisional,
    allows: (purpose, revision) => (purpose === 'baseline' ? explain(revision).approved : trust.allows(purpose, revision)),
    derivation: explain,
  });
}

// Where the local trusted branch stands against approval (manual mode), from signed receipts only: an unsigned
// payload never makes the tip look approved, and reading records no claim. `ahead` counts first-parent commits from
// the tip back to its newest signed baseline receipt when the tip itself is not approved.
export function trustedBranchState({ repo, branch, trust }) {
  if (!trust || trust.mode === 'enforced' || typeof branch !== 'string' || !branch.trim()) return null;
  const git = gitIn(repo);
  if (branch.startsWith('-') || !git('check-ref-format', '--branch', branch).ok) return null;
  const tip = git('rev-parse', '--verify', '--quiet', '--end-of-options', `refs/heads/${branch}^{commit}`);
  if (!tip.ok) return null;
  const revision = tip.out.trim();
  const signed = rev => trust.peek?.('baseline', rev)?.level === 'signed';
  const approved = trust.derivation ? trust.derivation(revision, { record: false, signedOnly: true }).approved : signed(revision);
  if (approved) return { branch, tip: revision, approved: true, ahead: 0, newest_receipt: revision };
  const walk = git('rev-list', '--first-parent', '--max-count=1000', revision);
  const chain = walk.ok ? walk.out.split('\n').filter(Boolean) : [];
  const at = chain.findIndex((rev, i) => i > 0 && signed(rev));
  return { branch, tip: revision, approved: false, ahead: at > 0 ? at : null, newest_receipt: at > 0 ? chain[at] : null };
}
