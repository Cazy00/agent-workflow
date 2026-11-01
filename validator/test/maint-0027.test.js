import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitSource } from '../lib/index.js';
import { acceptanceEvidenceErrors, owedFoundTasks } from '../lib/acceptance-evidence.js';
import { evidenceErrors } from '../lib/delivery-evidence.js';
import { runPrecheck, precheckCommands } from '../lib/precheck.js';
import { cli, evidence, project, taskPath, check } from './helpers/maint-0018.js';

// MAINT-0027: a fast lane per task, a full lane per milestone, the owner's merge only at the plan and the acceptance.
const milestonePath = 'docs/workflow/milestones/M-0001.md';
const governing = c => ({ ...c, paths: { ...c.paths, governing: [...c.paths.governing, 'docs/workflow/milestones/**'] } });
const deferring = c => governing({ ...c, acceptance_evidence: true, approval: { ...c.approval, defer_to_acceptance: true } });
const plan = (...ids) => q => q.edit(milestonePath, x => x.replace('status: Authorised\n', `status: Authorised\ntasks: [${ids.join(', ')}]\n`));
const taskLike = (p, id, scope, edit = x => x) => p.write(`docs/workflow/tasks/${id}.md`, edit(fs.readFileSync(path.join(p.repo, taskPath), 'utf8').replaceAll('T-0001', id).replace(/^scope: .*$/m, `scope: [${scope}]`)));

// ---- lanes ----
const lane = (p, base, head) => p.run(['lane', '--baseline', base, '--candidate', head]).out.lane;
const pathsLane = (p, base, head) => p.run(['paths', '--baseline', base, '--candidate', head]).out.lane;

test('MAINT-0027: a code change is the fast lane, a records change the records lane, and wf lane prints the word', t => {
  const p = project(t, { configEdit: deferring });
  p.write('src/a.js', 'export const a = 1;\n');
  const code = p.commit('code');
  assert.equal(lane(p, p.baseline, code), 'fast');
  assert.equal(pathsLane(p, p.baseline, code), 'fast');
  const bare = spawnSync(process.execPath, [cli, 'lane', '--baseline', p.baseline, '--candidate', code, '--repo', p.repo], { encoding: 'utf8' });
  assert.deepEqual([bare.status, bare.stdout], [0, 'fast\n']);
  p.write('docs/notes.md', 'a note\n');
  const notes = p.commit('a note');
  assert.equal(lane(p, code, notes), 'records');
  assert.equal(pathsLane(p, code, notes), 'records');
  const r = p.run(['ci', '--baseline', code, '--candidate', notes]);
  assert.equal(r.out.lane, 'records');
});

test('MAINT-0027: a change that closes a milestone is the full lane, even when it is records only', t => {
  for (const status of ['Verified', 'Accepted', 'Released']) {
    const p = project(t, { configEdit: deferring });
    p.edit(milestonePath, x => x.replace('status: Authorised', `status: ${status}`));
    const head = p.commit(`M-0001 ${status}`);
    assert.equal(lane(p, p.baseline, head), 'full', status);
    assert.equal(pathsLane(p, p.baseline, head), 'full', status);
  }
  // Authorised to Active is not a close.
  const q = project(t, { configEdit: deferring });
  q.edit(milestonePath, x => x.replace('status: Authorised', 'status: Active'));
  assert.equal(lane(q, q.baseline, q.commit('Active')), 'records');
  // Already Verified on both sides: no move.
  const v = project(t, { configEdit: deferring, baselineEdit: s => s.edit(milestonePath, x => x.replace('status: Authorised', 'status: Verified')) });
  v.edit(milestonePath, x => x.replace('status: Verified', 'status: Accepted'));
  assert.equal(lane(v, v.baseline, v.commit('Accepted after Verified')), 'records');
});

