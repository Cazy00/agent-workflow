import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WAIT_CEILING_SECONDS, waitForCommit, waitForPullRequest } from '../lib/wait.js';
import { fakeExecutable } from './helpers.js';
import { cli, project } from './helpers/maint-0018.js';

// MAINT-0020: what M-0005 of mateen-systems (14–16 October 2026) cost on v2.7.0, and the cuts v2.8.0 makes. Later slices of
// the release append their tests here.
const root = fileURLToPath(new URL('../..', import.meta.url));
const SHA = 'c'.repeat(40);
const run = (name, status, conclusion = null, at = '2026-10-16T00:00:00Z') => ({ name, status, conclusion, started_at: at });

// A clock that only moves when the wait pauses, so a 270-second ceiling takes no time.
const fakeClock = () => { let ms = 0; return { now: () => ms, pause: seconds => { ms += seconds * 1000; }, elapsed: () => ms / 1000 }; };
const fakeApi = (checks, calls = []) => (endpoint, timeout) => {
  calls.push({ endpoint, timeout });
  if (endpoint.includes('/pulls/')) return { state: 'open', merged: false, head: { sha: SHA } };
  return { check_runs: typeof checks === 'function' ? checks(calls.filter(c => c.endpoint.includes('/check-runs')).length) : checks };
};

// P12. A wait that outlasts the harness's five-minute prompt cache rewrites the waiting agent's whole context: about $50
// in M-0005, $3 against $0.12 for one 600 K-token rebuild. One call now returns `pending` inside the cache.
test('MAINT-0020 P12: one wait call ends inside the five-minute cache with pending, and a fresh call starts the two polls again', () => {
  assert.equal(WAIT_CEILING_SECONDS, 270);
  const clock = fakeClock(), calls = [];
  const r = waitForPullRequest({ repository: 'fixture/project', number: 7, required: ['unit'], call: fakeApi([run('unit', 'in_progress')], calls), now: clock.now, pause: clock.pause });
  assert.equal(r.result, 'pending');
  assert.equal(r.ok, false);
  assert.equal(clock.elapsed(), 270, 'the default ceiling, not the thirty minutes of v2.7.0');
  assert.ok(calls.filter(c => c.endpoint.includes('/check-runs')).length > 5, 'it polled throughout');
  assert.ok(calls.every(c => c.timeout <= 30000), 'a single poll cannot carry the call far past the ceiling');
  assert.deepEqual(r.checks.map(c => c.name), ['unit']);
  // Checks that finished are a pass on the second poll of a call, and every call needs its own two polls.
  const done = [run('unit', 'completed', 'success')];
  for (let i = 0; i < 2; i++) {
    const c2 = fakeClock(), calls2 = [];
    const passed = waitForPullRequest({ repository: 'fixture/project', number: 7, required: ['unit'], call: fakeApi(done, calls2), now: c2.now, pause: c2.pause });
    assert.equal(passed.result, 'passed');
    assert.equal(calls2.filter(c => c.endpoint.includes('/check-runs')).length, 2);
    assert.equal(c2.elapsed(), 30);
  }
  // A longer single wait is still possible.
  const long = fakeClock();
  assert.equal(waitForPullRequest({ repository: 'fixture/project', number: 7, seconds: 600, call: fakeApi([run('unit', 'in_progress')]), now: long.now, pause: long.pause }).result, 'pending');
  assert.equal(long.elapsed(), 600);
});

// P10. The coordinator wrote 24 loops of its own to wait for the trusted branch's run after a merge.
test('MAINT-0020 P10: waiting for a commit follows its newest run of each required check, through errors, and ends pending', () => {
  const clock = fakeClock(), calls = [];
  const sequence = n => n < 2
    ? [run('unit', 'in_progress'), run('lint', 'completed', 'success')]
    : [run('unit', 'completed', 'failure', '2026-10-16T00:00:00Z'), run('unit', 'completed', 'success', '2026-10-16T00:05:00Z'), run('lint', 'completed', 'success')];
  let thrown = false;
  const api = fakeApi(sequence, calls);
  const call = (endpoint, timeout) => { if (!thrown && calls.length === 2) { thrown = true; throw new Error('connection reset'); } return api(endpoint, timeout); };
  const r = waitForCommit({ repository: 'fixture/project', sha: SHA, required: ['unit', 'lint'], call, now: clock.now, pause: clock.pause });
  assert.equal(r.result, 'passed', JSON.stringify(r));
  assert.equal(r.head, SHA);
  assert.deepEqual(r.checks.map(c => `${c.name}:${c.conclusion}`).sort(), ['lint:success', 'unit:success'], 'the newest run of each check counts');
  assert.ok(calls.every(c => c.endpoint.startsWith(`repos/fixture/project/commits/${SHA}/check-runs`)), 'only the commit\'s check runs are asked for');
  // A required check that has not appeared is not a pass; the call ends pending and names it.
  const c2 = fakeClock();
  const waiting = waitForCommit({ repository: 'fixture/project', sha: SHA, required: ['unit', 'e2e'], call: fakeApi([run('unit', 'completed', 'success')]), now: c2.now, pause: c2.pause });
  assert.equal(waiting.result, 'pending');
  assert.deepEqual(waiting.waiting_for, ['e2e']);
  assert.equal(c2.elapsed(), 270);
  // A failed check is a failure, as for a pull request.
  const c3 = fakeClock();
  const failed = waitForCommit({ repository: 'fixture/project', sha: SHA, call: fakeApi([run('unit', 'completed', 'failure')]), now: c3.now, pause: c3.pause });
  assert.deepEqual([failed.ok, failed.result, failed.failed], [false, 'failed', ['unit']]);
});

