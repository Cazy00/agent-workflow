import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitSource } from '../lib/index.js';
import { carriedFrom } from '../lib/carry.js';
import { evidenceErrors } from '../lib/delivery-evidence.js';
import { fakeExecutable } from './helpers.js';
import { cli, evidence, project, taskPath } from './helpers/maint-0018.js';

// MAINT-0018 Part B: the costs M-0004 of mateen-systems showed after Part A. Task leads that implemented their own tasks,
// a governing edit that kept a pull request waiting 13 hours, a fix review with nothing exposed, access found missing
// after midnight, and waits, Done commits and IDs written by hand.

// B1. The task lead's brief, from the records, with the rule that a fresh helper implements.
test('MAINT-0018 B1: wf brief --lead prints the task lead\'s brief: the task, what not to edit, and who implements', t => {
  const p = project(t);
  const r = spawnSync(process.execPath, [cli, 'brief', '--lead', '--task', 'T-0001', '--repo', p.repo, '--baseline', p.baseline], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const want of [
    /^# T-0001: Task T-0001$/m,
    /Do the work of T-0001/,
    /A fresh helper implements the task; each fix round goes to a new helper[^;]*; a small one writes the closing paperwork/,
    /AC-001-1/,
    /Do not edit, in this task's pull request: [^\n]*docs\/specs\/\*\*/,
    /wf evidence --baseline [0-9a-f]{40} --candidate HEAD --task T-0001/,
    /"implementer": "helper"/,
  ]) assert.match(r.stdout, want);
});

test('MAINT-0018 B1 (review S3): in manual mode the brief\'s commands carry the trust options, and pull-request commands are left out', t => {
  const p = project(t, { configEdit: c => ({ ...c, approval: { ...c.approval, label: 'manual', mechanism: 'manual', checkpoint: undefined } }), baselineEdit: q => q.edit('docs/workflow/profile.md', x => x.replace('approval_label: owner-merge', 'approval_label: manual')) });
  const r = spawnSync(process.execPath, [cli, 'brief', '--lead', '--task', 'T-0001', '--repo', p.repo, '--baseline', p.baseline], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /wf readiness --baseline [0-9a-f]{40} --task T-0001 --trust-key … --receipts … --repository …/);
  assert.match(r.stdout, /wf ci --baseline [0-9a-f]{40} --candidate HEAD --task T-0001 --trust-key … --receipts … --repository … --unsigned-receipts ROUND_FILE/);
  assert.doesNotMatch(r.stdout, /wf evidence|wf wait/);
});

test('MAINT-0018 B1: a session outcome may say who implemented; a lead that implemented its own task is flagged', t => {
  const p = project(t);
  const head = p.git('rev-parse', 'HEAD');
  const session = record => { const file = path.join(p.temp, 'session.json'); fs.writeFileSync(file, JSON.stringify(record)); return p.run(['session', '--baseline', p.baseline, '--candidate', head, '--record', file]); };
  const base = { outcome: 'progress', workflow: { version: 'v2.6.0', revision: 'a'.repeat(40) }, summary: 'T-0001 delivered', evidence: ['https://github.com/fixture/project/pull/1'], next_action: 'next task', friction: 'none' };
  const lead = session({ ...base, implementer: 'lead' });
  assert.equal(lead.status, 0, lead.stdout + lead.stderr);
  assert.ok(lead.out.notes.some(n => /the task lead implemented the task itself/.test(n)), lead.stdout);
  assert.match(session({ ...base, implementer: 'someone' }).out.errors.join(' | '), /implementer is helper or lead/);
  assert.equal(session({ ...base, implementer: 'helper' }).out.notes?.length ?? 0, 0);
});

