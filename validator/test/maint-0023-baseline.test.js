import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gitSource } from '../lib/sources.js';
import { baselineHint, judgeRun } from '../lib/baseline-run.js';
import { workflowRuns, CHECK_RUNS_SECONDS } from '../lib/wait.js';
import { project, taskPath } from './helpers/maint-0018.js';

// MAINT-0023 P5: the baseline result of a task names a run. (a) `pass: <reference>` is accepted beside `pass`; (b) a baseline
// that is a merge commit whose tree is its second parent's takes that parent's passing run; (c) a baseline that differs from an
// ancestor only under docs/workflow/ takes the ancestor's. `wf next` checks the run before it is named; the gate reads only the
// format, so none of this grants anything.
const baselineIs = text => x => x.replace(/^baseline_result: .*$/m, `baseline_result: ${text}`);
const URL = id => `https://github.com/fixture/project/actions/runs/${id}`;
const run = (id, sha, extra = {}) => ({ id, name: 'CI', workflow_id: 1, event: 'push', status: 'completed', conclusion: 'success', head_sha: sha, html_url: URL(id), run_number: id, created_at: `2026-10-27T10:0${id % 10}:00Z`, pull_requests: [], ...extra });

test('MAINT-0023 P5(a): baseline_result takes "pass: <reference>" beside "pass", and refuses an empty reference', t => {
  const p = project(t);
  for (const ok of ['pass', `pass: ${URL(9)}`, 'pass: main\'s CI run https://github.com/fixture/project/actions/runs/9', 'fail: 3 pricing tests', 'pending: run 42']) {
    p.edit(taskPath, baselineIs(ok));
    const r = p.run(['records']);
    assert.equal(r.status, 0, `${ok}: ${r.stdout}`);
  }
  for (const bad of ['pass:', 'pass:   ', 'passed', 'pass something', 'pending:', 'waiting for main']) {
    p.edit(taskPath, baselineIs(bad));
    const r = p.run(['records']);
    assert.equal(r.status, 1, bad);
    assert.match(r.out.errors.join(' | '), /baseline_result must be "pass", "pass: <run reference>", "fail: <summary>" or "pending: <run reference>"/, bad);
  }
});

// A trunk with a task Ready, and a pull request branch that adds code. `merge()` merges it without fast-forward, as GitHub's
// "Create a merge commit" does.
function withPullRequest(t, { trunkMoves = false } = {}) {
  const p = project(t);
  p.git('switch', '-q', '-c', 'pr');
  p.write('src/a.js', 'export const a = 1;\n');
  const head = p.commit('the pull request\'s work');
  p.git('switch', '-q', 'main');
  let moved = null;
  if (trunkMoves) { p.write('src/b.js', 'export const b = 1;\n'); moved = p.commit('another pull request landed first'); }
  p.git('merge', '-q', '--no-ff', '-m', 'Merge pull request #7 from fixture/pr', 'pr');
  return { p, head, moved, merged: p.git('rev-parse', 'HEAD') };
}
const hint = (p, sha, runs) => baselineHint({ source: gitSource(p.repo, sha), recordsDir: 'docs/workflow', runsFor: s => runs[s] ?? [] });

test('MAINT-0023 P5(b): a merge commit whose tree is its pull request head\'s names the passing run of that head', t => {
  const { p, head, merged } = withPullRequest(t);
  assert.equal(p.git('rev-parse', `${merged}^{tree}`), p.git('rev-parse', `${head}^{tree}`), 'the fixture: equal trees');
  const h = hint(p, merged, { [head]: [run(3, head)] });
  assert.deepEqual(h.results.map(r => r.value), [`pass: ${URL(3)} (head of #7)`]);
  assert.equal(h.results[0].commit, head);
  // A pull_request run tested a test-merge; with the base already in the head, that merge is the head's own tree.
  const base = p.git('rev-parse', `${head}^`);
  const viaPr = hint(p, merged, { [head]: [run(4, head, { event: 'pull_request', pull_requests: [{ number: 7, base: { sha: base } }] })] });
  assert.deepEqual(viaPr.results.map(r => r.value), [`pass: ${URL(4)} (head of #7)`]);
});

test('MAINT-0023 P5(b): trees that differ name no run, however green the head was', t => {
  const { p, head, merged } = withPullRequest(t, { trunkMoves: true });
  assert.notEqual(p.git('rev-parse', `${merged}^{tree}`), p.git('rev-parse', `${head}^{tree}`), 'the fixture: trunk moved, so the merge is not the head');
  const h = hint(p, merged, { [head]: [run(3, head)] });
  assert.deepEqual(h.results, []);
  assert.ok(!h.candidates.some(c => c.kind === 'merge-head'));
});