const fakeGh = (p, checks) => {
  const bin = path.join(p.temp, 'bin'); fs.mkdirSync(bin, { recursive: true });
  fakeExecutable(path.join(bin, 'gh'), `const a = process.argv.slice(2).join(' ');
const runs = JSON.parse(process.env.FAKE_RUNS);
if (a.includes('/pulls/7')) console.log(JSON.stringify({ state: 'open', merged: false, head: { sha: ${JSON.stringify(SHA)} } }));
else if (a.includes('/commits/' + ${JSON.stringify(SHA)} + '/check-runs')) console.log(JSON.stringify({ check_runs: runs }));
else process.exit(1);`);
  return { PATH: `${bin}:${process.env.PATH}`, WF_WAIT_INTERVAL: '0', FAKE_RUNS: JSON.stringify(checks) };
};

test('MAINT-0020 P12/P10: wf wait exits 4 when still pending, with the command to run again, and 0 or 1 as before', t => {
  const p = project(t);
  const running = fakeGh(p, [run('unit', 'in_progress'), run('wf ci', 'in_progress')]);
  const pr = p.run(['wait', '--pr', '7', '--timeout', '0.02'], { env: running });
  assert.equal(pr.status, 4, pr.stdout + pr.stderr);
  assert.equal(pr.out.result, 'pending');
  assert.equal(pr.out.next, 'wf wait --pr 7 --timeout 0.02');
  assert.match(pr.out.detail, /not finished after 1 s: run it again/);
  assert.equal(p.run(['wait', '--pr', '7', '--merged', '--timeout', '0.02'], { env: running }).out.next, 'wf wait --pr 7 --merged --timeout 0.02');
  // Without --timeout the ceiling applies (injected here, as the interval is), and the command to run again has no option.
  const byDefault = p.run(['wait', '--pr', '7'], { env: { ...running, WF_WAIT_CEILING: '0.5' } });
  assert.equal(byDefault.status, 4, byDefault.stdout + byDefault.stderr);
  assert.equal(byDefault.out.next, 'wf wait --pr 7');
  assert.match(p.run(['wait', '--pr', '7'], { env: { ...running, WF_WAIT_CEILING: 'soon' } }).stderr, /WF_WAIT_CEILING must be a number of seconds/);
  // Passed is 0 and failed is 1, so 4 is a state of its own.
  const finished = fakeGh(p, [run('unit', 'completed', 'success'), run('wf ci', 'completed', 'success')]);
  assert.equal(p.run(['wait', '--pr', '7'], { env: finished }).status, 0);
  const red = fakeGh(p, [run('unit', 'completed', 'failure'), run('wf ci', 'completed', 'success')]);
  assert.equal(p.run(['wait', '--pr', '7'], { env: red }).status, 1);
});

