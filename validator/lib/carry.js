// MAINT-0016: whether evidence produced at an earlier revision of a pull request still covers its head. procedures/
// review.md assembles the candidate with the trusted branch after review and revalidates the review there; it does not
// redo it. The evidence carries over when every path changed since that revision is a planning record, or is one the
// pull request had not touched by then and that now holds the trusted branch's content: what a merge of that branch
// brings in. Matching the trusted branch alone is not enough (the independent review of MAINT-0016, C1): deleting or
// reverting reviewed work, or settling a conflict by taking the trusted branch's side, also leaves the head equal to it.
// The task's own code, an acceptance test, or a merge that combined both sides' edits needs new evidence.
import { classifyPaths } from './paths.js';

const SHA = /^[0-9a-f]{40,64}$/;
export function carriedFrom({ config, baseline, candidate, from }) {
  if (candidate.kind !== 'git' || baseline.kind !== 'git') return { ok: false, why: 'evidence carries over only between Git revisions' };
  if (from === candidate.name) return { ok: true, paths: [] };
  if (!SHA.test(from ?? '') || !candidate.isAncestor(from)) return { ok: false, why: `${String(from).slice(0, 12)} is not an earlier revision of this candidate` };
  const changed = candidate.changedPaths(from);
  const reviewed = candidate.atRevision(from), base = baseline.mergeBase(from);
  const before = base ? candidate.atRevision(base) : null;
  const merged = p => reviewed.blob(p) === (before ? before.blob(p) : null) && candidate.blob(p) === baseline.blob(p);
  const own = classifyPaths(config, changed).filter(c => (c.category !== 'planning' || c.acceptance_test) && !merged(c.path)).map(c => c.path);
  return own.length ? { ok: false, why: `changed since ${from.slice(0, 12)}: ${own.slice(0, 5).join(', ')}${own.length > 5 ? ', …' : ''}` } : { ok: true, paths: changed };
}
