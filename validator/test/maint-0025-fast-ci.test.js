import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { gitSource } from '../lib/sources.js';
import { baselineHint } from '../lib/baseline-run.js';
import { classifyPaths, isRecordsOnlyPath, recordsOnly } from '../lib/paths.js';
import { loadConfig } from '../lib/records.js';
import { decideReuse, formatMarker, parseMarker } from '../lib/ci-reuse.js';
import { project, taskPath, cli } from './helpers/maint-0018.js';

// v2.14.0 (MAINT-0025), the validator's part of faster CI: records-only, and a push's reuse of its pull request's result.
const rd = 'docs/workflow';
const config = t => loadConfig(gitSource(project(t).repo, 'HEAD'));

test('records-only: planning records and milestone and decision records, never code, the config, the profile or acceptance definitions', t => {
  const c = config(t);
  for (const ok of [`${rd}/tasks/T-0002.md`, `${rd}/feedback/inbox/F-1.md`, `${rd}/milestones/M-0001.md`, `${rd}/decisions/D-0001.md`, 'docs/notes.md', 'README.md']) assert.equal(isRecordsOnlyPath(c, ok), true, ok);
  for (const no of [`${rd}/config.json`, `${rd}/profile.md`, `${rd}/acceptance.json`, 'src/a.js', 'package.json', '.github/workflows/ci.yml', 'docs/specs/api.md', 'AGENTS.md', 'tests/acceptance/a.test.js', 'mystery.bin']) assert.equal(isRecordsOnlyPath(c, no), false, no);
  assert.equal(recordsOnly(c, []), false, 'an empty change is never records-only');
  assert.equal(recordsOnly(c, [`${rd}/milestones/M-0001.md`, `${rd}/tasks/T-0001.md`]), true);
  assert.equal(recordsOnly(c, [`${rd}/milestones/M-0001.md`, 'src/a.js']), false, 'one code file ends it');
  assert.equal(recordsOnly(c, [`./${rd}/tasks/T-0001.md`]), true, 'a leading ./ is the same path');
});

test('records-only: an owner-approved acceptance test is not a record', t => {
  const p = project(t, { configEdit: c => ({ ...c, paths: { ...c.paths, acceptance_tests: [...(c.paths.acceptance_tests ?? []), 'docs/acceptance/**'] } }) });
  const c = loadConfig(gitSource(p.repo, 'HEAD'));
  assert.equal(isRecordsOnlyPath(c, 'docs/acceptance/a.md'), false);
  assert.equal(isRecordsOnlyPath(c, 'docs/other.md'), true);
});

// F4: a milestone's or a task's status decides which mapped acceptance tests may fail (MAINT-0012), so where the project names
// owner-approved acceptance tests, a change to either can make tests required and is never records-only.
test('records-only: with owner-approved acceptance tests, milestone and task records change what must pass and are not records-only', t => {
  const p = project(t, { configEdit: c => ({ ...c, paths: { ...c.paths, acceptance_tests: [...(c.paths.acceptance_tests ?? []), 'tests/acceptance/**'] } }) });
  const c = loadConfig(gitSource(p.repo, 'HEAD'));
  for (const no of [`${rd}/milestones/M-0001.md`, `${rd}/tasks/T-0001.md`]) assert.equal(isRecordsOnlyPath(c, no), false, no);
  for (const ok of [`${rd}/decisions/D-0001.md`, `${rd}/feedback/inbox/F-1.md`, 'docs/notes.md']) assert.equal(isRecordsOnlyPath(c, ok), true, ok);
});

// F5: config.json and acceptance.json live at docs/workflow/ whatever records_dir says (SCHEMA.md), and the profile in the records directory.
test('records-only: the config stays out under a custom records_dir', t => {
  const p = project(t, { configEdit: c => ({ ...c, records_dir: 'records', paths: { ...c.paths, planning: [...(c.paths.planning ?? []), 'docs/**'] } }) });
  const c = loadConfig(gitSource(p.repo, 'HEAD'));
  for (const no of ['docs/workflow/config.json', 'docs/workflow/acceptance.json', 'records/profile.md']) assert.equal(isRecordsOnlyPath(c, no), false, no);
  assert.equal(isRecordsOnlyPath(c, 'docs/notes.md'), true);
});

const pathsOf = (p, from, to) => { const r = spawnSync(process.execPath, [cli, 'paths', '--repo', p.repo, '--baseline', from, '--candidate', to, '--json'], { encoding: 'utf8' }); assert.ok([0, 1].includes(r.status), r.stderr); return JSON.parse(r.stdout); };

