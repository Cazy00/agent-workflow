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
    /Fresh helpers implement the task, one per slice \(below\); each fix round goes to a new helper[^;]*; a small one writes the closing paperwork/,
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
  const r = p.run(['doctor'], { env, cwd: p.repo }); // from the root, as a session starts (MAINT-0020 P9 adds the check)
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const by = name => r.out.checks.find(c => c.name === name);
  assert.equal(by('gh signed in').ok, true);
  assert.equal(by('staging deploy access').ok, true);
  assert.equal(by('a browser for the trial walk').ok, false);
  assert.equal(by('codex (review.second_model)').ok, false);
  assert.deepEqual(r.out.gaps.sort(), ['a browser for the trial walk', 'codex (review.second_model)']);
  assert.match(r.out.next, /ask the owner about every gap in your next question \(the plan's, when planning\)/); // MAINT-0020 P7(c)
  // The owner's account signed in where the agent works (the MacBook's arrangement since 13 October) is a gap too.
  const owner = p.run(['doctor'], { env: { ...env, FAKE_GH_ACCOUNT: 'owner' } }).out.checks.find(c => c.name === 'gh signed in');
  assert.equal(owner.ok, false);
  assert.match(owner.detail, /as owner, but the agent's account is agent: switch with gh auth switch --user agent/);
  // Review S5: the preflight list is the trusted branch's, never a working-tree edit, and runs without signing variables.
  const configPath = path.join(p.repo, 'docs/workflow/config.json');
  const edited = JSON.parse(fs.readFileSync(configPath, 'utf8')); edited.preflight = [{ name: 'an edit in the working tree', run: 'true' }]; fs.writeFileSync(configPath, JSON.stringify(edited));
  assert.equal(p.run(['doctor'], { env }).out.checks.some(c => c.name === 'an edit in the working tree'), false);
  p.git('checkout', '-q', '--', 'docs/workflow/config.json');
  const leak = project(t, { configEdit: c => ({ ...c, preflight: [{ name: 'no signing key', run: 'test -z "$OWNER_SIGNING_KEY$WF_READ_TOKEN$GPG_PASSPHRASE"' }, { name: 'the ssh agent', run: 'test -n "$SSH_AUTH_SOCK"' }] }) });
  const leaked = leak.run(['doctor'], { env: { ...env, OWNER_SIGNING_KEY: 'secret', WF_READ_TOKEN: 'secret', GPG_PASSPHRASE: 'secret', SSH_AUTH_SOCK: '/tmp/agent.sock' } }).out.checks;
  assert.equal(leaked.find(c => c.name === 'no signing key').ok, true);
  assert.equal(leaked.find(c => c.name === 'the ssh agent').ok, true, 'a preflight ssh to staging uses the agent (fix review)');
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
  assert.equal(missing.out.result, 'pending', 'the required check unit has not appeared, so wf ci alone is not a pass'); // MAINT-0020 P12: was 'timeout'
  assert.deepEqual(missing.out.waiting_for, ['unit']);
  const failed = p.run(['wait', '--pr', '7', '--merged', '--timeout', '1'], { env: env([done('wf ci', 'success'), done('unit', 'failure')]) });
  assert.equal(failed.status, 1);
  assert.equal(failed.out.result, 'failed');
  // The fix review: wf ci is required too; a cancelled run (wf ci cancels itself when the description is edited) does
  // not end a --merged wait; a pass needs two polls that agree.
  const noGate = p.run(['wait', '--pr', '7', '--timeout', '0.02'], { env: env([done('unit', 'success')]) });
  assert.deepEqual(noGate.out.waiting_for, ['wf ci']);
  assert.equal(p.run(['wait', '--pr', '7', '--merged', '--timeout', '0.02'], { env: env([done('wf ci', 'cancelled'), done('unit', 'success')]) }).out.result, 'pending');
  const seq = path.join(p.temp, 'seq');
  fakeExecutable(path.join(bin, 'gh'), `const fs = require('fs'); const f = ${JSON.stringify(seq)};
const a = process.argv.slice(2).join(' ');
if (a.includes('/pulls/7')) { console.log(JSON.stringify({ state: 'open', merged: false, head: { sha: 'f'.repeat(40) } })); process.exit(0); }
const n = (fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0) + 1; fs.writeFileSync(f, String(n));
const unit = { name: 'unit', status: 'completed', conclusion: 'success', started_at: '2026-10-14T00:00:00Z' };
const gate = n === 1 ? { name: 'wf ci', status: 'completed', conclusion: 'success', started_at: '2026-10-14T00:00:00Z' }
  : n === 2 ? { name: 'wf ci', status: 'queued', conclusion: null, started_at: '2026-10-14T00:05:00Z' }
  : { name: 'wf ci', status: 'completed', conclusion: 'failure', started_at: '2026-10-14T00:05:00Z' };
console.log(JSON.stringify({ check_runs: [unit, gate] }));`);
  const rerun = p.run(['wait', '--pr', '7'], { env: env([]) });
  assert.equal(rerun.out.result, 'failed', 'the old passing run of wf ci answered only once before the new run appeared');
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

// MAINT-0023 P10: with approval.auto_merge, `wf doctor` reads the trusted branch's rules and warns about one the agent's account
// cannot satisfy. A warning never fails the exit code, and the bypass lists the account cannot see are not used.
function rulesProject(t, { autoMerge = true, trusted } = {}) {
  const p = project(t, { configEdit: c => ({ ...c, ...(trusted ? { trusted_branch: trusted } : {}), approval: { ...c.approval, auto_merge: autoMerge } }) });
  const bin = path.join(p.temp, 'bin'); fs.mkdirSync(bin);
  const log = path.join(p.temp, 'gh.log');
  fakeExecutable(path.join(bin, 'gh'), `const fs = require('fs');
const a = process.argv.slice(2).join(' ');
fs.appendFileSync(${JSON.stringify(log)}, a + '\\n');
if (a === '--version') console.log('gh version 2.40.0 (2023-12-01)');
else if (a.startsWith('api user')) console.log('agent');
else if (/^api repos\\/fixture\\/project\\/rules\\/branches\\//.test(a)) {
  if (process.env.FAKE_GH_RULES === 'fail') { console.error('gh: HTTP 403'); process.exit(1); }
  console.log(process.env.FAKE_GH_RULES ?? '[]');
}
else if (/^api repos\\/fixture\\/project\\/branches\\/.+\\/protection$/.test(a)) {
  if (process.env.FAKE_GH_PROTECTION === '404') { console.error('gh: Branch not protected (HTTP 404)'); process.exit(1); }
  if (process.env.FAKE_GH_PROTECTION === 'fail') { console.error('gh: HTTP 403'); process.exit(1); }
  console.log(process.env.FAKE_GH_PROTECTION ?? '{}');
}
else if (a.startsWith('api')) console.log(JSON.stringify({ full_name: 'fixture/project', permissions: { push: true } }));
else process.exit(1);`);
  const doctor = (rules, protection) => p.run(['doctor'], { env: { PATH: `${bin}:/usr/bin:/bin`, ...(rules === undefined ? {} : { FAKE_GH_RULES: typeof rules === 'string' ? rules : JSON.stringify(rules) }), ...(protection === undefined ? {} : { FAKE_GH_PROTECTION: typeof protection === 'string' ? protection : JSON.stringify(protection) }) }, cwd: p.repo });
  const asked = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '').split('\n').filter(l => l.includes('/rules/branches/'));
  const askedProtection = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '').split('\n').filter(l => l.includes('/protection'));
  return { doctor, asked, askedProtection };
}

test('MAINT-0023 P10: wf doctor warns, without failing, when a rule needs a review the agent cannot give or a merge queue', t => {
  const { doctor, asked } = rulesProject(t);
  const r = doctor([
    { type: 'deletion' },
    { type: 'pull_request', parameters: { required_approving_review_count: 1, require_code_owner_review: true, require_last_push_approval: true } },
    { type: 'merge_queue', parameters: {} },
  ]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.out.ok, true);
  assert.deepEqual(r.out.gaps, []);
  assert.deepEqual(asked(), ['api repos/fixture/project/rules/branches/main']);
  const warned = r.out.warnings.map(w => w.name);
  assert.deepEqual(warned.sort(), ['a merge queue on main', 'approval of the most recent push on main', 'code-owner review on main', 'required approving reviews on main']);
  assert.match(r.out.warnings.find(w => w.name === 'required approving reviews on main').detail, /1 approving review\(s\).*the agent's account cannot approve its own pull request/);
  assert.match(r.out.warnings.find(w => w.name === 'a merge queue on main').detail, /cannot use/);
  assert.match(r.out.next, /warning/i);
});

test('MAINT-0023 P10: no warning for rules the agent can satisfy, none without auto_merge, and an unreadable rule list is a warning', t => {
  const ok = rulesProject(t);
  const clean = ok.doctor([{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'pull_request', parameters: { required_approving_review_count: 0, require_code_owner_review: false, require_last_push_approval: false } }, { type: 'required_status_checks', parameters: {} }]);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.deepEqual(clean.out.warnings, []);
  const off = rulesProject(t, { autoMerge: false });
  const none = off.doctor([{ type: 'merge_queue' }]);
  assert.equal(none.status, 0, none.stdout + none.stderr);
  assert.deepEqual(none.out.warnings, []);
  assert.deepEqual(off.asked(), [], 'without auto_merge the rules are not read');
  const bad = rulesProject(t, { trusted: 'release' });
  const failed = bad.doctor('fail');
  assert.equal(failed.status, 0, failed.stdout + failed.stderr);
  assert.deepEqual(bad.asked(), ['api repos/fixture/project/rules/branches/release']);
  assert.match(failed.out.warnings[0].detail, /could not read the rules on release/);
  assert.equal(failed.out.ok, true);
});

// Review N8: classic branch protection is not in the ruleset rules, so with no rules the protection is read as well; a branch name
// with a slash is asked for as it is.
test('MAINT-0023 P10: with no ruleset rules wf doctor reads classic branch protection, and a branch with a slash is not encoded', t => {
  const protection = { required_pull_request_reviews: { required_approving_review_count: 2, require_code_owner_reviews: true, require_last_push_approval: true } };
  const classic = rulesProject(t, { trusted: 'release/x' });
  const r = classic.doctor([], protection);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(classic.asked(), ['api repos/fixture/project/rules/branches/release/x']);
  assert.deepEqual(classic.askedProtection(), ['api repos/fixture/project/branches/release/x/protection']);
  assert.deepEqual(r.out.warnings.map(w => w.name).sort(), ['approval of the most recent push on release/x', 'code-owner review on release/x', 'required approving reviews on release/x']);
  assert.match(r.out.warnings.find(w => w.name === 'required approving reviews on release/x').detail, /2 approving review\(s\)/);
  assert.equal(r.out.ok, true);
  // No rules and no protection (404), or protection without reviews: nothing to warn about. Rules that came back are not supplemented.
  const none = rulesProject(t);
  assert.deepEqual(none.doctor([], '404').out.warnings, []);
  const lax = rulesProject(t);
  assert.deepEqual(lax.doctor([], { required_status_checks: {} }).out.warnings, []);
  const ruled = rulesProject(t);
  assert.deepEqual(ruled.doctor([{ type: 'deletion' }], protection).out.warnings, []);
  assert.deepEqual(ruled.askedProtection(), []);
  // A protection that cannot be read is said, as an unreadable rule list is.
  const bad = rulesProject(t);
  assert.match(bad.doctor([], 'fail').out.warnings[0].detail, /classic branch protection could not be read/);
});