test('MAINT-0020 P10: wf wait --commit SHA waits for the profile\'s required checks on a commit, not wf ci, and refuses what is not a commit', t => {
  const p = project(t);
  // wf ci runs on pull requests only, so a commit of the trusted branch is done when the profile's required checks are.
  const done = fakeGh(p, [run('unit', 'completed', 'success')]);
  const r = p.run(['wait', '--commit', SHA], { env: done });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual([r.out.result, r.out.head], ['passed', SHA]);
  const running = fakeGh(p, [run('unit', 'in_progress')]);
  const pending = p.run(['wait', '--commit', SHA, '--timeout', '0.02'], { env: running });
  assert.equal(pending.status, 4, pending.stdout + pending.stderr);
  assert.equal(pending.out.next, `wf wait --commit ${SHA} --timeout 0.02`);
  const missing = p.run(['wait', '--commit', SHA, '--timeout', '0.02'], { env: fakeGh(p, []) });
  assert.deepEqual([missing.status, missing.out.waiting_for], [4, ['unit']]);
  const red = p.run(['wait', '--commit', SHA], { env: fakeGh(p, [run('unit', 'completed', 'failure')]) });
  assert.deepEqual([red.status, red.out.failed], [1, ['unit']]);
  assert.match(p.run(['wait', '--commit', 'main'], { env: done }).stderr, /wait --commit needs the full hash of the commit/);
  assert.match(p.run(['wait', '--commit', SHA, '--merged'], { env: done }).stderr, /wait --commit has no --merged/);
  assert.match(p.run(['wait', '--commit', SHA, '--pr', '7'], { env: done }).stderr, /wait needs --pr NUMBER or --commit SHA/);
  assert.match(p.run(['wait'], { env: done }).stderr, /wait needs --pr NUMBER or --commit SHA/);
});

// P9. In M-0005 the session started in the parent folder, so the project's reviewer and walker agents were "not registered".
test('MAINT-0020 P9: wf doctor reports a session that did not start in the repository root, and only then', t => {
  const p = project(t);
  const bin = path.join(p.temp, 'bin'); fs.mkdirSync(bin);
  fakeExecutable(path.join(bin, 'gh'), 'process.exit(1);'); // no network in a test; the other checks are not the subject
  const env = { PATH: `${bin}:/usr/bin:/bin` };
  const name = 'session started in the repository root';
  const at = cwd => p.run(['doctor'], { env, cwd }).out;
  const atRoot = at(p.repo);
  assert.equal(atRoot.checks.find(c => c.name === name).ok, true);
  assert.equal(atRoot.gaps.includes(name), false);
  for (const where of [p.temp, path.join(p.repo, 'docs')]) { // the folder above, as in M-0005, and a folder inside
    const out = at(where);
    const gap = out.checks.find(c => c.name === name);
    assert.equal(gap.ok, false, where);
    assert.ok(out.gaps.includes(name), where);
    assert.match(gap.detail, /\(\.claude\/agents, CLAUDE\.md, AGENTS\.md\) are not loaded from a parent folder/);
    assert.ok(gap.detail.endsWith(`start the session in ${fs.realpathSync(p.repo)}`), gap.detail);
  }
  // A link to the root is the root: both paths are resolved before they are compared.
  fs.symlinkSync(p.repo, path.join(p.temp, 'link'));
  assert.equal(at(path.join(p.temp, 'link')).checks.find(c => c.name === name).ok, true);
});

// P13. All 13 outcomes of M-0005 kept the pre-filled "none", in a milestone with an overnight question and a second-model outage.
test('MAINT-0020 P13: friction starts empty in the lead\'s skeleton and the template, and wf session refuses it empty', t => {
  const p = project(t);
  const head = p.git('rev-parse', 'HEAD');
  const r = spawnSync(process.execPath, [cli, 'brief', '--lead', '--task', 'T-0001', '--repo', p.repo, '--baseline', p.baseline], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const skeleton = JSON.parse(r.stdout.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(skeleton.friction, '', 'the lead writes none; the brief does not');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'templates/session.json'), 'utf8')).friction, '');
  const session = record => { const file = path.join(p.temp, 'session.json'); fs.writeFileSync(file, JSON.stringify(record)); return p.run(['session', '--baseline', p.baseline, '--candidate', head, '--record', file]); };
  const progress = { outcome: 'progress', workflow: { version: 'v2.6.0', revision: 'a'.repeat(40) }, summary: 'T-0001 delivered', evidence: ['https://github.com/fixture/project/pull/1'], next_action: 'next task' };
  for (const friction of [undefined, '', '  ']) {
    const refused = session({ ...progress, friction });
    assert.equal(refused.status, 1, refused.stdout + refused.stderr);
    assert.match(refused.out.errors.join(' | '), /session requires friction: write none if the workflow got in the way of nothing, or the report IDs or what went wrong/);
  }
  assert.equal(session({ ...progress, friction: 'none' }).status, 0);
  assert.equal(session({ ...progress, friction: 'F-0042: wf wait outlasted the cache' }).status, 0);
  // The skeleton as the brief printed it is refused for its friction (and for the fields the lead has yet to write).
  assert.match(session({ ...skeleton, summary: 'T-0001 delivered', candidate: head, evidence: progress.evidence, next_action: 'next task' }).out.errors.join(' | '), /session requires friction/);
});