test('wf paths reports records_only: true for a milestone close, false for code and for an empty change', t => {
  const p = project(t);
  const before = p.git('rev-parse', 'HEAD');
  p.edit(`${rd}/milestones/M-0001.md`, x => `${x}\nclosed\n`); p.edit(taskPath, x => `${x}\nnote\n`);
  const after = p.commit('close the milestone');
  const r = pathsOf(p, before, after);
  assert.equal(r.records_only, true);
  p.write('src/a.js', 'export const a = 1;\n');
  assert.equal(pathsOf(p, after, p.commit('code')).records_only, false);
  assert.equal(pathsOf(p, after, after).records_only, false);
});

test('wf ci carries records_only, so a project\'s CI can skip its product steps on it', t => {
  const p = project(t);
  const before = p.git('rev-parse', 'HEAD');
  p.edit(`${rd}/milestones/M-0001.md`, x => `${x}\nclosed\n`);
  const records = p.commit('records only');
  const a = p.run(['ci', '--baseline', before, '--candidate', records]);
  assert.equal(a.out?.records_only, true, a.stdout + a.stderr);
  p.write('src/a.js', 'export const a = 1;\n');
  const code = p.commit('code');
  const b = p.run(['ci', '--baseline', records, '--candidate', code]);
  assert.equal(b.out?.records_only, false, b.stdout + b.stderr);
  p.edit(`${rd}/profile.md`, x => `${x}\nmore\n`);
  const profile = p.commit('the profile');
  assert.equal(p.run(['ci', '--baseline', code, '--candidate', profile]).out?.records_only, false, 'the profile changes what the checks run');
});

// The NOT_PLANNING fix: baseline-run's records-only walk called a milestone or decision record code, because they are governing.
test('baseline-run: the walk goes through a milestone-close commit, and still stops at the config', t => {
  // As config.default.json has it: milestone and decision records are governing, because the owner approves them.
  const p = project(t, { configEdit: c => ({ ...c, paths: { ...c.paths, governing: [...c.paths.governing, 'docs/workflow/milestones/**'] } }) });
  assert.equal(classifyPaths(loadConfig(gitSource(p.repo, 'HEAD')), [`${rd}/milestones/M-0001.md`])[0].category, 'governing');
  p.write('src/a.js', 'export const a = 1;\n');
  const code = p.commit('the last code commit');
  p.edit(`${rd}/milestones/M-0001.md`, x => `${x}\naccepted\n`);
  const milestone = p.commit('close the milestone');
  p.edit(`${rd}/decisions/D-0001.md`, x => `${x}\nnote\n`);
  const decision = p.commit('a decision note');
  const hint = sha => baselineHint({ source: gitSource(p.repo, sha), recordsDir: rd, runsFor: () => [] });
  assert.deepEqual(hint(decision).candidates.map(c => c.commit), [milestone, code]);
  p.edit(`${rd}/config.json`, x => JSON.stringify({ ...JSON.parse(x), setup_budget_days: 3 }));
  const changed = p.commit('the config');
  p.edit(`${rd}/milestones/M-0001.md`, x => `${x}\nmore\n`);
  const top = p.commit('another milestone edit');
  assert.deepEqual(hint(top).candidates.map(c => c.commit), [changed]);
});