test('MAINT-0027: an enforcement path or the config\'s checks make the full lane', t => {
  const p = project(t, { configEdit: deferring });
  p.write('.github/workflows/ci.yml', 'name: ci\n');
  assert.equal(lane(p, p.baseline, p.commit('a workflow')), 'full');
  const q = project(t, { configEdit: c => ({ ...deferring(c), paths: { ...deferring(c).paths, enforcement: [] } }) });
  q.edit('docs/workflow/config.json', x => JSON.stringify({ ...JSON.parse(x), checks: { fast: ['npm test'] } }));
  assert.equal(lane(q, q.baseline, q.commit('checks')), 'full');
  // A config change that leaves checks alone, with config.json no enforcement path, is not full.
  const r = project(t, { configEdit: c => ({ ...deferring(c), paths: { ...deferring(c).paths, enforcement: [] } }) });
  r.edit('docs/workflow/config.json', x => JSON.stringify({ ...JSON.parse(x), review: { deep_paths: ['src/x/**'] } }));
  assert.notEqual(lane(r, r.baseline, r.commit('review paths')), 'full');
});

// ---- wf precheck ----
test('MAINT-0027: wf precheck runs checks.fast in the repository root, prints each command with its seconds and stops at the first failure', t => {
  const p = project(t, { configEdit: c => ({ ...c, checks: { fast: ['echo first > first.txt', 'sh -c "exit 7"', 'echo never > never.txt'], full: ['echo slow > slow.txt'] } }) });
  const sub = path.join(p.repo, 'src');
  fs.mkdirSync(sub, { recursive: true });
  const r = p.run(['precheck'], { cwd: sub });
  assert.equal(r.status, 7, r.stdout + r.stderr);
  assert.match(r.stdout, /checks\.fast 1\/3\): echo first > first\.txt/);
  assert.match(r.stdout, /ok, \d+\.\d s/);
  assert.match(r.stdout, /FAILED after \d+\.\d s with exit code 7: sh -c "exit 7"/);
  assert.ok(fs.existsSync(path.join(p.repo, 'first.txt')), 'ran in the repository root, not in the subfolder');
  assert.ok(!fs.existsSync(path.join(p.repo, 'never.txt')), 'stopped at the first failure');
  const full = p.run(['precheck', '--full']);
  assert.equal(full.status, 0, full.stdout + full.stderr);
  assert.ok(fs.existsSync(path.join(p.repo, 'slow.txt')));
  assert.match(full.stdout, /checks\.full passed \(1 command\)/);
});

test('MAINT-0027: wf precheck without the key says what to add and exits 2; --full is only for precheck', t => {
  const p = project(t, { configEdit: c => ({ ...c, checks: { full: ['true'] } }) });
  const fast = p.run(['precheck']);
  assert.equal(fast.status, 2);
  assert.match(fast.stderr, /no checks\.fast.*"checks": \{ "fast": \["npm run lint", "npm test"\] \}/);
  assert.equal(p.run(['precheck', '--full']).status, 0);
  assert.equal(p.run(['paths', '--baseline', p.baseline, '--full']).status, 2);
  const none = project(t);
  assert.equal(none.run(['precheck', '--full']).status, 2);
  assert.throws(() => precheckCommands({ checks: { fast: [] } }), /checks\.fast .* is empty/);
});

test('MAINT-0027: runPrecheck takes its spawn and clock, and a signal counts as a failure', () => {
  const lines = [];
  let now = 0;
  const calls = [];
  const spawn = (cmd, args, opts) => { calls.push([cmd, args, opts.cwd]); now += 1500; return { status: args[1] === 'b' ? null : 0 }; };
  const r = runPrecheck({ config: { checks: { fast: ['a', 'b', 'c'] } }, root: '/repo', write: s => lines.push(s), spawn, clock: () => now });
  assert.deepEqual([r.ok, r.code, r.ran], [false, 1, 2]);
  assert.deepEqual(calls, [['sh', ['-c', 'a'], '/repo'], ['sh', ['-c', 'b'], '/repo']]);
  assert.ok(lines.some(l => /ok, 1\.5 s/.test(l)), lines.join(''));
});

