import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseYaml } from '../lib/ci-lint.js';
import { cli, project } from './helpers/maint-0018.js';

// v2.14.0 (MAINT-0025): the two shell steps of templates/github/project-ci.yml, run for real against a Git repository, a stub `gh`
// (which applies the step's own --jq filter with jq, so the filter is under test too) and a `scripts/wf` that runs this checkout's
// validator. The cases are the ones that decide whether CI spends minutes: a push whose pull request passed on the same tree, one that
// was behind the trusted branch, none, a failed marker, a records-only change.
const jqAvailable = spawnSync('jq', ['--version']).status === 0;
const workflow = parseYaml(fs.readFileSync(new URL('../../templates/github/project-ci.yml', import.meta.url), 'utf8').replaceAll('__TRUSTED_BRANCH__', 'main'));
const scope = workflow.jobs.scope.steps.find(s => s.id === 'decide').run;
const result = workflow.jobs.result.steps[0].run;
const marker = (p, commit) => `tree=${p.git('rev-parse', `${commit}^{tree}`)} merge=${commit}`;

function bench(t) {
  const p = project(t);
  const bin = path.join(p.temp, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/bash
url=$2; filter=cat
for ((i = 1; i <= $#; i++)); do [ "\${!i}" = --jq ] && { j=$((i + 1)); filter="\${!j}"; }; done
case " $* " in *" -X POST "*) printf '%s\\n' "$*" >> "$FAKE_POSTS"; exit 0;; esac
case "$url" in
  */commits/*/pulls) json="$FAKE_PULLS";;
  */statuses*) json="$FAKE_STATUSES";;
  */git/commits/*) json="{\\"tree\\":{\\"sha\\":\\"$FAKE_TREE\\"}}";;
  *) exit 1;;
esac
printf '%s' "$json" | jq -r "$filter"
`, { mode: 0o755 });
  fs.mkdirSync(path.join(p.repo, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(p.repo, 'scripts', 'wf'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} --repo "$PWD" "$@"\n`, { mode: 0o755 });
  p.commit('the launcher'); // committed now, so no later commit under test carries it
  const posts = path.join(p.temp, 'posts');
  const out = path.join(p.temp, 'output');
  const run = (script, env) => {
    fs.rmSync(out, { force: true });
    const r = spawnSync('bash', ['-c', script], { cwd: p.repo, encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, HOME: p.temp, GITHUB_OUTPUT: out, GITHUB_REPOSITORY: 'fixture/project', GH_TOKEN: 'x', FAKE_POSTS: posts, ...env } });
    return { ...r, product: fs.existsSync(out) ? /product=(\w+)/.exec(fs.readFileSync(out, 'utf8'))?.[1] : null };
  };
  const status = (description, state = 'success') => JSON.stringify([{ context: 'wf-tested-tree', state, description }, { context: 'ci/other', state: 'success', description: 'x' }]);
  const pulls = head => JSON.stringify([{ head: { sha: head } }]);
  return { p, run, posts, status, pulls };
}
const skip = { skip: jqAvailable ? false : 'jq is not installed' };

// A pull request into main, checked on GitHub's test merge, then merged by a merge commit.
function merged(p, { behind = false } = {}) {
  p.git('switch', '-q', '-c', 'pr');
  p.write('src/a.js', 'export const a = 1;\n');
  const head = p.commit('the pull request\'s work');
  p.git('switch', '-q', '--detach', 'main');
  p.git('merge', '-q', '--no-ff', '-m', 'test merge', head);
  const testMerge = p.git('rev-parse', 'HEAD');
  p.git('switch', '-q', 'main');
  if (behind) { p.write('src/other.js', 'export const o = 1;\n'); p.commit('another pull request landed first'); }
  const before = p.git('rev-parse', 'HEAD');
  p.git('merge', '-q', '--no-ff', '-m', 'Merge pull request #7 from fixture/pr', head);
  return { head, testMerge, before, pushed: p.git('rev-parse', 'HEAD') };
}

test('push to the trusted branch: the pull request passed on this very tree, so the product jobs are skipped', skip, t => {
  const { p, run, status, pulls } = bench(t);
  const m = merged(p);
  const r = run(scope, { EVENT: 'push', BASE: m.before, CANDIDATE: m.pushed, GITHUB_SHA: m.pushed, FAKE_PULLS: pulls(m.head), FAKE_STATUSES: status(marker(p, m.testMerge)) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.product, 'false', r.stdout);
  assert.match(r.stdout, /reuse=true/);
});

test('push to the trusted branch: a pull request that was behind it merges to another tree and runs in full', skip, t => {
  const { p, run, status, pulls } = bench(t);
  const m = merged(p, { behind: true });
  const r = run(scope, { EVENT: 'push', BASE: m.before, CANDIDATE: m.pushed, GITHUB_SHA: m.pushed, FAKE_PULLS: pulls(m.head), FAKE_STATUSES: status(marker(p, m.testMerge)) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.product, 'true', r.stdout);
  assert.match(r.stdout, /reuse=false/);
  assert.match(r.stderr, /behind the trusted branch/);
});

test('push to the trusted branch: no pull request, no marker, a failed marker or a malformed one run in full', skip, t => {
  const { p, run, status, pulls } = bench(t);
  const m = merged(p);
  const push = extra => run(scope, { EVENT: 'push', BASE: m.before, CANDIDATE: m.pushed, GITHUB_SHA: m.pushed, ...extra });
  assert.equal(push({ FAKE_PULLS: '[]', FAKE_STATUSES: '[]' }).product, 'true', 'a direct push');
  assert.equal(push({ FAKE_PULLS: pulls(m.head), FAKE_STATUSES: '[]' }).product, 'true', 'a pull request that left no marker');
  assert.equal(push({ FAKE_PULLS: pulls(m.head), FAKE_STATUSES: status(marker(p, m.testMerge), 'failure') }).product, 'true', 'a marker that is not a pass');
  assert.equal(push({ FAKE_PULLS: pulls(m.head), FAKE_STATUSES: status('tree=nothing') }).product, 'true', 'a malformed marker');
  // The newest status of the context decides: a later failure on the same head withdraws an earlier pass.
  const both = JSON.stringify([{ context: 'wf-tested-tree', state: 'failure', description: 'x' }, { context: 'wf-tested-tree', state: 'success', description: marker(p, m.testMerge) }]);
  assert.equal(push({ FAKE_PULLS: pulls(m.head), FAKE_STATUSES: both }).product, 'true');
});

test('records only skips the product jobs on a pull request and on a push, and code does not', skip, t => {
  const { p, run } = bench(t);
  const before = p.git('rev-parse', 'HEAD');
  p.edit('docs/workflow/milestones/M-0001.md', x => `${x}\nclosed\n`);
  const records = p.commit('close the milestone');
  const env = { FAKE_PULLS: '[]', FAKE_STATUSES: '[]' };
  assert.equal(run(scope, { EVENT: 'pull_request', BASE: before, CANDIDATE: records, GITHUB_SHA: 'unused', ...env }).product, 'false');
  assert.equal(run(scope, { EVENT: 'push', BASE: before, CANDIDATE: records, GITHUB_SHA: records, ...env }).product, 'false');
  p.write('src/a.js', 'export const a = 1;\n');
  const code = p.commit('code');
  assert.equal(run(scope, { EVENT: 'pull_request', BASE: records, CANDIDATE: code, GITHUB_SHA: 'unused', ...env }).product, 'true');
  // Where the base cannot be diffed (a first push has an all-zero before), everything runs.
  assert.equal(run(scope, { EVENT: 'pull_request', BASE: '0'.repeat(40), CANDIDATE: records, GITHUB_SHA: 'unused', ...env }).product, 'true');
});

test('the result job leaves the tested tree on a pull request that passed in full, and only then', skip, t => {
  const { p, run, posts } = bench(t);
  const m = merged(p);
  const tree = p.git('rev-parse', `${m.testMerge}^{tree}`);
  const env = { GITHUB_EVENT_NAME: 'pull_request', PRODUCT: 'true', HEAD_SHA: m.head, GITHUB_SHA: m.testMerge, FAKE_TREE: tree };
  const pass = run(result, { ...env, RESULTS: 'success success success success' });
  assert.equal(pass.status, 0, pass.stderr);
  const posted = fs.readFileSync(posts, 'utf8');
  assert.match(posted, new RegExp(`statuses/${m.head} .*context=wf-tested-tree`));
  assert.ok(posted.includes(`description=tree=${tree} merge=${m.testMerge}`), posted);
  // What it wrote is what the push decides on.
  assert.equal(marker(p, m.testMerge), `tree=${tree} merge=${m.testMerge}`);
  fs.rmSync(posts);
  for (const [name, extra] of [['a failed job', { RESULTS: 'success failure skipped success' }], ['a cancelled job', { RESULTS: 'cancelled success success success' }]]) {
    const bad = run(result, { ...env, ...extra });
    assert.equal(bad.status, 1, name);
    assert.ok(!fs.existsSync(posts), `${name}: no marker`);
  }
  assert.equal(run(result, { ...env, RESULTS: 'success skipped skipped skipped', PRODUCT: 'false' }).status, 0, 'a skipped run passes');
  assert.ok(!fs.existsSync(posts), 'a run that skipped the product jobs tested nothing to remember');
  assert.equal(run(result, { ...env, GITHUB_EVENT_NAME: 'push', RESULTS: 'success success success success' }).status, 0);
  assert.ok(!fs.existsSync(posts), 'a push leaves no marker');
});
