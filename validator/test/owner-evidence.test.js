// MAINT-0005: owner-approved acceptance tests (paths.acceptance_tests), evidence the owner's machine produces
// (`wf attest`) and the agent's next action worked out by code (`wf next`).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTrust } from '../lib/trust.js';
import { withDerivedBaselines } from '../lib/derived.js';
import { readJunit, validateAttestConfig } from '../lib/attest.js';
import { payloadProblems } from '../lib/payloads.js';
import { renderBrief } from '../lib/brief.js';
import { classifyPaths } from '../lib/paths.js';
import { dirSource, gitSource } from '../lib/sources.js';
import { loadConfig, validateRecords } from '../lib/records.js';
import { evaluateNext } from '../lib/next.js';

const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const taskPath = 'docs/workflow/tasks/T-0001.md';
const repository = 'fixture/project';
const REVIEW = ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'];
const OWNER_TESTS = ['tests/acceptance-map.json', 'tests/acceptance/**'];

// main holds the approved baseline B, with owner-approved acceptance tests configured. On the task branch, A writes the
// acceptance test (the owner can approve it there, before implementation), C implements against it, D marks it Done.
function project(t, { attest = null, acceptanceTests = OWNER_TESTS } = {}) {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wf-owner-evidence-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'project'); fs.cpSync(fixture, repo, { recursive: true });
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true }); fs.writeFileSync(path.join(repo, p), text); };
  const edit = (p, fn) => write(p, fn(fs.readFileSync(path.join(repo, p), 'utf8')));
  const git = (...args) => { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const commit = message => { git('add', '-A'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Test Worker'); git('config', 'user.email', 'worker@example.invalid');
  edit('docs/workflow/config.json', text => {
    const c = JSON.parse(text);
    c.repository = repository; c.approval.derived_baselines = true; c.approval.label = 'manual';
    c.paths.production.push('tests/**');
    if (acceptanceTests) c.paths.acceptance_tests = acceptanceTests;
    if (attest) c.attest = attest;
    return JSON.stringify(c, null, 2);
  });
  edit('docs/workflow/profile.md', x => x.replace('approval_label: enforced', 'approval_label: manual'));
  for (const record of [taskPath, 'docs/workflow/milestones/M-0001.md']) edit(record, x => x.replace('scope: [src, docs/workflow/tasks]', 'scope: [src, tests, docs/workflow/tasks]'));
  edit('docs/workflow/acceptance.json', x => x.replace('inspection', 'automated'));
  write('tests/acceptance-map.json', JSON.stringify([{ acceptance: 'AC-001-1', file: 'tests/acceptance/feature.test.mjs', name: 'required scenario' }]));
  write('tests/acceptance/feature.test.mjs', "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { result } from '../../src/a.mjs';\ntest('required scenario', () => assert.equal(result, 1));\n");
  write('src/a.mjs', 'export const result = 0;\n');
  const initial = commit('initial');
  edit(taskPath, x => x.replaceAll('fixture-rev', initial));
  const B = commit('authorised baseline');
  git('checkout', '-q', '-b', 'T-0001-work');
  edit(taskPath, x => x.replace(`governing_baseline_revision: ${initial}`, `governing_baseline_revision: ${B}`).replace(/^baseline_revision:.*$/m, `baseline_revision: ${B}`));
  edit('tests/acceptance/feature.test.mjs', x => `${x}// the owner's acceptance test for this milestone\n`);
  const A = commit('T-0001: acceptance test (red)');
  write('src/a.mjs', 'export const result = 1;\n');
  const C = commit('T-0001: candidate');
  edit(taskPath, x => x.replace('status: Ready', 'status: Done').replace(/^implemented:.*$/m, `implemented: ${C}`));
  const D = commit('T-0001: record done');
  const keys = generateKeyPairSync('ed25519');
  const key = path.join(temp, 'owner.pem'); fs.writeFileSync(key, keys.publicKey.export({ type: 'spki', format: 'pem' }));
  const check = { environment: 'isolated', checks: [{ name: 'unit', result: 'passed', evidence: 'evidence/log.txt' }] };
  const evidence = rev => [
    { purpose: 'verification', revision: rev, ...check, execution: { revision: rev, tests: [{ file: 'tests/acceptance/feature.test.mjs', name: 'required scenario', status: 'passed' }] } },
    { purpose: 'integration', revision: rev, ...check },
    { purpose: 'review', revision: rev, reviewer: 'independent', implementer: 'agent', separate_context: 'fresh', evidence: 'evidence/log.txt', coverage: REVIEW, findings: [] },
  ];
  const payload = c => ({ ...c, repository, expires_at: '2099-01-01T00:00:00Z' });
  const signed = claims => claims.map(c => { const p = payload(c); return { payload: p, signature: sign(null, Buffer.from(JSON.stringify(p)), keys.privateKey).toString('base64') }; });
  const file = (name, value) => { const f = path.join(temp, name); fs.writeFileSync(f, JSON.stringify(value)); return f; };
  const run = (args, { claims = [], draft = null, env = {} } = {}) => {
    const receipts = file('receipts.json', signed(claims));
    const unsigned = draft ? ['--unsigned-receipts', file('unsigned.json', draft.map(payload))] : [];
    const r = spawnSync(process.execPath, [cli, ...args, '--repo', repo, '--trust-key', key, '--receipts', receipts, '--repository', repository, ...unsigned, '--json'], { encoding: 'utf8', env: { ...process.env, ...env } });
    return { ...r, json: (() => { try { return JSON.parse(r.stdout); } catch { return null; } })() };
  };
  const trustOf = claims => withDerivedBaselines(createTrust({ publicKey: keys.publicKey, repository, envelopes: signed(claims) }), repo);
  return { temp, repo, git, edit, write, commit, initial, B, A, C, D, evidence, run, trustOf, payload, file };
}
const testChange = rev => ({ purpose: 'governing-change', revision: rev, paths: ['tests/acceptance/feature.test.mjs'] });
const ci = (p, rev = p.C) => ['ci', '--baseline', p.B, '--candidate', rev, '--task', 'T-0001'];

test('an acceptance test keeps its production gates and is flagged as the owner\'s', () => {
  const config = { paths: { production: ['tests/**'], acceptance_tests: OWNER_TESTS } };
  assert.deepEqual(classifyPaths(config, ['tests/acceptance/x.test.js', 'tests/unit/y.test.js']), [
    { path: 'tests/acceptance/x.test.js', category: 'production', producer: undefined, acceptance_test: true },
    { path: 'tests/unit/y.test.js', category: 'production', producer: undefined },
  ]);
});

test('a changed acceptance test needs the owner\'s governing-change; production evidence alone does not pass', t => {
  const p = project(t);
  const r = p.run(ci(p), { claims: [{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)] });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.json.findings.join('\n'), /acceptance tests tests\/acceptance\/feature\.test\.mjs need the owner's governing-change/);
  const ok = p.run(ci(p), { claims: [{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C), testChange(p.C)] });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

test('the owner can approve the acceptance test before implementation, at the revision that wrote it', t => {
  const p = project(t);
  const r = p.run(ci(p), { claims: [{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C), testChange(p.A)] });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // The approval does not follow the path to content the owner never saw.
  p.edit('tests/acceptance/feature.test.mjs', x => x.replace('assert.equal(result, 1)', 'assert.ok(true)'));
  const weakened = p.commit('T-0001: weaken the test');
  const w = p.run(ci(p, weakened), { claims: [{ purpose: 'baseline', revision: p.B }, ...p.evidence(weakened), testChange(p.A)] });
  assert.equal(w.status, 1, w.stdout);
  assert.match(w.json.findings.join('\n'), /need the owner's governing-change/);
});

test('an approval at a revision outside the candidate\'s history does not count', t => {
  const p = project(t);
  p.git('checkout', '-q', '-b', 'elsewhere', p.B);
  p.edit('tests/acceptance/feature.test.mjs', x => `${x}// the owner's acceptance test for this milestone\n`);
  const other = p.commit('same content on another branch');
  p.git('checkout', '-q', 'T-0001-work');
  const r = p.run(ci(p), { claims: [{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C), testChange(other)] });
  assert.equal(r.status, 1, r.stdout);
});

test('an unsigned approval of the acceptance test is a dry run: exit 3', t => {
  const p = project(t);
  const r = p.run(ci(p), { claims: [{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)], draft: [testChange(p.A)] });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.equal(r.json.authoritative, false);
  assert.ok(r.json.provisional.some(x => x.purpose === 'governing-change' && x.revision === p.A));
});

test('a derived baseline needs the acceptance test\'s governing-change as well as the evidence', t => {
  const p = project(t);
  const without = p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]).derivation(p.D);
  assert.equal(without.approved, false);
  assert.match(without.reasons.join(' '), /acceptance test tests\/acceptance\/feature\.test\.mjs is not covered/);
  const withIt = p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C), testChange(p.A)]).derivation(p.D);
  assert.equal(withIt.approved, true, JSON.stringify(withIt));
});