// A push reuses its pull request's result only on an identical tree. The fixtures use real Git, like GitHub's test merge commit.
const sha = /^[0-9a-f]{40}$/;
function pullRequest(t, { mainMovesAfterRun = false, mainMovesBeforeRun = false } = {}) {
  const p = project(t);
  p.git('switch', '-q', '-c', 'pr');
  p.write('src/a.js', 'export const a = 1;\n');
  const head = p.commit('the pull request\'s work');
  p.git('switch', '-q', 'main');
  if (mainMovesBeforeRun) { p.write('src/b.js', 'export const b = 1;\n'); p.commit('another pull request landed before the run'); }
  // GitHub's test merge: the head merged into the base as it is when the checks start. The run checks it out and leaves its marker.
  p.git('switch', '-q', '--detach', 'main');
  p.git('merge', '-q', '--no-ff', '-m', 'test merge', head);
  const testMerge = p.git('rev-parse', 'HEAD');
  const marker = spawnSync(process.execPath, [cli, 'reuse', '--repo', p.repo, '--candidate', testMerge, '--emit'], { encoding: 'utf8' }).stdout.trim();
  p.git('switch', '-q', 'main');
  if (mainMovesAfterRun) { p.write('src/c.js', 'export const c = 1;\n'); p.commit('another pull request landed after the run'); }
  return { p, head, testMerge, marker };
}
const decide = (p, commit, marker) => { const r = spawnSync(process.execPath, [cli, 'reuse', '--repo', p.repo, '--candidate', commit, '--marker', marker], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return { reuse: r.stdout.trim(), why: r.stderr }; };

test('reuse: the marker is the test merge commit\'s tree and commit, and the merge of an up-to-date pull request reuses it, by merge commit or squash', t => {
  const { p, head, testMerge, marker } = pullRequest(t);
  assert.equal(marker, `tree=${p.git('rev-parse', `${testMerge}^{tree}`)} merge=${testMerge}`);
  assert.deepEqual(parseMarker(marker), { tree: p.git('rev-parse', `${testMerge}^{tree}`), merge: testMerge });
  p.git('merge', '-q', '--no-ff', '-m', 'Merge pull request #7 from fixture/pr', head);
  assert.equal(decide(p, p.git('rev-parse', 'HEAD'), marker).reuse, 'reuse=true');
  // A squash merge makes a different commit with the same tree.
  p.git('reset', '-q', '--hard', 'HEAD^');
  p.git('merge', '-q', '--squash', head); const squashed = p.commit('the pull request (#7)');
  assert.equal(decide(p, squashed, marker).reuse, 'reuse=true');
});

test('reuse: a pull request that was behind main when its checks ran runs in full on the push', t => {
  // The run tested main-as-it-was plus the head; another pull request landed before this one merged, so main's new tree holds a file
  // the tested tree never had. The branch was behind, and its green checks say nothing about the merged result.
  const { p, head, marker } = pullRequest(t, { mainMovesAfterRun: true });
  p.git('merge', '-q', '--no-ff', '-m', 'Merge pull request #7 from fixture/pr', head);
  const r = decide(p, p.git('rev-parse', 'HEAD'), marker);
  assert.equal(r.reuse, 'reuse=false');
  assert.match(r.why, /behind the trusted branch/);
  // The same through a squash merge.
  p.git('reset', '-q', '--hard', 'HEAD^');
  p.git('merge', '-q', '--squash', head); const squashed = p.commit('the pull request (#7)');
  assert.equal(decide(p, squashed, marker).reuse, 'reuse=false');
});

test('reuse: a pull request whose run began after main moved reuses it, because the test merge already held main\'s change', t => {
  const { p, head, marker } = pullRequest(t, { mainMovesBeforeRun: true });
  p.git('merge', '-q', '--no-ff', '-m', 'Merge pull request #7 from fixture/pr', head);
  assert.equal(decide(p, p.git('rev-parse', 'HEAD'), marker).reuse, 'reuse=true');
});

test('reuse: no marker, a malformed one, or a push that is not a pull request\'s merge runs everything', t => {
  const { p, head } = pullRequest(t);
  p.git('merge', '-q', '--no-ff', '-m', 'merge', head);
  const tip = p.git('rev-parse', 'HEAD');
  const tree = p.git('rev-parse', `${tip}^{tree}`);
  for (const bad of ['none', 'tree=abc merge=def', `tree=${tree}`, `tree=${tree} merge=${tip} extra`, `TREE=${tree} MERGE=${tip}`, `tree=${tree.toUpperCase()} merge=${tip}`]) assert.equal(decide(p, tip, bad).reuse, 'reuse=false', bad);
  assert.equal(decide(p, tip, `tree=${tree} merge=${tip}`).reuse, 'reuse=true', 'the well-formed marker of the same tree');
  p.write('src/direct.js', 'export const d = 1;\n');
  assert.equal(decide(p, p.commit('a direct push'), `tree=${tree} merge=${tip}`).reuse, 'reuse=false', 'a direct push changes the tree');
  const json = p.run(['reuse', '--candidate', tip, '--marker', 'none', '--json']);
  assert.equal(json.out.reuse, false);
  assert.match(json.out.reason, /no passing pull request result/);
});

test('reuse: the command takes a full candidate, exactly one of --emit and --marker, and no baseline', t => {
  const p = project(t);
  const tip = p.git('rev-parse', 'HEAD');
  for (const args of [['reuse', '--emit'], ['reuse', '--candidate', 'HEAD', '--emit'], ['reuse', '--candidate', tip], ['reuse', '--candidate', tip, '--emit', '--marker', 'none'], ['reuse', '--candidate', tip, '--emit', '--baseline', tip], ['paths', '--baseline', tip, '--candidate', tip, '--emit']]) {
    const r = p.run(args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
  }
});

test('ci-reuse: the marker round-trips, and full-length (SHA-256) object names work', () => {
  const tree = 'a'.repeat(64), merge = 'b'.repeat(64);
  assert.deepEqual(parseMarker(formatMarker({ tree, merge })), { tree, merge });
  assert.equal(decideReuse({ candidate: { tree }, marker: formatMarker({ tree, merge }) }).reuse, true);
  assert.equal(decideReuse({ candidate: { tree: 'c'.repeat(64) }, marker: formatMarker({ tree, merge }) }).reuse, false);
  assert.equal(decideReuse({ candidate: {}, marker: formatMarker({ tree, merge }) }).reuse, false);
  assert.throws(() => formatMarker({ tree: 'x', merge }), /full object names/);
});