test('MAINT-0023 P5(b): a failed, cancelled or unfinished run is not named, and says why', t => {
  const { p, head, merged } = withPullRequest(t);
  for (const [extra, why] of [[{ conclusion: 'failure' }, /failure/], [{ conclusion: 'cancelled' }, /cancelled/], [{ status: 'in_progress', conclusion: null }, /in_progress/]]) {
    const h = hint(p, merged, { [head]: [run(3, head, extra)] });
    assert.deepEqual(h.results, [], JSON.stringify(extra));
    assert.match(h.notes.join(' | '), why, JSON.stringify(extra));
  }
  // The newest run of a workflow decides: a later pass of the same workflow replaces an earlier failure, a later failure an earlier pass.
  const rerun = hint(p, merged, { [head]: [run(3, head, { conclusion: 'failure' }), run(5, head)] });
  assert.deepEqual(rerun.results.map(r => r.value), [`pass: ${URL(5)} (head of #7)`]);
  const broken = hint(p, merged, { [head]: [run(3, head), run(5, head, { conclusion: 'failure' })] });
  assert.deepEqual(broken.results, []);
  // A run of another commit is not the head's.
  assert.deepEqual(hint(p, merged, { [head]: [run(3, 'd'.repeat(40))] }).results, []);
});

test('MAINT-0023 P5(b): a pull_request run that tested a stale test-merge is not named', t => {
  const p = project(t);
  // Trunk lands X and reverts it before the pull request merges, so the merge commit's tree is the head's although the head
  // never contained X: a run whose test-merge included X tested something else.
  p.write('src/x.js', 'export const x = 1;\n'); const x = p.commit('X');
  p.git('revert', '--no-edit', 'HEAD'); const reverted = p.git('rev-parse', 'HEAD');
  p.git('switch', '-q', '-c', 'pr', p.baseline);
  p.write('src/a.js', 'export const a = 1;\n'); const head = p.commit('the work');
  p.git('switch', '-q', 'main');
  p.git('merge', '-q', '--no-ff', '-m', 'Merge pull request #8 from fixture/pr', 'pr');
  const merged = p.git('rev-parse', 'HEAD');
  assert.equal(p.git('rev-parse', `${merged}^{tree}`), p.git('rev-parse', `${head}^{tree}`), 'the fixture: equal trees');
  const stale = hint(p, merged, { [head]: [run(6, head, { event: 'pull_request', pull_requests: [{ number: 8, base: { sha: x } }] })] });
  assert.deepEqual(stale.results, []);
  assert.match(stale.notes.join(' | '), /test-merge/);
  const current = hint(p, merged, { [head]: [run(7, head, { event: 'pull_request', pull_requests: [{ number: 8, base: { sha: p.baseline } }] })] });
  assert.deepEqual(current.results.map(r => r.value), [`pass: ${URL(7)} (head of #8)`]);
  // A run that does not say which base it merged with cannot be judged; pull_request_target tests the base, not the head.
  assert.deepEqual(hint(p, merged, { [head]: [run(8, head, { event: 'pull_request' })] }).results, []);
  assert.deepEqual(hint(p, merged, { [head]: [run(9, head, { event: 'pull_request_target' })] }).results, []);
  assert.ok(reverted);
});

test('MAINT-0023 P5(b): a squash or rebase merge falls back to today\'s rule', t => {
  const p = project(t);
  p.write('src/a.js', 'export const a = 1;\n');
  const squashed = p.commit('the pull request, squashed (#7)');
  const h = hint(p, squashed, {});
  assert.deepEqual(h.candidates.filter(c => c.kind === 'merge-head'), []);
});

test('MAINT-0023 P5(c): an ancestor that differs only under docs/workflow/ lends its passing run; one code file ends the walk', t => {
  const p = project(t);
  p.write('src/a.js', 'export const a = 1;\n');
  const code = p.commit('the last code commit');
  p.write('docs/workflow/notes.md', 'records only\n');
  const records1 = p.commit('records: one');
  p.write('docs/workflow/notes2.md', 'records only\n');
  const records2 = p.commit('records: two');
  const runs = { [code]: [run(11, code)], [records1]: [run(12, records1, { conclusion: 'failure' })] };
  const h = hint(p, records2, runs);
  assert.deepEqual(h.candidates.map(c => [c.kind, c.commit]), [['records-only', records1], ['records-only', code]]);
  // The nearest ancestor failed, so the next one with a passing run is named.
  assert.deepEqual(h.results.map(r => r.value), [`pass: ${URL(11)} (code unchanged since ${code.slice(0, 12)})`]);
  assert.equal(h.results[0].commit, code);
  // One code file in the difference ends the walk: the commit before the last code commit is not a candidate.
  assert.ok(!h.candidates.some(c => c.commit === p.baseline), 'the code commit changed src/a.js against the baseline');
  // A pull request's run is not an ancestor's run on the trusted branch.
  assert.deepEqual(hint(p, records2, { [code]: [run(13, code, { event: 'pull_request' })] }).results, []);
});

