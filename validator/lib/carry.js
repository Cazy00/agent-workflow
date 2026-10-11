// MAINT-0016: whether evidence produced at an earlier revision of a pull request still covers its head. procedures/
// review.md assembles the candidate with the trusted branch after review and revalidates the review there; it does not
// redo it. The evidence carries over when every path changed since that revision holds the trusted branch's own content
// (as a merge of that branch leaves it) or is a planning record. The task's own code, an acceptance test, or a merge
// that combined both sides' edits to one file needs new evidence.
import { classifyPaths } from './paths.js';

const SHA = /^[0-9a-f]{40,64}$/;
export function carriedFrom({ config, baseline, candidate, from }) {
  if (candidate.kind !== 'git' || baseline.kind !== 'git') return { ok: false, why: 'evidence carries over only between Git revisions' };
  if (from === candidate.name) return { ok: true, paths: [] };
  if (!SHA.test(from ?? '') || !candidate.isAncestor(from)) return { ok: false, why: `${String(from).slice(0, 12)} is not an earlier revision of this candidate` };
  const changed = candidate.changedPaths(from);
  const own = classifyPaths(config, changed).filter(c => (c.category !== 'planning' || c.acceptance_test) && candidate.blob(c.path) !== baseline.blob(c.path)).map(c => c.path);
  return own.length ? { ok: false, why: `changed since ${from.slice(0, 12)}: ${own.slice(0, 5).join(', ')}${own.length > 5 ? ', …' : ''}` } : { ok: true, paths: changed };
}