test('MAINT-0027: checks must be lists of shell command strings under fast and full', t => {
  for (const checks of [{ fast: 'npm test' }, { fast: [''] }, { fast: [1] }, { slow: [] }, []]) {
    const p = project(t, { configEdit: c => ({ ...c, checks }) });
    const r = p.run(['records', '--baseline', p.baseline]);
    assert.equal(r.status, 2, JSON.stringify(checks));
    assert.match(r.stderr, /checks/);
  }
});

test('MAINT-0027: wf doctor warns, never fails, when checks.fast is missing', t => {
  const without = project(t);
  const a = without.run(['doctor'], { env: { PATH: process.env.PATH } }).out;
  assert.ok(a.warnings.some(w => w.name === 'checks.fast' && /wf precheck/.test(w.detail)), JSON.stringify(a.warnings));
  assert.ok(!a.gaps.includes('checks.fast'));
  const withFast = project(t, { configEdit: c => ({ ...c, checks: { fast: ['true'] } }) });
  assert.ok(!withFast.run(['doctor']).out.warnings.some(w => w.name === 'checks.fast'));
});

// ---- the found task beyond its allowance, or without found_from ----
// A project whose M-0001 plans T-0001 only, with T-0002 waiting as a found Draft.
function found(t, { configEdit = deferring, task = x => x } = {}) {
  const p = project(t, { configEdit, baselineEdit: plan('T-0001') });
  taskLike(p, 'T-0002', 'src/b', x => task(x.replace('status: Ready', 'status: Draft')));
  return { ...p, base: p.commit('records: T-0002, a found Draft') };
}
const work = (p, dir = 'src/b') => {
  p.edit('docs/workflow/tasks/T-0002.md', x => x.replace('status: Draft', 'status: Active'));
  p.write(`${dir}/index.js`, 'export const b = 1;\n');
  return p.commit('T-0002: the work');
};
const ci = (p, head, extra = e => e) => {
  const e = evidence(head); e.tasks = ['T-0002']; e.review.tasks = ['T-0002'];
  return p.run(['ci', '--baseline', p.base, '--candidate', head, '--task', 'T-0002'], { evidence: extra(e) });
};
const withFrom = x => x.replace('status: Draft', 'status: Draft\nfound_from: R-0001/F1');
const noFrom = 'found task T-0002 of M-0001 without found_from, for the owner at the acceptance';
const beyond = 'found task T-0002 of M-0001 beyond its found_tasks allowance, for the owner at the acceptance';

test('MAINT-0027: a found task without found_from passes as the agent\'s merge, listed as deferred', t => {
  const p = found(t);
  const r = ci(p, work(p));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.out.merge, 'agent', JSON.stringify(r.out.owner_reasons));
  assert.deepEqual(r.out.deferred, [noFrom]);
  assert.ok(r.out.findings.some(f => /readiness T-0002: Ready/.test(f)));
});

test('MAINT-0027: a found task beyond its found_tasks allowance passes as the agent\'s merge, listed as deferred', t => {
  const p = found(t, { task: withFrom });
  const r = ci(p, work(p));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.out.merge, 'agent', JSON.stringify(r.out.owner_reasons));
  assert.deepEqual(r.out.deferred, [beyond]);
  // Within the allowance it is an ordinary found task: nothing deferred.
  const q = project(t, { configEdit: deferring, baselineEdit: s => { plan('T-0001')(s); s.edit(milestonePath, x => x.replace('tasks: [T-0001]', 'tasks: [T-0001]\nfound_tasks: 1')); } });
  taskLike(q, 'T-0002', 'src/b', x => withFrom(x.replace('status: Ready', 'status: Draft')));
  q.base = q.commit('records');
  const ok = ci(q, work(q));
  assert.equal(ok.out.merge, 'agent');
  assert.equal(ok.out.deferred, undefined);
});