test('MAINT-0023 P5(c): a difference in code under the records directory\'s sibling is code', t => {
  const p = project(t);
  const first = p.git('rev-parse', 'HEAD');
  p.write('docs/workflow-extra/tool.js', 'export const t = 1;\n');
  const second = p.commit('a file whose path only starts like the records directory');
  const h = hint(p, second, { [first]: [run(14, first)] });
  assert.deepEqual(h.candidates, []);
});

// Review F3: only the planning records (tasks, feedback, notes) leave the code unchanged. The config (the workflow pin, paths and
// required checks), the acceptance definitions and the profile change what the project's own checks run.
test('MAINT-0023 P5(c): a change to the config, the acceptance definitions or the profile ends the walk', t => {
  for (const [file, change] of [['docs/workflow/config.json', x => JSON.stringify({ ...JSON.parse(x), setup_budget_days: 3 })], ['docs/workflow/acceptance.json', x => `${x}\n`], ['docs/workflow/profile.md', x => `${x}\nmore\n`]]) {
    const p = project(t);
    const before = p.git('rev-parse', 'HEAD');
    p.edit(file, change);
    const changed = p.commit(`a change to ${file}`);
    p.write('docs/workflow/notes.md', 'records only\n');
    const after = p.commit('records: a note');
    const h = hint(p, after, { [before]: [run(15, before)], [changed]: [run(16, changed)] });
    assert.deepEqual(h.candidates.map(c => c.commit), [changed], `${file}: the commit that changed it is the last candidate, its parent is not`);
    // The walk compares each ancestor with the baseline: from \`before\` to \`after\` the file differs, so \`before\` lends nothing.
    assert.ok(!h.candidates.some(c => c.commit === before), file);
    assert.deepEqual(h.results.map(r => r.commit), [changed], file);
  }
  // A task record is planning: the walk goes through it.
  const p = project(t);
  const before = p.git('rev-parse', 'HEAD');
  p.edit(taskPath, x => `${x}\nnote\n`);
  const after = p.commit('task note');
  assert.deepEqual(baselineHint({ source: gitSource(p.repo, after), recordsDir: 'docs/workflow', runsFor: s => s === before ? [run(17, before)] : [] }).results.map(r => r.commit), [before]);
});

// Review F2: the runs of the workflows that test the commit decide. A scheduled run (wf-status refreshing the issue) tested nothing.
test('MAINT-0023 P5(c): a scheduled run of wf-status, failed or not, neither rejects a commit nor lends its run', t => {
  const p = project(t);
  p.write('src/a.js', 'export const a = 1;\n');
  const code = p.commit('the last code commit');
  p.write('docs/workflow/notes.md', 'records only\n');
  const records = p.commit('records');
  const scheduled = (id, extra = {}) => run(id, code, { workflow_id: 2, name: 'wf-status', event: 'schedule', ...extra });
  for (const extra of [{}, { conclusion: 'failure' }, { status: 'in_progress', conclusion: null }]) {
    const h = hint(p, records, { [code]: [run(11, code), scheduled(12, extra)] });
    assert.deepEqual(h.results.map(r => [r.value, r.workflow]), [[`pass: ${URL(11)} (code unchanged since ${code.slice(0, 12)})`, 'CI']], JSON.stringify(extra));
  }
  // Only scheduled runs: nothing tested the commit.
  assert.deepEqual(hint(p, records, { [code]: [scheduled(12)] }).results, []);
  // Fail closed for the workflows that do test: a failed push run, a failed manual run or a failed pull_request run of another workflow.
  const other = (id, event, conclusion) => run(id, code, { workflow_id: 3, name: 'wf-client-page', event, conclusion });
  for (const event of ['push', 'workflow_dispatch']) assert.deepEqual(hint(p, records, { [code]: [run(11, code), other(13, event, 'failure')] }).results, [], event);
  assert.deepEqual(hint(p, records, { [code]: [run(11, code, { conclusion: 'failure' }), scheduled(12)] }).results, []);
});

// Review N6: the reference is printed to be recorded, so it must be a plain https link.
test('MAINT-0023 P5: a run whose link holds whitespace, a newline or credentials is not named', t => {
  const { p, head, merged } = withPullRequest(t);
  const source = gitSource(p.repo, merged);
  for (const html_url of ['https://x\nstatus: Done', 'https://x y', 'https://user:pw@github.com/a/b', 'http://github.com/a/b', 'https://', '']) {
    const j = judgeRun({ source, candidate: { kind: 'merge-head', commit: head }, run: run(3, head, { html_url }) });
    assert.equal(j.ok, false, JSON.stringify(html_url));
    assert.match(j.reason, /https link/);
  }
});