// B3. Putting a governing file back to the trusted branch's content keeps the review: #73 waited 13 h 18 min.
test('MAINT-0018 B3: a governing file restored to the trusted branch\'s content after the review carries the review over', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-maint-0018-b3-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
  const commit = m => { git('add', '-A'); git('commit', '-qm', m); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  write('src/a.js', 'a\n'); write('apps/web/ARCHITECTURE.md', 'the architecture\n'); const base = commit('main');
  git('checkout', '-q', '-b', 'task');
  write('src/a.js', 'the task\'s code\n'); write('apps/web/ARCHITECTURE.md', 'the architecture, and a paragraph\n'); const reviewed = commit('the task, with a governing paragraph');
  write('apps/web/ARCHITECTURE.md', 'the architecture\n'); const restored = commit('the paragraph moves to the acceptance pull request');
  const config = { paths: { production: ['src/**'], governing: ['apps/web/ARCHITECTURE.md'], planning: ['docs/**'] } };
  assert.deepEqual(carriedFrom({ config, baseline: gitSource(dir, base), candidate: gitSource(dir, restored), from: reviewed }).ok, true);
  write('src/a.js', 'a\n'); const reverted = commit('the code goes back too');
  assert.equal(carriedFrom({ config, baseline: gitSource(dir, base), candidate: gitSource(dir, reverted), from: reviewed }).ok, false, 'reverting reviewed code still needs a review');
  // Review S7: a governing file that is also an acceptance test never carries; a file the trusted branch changed meanwhile
  // carries once the pull request holds the trusted branch's new content.
  const tests = { paths: { ...config.paths, acceptance_tests: ['apps/web/ARCHITECTURE.md'] } };
  assert.equal(carriedFrom({ config: tests, baseline: gitSource(dir, base), candidate: gitSource(dir, restored), from: reviewed }).ok, false, 'an acceptance test put back still needs its run');
  git('checkout', '-q', 'main'); write('apps/web/ARCHITECTURE.md', 'the architecture, revised on main\n'); const moved = commit('main revises the architecture');
  git('checkout', '-q', 'task'); git('reset', '-q', '--hard', restored); git('merge', '-q', '--no-edit', 'main'); const merged = git('rev-parse', 'HEAD');
  assert.equal(carriedFrom({ config, baseline: gitSource(dir, moved), candidate: gitSource(dir, merged), from: reviewed }).ok, true);
});