test('MAINT-0027: a found task outside the milestone\'s scope or acceptance still fails', t => {
  const p = found(t, { task: x => x.replace('scope: [src/b]', 'scope: [ops]') });
  const r = ci(p, work(p, 'ops'));
  assert.equal(r.status, 1, r.stdout);
  assert.ok(r.out.readiness.reasons.some(x => /task scope ops is outside milestone authority/.test(x)), JSON.stringify(r.out.readiness.reasons));
  assert.equal(r.out.merge, undefined);
  const q = found(t, { task: x => x.replace(/^acceptance: .*$/m, 'acceptance: [AC-009-9]') });
  const s = ci(q, work(q));
  assert.equal(s.status, 1, s.stdout);
  assert.ok(s.out.readiness.reasons.some(x => /acceptance AC-009-9 is outside milestone authority/.test(x)), JSON.stringify(s.out.readiness.reasons));
});

test('MAINT-0027: without defer_to_acceptance, or without acceptance_evidence, the found-task failures are unchanged', t => {
  const withoutEvidence = c => { const { acceptance_evidence, ...rest } = deferring(c); return rest; };
  for (const configEdit of [governing, withoutEvidence, c => ({ ...c, approval: { ...c.approval, defer_to_acceptance: true } })]) {
    const none = found(t, { configEdit });
    const a = ci(none, work(none));
    assert.equal(a.status, 1, a.stdout);
    assert.ok(a.out.readiness.reasons.some(x => /T-0002 is a found task of M-0001 \(its tasks: list does not name it\) without found_from: name the review finding \(R-NNNN\/F1\) or trial it fixes, or ask the owner, who adds it to M-0001's tasks: or moves the work to a later milestone/.test(x)), JSON.stringify(a.out.readiness.reasons));
    assert.equal(a.out.readiness.deferred, undefined);
    const over = found(t, { configEdit, task: withFrom });
    const b = ci(over, work(over));
    assert.equal(b.status, 1, b.stdout);
    assert.ok(b.out.readiness.reasons.some(x => /T-0002 would be found task 1 of M-0001, beyond its found_tasks allowance of 0: ask the owner/.test(x)), JSON.stringify(b.out.readiness.reasons));
    const out = found(t, { configEdit, task: x => x.replace('scope: [src/b]', 'scope: [ops]') });
    const c = ci(out, work(out, 'ops'));
    assert.equal(c.status, 1, c.stdout);
    assert.ok(c.out.readiness.reasons.some(x => /task scope ops is outside milestone authority/.test(x)));
    for (const r of [a, b, c]) assert.equal(r.out.deferred, undefined);
  }
});

// What stays the owner's under both keys.
test('MAINT-0027: an uncarried blocking finding still gives the merge to the owner, found task or not', t => {
  const p = found(t);
  const r = ci(p, work(p), e => { e.review.findings = [{ id: 'F1', severity: 'blocking', status: 'accepted', resolution: 'for the owner', exposure: 'another shop\'s customers can be read' }]; return e; });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.out.merge, 'owner');
  assert.match(r.out.owner_reasons.join(' | '), /blocking review findings accepted rather than fixed: F1 \(not carried: not in the task record's accepted_findings\)/);
  assert.ok(r.out.deferred.includes(noFrom), JSON.stringify(r.out.deferred));
});

// The milestone's authorisation (Draft to Authorised), its acceptance and new acceptance definitions are the owner's two answers; the
// agent never merges them, with both keys chosen. The same holds with the milestone records not classified as governing.
const ownerOnly = (r, pattern) => {
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.out.merge, 'owner', r.stdout);
  assert.match(r.out.owner_reasons.join(' | '), pattern);
};

test('MAINT-0027: an approved plan (a milestone Draft to Authorised) is the owner\'s merge', t => {
  for (const configEdit of [deferring, c => ({ ...c, acceptance_evidence: true, approval: { ...c.approval, defer_to_acceptance: true } })]) {
    const p = project(t, { configEdit, baselineEdit: s => s.edit(milestonePath, x => x.replace('status: Authorised', 'status: Draft')) });
    p.edit(milestonePath, x => x.replace('status: Draft', 'status: Authorised\nworkflow_version: v2.6.0\ntasks: [T-0001]'));
    ownerOnly(p.run(['ci', '--baseline', p.baseline, '--candidate', p.commit('M-0001 authorised')]), /docs\/workflow\/milestones\/M-0001\.md/);
  }
});

const acceptanceEvidence = rev => ({
  schema: 'agent-workflow/acceptance-evidence@1', milestone: 'M-0001', candidate: rev,
  review: { reviewer: 'independent-reviewer', model: 'a-model', revision: rev, report: 'https://github.com/fixture/project/pull/9#issuecomment-1' },
  walkthrough: { not_applicable: 'the project has no user interface: it is a command-line tool' },
  deferred: [], tests_changed: [],
});

test('MAINT-0027: an accepted milestone is the owner\'s merge (Accepted, and Released under review.cadence milestone)', t => {
  for (const configEdit of [deferring, c => ({ ...c, acceptance_evidence: true, approval: { ...c.approval, defer_to_acceptance: true } })]) {
    const p = project(t, { configEdit, baselineEdit: plan('T-0001') });
    p.edit(milestonePath, x => x.replace('status: Authorised', 'status: Accepted'));
    const r = p.run(['ci', '--baseline', p.baseline, '--candidate', p.commit('Accept M-0001')], { evidence: acceptanceEvidence(p.baseline) });
    ownerOnly(r, /docs\/workflow\/milestones\/M-0001\.md/);
    assert.equal(r.out.lane, 'full');
  }
});

test('MAINT-0027: new acceptance definitions are the owner\'s merge', t => {
  for (const configEdit of [deferring, c => ({ ...c, acceptance_evidence: true, approval: { ...c.approval, defer_to_acceptance: true } })]) {
    const p = project(t, { configEdit });
    p.edit('docs/workflow/acceptance.json', x => { const j = JSON.parse(x); j.examples.push({ id: 'AC-001-2', requirement: 'docs/specs/feature.md', method: 'inspection' }); return JSON.stringify(j, null, 2); });
    ownerOnly(p.run(['ci', '--baseline', p.baseline, '--candidate', p.commit('a new scenario')]), /docs\/workflow\/acceptance\.json/);
  }
});

test('MAINT-0027: an enforcement path, the checkpoint and the milestone hold stay the owner\'s', t => {
  const p = found(t);
  p.write('.github/workflows/ci.yml', 'name: ci\n');
  const e = ci(p, work(p));
  assert.equal(e.out.merge, 'owner');
  assert.match(e.out.owner_reasons.join(' | '), /it changes the workflow: \.github\/workflows\/ci\.yml/);
  assert.equal(e.out.lane, 'full');
  assert.ok(e.out.deferred.includes(noFrom));
  // The checkpoint `change` (which cannot defer) is the owner's merge for every pull request.
  const every = project(t, { configEdit: c => governing({ ...c, approval: { ...c.approval, checkpoint: 'change' } }) });
  every.write('docs/notes.md', 'a note\n');
  const r = every.run(['ci', '--baseline', every.baseline, '--candidate', every.commit('code')]);
  assert.equal(r.out?.merge, 'owner', r.stdout + r.stderr);
});

test('MAINT-0027: removing or changing a Done record of a milestone not yet accepted stays the owner\'s', t => {
  const p = found(t, { task: x => x });
  p.edit('docs/workflow/tasks/T-0002.md', x => x.replace('status: Draft', 'status: Done'));
  const done = p.commit('T-0002 Done');
  p.base = done;
  p.edit('docs/workflow/tasks/T-0002.md', x => x + '\nA changed line.\n');
  const r = p.run(['ci', '--baseline', done, '--candidate', p.commit('a Done record changes')]);
  ownerOnly(r, /it changes Done task records of a milestone not yet accepted, which its acceptance reads: T-0002/);
});

// ---- the acceptance lists the deferred found tasks ----
const records = (t, ms, tasks) => ({ milestones: new Map([['M-0001', { data: ms }]]), tasks: new Map(tasks.map(d => [d.id, { data: d }])) });
const cfg = { acceptance_evidence: true, approval: { label: 'owner-merge', mechanism: 'owner-merge', checkpoint: 'milestone', defer_to_acceptance: true } };
const task = (id, extra = {}) => ({ id, milestone: 'M-0001', status: 'Done', ...extra });

test('MAINT-0027: the acceptance evidence lists found tasks passed without found_from or beyond the allowance', t => {
  const r = records(t, { id: 'M-0001', tasks: ['T-0001'], found_tasks: 1 }, [task('T-0001'), task('T-0002'), task('T-0003', { found_from: 'R-0001/F1' })]);
  assert.deepEqual(owedFoundTasks({ config: cfg, records: r, milestone: 'M-0001' }), ['T-0002']);
  // Beyond the allowance, the order they began in is not kept, so every found task is listed.
  const over = records(t, { id: 'M-0001', tasks: ['T-0001'], found_tasks: 1 }, [task('T-0002', { found_from: 'R-0001/F1' }), task('T-0003', { found_from: 'R-0001/F2' })]);
  assert.deepEqual(owedFoundTasks({ config: cfg, records: over, milestone: 'M-0001' }), ['T-0002', 'T-0003']);
  // Not found tasks: planned, a Draft never begun, another milestone's, and a project without the keys.
  const none = records(t, { id: 'M-0001', tasks: ['T-0001', 'T-0002'], found_tasks: 1 }, [task('T-0002'), task('T-0004', { status: 'Draft' }), task('T-0005', { milestone: 'M-0002' })]);
  assert.deepEqual(owedFoundTasks({ config: cfg, records: none, milestone: 'M-0001' }), []);
  assert.deepEqual(owedFoundTasks({ config: { ...cfg, approval: { ...cfg.approval, defer_to_acceptance: false } }, records: r, milestone: 'M-0001' }), []);
  assert.deepEqual(owedFoundTasks({ config: { approval: cfg.approval }, records: r, milestone: 'M-0001' }), []);
});

test('MAINT-0027: acceptanceEvidenceErrors fails until deferred names the found task, and passes once it does', t => {
  const p = project(t, { configEdit: deferring });
  taskLike(p, 'T-0002', 'src/b', x => x.replace('status: Ready', 'status: Done'));
  const base = p.commit('a Done found task, never added to tasks:');
  p.edit(milestonePath, x => x.replace('status: Authorised', 'status: Accepted'));
  const head = p.commit('Accept M-0001');
  const load = rev => gitSource(p.repo, rev);
  const run = deferred => acceptanceEvidenceErrors({ evidence: { ...acceptanceEvidence(base), deferred }, milestone: 'M-0001', config: { ...JSON.parse(fs.readFileSync(path.join(p.repo, 'docs/workflow/config.json'), 'utf8')) }, candidate: load(head), baseline: load(base), records: [{ milestones: new Map([['M-0001', { data: { id: 'M-0001', tasks: [] } }]]), tasks: new Map([['T-0002', { data: task('T-0002') }]]) }] });
  const missing = run([]).filter(e => /found tasks of M-0001/.test(e));
  assert.equal(missing.length, 1);
  assert.match(missing[0], /merged without found_from or beyond its found_tasks allowance, which the owner approves here: T-0002$/);
  assert.deepEqual(run(['T-0002: the fix for the date bug']).filter(e => /found tasks of M-0001/.test(e)), []);
});

// ---- a required check reported skipped ----
const skipped = e => { e.integration.checks = [{ ...check('unit'), result: 'skipped' }]; return e; };
const base = { revision: 'a'.repeat(40), taskIds: ['T-0001'], owner: null, requiredChecks: ['unit'] };

test('MAINT-0027: a required check reported skipped counts only when the recomputed lane is fast', t => {
  const fast = project(t, { configEdit: deferring });
  fast.write('src/a.js', 'export const a = 1;\n');
  const head = fast.commit('T-0001: the work');
  const ok = fast.run(['ci', '--baseline', fast.baseline, '--candidate', head, '--task', 'T-0001'], { evidence: skipped(evidence(head)) });
  assert.equal(ok.out.lane, 'fast');
  assert.ok(!ok.out.findings.some(f => /skipped|required check unit did not pass/.test(f)), ok.out.findings.join(' | '));
  assert.equal(ok.status, 0, ok.stdout);

  // The same evidence on a candidate that also closes a milestone: the lane is full, and the evidence's own word cannot change it.
  const full = project(t, { configEdit: deferring });
  full.write('src/a.js', 'export const a = 1;\n');
  full.edit(milestonePath, x => x.replace('status: Authorised', 'status: Verified'));
  const fullHead = full.commit('T-0001: the work, and M-0001 Verified');
  const e = skipped(evidence(fullHead)); e.lane = 'fast';
  const bad = full.run(['ci', '--baseline', full.baseline, '--candidate', fullHead, '--task', 'T-0001'], { evidence: e });
  assert.equal(bad.out.lane, 'full');
  assert.equal(bad.status, 1, bad.stdout);
  assert.ok(bad.out.findings.some(f => /delivery evidence: integration check "unit" is "skipped", which counts only on the fast lane/.test(f)), bad.out.findings.join(' | '));
  assert.ok(bad.out.findings.some(f => /delivery evidence has an unknown field lane/.test(f)));
});

test('MAINT-0027: evidenceErrors counts skipped only for a required check, and only when told the lane is fast', () => {
  const e = candidate => { const x = evidence(candidate); x.tasks = ['T-0001']; return skipped(x); };
  const args = { ...base, evidence: e('a'.repeat(40)) };
  assert.ok(evidenceErrors(args).some(m => /is "skipped"/.test(m)));
  assert.ok(!evidenceErrors({ ...args, skippedChecks: true }).some(m => /skipped|required check unit did not pass/.test(m)));
  // A skipped check the profile does not require never counts.
  const other = e('a'.repeat(40)); other.integration.checks = [{ ...check('unit'), result: 'passed' }, { ...check('e2e'), result: 'skipped' }];
  assert.ok(evidenceErrors({ ...base, evidence: other, skippedChecks: true }).some(m => /check "e2e" did not pass/.test(m)));
});

// ---- the template ----
test('MAINT-0027: wf-ci.yml names a draft run apart and the project template runs its slow job on the full lane only', () => {
  const ci = fs.readFileSync(new URL('../../templates/github/wf-ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /types: \[opened, synchronize, reopened, edited, ready_for_review, converted_to_draft, auto_merge_enabled, auto_merge_disabled\]/);
  assert.match(ci, /name: \$\{\{ github\.event\.pull_request\.draft && 'wf ci \(draft\)' \|\| 'wf ci' \}\}/);
  assert.match(ci, /WF_DRAFT: \$\{\{ github\.event\.pull_request\.draft && 'true' \|\| 'false' \}\}/);
  assert.match(ci, /\[ "\$WF_DRAFT" = true \] && exit 0\n\s+exit "\$code"/);
  assert.match(ci, /a green draft run must never be the required `wf ci`/);
  assert.match(ci, /relies on its merge route to require `wf ci` by name/);
  const project = fs.readFileSync(new URL('../../templates/github/project-ci.yml', import.meta.url), 'utf8');
  assert.match(project, /lane: \$\{\{ steps\.decide\.outputs\.lane \}\}/);
  assert.match(project, /if: needs\.scope\.outputs\.product == 'true' && needs\.scope\.outputs\.lane == 'full'/);
  assert.match(project, /needs: \[scope, lint, unit, database, acceptance\]/);
  assert.doesNotMatch(project, /schedule:|cron:/);
  assert.equal(fs.readFileSync(new URL('../../CODEOWNERS', import.meta.url), 'utf8').split('\n').filter(l => l && !l.startsWith('#')).length, 0, 'CODEOWNERS requests no default owner');
});