test('the map and every mapped test file must be owner-approved acceptance tests', t => {
  const p = project(t);
  assert.deepEqual(validateRecords(dirSource(p.repo), 'docs/workflow').errors, []);
  p.write('tests/acceptance-map.json', JSON.stringify([{ acceptance: 'AC-001-1', file: 'src/a.mjs', name: 'required scenario' }]));
  assert.match(validateRecords(dirSource(p.repo), 'docs/workflow').errors.join('\n'), /mapped test file "src\/a\.mjs" is outside paths\.acceptance_tests/);
  p.edit('docs/workflow/config.json', x => { const c = JSON.parse(x); c.paths.acceptance_tests = ['tests/acceptance/**']; return JSON.stringify(c); });
  assert.match(validateRecords(dirSource(p.repo), 'docs/workflow').errors.join('\n'), /tests\/acceptance-map\.json is not under paths\.acceptance_tests/);
  p.edit('docs/workflow/config.json', x => { const c = JSON.parse(x); c.paths.acceptance_tests = 'tests/**'; return JSON.stringify(c); });
  assert.throws(() => loadConfig(dirSource(p.repo)), /paths\.acceptance_tests must be an array of glob strings/);
  const r = spawnSync(process.execPath, [cli, 'records', '--repo', p.repo, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stdout); // the invalid config is reported, not passed
});

test('without paths.acceptance_tests nothing changes for an existing project', t => {
  const p = project(t, { acceptanceTests: null });
  const r = p.run(ci(p), { claims: [{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)] });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('the brief lists an acceptance test that no payload approves', t => {
  const p = project(t);
  const round = p.file('round.json', [...p.evidence(p.C)].map(p.payload));
  const r = spawnSync(process.execPath, [cli, 'brief', '--payloads', round, '--repo', p.repo, '--baseline', p.B, '--candidate', p.C], { encoding: 'utf8' });
  assert.match(r.stdout, /tests\/acceptance\/feature\.test\.mjs` \(acceptance test: needs a governing-change listing it/);
});

// --- wf attest ---

const NODE_CHECK = { name: 'unit', run: 'node --test --test-reporter="$WF_NODE_REPORTER" --test-reporter-destination="$WF_REPORT_DIR/node.ndjson" "tests/acceptance/*.test.mjs"', report: { format: 'node-test', file: 'node.ndjson' } };
function attestSetup(t, attest = { setup: ['echo preparing'], checks: [NODE_CHECK] }) {
  const p = project(t, { attest });
  const secret = path.join(p.temp, 'owner-secret.pem'); fs.writeFileSync(secret, 'PRIVATE KEY MATERIAL\n');
  // A stand-in sandbox: it refuses any command that names the protected file, as a real one refuses to read it.
  const sandbox = path.join(p.temp, 'sandbox.sh');
  fs.writeFileSync(sandbox, `#!/bin/sh\nfor a in "$@"; do [ "$a" = '${secret}' ] && exit 1; done\nexec "$@"\n`, { mode: 0o755 });
  const leaky = path.join(p.temp, 'leaky.sh'); fs.writeFileSync(leaky, '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
  const attestRun = (extra, { candidate = p.C, env = {} } = {}) => {
    const out = path.join(p.temp, `attest-${Math.random().toString(16).slice(2)}.json`);
    const r = spawnSync(process.execPath, [cli, 'attest', '--repo', p.repo, '--baseline', p.B, '--candidate', candidate, '--repository', repository, '--expires-at', '2099-01-01T00:00:00Z', '--out', out, ...extra], { encoding: 'utf8', env: { ...process.env, ...env } });
    const json = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
    return { ...r, json, out, payloads: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null };
  };
  return { ...p, secret, sandbox, leaky, attestRun };
}

test('attest runs the approved checks on a fresh checkout and writes verification and integration payloads', t => {
  const p = attestSetup(t);
  p.git('checkout', '-q', 'main'); // the clone's own working tree is not what attest runs
  const r = p.attestRun(['--sandbox', p.sandbox, '--protect', p.secret]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.sha256, createHash('sha256').update(fs.readFileSync(r.out)).digest('hex'));
  assert.equal((fs.statSync(r.out).mode & 0o777), 0o600);
  const [verification, integration] = r.payloads;
  assert.deepEqual([verification.purpose, integration.purpose], ['verification', 'integration']);
  assert.equal(verification.revision, p.C);
  assert.deepEqual(payloadProblems(verification), []); assert.deepEqual(payloadProblems(integration), []);
  assert.deepEqual(verification.execution.tests, [{ file: 'tests/acceptance/feature.test.mjs', name: 'required scenario', status: 'passed' }]);
  assert.deepEqual(verification.checks.map(c => [c.name, c.result]), [['unit', 'passed']]);
  assert.match(verification.artifacts['setup.log'], /preparing/);
  assert.equal(verification.attested.tool, 'wf attest');
  assert.equal(verification.attested.sandbox.launcher, 'sandbox.sh');
  assert.match(verification.environment, /fresh checkout of [0-9a-f]{40} from a verified mirror/);
  // Its payloads satisfy the gate like any signed evidence.
  const gate = p.run(ci(p), { claims: [{ purpose: 'baseline', revision: p.B }, ...r.payloads, p.evidence(p.C)[2], testChange(p.A)] });
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
});

test('attest refuses a sandbox that does not hide the protected path, and runs unsandboxed only when told', t => {
  const p = attestSetup(t);
  const leaky = p.attestRun(['--sandbox', p.leaky, '--protect', p.secret]);
  assert.equal(leaky.status, 2); assert.match(leaky.stderr, /readable inside the sandbox/); assert.equal(leaky.payloads, null);
  const none = p.attestRun([]);
  assert.equal(none.status, 2); assert.match(none.stderr, /--sandbox FILE/);
  const untested = p.attestRun(['--sandbox', p.sandbox]);
  assert.equal(untested.status, 2); assert.match(untested.stderr, /--protect/);
  const unsandboxed = p.attestRun(['--unsandboxed']);
  assert.equal(unsandboxed.status, 0, unsandboxed.stderr);
  assert.match(unsandboxed.payloads[0].environment, /UNSANDBOXED/);
  assert.equal(unsandboxed.payloads[0].attested.sandbox, null);
});

test('checks get a minimal environment: no signing or workflow variables reach candidate code', t => {
  const p = attestSetup(t, { checks: [{ name: 'unit', run: 'env' }] });
  const r = p.attestRun(['--unsandboxed'], { env: { OWNER_SIGNING_KEY: '/owner/key.pem', OWNER_SIGNING_PASSPHRASE: 'hunter2', WF_RECEIPTS: '/x', GH_TOKEN: 'ghp_x', SAFE_TO_PASS: 'yes' } });
  assert.equal(r.status, 1, r.stderr); // no report, so the mapped test never ran: recorded, not signable
  assert.match(r.json.notes.join(' '), /ran 0 time\(s\)/);
  const log = r.payloads[0].artifacts['unit.log'];
  for (const leaked of ['OWNER_SIGNING_KEY', 'hunter2', 'WF_RECEIPTS', 'ghp_x', 'SAFE_TO_PASS']) assert.doesNotMatch(log, new RegExp(leaked));
  assert.match(log, /^CI=true$/m); assert.match(log, /^WF_REPORT_DIR=/m);
});

test('attest runs the baseline\'s checks, whatever the candidate\'s config says', t => {
  const p = attestSetup(t);
  p.edit('docs/workflow/config.json', x => { const c = JSON.parse(x); c.attest.checks = [{ name: 'unit', run: 'echo candidate-chosen; true' }]; return JSON.stringify(c); });
  const E = p.commit('T-0001: try to choose the checks');
  const r = p.attestRun(['--unsandboxed'], { candidate: E });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.payloads[0].artifacts['unit.log'], /candidate-chosen/);
  assert.match(r.payloads[0].artifacts['unit.log'], /node --test/);
});

test('a failing mapped test, a failing check or a missing report is recorded and exits 1; do not sign it', t => {
  const p = attestSetup(t);
  const red = p.attestRun(['--unsandboxed'], { candidate: p.A }); // the acceptance test before the implementation
  assert.equal(red.status, 1, red.stderr);
  assert.equal(red.json.ok, false);
  assert.match(red.json.notes.join(' '), /mapped test tests\/acceptance\/feature\.test\.mjs \/ required scenario \(AC-001-1\) ran 1 time\(s\), failed/);
  assert.equal(red.payloads[0].checks[0].result, 'failed');
  assert.match(red.json.next, /do not sign/);
  const q = attestSetup(t, { checks: [{ name: 'unit', run: 'true', report: { format: 'junit', file: 'missing.xml' } }] });
  const missing = q.attestRun(['--unsandboxed']);
  assert.equal(missing.status, 1); assert.match(missing.json.notes.join(' '), /missing\.xml could not be read/);
});

test('attest refuses what it cannot vouch for: a candidate without the baseline, a missing required check, an output in the checkout', t => {
  const p = attestSetup(t);
  p.git('checkout', '-q', '-b', 'detached-work', p.initial);
  p.write('src/a.mjs', 'export const result = 1;\n');
  const elsewhere = p.commit('not on top of the baseline');
  const r = p.attestRun(['--unsandboxed'], { candidate: elsewhere });
  assert.equal(r.status, 2); assert.match(r.stderr, /must contain the approved baseline/);
  const q = attestSetup(t, { checks: [{ name: 'lint', run: 'true' }] });
  const m = q.attestRun(['--unsandboxed']);
  assert.equal(m.status, 2); assert.match(m.stderr, /the profile requires unit/);
  const inside = spawnSync(process.execPath, [cli, 'attest', '--repo', q.repo, '--baseline', q.B, '--candidate', q.C, '--repository', repository, '--expires-at', '2099-01-01T00:00:00Z', '--out', path.join(q.repo, 'x.json'), '--unsandboxed'], { encoding: 'utf8' });
  assert.equal(inside.status, 2); assert.match(inside.stderr, /outside the repository/);
});

test('the attest config is checked: no sandbox from the repository, no withheld variables', () => {
  assert.doesNotThrow(() => validateAttestConfig(undefined));
  assert.doesNotThrow(() => validateAttestConfig({ setup: ['npm ci'], checks: [NODE_CHECK], env: ['DOCKER_HOST'], timeout_minutes: 45 }));
  assert.throws(() => validateAttestConfig({ checks: [NODE_CHECK], sandbox: ['sh'] }), /unknown field sandbox/);
  assert.throws(() => validateAttestConfig({ checks: [NODE_CHECK], env: ['OWNER_SIGNING_KEY'] }), /never passed/);
  assert.throws(() => validateAttestConfig({ checks: [] }), /at least one/);
  assert.throws(() => validateAttestConfig({ checks: [NODE_CHECK, NODE_CHECK] }), /listed twice/);
  assert.throws(() => validateAttestConfig({ checks: [{ ...NODE_CHECK, report: { format: 'junit', file: '../x.xml' } }] }), /plain file name/);
});

test('JUnit reports from common runners give file and name as the acceptance map records them', () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="s">
    <testcase classname="tests/a.test.ts" name="suite &gt; case one"/>
    <testcase classname="tests/a.test.ts" name="suite > case two" time="0.1"><failure message="x">expected <b></failure></testcase>
    <testcase classname="pkg.mod" file="tests/test_b.py" name="test_b"><skipped/></testcase>
    <testcase classname="tests/a.test.ts" name="printed"><system-out><![CDATA[<testcase name="fake"/>]]></system-out></testcase>
  </testsuite></testsuites>`;
  assert.deepEqual(readJunit(xml, '/root'), [
    { file: 'tests/a.test.ts', name: 'suite > case one', status: 'passed' },
    { file: 'tests/a.test.ts', name: 'suite > case two', status: 'failed' },
    { file: 'tests/test_b.py', name: 'test_b', status: 'skipped' },
    { file: 'tests/a.test.ts', name: 'printed', status: 'passed' },
  ]);
  assert.throws(() => readJunit('<html/>', '/root'), /not a JUnit/);
  assert.throws(() => readJunit('<testsuites><testcase classname="../outside.js" name="x"/></testsuites>', '/root'), /missing its file/);
});

test('with attest configured, the brief refuses verification the agent wrote and points at attested evidence', t => {
  const p = attestSetup(t);
  const agentWritten = p.file('agent-round.json', p.evidence(p.C).map(p.payload));
  const r = spawnSync(process.execPath, [cli, 'brief', '--payloads', agentWritten, '--repo', p.repo, '--baseline', p.B, '--candidate', p.C], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /this project runs wf attest, so verification and integration come from your own attest run/);
  const attested = p.attestRun(['--sandbox', p.sandbox, '--protect', p.secret]);
  const view = renderBrief({ file: attested.out, raw: fs.readFileSync(attested.out, 'utf8'), attestConfigured: true });
  assert.equal(view.ok, true, view.problems.join('; '));
  assert.match(view.markdown, /From `wf attest`.*sandboxed by `sandbox\.sh`.*only if you ran that attest yourself/);
});

// --- wf next ---

test('wf next names the round to close out or stage when a task is Done on the branch but not on the trusted branch', t => {
  const p = project(t);
  const r = spawnSync(process.execPath, [cli, 'next', '--repo', p.repo], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Next: Close out or stage the signing round for T-0001$/m);
  assert.match(r.stdout, /procedures\/approval-evidence\.md \*Signing rounds\*/);
  assert.match(r.stdout, new RegExp(`wf closeout --baseline ${p.B}`));
});

test('wf next starts the ready task and names only what to read for it', t => {
  const p = project(t);
  p.git('checkout', '-q', 'main');
  const next = evaluateNext({ baseline: gitSource(p.repo, p.B), candidate: dirSource(p.repo) });
  assert.equal(next.next.kind, 'start'); assert.equal(next.next.item, 'T-0001');
  assert.deepEqual(next.next.read, ['docs/workflow/tasks/T-0001.md', 'docs/workflow/milestones/M-0001.md', 'docs/workflow/profile.md', 'docs/workflow/acceptance.json', 'tests/acceptance-map.json', 'procedures/execute.md *Implement a task*, then procedures/review.md']);
  assert.match(next.next.run[0], new RegExp(`wf readiness --baseline ${p.B} --task T-0001`));
});

test('wf next keeps working through a milestone that signs once at its end', t => {
  const p = project(t);
  p.edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised', 'status: Authorised\nsigning: milestone'));
  p.write('docs/workflow/tasks/T-0002.md', fs.readFileSync(path.join(p.repo, taskPath), 'utf8').replaceAll('T-0001', 'T-0002').replace('status: Done', 'status: Ready').replace(/^implemented:.*$/m, 'implemented:'));
  const next = evaluateNext({ baseline: gitSource(p.repo, p.B), candidate: dirSource(p.repo) });
  assert.notEqual(next.next.kind, 'round');
  assert.equal(next.next.item, 'T-0002');
});

test('wf next puts record errors first and stops when nothing is eligible', t => {
  const p = project(t);
  p.git('checkout', '-q', 'main');
  p.edit(taskPath, x => x.replace('status: Ready', 'status: Sideways'));
  const broken = evaluateNext({ baseline: gitSource(p.repo, p.B), candidate: dirSource(p.repo) });
  assert.equal(broken.next.kind, 'records'); assert.match(broken.next.why, /status must be one of/);
  p.edit(taskPath, x => x.replace('status: Sideways', 'status: Blocked\nresume_condition: the owner answers D-0009'));
  const idle = evaluateNext({ baseline: gitSource(p.repo, p.B), candidate: dirSource(p.repo) });
  assert.equal(idle.next.kind, 'stop');
  assert.deepEqual(idle.blocked, [{ task: 'T-0001', resume_condition: 'the owner answers D-0009' }]);
});