test('MAINT-0023 P5(b) and (c): without a way to read the runs the hint names the commits, never a run', t => {
  const { p, merged, head } = withPullRequest(t);
  const h = baselineHint({ source: gitSource(p.repo, merged), recordsDir: 'docs/workflow', runsFor: null });
  assert.deepEqual(h.results, []);
  assert.ok(h.candidates.some(c => c.kind === 'merge-head' && c.commit === head));
});

test('MAINT-0023 P5: judgeRun reports each reason', t => {
  const { p, head, merged } = withPullRequest(t);
  const source = gitSource(p.repo, merged);
  const ok = judgeRun({ source, candidate: { kind: 'merge-head', commit: head }, run: run(3, head) });
  assert.deepEqual([ok.ok, ok.reference], [true, URL(3)]);
  const wrongCommit = judgeRun({ source, candidate: { kind: 'merge-head', commit: head }, run: run(3, merged) });
  assert.equal(wrongCommit.ok, false);
  assert.match(wrongCommit.reason, /ran on/);
});

test('MAINT-0023 P5: wf next prints the baseline result for a claim, from runs it is given', t => {
  const { p, head, merged } = withPullRequest(t);
  const file = path.join(p.temp, 'runs.json');
  fs.writeFileSync(file, JSON.stringify({ [head]: [run(3, head)] }));
  const start = p.run(['next', '--baseline', merged, '--runs', file]).out.next;
  assert.equal(start.kind, 'start');
  assert.deepEqual(start.baseline.results.map(r => r.value), [`pass: ${URL(3)} (head of #7)`]);
  const text = p.run(['next', '--baseline', merged, '--runs', file]).stdout;
  assert.ok(JSON.stringify(start).includes(`pass: ${URL(3)} (head of #7)`));
  assert.ok(text.length > 0);
  // No runs file and no --check-runs: the candidates, and the command that checks them.
  const plain = p.run(['next', '--baseline', merged]).out.next;
  assert.deepEqual(plain.baseline.results, []);
  assert.equal(plain.baseline.candidates[0].commit, head);
  assert.match(plain.baseline.how, /wf next --check-runs/);
  // A baseline with no candidate carries no baseline hint, so the action is as it was.
  const none = project(t);
  none.write('src/z.js', 'export const z = 1;\n');
  assert.equal(none.run(['next', '--baseline', none.commit('code')]).out.next.baseline, undefined);
});

// Review N10: `wf next --check-runs` asks GitHub for one commit after another. One allowance covers them all, no request outlasts it,
// and a commit whose runs were not read is named in the notes.
test('MAINT-0023 P5: workflowRuns shares one deadline, so a slow GitHub cannot hold wf next for minutes', () => {
  let clock = 0;
  const seen = [];
  const call = (endpoint, timeout) => { seen.push([endpoint, timeout]); clock += timeout; return { workflow_runs: [{ id: 1 }] }; };
  const deadline = CHECK_RUNS_SECONDS * 1000;
  const read = sha => workflowRuns({ repository: 'o/r', sha, call, deadline, now: () => clock });
  assert.deepEqual(read('a'.repeat(40)), [{ id: 1 }]);
  assert.equal(seen[0][1], 30000, 'a call has the usual 30 s when the allowance is large');
  read('b'.repeat(40));
  assert.equal(seen[1][1], 30000);
  assert.throws(() => read('c'.repeat(40)), /allowed for reading runs from GitHub was used up/);
  assert.equal(seen.length, 2, 'no third request starts');
  // A call near the end gets only the time that is left.
  clock = deadline - 5000; seen.length = 0;
  read('d'.repeat(40));
  assert.equal(seen[0][1], 5000);
});

test('MAINT-0023 P5: a commit whose runs were not read is named in the notes', t => {
  const p = project(t);
  p.write('docs/workflow/a.md', 'one\n'); const first = p.commit('records: one');
  p.write('docs/workflow/b.md', 'two\n'); const second = p.commit('records: two');
  p.write('docs/workflow/c.md', 'three\n'); const third = p.commit('records: three');
  let clock = 0;
  const deadline = CHECK_RUNS_SECONDS * 1000;
  const runsFor = sha => workflowRuns({ repository: 'o/r', sha, deadline, now: () => clock, call: (_, timeout) => { clock += timeout; return { workflow_runs: [] }; } });
  const h = baselineHint({ source: gitSource(p.repo, third), recordsDir: 'docs/workflow', runsFor });
  assert.deepEqual(h.results, []);
  const notes = h.notes.join(' | ');
  assert.match(notes, new RegExp(`no run of ${second.slice(0, 12)}`));
  assert.match(notes, new RegExp(`no run of ${first.slice(0, 12)}`));
  assert.match(notes, new RegExp(`could not read the runs of ${p.baseline.slice(0, 12)}: the ${CHECK_RUNS_SECONDS} s allowed`));
});
