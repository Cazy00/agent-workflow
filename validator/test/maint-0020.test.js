import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WAIT_CEILING_SECONDS, waitForCommit, waitForPullRequest } from '../lib/wait.js';
import os from 'node:os';
import { dirSource, loadConfig } from '../lib/index.js';
import { DEFAULT_ROLES } from '../lib/roles.js';
import { renderNext } from '../lib/next.js';
import { fakeExecutable } from './helpers.js';
import { evidenceErrors } from '../lib/delivery-evidence.js';
import { cli, evidence, project, taskPath } from './helpers/maint-0018.js';

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

// P4. M-0005 ran 46 of 51 helpers at the session's xhigh effort and every role on the coordinator's model; execute.md said effort
// follows the review level and no brief printed it.
const configIn = (t, edit) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-roles-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = JSON.parse(fs.readFileSync(path.join(root, 'config.default.json'), 'utf8'));
  fs.mkdirSync(path.join(dir, 'docs/workflow'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/workflow/config.json'), JSON.stringify(edit(base)));
  return () => loadConfig(dirSource(dir));
};
const leadBrief = (p, ...edits) => {
  for (const edit of edits) p.edit(taskPath, edit);
  const sha = edits.length ? p.commit('the task\'s review') : p.baseline;
  const r = spawnSync(process.execPath, [cli, 'brief', '--lead', '--task', 'T-0001', '--repo', p.repo, '--baseline', sha], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
};
const reviewIs = text => x => x.replace(/^review: .*$/m, `review: ${text}`);

test('MAINT-0020 P4: the config names a model and an effort for the four roles, and refuses any other role or effort', t => {
  assert.deepEqual(configIn(t, c => c)().roles, DEFAULT_ROLES, 'config.default.json and the defaults of a project without roles are one');
  const execute = fs.readFileSync(path.join(root, 'procedures/execute.md'), 'utf8');
  const { light, standard, deep } = DEFAULT_ROLES.implementer.effort;
  assert.ok(execute.includes(`light \`${light}\`, standard \`${standard}\`, deep \`${deep}\``), 'execute.md states the effort for each level the defaults give');
  const roles = { lead: { model: 'opus[1m]', effort: 'max' }, implementer: { model: null, effort: null }, walker: { effort: { light: 'low', standard: 'medium', deep: 'high' } } };
  assert.deepEqual(configIn(t, c => ({ ...c, roles }))().roles, roles, 'a partial config is valid, and null leaves it to the session');
  for (const [bad, pattern] of [
    [{ reviewer: { model: 'opus' } }, /roles may contain only lead, implementer, paperwork, walker/],
    [{ lead: { effort: 'maximum' } }, /roles\.lead\.effort must be one of low, medium, high, xhigh, max/],
    [{ lead: { effort: 'minimal' } }, /roles\.lead\.effort must be one of low, medium, high, xhigh, max/],
    [{ implementer: { effort: { light: 'low', standard: 'high' } } }, /roles\.implementer\.effort by review level needs light, standard, deep/],
    [{ implementer: { effort: { light: 'low', standard: 'high', deep: 'ultra' } } }, /roles\.implementer\.effort by review level needs/],
    [{ implementer: { effort: { light: 'low', standard: 'high', deep: 'max', trivial: 'low' } } }, /roles\.implementer\.effort may contain only light, standard, deep/],
    [{ paperwork: { model: 'haiku 5' } }, /roles\.paperwork\.model must be a plain model name/],
    [{ paperwork: { model: 5 } }, /roles\.paperwork\.model must be a plain model name/],
    [{ walker: { tool: 'x' } }, /roles\.walker may contain only model, effort/],
    [['lead'], /roles may contain only/],
  ]) assert.throws(configIn(t, c => ({ ...c, roles: bad })), pattern, JSON.stringify(bad));
});

test('MAINT-0020 P4: the lead\'s brief prints the model and effort for the lead, the implementer by review level, and the paperwork helper', t => {
  const p = project(t);
  const settings = text => text.match(/Launch with these settings[\s\S]*?\n\n/)[0];
  const fresh = leadBrief(p); // "independent context required" names no level, and the scope reaches no deep path
  assert.match(settings(fresh), /- you, the lead \(the coordinator launches you so\): model sonnet, effort low\n/);
  assert.match(settings(fresh), /- the paperwork helper: model haiku, effort low\n/);
  assert.match(settings(fresh), /- the implementer and each fix round: model inherit, effort high \(review level standard, not read: its review field names no level \(light, standard or deep\) and its scope reaches no review\.deep_paths; standard is the default\)\n/);
  for (const [text, level, effort] of [['light: copy and styling', 'light', 'medium'], ['standard', 'standard', 'high'], ['deep: money paths', 'deep', 'xhigh'], ['Deep', 'deep', 'xhigh']]) {
    assert.match(settings(leadBrief(p, reviewIs(text))), new RegExp(`- the implementer and each fix round: model inherit, effort ${effort} \\(review level ${level}: the task's review field starts with ${level}\\)\n`), text);
  }
  // 'deeper' is not a level; the deep-paths rule the brief prints reads the task's scope instead.
  const deepPaths = project(t, { configEdit: c => ({ ...c, review: { deep_paths: ['src/**'] } }) });
  assert.match(settings(leadBrief(deepPaths, reviewIs('deeper than it looks'))), /effort xhigh \(review level deep: its scope reaches review\.deep_paths \(src\)\)/);
  assert.match(settings(leadBrief(deepPaths, reviewIs('light'))), /effort medium \(review level light:/, 'a named level wins over the paths');
  // The project's own roles replace the defaults a field at a time.
  const own = project(t, { configEdit: c => ({ ...c, roles: { lead: { effort: 'high' }, implementer: { model: 'opus', effort: { light: 'low', standard: 'medium', deep: 'high' } }, paperwork: { model: null } } }) });
  const mine = settings(leadBrief(own, reviewIs('deep')));
  assert.match(mine, /the lead[^\n]*: model sonnet, effort high\n/);
  assert.match(mine, /implementer and each fix round: model opus, effort high \(review level deep/);
  assert.match(mine, /paperwork helper: model inherit, effort low\n/);
});

test('MAINT-0020 P4: wf session notes a recorded model or effort that differs from the config, and refuses a malformed models', t => {
  const p = project(t);
  const head = p.git('rev-parse', 'HEAD');
  const base = { outcome: 'progress', workflow: { version: 'v2.6.0', revision: 'a'.repeat(40) }, summary: 'T-0001 delivered', evidence: ['https://github.com/fixture/project/pull/1'], next_action: 'next task', friction: 'none' };
  const session = (models, extra = []) => { const file = path.join(p.temp, 'session.json'); fs.writeFileSync(file, JSON.stringify({ ...base, models })); return p.run(['session', '--baseline', p.baseline, '--candidate', head, '--record', file, ...extra]); };
  const same = session({ lead: { model: 'claude-sonnet-5-5', effort: 'low' }, paperwork: { model: 'HAIKU', effort: 'low' }, implementer: { model: 'opus', effort: 'high' }, reviewer: { model: 'gpt-6.1-sol', effort: 'max' } });
  assert.equal(same.status, 0, same.stdout + same.stderr);
  assert.equal(same.out.notes, undefined, 'an alias matches its ID, an inherit role has no model to differ from, and a role the config does not name is not compared');
  const differ = session({ lead: { model: 'claude-opus-5-5', effort: 'xhigh' }, paperwork: { model: 'sonnet' } });
  assert.equal(differ.status, 0, 'a note, not an error');
  assert.deepEqual(differ.out.notes, ['lead ran on claude-opus-5-5; roles.lead.model says sonnet', 'lead ran at effort xhigh; roles.lead.effort says low', 'paperwork ran on sonnet; roles.paperwork.model says haiku']);
  // The implementer's effort depends on the task's level; without a task any level's effort is the config's.
  assert.equal(session({ implementer: { effort: 'xhigh' } }).out.notes, undefined);
  assert.deepEqual(session({ implementer: { effort: 'max' } }).out.notes, ['implementer ran at effort max; roles.implementer.effort says medium or high or xhigh']);
  const withTask = session({ implementer: { effort: 'xhigh' } }, ['--task', 'T-0001']);
  assert.deepEqual(withTask.out.notes, ['implementer ran at effort xhigh; roles.implementer.effort says high for a standard task'], withTask.stdout);
  for (const bad of ['sonnet', ['lead'], { lead: 'sonnet' }, { lead: { model: 5 } }]) {
    const r = session(bad);
    assert.equal(r.status, 1, JSON.stringify(bad));
    assert.match(r.out.errors.join(' | '), /session models is an object of role: \{ model, effort \}/);
  }
  assert.equal(JSON.parse(leadBrief(p).match(/```json\n([\s\S]*?)\n```/)[1]).models.implementer.effort, '', 'the skeleton leaves what was launched for the lead to write');
});

// P5(a). In M-0005 Codex ran out at the milestone review, after 14 runs in 22 hours.
test('MAINT-0020 P5(a): wf next prints the second-model budget of each live milestone: two runs per deep task and one for the milestone', t => {
  const withSecondModel = { review: { second_model: { tool: 'codex', model: 'gpt-6.1-sol', max_effort: 'high' } } };
  const p = project(t, { configEdit: c => ({ ...c, ...withSecondModel }) });
  const task = fs.readFileSync(path.join(p.repo, taskPath), 'utf8');
  p.edit(taskPath, reviewIs('deep: money'));
  p.write('docs/workflow/tasks/T-0002.md', reviewIs('Deep (permissions)')(task.replaceAll('T-0001', 'T-0002')));
  p.write('docs/workflow/tasks/T-0003.md', reviewIs('standard')(task.replaceAll('T-0001', 'T-0003')));
  p.write('docs/workflow/tasks/T-0004.md', reviewIs('deeper than it looks')(task.replaceAll('T-0001', 'T-0004')));
  const sha = p.commit('two deep tasks, a standard one and one that only starts with deep');
  const next = () => spawnSync(process.execPath, [cli, 'next', '--repo', p.repo, '--baseline', sha], { encoding: 'utf8' });
  const r = next();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const line = 'M-0001: second-model budget: 5 runs (two per deep task, one for the milestone review); keep one for the milestone review';
  assert.ok(r.stdout.split('\n').includes(line), r.stdout);
  assert.deepEqual(p.run(['next', '--baseline', sha]).out.second_model_budget, [{ milestone: 'M-0001', deep_tasks: 2, runs: 5 }]);
  // No deep task leaves the milestone's own run; no second model configured leaves no budget to keep.
  p.edit(taskPath, reviewIs('light')); p.edit('docs/workflow/tasks/T-0002.md', reviewIs('light'));
  p.edit('docs/workflow/config.json', x => JSON.stringify({ ...JSON.parse(x), review: { second_model: null } }));
  const none = p.commit('no second model');
  assert.deepEqual(p.run(['next', '--baseline', none]).out.second_model_budget, []);
  assert.doesNotMatch(spawnSync(process.execPath, [cli, 'next', '--repo', p.repo, '--baseline', none], { encoding: 'utf8' }).stdout, /second-model budget/);
  p.edit('docs/workflow/config.json', x => JSON.stringify({ ...JSON.parse(x), ...withSecondModel }));
  assert.match(spawnSync(process.execPath, [cli, 'next', '--repo', p.repo, '--baseline', p.commit('a second model again')], { encoding: 'utf8' }).stdout, /M-0001: second-model budget: 1 run \(two per deep task/);
});

// P5(b) and (c), P12. R-0067 re-reviewed a merge that `wf ci` would have carried; the first milestone-review run died with a
// restarted session; helpers wrote 24 loops of their own and waited past the five-minute cache.
test('MAINT-0020 P5(b), P12: the lead\'s brief says to run wf ci after a merge of the trusted branch, and how to wait', t => {
  const brief = leadBrief(project(t));
  assert.match(brief, /After merging the trusted branch into the task branch, run `wf ci` first and review only what it says does not carry over\./);
  assert.match(brief, /- wf wait --pr N {2}\(returns within 270 s; pending, exit 4, means run it again; --merged waits for the merge\)\n/);
  assert.match(brief, /- wf wait --commit SHA {2}\(the same for the trusted branch's checks on a commit\)\n/);
  assert.match(brief, /No command waits longer than four and a half minutes, within the five-minute prompt cache: a test run longer than about four minutes starts in the background and is checked every four minutes\. Never wait in a loop of your own: use `wf wait`; tell each helper this\./);
  assert.doesNotMatch(brief, /until its checks finish/, 'the wait that returned only when done is gone');
  // Manual mode has no pull-request commands, so no `wf wait`; the rule against loops of the agent's own still stands.
  const manual = leadBrief(project(t, { configEdit: c => ({ ...c, approval: { ...c.approval, label: 'manual', mechanism: 'manual', checkpoint: undefined } }), baselineEdit: q => q.edit('docs/workflow/profile.md', x => x.replace('approval_label: owner-merge', 'approval_label: manual')) }));
  assert.match(manual, /No command waits longer than four and a half minutes[^\n]*Never wait in a loop of your own; tell each helper this\./);
  assert.doesNotMatch(manual, /wf wait/);
  assert.match(fs.readFileSync(path.join(root, 'procedures/review.md'), 'utf8'), /launched detached from the agent's process, its output to a file \(`setsid` or `nohup`\), so a restart of the session does not kill it/);
});

// P2(a). M-0005's coordinator ran each task lead in the foreground, one after another: 17.4 h, though T-0025, T-0026 and T-0028
// shared no prerequisite or scope with T-0029.
const taskLike = (p, id, scope, edit = x => x) => p.write(`docs/workflow/tasks/${id}.md`, edit(fs.readFileSync(path.join(p.repo, taskPath), 'utf8').replaceAll('T-0001', id).replace(/^scope: .*$/m, `scope: [${scope}]`)));
const lines = out => renderNext(out).split('\n'); // the text wf next prints from the same view

test('MAINT-0020 P2(a): wf next lists the tasks to start together: disjoint scopes, no outstanding prerequisite, at most three running', t => {
  const p = project(t);
  p.edit(taskPath, x => x.replace(/^scope: .*$/m, 'scope: [src/a]'));
  taskLike(p, 'T-0002', 'src/b');
  const two = p.commit('two tasks with disjoint scopes');
  const r = p.run(['next', '--baseline', two]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual([r.out.startable, r.out.running], [['T-0001', 'T-0002'], []]);
  assert.ok(lines(r.out).includes('Start together, each with its own lead in the background: T-0001, T-0002'), renderNext(r.out));
  assert.match(spawnSync(process.execPath, [cli, 'next', '--repo', p.repo, '--baseline', two], { encoding: 'utf8' }).stdout, /\n\nStart together, each with its own lead in the background: T-0001, T-0002\n/);
  // An overlapping scope gives one of the two; an outstanding prerequisite keeps a disjoint task out (its readiness fails).
  taskLike(p, 'T-0003', 'src/a/deep');
  taskLike(p, 'T-0004', 'src/c', x => x.replace('prerequisites: []', 'prerequisites: [T-0001]'));
  const more = p.commit('an overlapping task and one waiting for T-0001');
  assert.deepEqual(p.run(['next', '--baseline', more]).out.startable, ['T-0001', 'T-0002']);
  // Three at most, in priority order.
  taskLike(p, 'T-0005', 'src/d'); taskLike(p, 'T-0006', 'src/e');
  const many = p.commit('two more disjoint tasks');
  assert.deepEqual(p.run(['next', '--baseline', many]).out.startable, ['T-0001', 'T-0002', 'T-0005']);
  // An Active task counts toward the three, and a task overlapping its scope waits.
  p.edit(taskPath, x => x.replace('status: Ready', 'status: Active'));
  const active = p.commit('T-0001: start');
  const a = p.run(['next', '--baseline', active]).out;
  assert.deepEqual([a.startable, a.running], [['T-0002', 'T-0005'], ['T-0001']]);
  assert.equal(a.next.kind, 'continue');
  assert.ok(lines(a).includes('Start together, each with its own lead in the background (beside T-0001): T-0002, T-0005'));
  // A claimed task (an open pull request from its branch) runs as well.
  const prs = path.join(p.temp, 'prs.json');
  fs.writeFileSync(prs, JSON.stringify([{ number: 9, title: 'T-0002: Task T-0002', headRefName: 'T-0002', author: { login: 'agent' } }]));
  const c = p.run(['next', '--baseline', active, '--pull-requests', prs]).out;
  assert.deepEqual([c.startable, c.running], [['T-0005'], ['T-0001', 'T-0002']]);
  assert.ok(lines(c).includes('Start, with its own lead in the background (beside T-0001, T-0002): T-0005'));
  // Three running leave nothing to start, and no line.
  taskLike(p, 'T-0007', 'src/f', x => x.replace('status: Ready', 'status: Active'));
  const full = p.commit('a second Active task');
  const none = p.run(['next', '--baseline', full, '--pull-requests', prs]).out;
  assert.deepEqual([none.startable, none.running], [[], ['T-0001', 'T-0002', 'T-0007']]);
  assert.ok(!lines(none).some(l => l.startsWith('Start')));
});

// P2(b), P10. Six claims of M-0005 waited 9–16 min each for main's run before recording baseline_result.
const pendingResult = 'pending: https://github.com/fixture/project/actions/runs/42';
const baselineIs = text => x => x.replace(/^baseline_result: .*$/m, `baseline_result: ${text}`);

test('MAINT-0020 P2(b): a pending baseline_result passes readiness at implement and is refused from verify on, saying how to fill it', t => {
  const p = project(t);
  p.edit(taskPath, baselineIs(pendingResult));
  const sha = p.commit('T-0001: claimed while main\'s run finishes');
  assert.equal(p.run(['records', '--candidate', sha]).status, 0);
  const implement = p.run(['readiness', '--baseline', sha, '--task', 'T-0001']);
  assert.equal(implement.status, 0, implement.stdout + implement.stderr);
  assert.equal(implement.out.outcome, 'Ready');
  const message = `baseline_result is still ${pendingResult}: fill it from the trusted branch's run on the baseline commit (wf wait --commit ${p.initial}, then pass or fail: <summary>) before the review packet`;
  for (const stage of ['verify', 'integrate', 'accept']) {
    const later = p.run(['readiness', '--baseline', sha, '--task', 'T-0001', '--stage', stage]);
    assert.equal(later.out.outcome, 'Needs discovery or resolution', stage);
    assert.ok(later.out.reasons.includes(message), later.stdout);
  }
  // The record's own stage counts: an implemented task is at verify.
  p.edit(taskPath, x => x.replace(/^implemented:.*$/m, `implemented: ${sha}`));
  assert.ok(p.run(['readiness', '--baseline', sha, '--task', 'T-0001']).out.reasons.includes(message));
  // The format: pass, fail: <summary> and pending: <run reference>; nothing else.
  for (const ok of ['pass', 'fail: 3 pricing tests', 'pending: run 42']) { p.edit(taskPath, baselineIs(ok)); assert.equal(p.run(['records']).status, 0, ok); }
  for (const bad of ['pending:', 'pending', 'waiting for main', 'passed']) {
    p.edit(taskPath, baselineIs(bad));
    const r = p.run(['records']);
    assert.equal(r.status, 1, bad);
    assert.match(r.out.errors.join(' | '), /baseline_result must be "pass", "fail: <summary>" or "pending: <run reference>"/, bad);
  }
});

test('MAINT-0020 P2(b): review-packet and wf ci refuse a pending baseline_result, and take the filled one', t => {
  const p = project(t);
  p.edit(taskPath, baselineIs(pendingResult)); p.write('src/a.js', 'export const result = 1;\n');
  const pending = p.commit('T-0001: the work, baseline still pending');
  const checks = path.join(p.temp, 'checks.txt'); fs.writeFileSync(checks, 'checks observed');
  const git = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_COUNT: '0' }; // no host filters, as review-packet.test.js
  const packet = () => p.run(['review-packet', '--baseline', p.baseline, '--candidate', p.git('rev-parse', 'HEAD'), '--task', 'T-0001', '--evidence', checks], { env: git });
  const refused = packet();
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /review task T-0001: baseline_result is still pending: https:\/\/github\.com\/fixture\/project\/actions\/runs\/42: fill it from the trusted branch's run on the baseline commit \(wf wait --commit [0-9a-f]{40}, then pass or fail: <summary>\) before the review packet/);
  const ci = p.run(['ci', '--baseline', p.baseline, '--candidate', pending, '--task', 'T-0001'], { evidence: evidence(pending) });
  assert.equal(ci.status, 1, ci.stdout + ci.stderr);
  assert.match(ci.out.findings.join(' | '), /readiness T-0001: Needs discovery or resolution \|\s+baseline_result is still pending: /);
  p.edit(taskPath, baselineIs('pass'));
  const filled = p.commit('T-0001: baseline_result from main\'s run');
  assert.equal(packet().status, 0);
  const passed = p.run(['ci', '--baseline', p.baseline, '--candidate', filled, '--task', 'T-0001'], { evidence: evidence(filled) });
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
});

test('MAINT-0020 P10, P7(c): the start action prints wf wait --commit for the baseline, and the Draft milestone action wf doctor', t => {
  const p = project(t);
  const start = p.run(['next', '--baseline', p.baseline]).out.next;
  assert.equal(start.kind, 'start');
  assert.ok(start.run.includes(`wf wait --commit ${p.baseline}  (the trusted branch's checks on the baseline; fill baseline_result before the review packet)`), JSON.stringify(start.run));
  assert.match(start.run[0], /^wf doctor  \(raise every gap in the next question to the owner\)$/, 'kept at the hand-over');
  p.edit(taskPath, x => x.replace('status: Ready', 'status: Active'));
  const resumed = p.run(['next', '--baseline', p.commit('T-0001: start')]).out.next;
  assert.deepEqual([resumed.kind, resumed.run.some(c => c.startsWith('wf wait'))], ['continue', false], 'only at the claim');
  // Manual mode has no pull-request commands (as the lead's brief), so no wf wait.
  const manual = project(t, { configEdit: c => ({ ...c, approval: { ...c.approval, label: 'manual', mechanism: 'manual', checkpoint: undefined } }), baselineEdit: q => q.edit('docs/workflow/profile.md', x => x.replace('approval_label: owner-merge', 'approval_label: manual')) });
  const claim = manual.run(['next', '--baseline', manual.baseline]).out.next;
  assert.deepEqual([claim.kind, claim.run.some(c => c.startsWith('wf wait'))], ['start', false]);
  // P7(c): before the plan's question, not 7 h 40 min after it.
  const draft = project(t, { baselineEdit: q => q.edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised', 'status: Draft')) });
  const plan = draft.run(['next', '--baseline', draft.baseline]).out.next;
  assert.deepEqual([plan.kind, plan.item, plan.do], ['plan', 'M-0001', 'Prepare M-0001 for the owner\'s authorisation']);
  assert.deepEqual(plan.run, ['wf doctor  (put every gap in the plan\'s question to the owner, before authorisation)']);
  // doctor's own next text says the same: maint-0018-b.test.js (B5).
  assert.match(fs.readFileSync(path.join(root, 'procedures/execute.md'), 'utf8'), /Run `wf doctor` when planning and before work starts; put every gap it names in the plan's question to the owner when planning, otherwise in the next\. Claim every task `wf next` lists as startable and hand each to a fresh task lead \(an empty-context subagent, in the background\)/);
});

// P6(b). Five of M-0005's seven question rounds were about its limits: tasks 8, 9 and 10 were each asked, and all twelve
// answers were the recommended option. The owner allows up to three found tasks that fix the milestone's own review or trial
// findings (MAINT-0020 § 10); the milestone's record says how many.
const planOf = (found = 'found_tasks: 2\n') => q => q.edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised\n', `status: Authorised\ntasks: [T-0001]\n${found}`));
const fixes = finding => x => x.replace('status: Ready', `status: Ready\nfound_from: ${finding}`);
const ask = 'ask the owner, who adds it to M-0001\'s tasks: or moves the work to a later milestone';

test('MAINT-0020 P6(b): a found task that names its finding passes readiness within found_tasks; beyond it, or without found_from, it asks the owner', t => {
  const p = project(t, { baselineEdit: planOf() });
  taskLike(p, 'T-0002', 'src/b', fixes('R-0001/F1'));
  taskLike(p, 'T-0003', 'src/c');
  taskLike(p, 'T-0004', 'src/d', fixes('trial'));
  taskLike(p, 'T-0005', 'src/e', fixes('R-0002/F3'));
  const sha = p.commit('records: four found tasks');
  const ready = (id, ...more) => p.run(['readiness', '--baseline', sha, '--task', id, ...more]).out;
  for (const id of ['T-0001', 'T-0002', 'T-0004']) assert.equal(ready(id).outcome, 'Ready', `${id}: ${ready(id).reasons.join(' | ')}`);
  // The found task without found_from takes no place: T-0004 is the second.
  assert.deepEqual(ready('T-0003').reasons, [`T-0003 is a found task of M-0001 (its tasks: list does not name it) without found_from: name the review finding (R-NNNN/F1) or trial it fixes, or ${ask}`]);
  assert.deepEqual(ready('T-0005').reasons, [`T-0005 would be found task 3 of M-0001, beyond its found_tasks allowance of 2: ${ask}`]);
  // Those recorded only on the branch count too, after those on the trusted branch.
  taskLike(p, 'T-0006', 'src/f', fixes('trial'));
  taskLike(p, 'T-0007', 'src/g', fixes('R-0003/F1'));
  const branch = p.commit('T-0006, T-0007: recorded on a branch');
  assert.deepEqual(ready('T-0007', '--candidate', branch).reasons, [`T-0007 would be found task 5 of M-0001, beyond its found_tasks allowance of 2: ${ask}`]);
  // Without found_tasks none is allowed, as before; without a tasks: list no task is found, as wf status counts them.
  const none = project(t, { baselineEdit: planOf('') });
  taskLike(none, 'T-0002', 'src/b', fixes('R-0001/F1'));
  const noAllowance = none.commit('records: a found task');
  assert.deepEqual(none.run(['readiness', '--baseline', noAllowance, '--task', 'T-0002']).out.reasons, [`T-0002 would be found task 1 of M-0001, beyond its found_tasks allowance of 0: ${ask}`]);
  assert.equal(none.run(['readiness', '--baseline', noAllowance, '--task', 'T-0001']).out.outcome, 'Ready', 'a planned task is not counted');
  const unplanned = project(t);
  taskLike(unplanned, 'T-0002', 'src/b');
  assert.equal(unplanned.run(['readiness', '--baseline', unplanned.commit('records: T-0002'), '--task', 'T-0002']).out.outcome, 'Ready');
});

test('MAINT-0020 P6(b): wf records takes found_from as a review finding or trial, and found_tasks as 0 to 3; the template proposes 3', t => {
  const p = project(t);
  const set = (file, key, value) => p.edit(file, x => x.replace(new RegExp(`^(?:${key}: .*\\n)?(status: )`, 'm'), `${key}: ${value}\n$1`));
  const milestone = 'docs/workflow/milestones/M-0001.md';
  for (const ok of ['R-0073/F1', 'trial']) { set(taskPath, 'found_from', ok); assert.equal(p.run(['records']).status, 0, ok); }
  for (const bad of ['F1', 'trial: the cart', 'R-0073/F1/x', '[R-0073/F1]', 'R-0073 F1']) {
    set(taskPath, 'found_from', bad);
    const r = p.run(['records']);
    assert.equal(r.status, 1, bad);
    assert.match(r.out.errors.join(' | '), /found_from must name what the task fixes: a review finding like R-0073\/F1, or trial/, bad);
  }
  set(taskPath, 'found_from', 'trial');
  for (const ok of ['0', '3']) { set(milestone, 'found_tasks', ok); assert.equal(p.run(['records']).status, 0, ok); }
  for (const bad of ['4', '-1', 'three', '[3]', '1.5']) {
    set(milestone, 'found_tasks', bad);
    const r = p.run(['records']);
    assert.equal(r.status, 1, bad);
    assert.match(r.out.errors.join(' | '), /found_tasks must be 0, 1, 2 or 3, the found tasks allowed without asking the owner \(MAINT-0020 § 10\)/, bad);
  }
  assert.match(fs.readFileSync(path.join(root, 'templates/milestone.md'), 'utf8'), /^found_tasks: 3$/m);
  assert.match(fs.readFileSync(path.join(root, 'templates/task.md'), 'utf8'), /^found_from:$/m);
});

// P6(a). T-0030's three attempts went on two M-0003 screen tests it did not touch, and the limits question waited 3 h 50 min
// overnight. Attempts are counted by the agent, so no gate can see this; the text is what holds it.
test('MAINT-0020 P6(a): execute.md records a flake in tests the task does not change apart, using none of the task\'s attempts', () => {
  assert.match(fs.readFileSync(path.join(root, 'procedures/execute.md'), 'utf8'), /Expected test-first failures, and a flake \(a failure in tests the task does not change that passes on a rerun of the same revision, recorded with a found task\), are recorded apart and use none of the task's attempts\./);
});

// P11. R-0063/F1, a race from M-0004's T-0020 found in T-0031's review, made #91 the owner's merge though T-0032 fixed it.
const deferring = c => ({ ...c, approval: { ...c.approval, defer_to_acceptance: true } });
const race = (over = {}) => ({ id: 'F1', severity: 'blocking', status: 'accepted', resolution: 'carried by T-0002', exposure: 'two invoices can take the same number', carried_by: 'T-0002', paths: ['src/b.js'], merge_increases_exposure: false, ...over });
function carrying(t, { defer = true } = {}) {
  const p = project(t, { configEdit: defer ? deferring : c => c, baselineEdit: q => q.edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised\n', 'status: Authorised\ntasks: [T-0001, T-0003]\nfound_tasks: 3\n')) });
  taskLike(p, 'T-0002', 'src/b', x => fixes('R-0001/F1')(x).replace('status: Ready', 'status: Draft'));
  taskLike(p, 'T-0003', 'src/c', x => x.replace('status: Ready', 'status: Draft'));
  taskLike(p, 'T-0004', 'src/d', x => fixes('R-0001/F2')(x).replace('status: Ready', 'status: Draft'));
  const base = p.commit('records: the found T-0002 and T-0004, the planned T-0003');
  p.write('src/a.js', 'export const result = 1;\n');
  p.edit(taskPath, x => x.replace('subset: []', 'subset: []\naccepted_findings: [R-0001/F1]'));
  const head = p.commit('T-0001: the work; R-0001/F1 accepted, T-0002 fixes it');
  const ci = (findings, candidate = head) => { const e = evidence(candidate); e.review.findings = findings; return p.run(['ci', '--baseline', base, '--candidate', candidate, '--task', 'T-0001'], { evidence: e }); };
  return { ...p, base, head, ci };
}

test('MAINT-0020 P11: a blocking finding outside the diff, carried by a found task, keeps the agent\'s merge; any condition missing gives the owner\'s', t => {
  const p = carrying(t);
  const ok = p.ci([race()]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.deepEqual([ok.out.merge, ok.out.owner_reasons], ['agent', []]);
  assert.deepEqual(ok.out.deferred, ['blocking review findings carried by found tasks, in code this pull request does not change: R-0001/F1 by T-0002']);
  assert.equal(p.ci([race({ paths: ['src/b.js', 'docs/specs'] })]).out.merge, 'agent', 'a folder the diff does not touch');
  const owner = (findings, candidate) => { const r = p.ci(findings, candidate); assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(r.out.merge, 'owner'); return r.out.owner_reasons; };
  for (const [over, why] of [
    [{ paths: ['src/a.js'] }, 'this pull request changes src/a.js'],
    [{ paths: ['src/b.js', 'src'] }, 'this pull request changes src'],
    [{ paths: undefined }, 'it names no paths'],
    [{ carried_by: undefined }, 'carried_by names no other found task of M-0001'],
    [{ carried_by: 'T-0001' }, 'carried_by names no other found task of M-0001'],
    [{ carried_by: 'T-0003' }, 'carried_by names no other found task of M-0001'],
    [{ carried_by: 'T-0009' }, 'carried_by names no other found task of M-0001'],
    [{ carried_by: 'T-0004' }, 'T-0004\'s found_from is not R-0001/F1'],
    [{ merge_increases_exposure: true }, 'merge_increases_exposure is not false'],
    [{ merge_increases_exposure: undefined }, 'merge_increases_exposure is not false'],
  ]) assert.deepEqual(owner([race(over)]), [`blocking review findings accepted rather than fixed: F1 (not carried: ${why})`], JSON.stringify(over));
  // A finding the task record does not list.
  p.git('checkout', '-q', '--detach', p.base);
  p.write('src/a.js', 'export const result = 1;\n');
  const unlisted = p.commit('T-0001: the work, R-0001/F1 not listed');
  assert.deepEqual(owner([race()], unlisted), ['blocking review findings accepted rather than fixed: F1 (not carried: not in the task record\'s accepted_findings)']);
  // A found task cannot carry a finding of its own review.
  p.git('checkout', '-q', '--detach', p.base);
  p.edit('docs/workflow/tasks/T-0002.md', x => x.replace('status: Draft', 'status: Ready').replace('subset: []', 'subset: []\naccepted_findings: [R-0001/F1]'));
  p.write('src/b/fix.js', 'export const fixed = false;\n');
  const own = p.commit('T-0002: its work, its own finding accepted');
  const e = evidence(own); e.tasks = e.review.tasks = ['T-0002']; e.review.findings = [race({ paths: ['src/c.js'] })];
  const self = p.run(['ci', '--baseline', p.base, '--candidate', own, '--task', 'T-0002'], { evidence: e });
  assert.equal(self.status, 0, self.stdout + self.stderr);
  assert.deepEqual([self.out.merge, self.out.owner_reasons], ['owner', ['blocking review findings accepted rather than fixed: F1 (not carried: carried_by names no other found task of M-0001)']]);
  // A non-blocking accepted finding behaves as before, whatever it carries.
  const minor = p.ci([race({ severity: 'should fix', exposure: undefined })]);
  assert.deepEqual([minor.status, minor.out.merge, minor.out.deferred], [0, 'agent', ['review findings accepted rather than fixed: F1']]);
  const missing = p.ci([race({ severity: 'should fix', exposure: undefined })], unlisted);
  assert.equal(missing.status, 1);
  assert.match(missing.out.findings.join(' | '), /accepted findings F1 are not in the task record's accepted_findings/);
  // Without defer_to_acceptance every accepted finding is the owner's merge, as before.
  const plain = carrying(t, { defer: false });
  const r = plain.ci([race()]);
  assert.deepEqual([r.status, r.out.merge, r.out.owner_reasons], [0, 'owner', ['review findings accepted rather than fixed: F1']]);
  // POLICY states the exception with the owner's decision.
  assert.match(fs.readFileSync(path.join(root, 'POLICY.md'), 'utf8'), /A blocking finding accepted rather than fixed waits for the owner's merge unless the pull request does not change its code, the merge does not increase its exposure and a found task of the milestone fixes it; that one too waits for the acceptance \(the owner's decision of 16 October 2026, MAINT-0020 § 10\)\./);
});

test('MAINT-0020 P11: the delivery evidence checks carried_by, paths and merge_increases_exposure wherever a finding gives them', () => {
  const errorsWith = over => { const e = evidence(SHA); e.review.findings = [race(over)]; return evidenceErrors({ evidence: e, revision: SHA, taskIds: ['T-0001'], owner: 'agent', requiredChecks: ['unit'] }); };
  assert.deepEqual(errorsWith(), []);
  assert.deepEqual(errorsWith({ paths: ['src/b.js', 'src', 'docs/a file.md'] }), []);
  assert.deepEqual(errorsWith({ carried_by: undefined, paths: undefined, merge_increases_exposure: undefined }), [], 'each is optional');
  for (const carried_by of ['T-2', 'R-0001', 'T-0002 ', 7]) assert.deepEqual(errorsWith({ carried_by }), ['review finding "F1": carried_by must be the T-NNNN of the found task that fixes it'], String(carried_by));
  for (const paths of [[], 'src/b.js', ['src/*.js'], ['src/{a,b}.js'], ['./src/b.js'], ['src/../b.js'], ['/src/b.js'], ['src/'], ['src//b.js'], ['src/b.js '], ['src\\b.js'], [7]]) assert.deepEqual(errorsWith({ paths }), ['review finding "F1": paths must list the files or folders of its code as Git names them (no globs, no ./ or ..)'], JSON.stringify(paths));
  for (const value of ['false', 0, null]) assert.deepEqual(errorsWith({ merge_increases_exposure: value }), ['review finding "F1": merge_increases_exposure must be true or false'], String(value));
  assert.deepEqual(errorsWith({ severity: 'low', exposure: undefined, carried_by: 'T-2' }), ['review finding "F1": carried_by must be the T-NNNN of the found task that fixes it'], 'on any finding');
});
