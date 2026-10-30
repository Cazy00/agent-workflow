// MAINT-0025 (v2.14.0): when a push to the trusted branch may reuse the result of the pull request that produced it, instead of running
// every test again (procedures/delivery.md, "Faster CI"). The rule is exact: the PR's checks ran on a *test merge commit* (GitHub's merge
// of the head into the base as it was then), and a passing run leaves that commit's tree SHA as a marker on the PR head. A push reuses
// the result only when the tree it produced is that very tree. Equal trees are equal content, so the tests would see the same files.
// Anything else runs in full: a PR that was behind main (another PR landed after the run, so main's new tree holds files the test merge
// never had), a squash that lost a conflict resolution, a push with no pull request, a marker that is missing, malformed or not a pass.
// This decides nothing about who may merge and grants nothing; a project's workflow reads it to skip its own jobs.
export const MARKER_CONTEXT = 'wf-tested-tree';
const OBJECT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

// The text the passing PR run leaves (a commit status description on the PR head): the tree and the commit it was taken from.
export const formatMarker = ({ tree, merge }) => {
  if (!OBJECT.test(tree ?? '') || !OBJECT.test(merge ?? '')) throw new Error('a marker needs a tree and a commit, both full object names');
  return `tree=${tree} merge=${merge}`;
};
export function parseMarker(text) {
  const m = /^tree=([0-9a-f]{40}|[0-9a-f]{64}) merge=([0-9a-f]{40}|[0-9a-f]{64})$/.exec(String(text ?? '').trim());
  return m ? { tree: m[1], merge: m[2] } : null;
}

// `candidate`: the commit the push produced, as { tree } (its tree SHA). `marker`: the marker text of the pull request's passing run, or
// null when none was found. Returns { reuse, reason }.
export function decideReuse({ candidate, marker }) {
  if (!OBJECT.test(candidate?.tree ?? '')) return { reuse: false, reason: 'the pushed commit\'s tree is unknown: running everything' };
  if (marker == null || marker === '' || marker === 'none') return { reuse: false, reason: 'no passing pull request result was found for this commit: running everything' };
  const tested = parseMarker(marker);
  if (!tested) return { reuse: false, reason: 'the pull request\'s marker is malformed: running everything' };
  if (tested.tree !== candidate.tree) return { reuse: false, reason: `the pull request passed on tree ${tested.tree.slice(0, 12)} (test merge ${tested.merge.slice(0, 12)}), but this commit's tree is ${candidate.tree.slice(0, 12)}: the pull request was behind the trusted branch, or its merge changed the result: running everything` };
  return { reuse: true, reason: `this commit's tree is the tree ${tested.tree.slice(0, 12)} the pull request's checks passed on (test merge ${tested.merge.slice(0, 12)}): reusing that result` };
}
