// MAINT-0023 P5(b), P5(c): which run of the trusted branch may stand for a task's `baseline_result`, and the hint `wf next` prints for
// a claim. `baseline_result` is their result on the baseline, run once before the task starts (procedures/readiness.md); the trusted
// branch's own run on the baseline commit counts. Two cases need no further run, because the code the run tested is the baseline's:
// - merge-head: the baseline is a merge commit whose tree equals its second parent's, the merged pull request's head, so a passing
//   run of that head tested the baseline's code (a squash or rebase merge has no such parent and falls back to the rule above);
// - records-only: an ancestor on the trusted branch's first-parent line differs from the baseline only under the records
//   directory, so a passing run of that ancestor tested the baseline's code (the last code commit's run, for records-only merges).
// The gate reads only the format of `baseline_result` (records.js), so nothing here grants anything: this checks the run before the
// agent writes its reference, because a green head whose test-merge held other code, or a run that failed, is not the baseline's.
import { classifyPaths } from './paths.js';
import { loadConfig } from './records.js';
import { httpsRun } from './acceptance.js';

const short = sha => String(sha ?? '').slice(0, 12);
const MAX_RECORDS_ONLY = 5; // runs are read from GitHub one commit at a time
const SAME_CODE_EVENTS = ['push', 'workflow_dispatch']; // the ref's own tip is what they test
// The events whose runs test a commit. A run of any other event (`schedule`: wf-status refreshing the issue every few hours, wf-client-page
// rebuilding the page) ran the workflow's file from the branch tip and tested nothing about this commit, so it neither lends nor rejects.
const TESTING_EVENTS = [...SAME_CODE_EVENTS, 'pull_request'];
// What a records-only difference may hold: the planning records. The config (workflow pin, paths, required checks), the acceptance
// definitions and the profile are in the records directory too, but they change what the project's own checks run.
const NOT_PLANNING = ['config.json', 'acceptance.json', 'profile.md'];

export function baselineCandidates(source, recordsDir) {
  if (source?.kind !== 'git') return [];
  const out = [];
  try {
    const parents = source.parents();
    if (parents?.length === 2) {
      const head = parents[1];
      if (source.atRevision(head).tree() === source.tree()) {
        const number = source.subject()?.match(/^Merge pull request #(\d+)\b/)?.[1];
        out.push({ kind: 'merge-head', commit: head, number: number ? Number(number) : null });
      }
    }
  } catch { /* a head this clone lacks (shallow): no candidate */ }
  try {
    const own = `${recordsDir}/`;
    const config = loadConfig(source);
    const planning = p => p.startsWith(own) && !NOT_PLANNING.includes(p.slice(own.length)) && classifyPaths(config, [p]).every(c => c.category === 'planning' && !c.acceptance_test);
    for (const commit of (source.firstParentChain() ?? []).slice(1)) {
      if (out.filter(c => c.kind === 'records-only').length >= MAX_RECORDS_ONLY) break;
      if (!source.changedPaths(commit).every(planning)) break;
      out.push({ kind: 'records-only', commit });
    }
  } catch { /* history this clone lacks, or a config that does not load: the candidates found so far stand */ }
  return out;
}

// One run against one candidate. A `pull_request` run tested GitHub's test-merge of its head into the base as it was when the run
// started (`pull_requests[].base.sha`); that tree is the head's own only when the base was already part of the head.
export function judgeRun({ source, candidate, run }) {
  const id = `run ${run.id ?? '?'}`;
  if (run.head_sha !== candidate.commit) return { ok: false, reason: `${id} ran on ${short(run.head_sha)}, not ${short(candidate.commit)}` };
  if (run.status !== 'completed') return { ok: false, reason: `${id} of ${short(candidate.commit)} is ${run.status}` };
  if (run.conclusion !== 'success') return { ok: false, reason: `${id} of ${short(candidate.commit)} ended ${run.conclusion}` };
  if (!httpsRun(run.html_url)) return { ok: false, reason: `${id} has no https link to name` };
  if (!SAME_CODE_EVENTS.includes(run.event)) {
    if (!(candidate.kind === 'merge-head' && run.event === 'pull_request')) return { ok: false, reason: `${id} was a ${run.event} run, which did not test ${short(candidate.commit)} as it is` };
    const base = run.pull_requests?.[0]?.base?.sha;
    if (!/^[0-9a-f]{40,64}$/.test(base ?? '')) return { ok: false, reason: `${id} does not say which base its test-merge used, so the tree it tested is unknown` };
    if (!source.atRevision(candidate.commit).isAncestor(base)) return { ok: false, reason: `${id} tested a test-merge with base ${short(base)}, which the head does not contain: the tree it tested is not the head's` };
  }
  return { ok: true, reference: run.html_url };
}

// The newest run of each workflow that tests the commit decides, as `wf wait` counts only the newest run of each check.
const newestPerWorkflow = runs => {
  const by = new Map();
  const key = r => [Number(r.run_number) || 0, Number(r.run_attempt) || 0, String(r.created_at ?? '')];
  const later = (a, b) => { const [x, y] = [key(a), key(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  for (const r of runs) { const k = r.workflow_id ?? r.name; if (!by.has(k) || later(r, by.get(k))) by.set(k, r); }
  return [...by.values()];
};

const valueOf = (candidate, reference) => candidate.kind === 'merge-head'
  ? `pass: ${reference} (head of ${candidate.number ? `#${candidate.number}` : 'the merged pull request'})`
  : `pass: ${reference} (code unchanged since ${short(candidate.commit)})`;

// `runsFor(sha)` returns the workflow runs of a commit (or throws); null means the runs cannot be read, and the hint then names the
// commits only. A candidate commit lends a run only when every testing workflow's newest run on it passed (schedule runs and other events that did not test it are left out); the nearest such commit is used.
export function baselineHint({ source, recordsDir = 'docs/workflow', runsFor = null }) {
  const candidates = baselineCandidates(source, recordsDir);
  const hint = { candidates, results: [], notes: [] };
  if (!candidates.length) return hint;
  if (!runsFor) { hint.how = 'wf next --check-runs reads these commits\' runs from GitHub and prints the baseline_result to record; without it, record the baseline commit\'s own run as before'; return hint; }
  for (const candidate of candidates) {
    let runs;
    try { runs = runsFor(candidate.commit); } catch (e) { hint.notes.push(`could not read the runs of ${short(candidate.commit)}: ${e.message}`); continue; }
    const ofCommit = Array.isArray(runs) ? runs.filter(r => r?.head_sha === candidate.commit) : [];
    const newest = newestPerWorkflow(ofCommit.filter(r => TESTING_EVENTS.includes(r.event)));
    if (!newest.length) { hint.notes.push(ofCommit.length ? `no run of ${short(candidate.commit)} (${candidate.kind}) tested it: its runs were ${[...new Set(ofCommit.map(r => `${r.name ?? 'a workflow'} (${r.event})`))].join(', ')}` : `no run of ${short(candidate.commit)} (${candidate.kind})`); continue; }
    const judged = newest.map(run => ({ run, ...judgeRun({ source, candidate, run }) }));
    const bad = judged.filter(j => !j.ok);
    if (bad.length) { hint.notes.push(...bad.map(j => j.reason)); continue; }
    hint.results.push(...judged.map(j => ({ value: valueOf(candidate, j.reference), commit: candidate.commit, kind: candidate.kind, reference: j.reference, workflow: j.run.name ?? null })));
    break;
  }
  return hint;
}