test('MAINT-0018 B3: the owner\'s reason for a governing change says it can move to the acceptance pull request', t => {
  const p = project(t);
  p.edit('docs/specs/feature.md', x => `${x}\nA clarification.\n`); const records = p.commit('a governing clarification');
  // Review N3: on its own, as in an authorisation or acceptance pull request, it is the owner's change and says no more.
  assert.deepEqual(p.run(['ci', '--baseline', p.baseline, '--candidate', records]).out.owner_reasons, ['it changes the plan or requirements: docs/specs/feature.md']);
  p.edit(taskPath, x => x.replace(`governing_baseline_revision: ${p.initial}`, `governing_baseline_revision: ${p.baseline}`));
  p.write('src/a.js', 'export const result = 1;\n'); const head = p.commit('T-0001: the work, with the clarification');
  const r = p.run(['ci', '--baseline', p.baseline, '--candidate', head, '--task', 'T-0001'], { evidence: evidence(head) });
  assert.match(r.out.owner_reasons.join(' | '), /it changes the plan or requirements: docs\/specs\/feature\.md \(a clarification nothing waits on goes into the milestone's acceptance pull request: put the file back here and the review still carries over\)/, r.stdout);
});

// B4. A blocking finding states what it exposes; M-0004's second fix review chased a gap the server already refused.
test('MAINT-0018 B4: a blocking finding in the delivery evidence states its exposure', () => {
  const rev = 'c'.repeat(40);
  const errorsFor = findings => { const e = evidence(rev); e.review.findings = findings; return evidenceErrors({ evidence: e, revision: rev, taskIds: ['T-0001'], owner: 'agent', requiredChecks: ['unit'] }); };
  assert.match(errorsFor([{ id: 'F1', severity: 'blocking', status: 'resolved', resolution: 'fixed in abc' }]).join(' | '), /review finding "F1" is blocking: say in exposure what it exposes and to whom, or that nothing is exposed/);
  assert.deepEqual(errorsFor([{ id: 'F1', severity: 'blocking', status: 'resolved', resolution: 'fixed in abc', exposure: 'Clerk B in another shop could read Noor\'s customers (200, with rows)' }]), []);
  assert.deepEqual(errorsFor([{ id: 'N1', severity: 'should fix', status: 'resolved', resolution: 'fixed in abc' }]), []);
});

// B5. A start-of-session check of what the work needs; M-0004 found missing staging access at 18:17 and said so at 04:44.
test('MAINT-0018 B5: wf doctor reports the tools and the project\'s preflight checks, and names every gap', t => {
  const p = project(t, { configEdit: c => ({ ...c, review: { second_model: { tool: 'codex', model: 'gpt-6.1-sol', max_effort: 'high' } }, preflight: [{ name: 'staging deploy access', run: 'true' }, { name: 'a browser for the trial walk', run: 'exit 3' }] }) });
  const bin = path.join(p.temp, 'bin'); fs.mkdirSync(bin);
  fakeExecutable(path.join(bin, 'gh'), `const a = process.argv.slice(2).join(' ');
if (a === '--version') console.log('gh version 2.40.0 (2023-12-01)');
else if (a.startsWith('auth status')) console.log('github.com\\n  ✓ Logged in to github.com account ' + (process.env.FAKE_GH_ACCOUNT || 'agent') + ' (keyring)');
else if (a.startsWith('api user')) console.log(process.env.FAKE_GH_ACCOUNT || 'agent');
else if (a.startsWith('api')) console.log(JSON.stringify({ full_name: 'fixture/project', permissions: { push: true } }));
else process.exit(1);`);
  const env = { PATH: `${bin}:/usr/bin:/bin` };
  const r = p.run(['doctor'], { env });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const by = name => r.out.checks.find(c => c.name === name);
  assert.equal(by('gh signed in').ok, true);
  assert.equal(by('staging deploy access').ok, true);
  assert.equal(by('a browser for the trial walk').ok, false);
  assert.equal(by('codex (review.second_model)').ok, false);
  assert.deepEqual(r.out.gaps.sort(), ['a browser for the trial walk', 'codex (review.second_model)']);
  assert.match(r.out.next, /ask the owner about every gap in your first question/);
  // The owner's account signed in where the agent works (the MacBook's arrangement since 13 October) is a gap too.
  const owner = p.run(['doctor'], { env: { ...env, FAKE_GH_ACCOUNT: 'owner' } }).out.checks.find(c => c.name === 'gh signed in');
  assert.equal(owner.ok, false);
  assert.match(owner.detail, /as owner, but the agent's account is agent: switch with gh auth switch --user agent/);
  // Review S5: the preflight list is the trusted branch's, never a working-tree edit, and runs without signing variables.
  const configPath = path.join(p.repo, 'docs/workflow/config.json');
  const edited = JSON.parse(fs.readFileSync(configPath, 'utf8')); edited.preflight = [{ name: 'an edit in the working tree', run: 'true' }]; fs.writeFileSync(configPath, JSON.stringify(edited));
  assert.equal(p.run(['doctor'], { env }).out.checks.some(c => c.name === 'an edit in the working tree'), false);
  p.git('checkout', '-q', '--', 'docs/workflow/config.json');
  const leak = project(t, { configEdit: c => ({ ...c, preflight: [{ name: 'no signing key', run: 'test -z "$OWNER_SIGNING_KEY$WF_READ_TOKEN$GPG_PASSPHRASE"' }] }) });
  assert.equal(leak.run(['doctor'], { env: { ...env, OWNER_SIGNING_KEY: 'secret', WF_READ_TOKEN: 'secret', GPG_PASSPHRASE: 'secret' } }).out.checks.find(c => c.name === 'no signing key').ok, true);
  const bad = project(t, { configEdit: c => ({ ...c, preflight: [{ name: 'x' }] }) });
  assert.match(bad.run(['doctor'], { env }).stderr, /preflight entries need a name and a run command/);
});

// B6. Commands for what agents wrote by hand.
test('MAINT-0018 B6: wf wait follows a pull request\'s current head until its checks finish, through network errors', t => {
  const p = project(t);
  const bin = path.join(p.temp, 'bin'); fs.mkdirSync(bin);
  const state = path.join(p.temp, 'calls');
  fakeExecutable(path.join(bin, 'gh'), `const fs = require('fs'); const f = ${JSON.stringify(state)};
const n = (fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0) + 1; fs.writeFileSync(f, String(n));
const a = process.argv.slice(2).join(' ');
if (n === 2) { console.error('connection reset'); process.exit(1); }
if (a.includes('/pulls/7')) console.log(JSON.stringify({ state: 'open', merged: n > 20, head: { sha: 'f'.repeat(40) } }));
else if (a.includes('/check-runs')) console.log(JSON.stringify({ check_runs: n < 5
  ? [{ name: 'wf ci', status: 'in_progress', conclusion: null, started_at: '2026-10-14T00:00:00Z' }, { name: 'unit', status: 'completed', conclusion: 'success', started_at: '2026-10-14T00:00:00Z' }]
  : [{ name: 'wf ci', status: 'completed', conclusion: 'failure', started_at: '2026-10-14T00:00:00Z' }, { name: 'wf ci', status: 'completed', conclusion: 'success', started_at: '2026-10-14T00:01:00Z' }, { name: 'unit', status: 'completed', conclusion: 'success', started_at: '2026-10-14T00:00:00Z' }] }));
else process.exit(1);`);
  const env = { PATH: `${bin}:${process.env.PATH}`, WF_WAIT_INTERVAL: '0' };
  const r = p.run(['wait', '--pr', '7'], { env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.out.result, 'passed');
  assert.deepEqual(r.out.checks.map(c => `${c.name}:${c.conclusion}`).sort(), ['unit:success', 'wf ci:success'], 'the newest run of each check counts');
  fs.rmSync(state);
  const merged = p.run(['wait', '--pr', '7', '--merged'], { env });
  assert.equal(merged.status, 0, merged.stdout + merged.stderr);
  assert.equal(merged.out.result, 'merged');
});

test('MAINT-0018 B6 (review S6): wf wait waits for every required check to appear, stops on a failed one when waiting for a merge, and refuses bad numbers', t => {
  const p = project(t);
  const bin = path.join(p.temp, 'bin'); fs.mkdirSync(bin);
  fakeExecutable(path.join(bin, 'gh'), `const a = process.argv.slice(2).join(' ');
const runs = JSON.parse(process.env.FAKE_RUNS);
if (a.includes('/pulls/7')) console.log(JSON.stringify({ state: 'open', merged: false, head: { sha: 'f'.repeat(40) } }));
else if (a.includes('/check-runs')) console.log(JSON.stringify({ check_runs: runs }));
else process.exit(1);`);
  const env = runs => ({ PATH: `${bin}:${process.env.PATH}`, WF_WAIT_INTERVAL: '0', FAKE_RUNS: JSON.stringify(runs) });
  const done = (name, conclusion) => ({ name, status: 'completed', conclusion, started_at: '2026-10-14T00:00:00Z' });
  const missing = p.run(['wait', '--pr', '7', '--timeout', '0.02'], { env: env([done('wf ci', 'success')]) });
  assert.equal(missing.out.result, 'timeout', 'the required check unit has not appeared, so wf ci alone is not a pass');
  assert.deepEqual(missing.out.waiting_for, ['unit']);
  const failed = p.run(['wait', '--pr', '7', '--merged', '--timeout', '1'], { env: env([done('wf ci', 'success'), done('unit', 'failure')]) });
  assert.equal(failed.status, 1);
  assert.equal(failed.out.result, 'failed');
  assert.match(p.run(['wait', '--pr', '7'], { env: { ...env([]), WF_WAIT_INTERVAL: 'soon' } }).stderr, /WF_WAIT_INTERVAL must be a number of seconds/);
  assert.match(p.run(['wait', '--pr', '7', '--timeout', 'abc'], { env: env([]) }).stderr, /--timeout must be a number of minutes/);
});

test('MAINT-0018 B6: wf done marks a task Done with the commit it implemented, and refuses anything else', t => {
  const p = project(t);
  p.write('src/a.js', 'export const result = 1;\n'); const code = p.commit('T-0001: the work');
  const r = p.run(['done', '--task', 'T-0001', '--implemented', code]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const record = fs.readFileSync(path.join(p.repo, taskPath), 'utf8');
  assert.match(record, /^status: Done$/m);
  assert.match(record, new RegExp(`^implemented: ${code}$`, 'm'));
  assert.match(r.out.next, /git add docs\/workflow\/tasks\/T-0001\.md && git commit -m "T-0001: Done"/);
  assert.match(p.run(['done', '--task', 'T-0001', '--implemented', code]).stderr, /T-0001 is Done already/);
  p.git('checkout', '-q', '--', taskPath);
  assert.match(p.run(['done', '--task', 'T-0001', '--implemented', 'e'.repeat(40)]).stderr, /is not a commit in this checkout's history/);
});

test('MAINT-0018 B6: wf next names the next free record IDs, counting removed records, and wf doctor before a task starts', t => {
  const p = project(t);
  p.write('docs/workflow/tasks/T-0007.md', fs.readFileSync(path.join(p.repo, taskPath), 'utf8').replaceAll('T-0001', 'T-0007')); p.commit('a task');
  fs.rmSync(path.join(p.repo, 'docs/workflow/tasks/T-0007.md')); p.commit('its record removed after its milestone\'s acceptance');
  const r = p.run(['next']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.out.next_ids.task, 'T-0008');
  assert.equal(r.out.next_ids.milestone, 'M-0002');
  assert.match(r.out.next.run[0], /^wf doctor/, JSON.stringify(r.out.next));
  assert.match(r.out.next.run[1], /^wf brief --lead --task T-0001/);
  // Review S2: the flow M-0004 used, a Draft on the trusted branch claimed on its own branch, shows them too.
  const draft = project(t, { baselineEdit: q => q.edit(taskPath, x => x.replace('status: Ready', 'status: Draft')) });
  assert.match(draft.run(['next']).out.next.run[0], /^wf doctor/);
  draft.edit(taskPath, x => x.replace('status: Draft', 'status: Active')); draft.commit('T-0001: start');
  const active = draft.run(['next']).out.next;
  assert.equal(active.kind, 'continue');
  assert.match(active.run[0], /^wf doctor/);
});

test('MAINT-0018 B6: wf evidence --json prints the evidence alone', t => {
  const p = project(t);
  p.write('src/a.js', 'export const result = 1;\n'); const head = p.commit('T-0001: the work');
  const r = spawnSync(process.execPath, [cli, 'evidence', '--repo', p.repo, '--baseline', p.baseline, '--candidate', head, '--task', 'T-0001', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).candidate, head);
});
