// Signing rounds (MAINT-0004): derived baselines, unsigned dry runs, closeout, the trusted-branch report and the brief.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTrust } from '../lib/trust.js';
import { quote, withDerivedBaselines } from '../lib/derived.js';
import { fakeExecutable } from './helpers.js';

const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const taskPath = 'docs/workflow/tasks/T-0001.md';
const repository = 'fixture/project';
const REVIEW = ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'];

// main holds the approved baseline B; the task works on its own branch: candidate C (src/a.js) with its receipts, then
// D, the records-only commit that marks T-0001 Done.
function round(t, { derived = true, mapped = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-rounds-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'project'); fs.cpSync(fixture, repo, { recursive: true });
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true }); fs.writeFileSync(path.join(repo, p), text); };
  const edit = (p, fn) => write(p, fn(fs.readFileSync(path.join(repo, p), 'utf8')));
  const git = (...args) => { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const commit = message => { git('add', '-A'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Test Worker'); git('config', 'user.email', 'worker@example.invalid');
  edit('docs/workflow/config.json', text => { const c = JSON.parse(text); return JSON.stringify({ ...c, repository, approval: { ...c.approval, ...(derived ? { derived_baselines: true } : {}) } }, null, 2); });
  if (mapped) {
    edit('docs/workflow/acceptance.json', x => x.replace('inspection', 'automated'));
    write('tests/acceptance-map.json', JSON.stringify([{ acceptance: 'AC-001-1', file: 'tests/feature.js', name: 'required scenario' }]));
    write('tests/feature.js', 'actual test file\n');
  }
  const initial = commit('initial');
  edit(taskPath, x => x.replaceAll('fixture-rev', initial));
  const B = commit('authorised baseline');
  git('checkout', '-q', '-b', 'T-0001-work');
  edit(taskPath, x => x.replace(`governing_baseline_revision: ${initial}`, `governing_baseline_revision: ${B}`).replace(/^baseline_revision:.*$/m, `baseline_revision: ${B}`));
  write('src/a.js', 'export const result = 1;\n');
  const C = commit('T-0001: candidate');
  edit(taskPath, x => x.replace('status: Ready', 'status: Done').replace(/^implemented:.*$/m, `implemented: ${C}`));
  const D = commit('T-0001: record done');
  const keys = generateKeyPairSync('ed25519');
  const key = path.join(temp, 'owner.pem'); fs.writeFileSync(key, keys.publicKey.export({ type: 'spki', format: 'pem' }));
  const check = { environment: 'isolated', checks: [{ name: 'unit', result: 'passed', evidence: 'evidence/log.txt' }] };
  const evidence = rev => [
    { purpose: 'verification', revision: rev, ...check, execution: { revision: rev, tests: [{ file: 'tests/feature.js', name: 'required scenario', status: 'passed' }] } },
    { purpose: 'integration', revision: rev, ...check },
    { purpose: 'review', revision: rev, reviewer: 'independent', implementer: 'agent', separate_context: 'fresh', evidence: 'evidence/log.txt', coverage: REVIEW, findings: [] },
  ];
  const payload = c => ({ ...c, repository, expires_at: '2099-01-01T00:00:00Z' });
  const signed = claims => claims.map(c => { const p = payload(c); return { payload: p, signature: sign(null, Buffer.from(JSON.stringify(p)), keys.privateKey).toString('base64') }; });
  const file = (name, value) => { const f = path.join(temp, name); fs.writeFileSync(f, JSON.stringify(value)); return f; };
  const receipts = claims => file('receipts.json', signed(claims));
  const unsigned = claims => file('unsigned.json', claims.map(payload));
  const run = (args, { receiptsFile = path.join(temp, 'receipts.json'), unsignedFile = null } = {}) => {
    const r = spawnSync(process.execPath, [cli, ...args, '--repo', repo, '--trust-key', key, '--receipts', receiptsFile, '--repository', repository, ...(unsignedFile ? ['--unsigned-receipts', unsignedFile] : []), '--json'], { encoding: 'utf8' });
    return { ...r, json: (() => { try { return JSON.parse(r.stdout); } catch { return null; } })() };
  };
  const trustOf = (claims, draft = []) => withDerivedBaselines(createTrust({ publicKey: keys.publicKey, repository, envelopes: signed(claims), unsigned: draft.map(payload) }), repo);
  return { temp, repo, git, edit, write, commit, B, C, D, evidence, receipts, unsigned, file, run, trustOf, payload };
}

test('a records-only commit on a fully receipted candidate is a derived baseline', t => {
  const p = round(t);
  const trust = p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  const d = trust.derivation(p.D);
  assert.equal(d.approved, true, JSON.stringify(d));
  assert.equal(d.via, 'derived'); assert.equal(d.from, p.B);
  assert.deepEqual(d.covered.map(c => [c.path, c.receipt]), [['src/a.js', p.C], ['(assembled production content)', p.C]]);
  assert.equal(trust.allows('baseline', p.D), true);
  assert.deepEqual(trust.provisional(), []);
});

test('derivation is off unless the approved baseline config enables it', t => {
  const p = round(t, { derived: false });
  const d = p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]).derivation(p.D);
  assert.equal(d.approved, false); assert.match(d.reasons.join(' '), /derived_baselines/);
});

test('a candidate cannot enable derivation for itself', t => {
  const p = round(t, { derived: false });
  p.edit('docs/workflow/config.json', text => { const c = JSON.parse(text); c.approval.derived_baselines = true; return JSON.stringify(c); });
  const E = p.commit('enable derivation without approval');
  const d = p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]).derivation(E);
  assert.equal(d.approved, false); assert.match(d.reasons.join(' '), /derived_baselines/);
});

test('production content changed after its receipts, or without all three receipts, derives nothing', t => {
  const p = round(t);
  p.write('src/a.js', 'export const result = 2;\n');
  const E = p.commit('T-0001: unreceipted change');
  const trust = p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  assert.equal(trust.derivation(E).approved, false);
  assert.match(trust.derivation(E).reasons.join(' '), /production path src\/a\.js/);
  const partial = p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C).filter(c => c.purpose !== 'review')]);
  assert.equal(partial.derivation(p.D).approved, false);
});

test('governing and enforcement changes need scoped receipts; unclassified paths never derive', t => {
  const p = round(t);
  p.edit('docs/specs/feature.md', x => `${x}\nA changed requirement.\n`);
  const G = p.commit('governing edit');
  const base = [{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)];
  assert.equal(p.trustOf(base).derivation(G).approved, false);
  assert.equal(p.trustOf([...base, { purpose: 'governing-change', revision: G, paths: ['docs/other.md'] }]).derivation(G).approved, false);
  assert.equal(p.trustOf([...base, { purpose: 'governing-change', revision: G, paths: ['docs/specs/feature.md'] }]).derivation(G).approved, true);
  p.write('CODEOWNERS', '* @owner\n');
  const W = p.commit('enforcement edit');
  assert.equal(p.trustOf([...base, { purpose: 'governing-change', revision: G, paths: ['docs/specs/feature.md'] }]).derivation(W).approved, false);
  p.write('notes.unknown', 'x\n');
  const U = p.commit('unclassified');
  const all = [...base, { purpose: 'governing-change', revision: G, paths: ['docs/specs/feature.md'] }, { purpose: 'workflow-change', revision: W, paths: ['CODEOWNERS'] }];
  assert.equal(p.trustOf(all).derivation(W).approved, true);
  const u = p.trustOf(all).derivation(U);
  assert.equal(u.approved, false); assert.match(u.reasons.join(' '), /unclassified/);
});

test('a derivation that relied on an unsigned payload is provisional', t => {
  const p = round(t);
  const trust = p.trustOf([{ purpose: 'baseline', revision: p.B }], p.evidence(p.C));
  assert.equal(trust.derivation(p.D).approved, true);
  assert.deepEqual(trust.provisional().map(x => x.purpose).sort(), ['integration', 'review', 'verification']);
});

test('an unsigned dry run exits 3, never 0, and a signed receipt takes precedence', t => {
  const p = round(t);
  p.receipts([{ purpose: 'baseline', revision: p.B }]);
  const draft = p.unsigned(p.evidence(p.C));
  const dry = p.run(['ci', '--baseline', p.B, '--candidate', p.C, '--task', 'T-0001'], { unsignedFile: draft });
  assert.equal(dry.status, 3, dry.stdout + dry.stderr);
  assert.equal(dry.json.verdict, 'pass'); assert.equal(dry.json.authoritative, false); assert.equal(dry.json.provisional.length, 3);
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  const real = p.run(['ci', '--baseline', p.B, '--candidate', p.C, '--task', 'T-0001'], { unsignedFile: draft });
  assert.equal(real.status, 0, real.stdout + real.stderr); assert.equal(real.json.provisional, undefined);
});

test('an unsigned dry run still fails what it cannot satisfy and needs the trust options', t => {
  const p = round(t);
  p.receipts([{ purpose: 'baseline', revision: p.B }]);
  const partial = p.unsigned(p.evidence(p.C).filter(c => c.purpose !== 'integration'));
  assert.equal(p.run(['ci', '--baseline', p.B, '--candidate', p.C, '--task', 'T-0001'], { unsignedFile: partial }).status, 1);
  const foreign = p.file('foreign.json', p.evidence(p.C).map(c => ({ ...p.payload(c), repository: 'other/project' })));
  assert.equal(p.run(['ci', '--baseline', p.B, '--candidate', p.C, '--task', 'T-0001'], { unsignedFile: foreign }).status, 1);
  const bare = spawnSync(process.execPath, [cli, 'ci', '--repo', p.repo, '--baseline', p.B, '--candidate', p.C, '--task', 'T-0001', '--unsigned-receipts', partial], { encoding: 'utf8' });
  assert.equal(bare.status, 2); assert.match(bare.stderr, /unsigned-receipts/);
});

test('closeout re-runs the round\'s gates on the signed receipts and prints the fast-forward', t => {
  const p = round(t);
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  const r = p.run(['closeout', '--baseline', p.B, '--candidate', p.D]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.json.steps.every(s => s.ok));
  assert.ok(r.json.steps.some(s => /wf ci for T-0001/.test(s.name)));
  assert.ok(r.json.steps.some(s => /approved baseline \(derived\)/.test(s.name)));
  assert.equal(r.json.fast_forward, `git -C ${quote(p.repo)} update-ref 'refs/heads/main' ${p.D} ${p.B}`);
  assert.equal(p.git('rev-parse', 'main'), p.B, 'closeout moves nothing');
});

test('closeout refuses a round with a missing receipt, an unapproved end or a non-fast-forward', t => {
  const p = round(t);
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C).filter(c => c.purpose !== 'integration')]);
  const missing = p.run(['closeout', '--baseline', p.B, '--candidate', p.D]);
  assert.equal(missing.status, 1); assert.equal(missing.json.fast_forward, null);
  assert.ok(missing.json.steps.some(s => !s.ok && /T-0001/.test(s.name)));
  const q = round(t, { derived: false });
  q.receipts([{ purpose: 'baseline', revision: q.B }, ...q.evidence(q.C)]);
  const underived = q.run(['closeout', '--baseline', q.B, '--candidate', q.D]);
  assert.equal(underived.status, 1);
  assert.ok(underived.json.steps.some(s => !s.ok && /approved baseline/.test(s.name)));
  q.receipts([{ purpose: 'baseline', revision: q.B }, ...q.evidence(q.C), { purpose: 'baseline', revision: q.D }]);
  assert.equal(q.run(['closeout', '--baseline', q.B, '--candidate', q.D]).status, 0);
  q.git('checkout', '-q', '--orphan', 'elsewhere'); q.git('rm', '-rqf', '.');
  q.write('README.md', 'unrelated\n'); const O = q.commit('unrelated history');
  const unrelated = q.run(['closeout', '--baseline', q.B, '--candidate', O]);
  assert.equal(unrelated.status, 1);
});

test('closeout of an unsigned round is provisional; a milestone accepted in the round needs owner acceptance', t => {
  const p = round(t);
  p.receipts([{ purpose: 'baseline', revision: p.B }]);
  const dry = p.run(['closeout', '--baseline', p.B, '--candidate', p.D], { unsignedFile: p.unsigned(p.evidence(p.C)) });
  assert.equal(dry.status, 3, dry.stdout + dry.stderr); assert.equal(dry.json.authoritative, false);
  assert.equal(dry.json.fast_forward, null, 'a dry run prints nothing to run');
  p.edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised', 'status: Accepted'));
  const M = p.commit('close M-0001');
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  const unaccepted = p.run(['closeout', '--baseline', p.B, '--candidate', M]);
  assert.equal(unaccepted.status, 1); assert.ok(unaccepted.json.steps.some(s => !s.ok && /M-0001 acceptance/.test(s.name)));
  const close = { purpose: 'governing-change', revision: M, paths: ['docs/workflow/milestones/M-0001.md'] };
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C), close, { purpose: 'acceptance', revision: p.C, decision: 'accepted', scenarios: ['AC-001-1'] }]);
  const accepted = p.run(['closeout', '--baseline', p.B, '--candidate', M]);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  p.edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Accepted', 'status: Released'));
  const Rl = p.commit('release M-0001');
  const releaseClose = { purpose: 'governing-change', revision: Rl, paths: ['docs/workflow/milestones/M-0001.md'] };
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C), releaseClose, { purpose: 'acceptance', revision: p.C, decision: 'accepted', scenarios: ['AC-001-1'] }]);
  const unreleased = p.run(['closeout', '--baseline', p.B, '--candidate', Rl]);
  assert.equal(unreleased.status, 1); assert.ok(unreleased.json.steps.some(s => !s.ok && /release authority/.test(s.name)));
});

test('status and ci report a trusted branch that moved past approval', t => {
  const p = round(t, { derived: false });
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  const status = () => spawnSync(process.execPath, [cli, 'status', '--repo', p.repo, '--baseline', p.B, '--trust-key', path.join(p.temp, 'owner.pem'), '--receipts', path.join(p.temp, 'receipts.json'), '--repository', repository, '--json'], { encoding: 'utf8' });
  let view = JSON.parse(status().stdout);
  assert.equal(view.trusted_branch.approved, true);
  assert.ok(!view.waiting.some(w => w.kind === 'trusted-branch'));
  p.git('update-ref', 'refs/heads/main', p.D);
  view = JSON.parse(status().stdout);
  assert.equal(view.trusted_branch.approved, false); assert.equal(view.trusted_branch.ahead, 2);
  assert.ok(view.waiting.some(w => w.kind === 'trusted-branch' && w.owner === 'owner'));
  const ci = p.run(['ci', '--baseline', p.B, '--candidate', p.C, '--task', 'T-0001']);
  assert.equal(ci.status, 0, 'the report never fails the gate');
  assert.ok(ci.json.findings.some(f => /trusted branch main .* not approved/.test(f)));
  const plain = JSON.parse(spawnSync(process.execPath, [cli, 'status', '--repo', p.repo, '--json'], { encoding: 'utf8' }).stdout);
  assert.equal(plain.trusted_branch, null, 'without the trust options status reads no receipts');
});

test('the signing brief is rendered from the payload file, flags what needs judgement and escapes payload text', t => {
  const p = round(t);
  const review = { ...p.evidence(p.C)[2], findings: [{ id: 'R-1', category: 'scope', severity: 'note', status: 'accepted', resolution: 'kept | <script>alert(1)</script>' }] };
  const payloads = [...p.evidence(p.C).slice(0, 2), review, { purpose: 'governing-change', revision: p.C, paths: ['docs/specs/feature.md'] }, { purpose: 'baseline', revision: p.D }].map(p.payload);
  const f = p.file('round-unsigned.json', payloads);
  const r = spawnSync(process.execPath, [cli, 'brief', '--payloads', f, '--repo', p.repo, '--baseline', p.B], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const digest = (spawnSync('shasum', ['-a', '256', f], { encoding: 'utf8' }).stdout || '').split(' ')[0];
  if (digest) assert.ok(r.stdout.includes(digest));
  assert.match(r.stdout, /## What you are signing/);
  assert.match(r.stdout, /T-0001: candidate/);
  assert.match(r.stdout, /1 note accepted.*R-1/);
  const outsideCode = r.stdout.replace(/`[^`\n]*`/g, '');
  assert.ok(!/<script|\]\(|!\[/.test(outsideCode), 'payload text renders only inside code spans');
  assert.match(r.stdout, /Protected paths.*docs\/specs\/feature\.md/);
  assert.match(r.stdout, /T-0001 Ready → Done/);
  assert.ok(r.stdout.includes('`kept \\| <script>alert(1)</script>`'));
});

test('the signing brief refuses a file the gates would reject', t => {
  const p = round(t);
  const bad = [
    { ...p.payload(p.evidence(p.C)[2]), coverage: ['scope'] },
    p.payload({ purpose: 'baseline', revision: p.D }), p.payload({ purpose: 'baseline', revision: p.D }),
    { ...p.payload({ purpose: 'integration', revision: p.C, environment: 'x', checks: [{ name: 'unit', result: 'failed', evidence: 'log' }] }), expires_at: '2000-01-01T00:00:00Z' },
  ];
  const r = spawnSync(process.execPath, [cli, 'brief', '--payloads', p.file('bad.json', bad)], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /## Problems: do not sign until fixed/);
  assert.match(r.stdout, /review does not cover correctness/);
  assert.match(r.stdout, /repeats #2/);
  assert.match(r.stdout, /expires_at has passed/);
  assert.match(r.stdout, /check unit is failed; every check must pass/);
  const json = JSON.parse(spawnSync(process.execPath, [cli, 'brief', '--payloads', p.file('bad.json', bad), '--json'], { encoding: 'utf8' }).stdout);
  assert.equal(json.ok, false); assert.equal(json.count, 4);
});

test('a receipt counts toward derivation only with passing checks and mapped tests, a sound review and the required checks', t => {
  const p = round(t, { mapped: true });
  const [verification, integration, review] = p.evidence(p.C);
  const base = { purpose: 'baseline', revision: p.B };
  assert.equal(p.trustOf([base, verification, integration, review]).derivation(p.D).approved, true);
  const failed = { ...verification, checks: [{ name: 'unit', result: 'failed', evidence: 'evidence/log.txt' }] };
  assert.equal(p.trustOf([base, failed, integration, review]).derivation(p.D).approved, false);
  const run = tests => ({ ...verification, execution: { revision: p.C, tests } });
  const mappedRun = status => ({ file: 'tests/feature.js', name: 'required scenario', status });
  assert.equal(p.trustOf([base, run([mappedRun('skipped')]), integration, review]).derivation(p.D).approved, false, 'a mapped test must pass');
  assert.equal(p.trustOf([base, run([]), integration, review]).derivation(p.D).approved, false, 'a mapped test must run');
  assert.equal(p.trustOf([base, run([mappedRun('passed'), mappedRun('passed')]), integration, review]).derivation(p.D).approved, false, 'exactly once');
  assert.equal(p.trustOf([base, run([mappedRun('passed'), { file: 'tests/x.js', name: 'placeholder', status: 'skipped' }]), integration, review]).derivation(p.D).approved, true, 'an unmapped test may be skipped, as the gate allows');
  const open = { ...review, findings: [{ id: 'R-1', status: 'open' }] };
  assert.equal(p.trustOf([base, verification, integration, open]).derivation(p.D).approved, false);
  const self = { ...review, reviewer: 'agent' };
  assert.equal(p.trustOf([base, verification, integration, self]).derivation(p.D).approved, false);
  const other = c => ({ ...c, checks: [{ name: 'lint', result: 'passed', evidence: 'evidence/log.txt' }] });
  assert.equal(p.trustOf([base, other(verification), other(integration), review]).derivation(p.D).approved, false, 'the profile requires unit');
});

test('unsigned payloads never make the trusted branch look approved', t => {
  const p = round(t, { derived: false });
  p.receipts([{ purpose: 'baseline', revision: p.B }]);
  p.git('update-ref', 'refs/heads/main', p.D);
  const draft = p.unsigned([...p.evidence(p.C), { purpose: 'baseline', revision: p.D }]);
  const r = spawnSync(process.execPath, [cli, 'status', '--repo', p.repo, '--baseline', p.B, '--trust-key', path.join(p.temp, 'owner.pem'), '--receipts', path.join(p.temp, 'receipts.json'), '--repository', repository, '--unsigned-receipts', draft, '--json'], { encoding: 'utf8' });
  const view = JSON.parse(r.stdout);
  assert.equal(view.trusted_branch.approved, false);
  assert.equal(view.trusted_branch.newest_receipt, p.B);
});

test('the brief keeps a hostile revision inside a code span', t => {
  const p = round(t);
  const r = spawnSync(process.execPath, [cli, 'brief', '--payloads', p.file('odd.json', [p.payload({ purpose: 'baseline', revision: 'a|b`<i>' })])], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  const row = r.stdout.split('\n').find(l => l.startsWith('| 1 |'));
  assert.equal(row.split(' | ').length, 5, row);
  assert.ok(!r.stdout.replace(/`[^`\n]*`/g, '').includes('<i>'));
});

test('a path name with a backslash is never derived', t => {
  const p = round(t);
  p.write('tests\\evil.test.js', 'x\n');
  const E = p.commit('odd name');
  const d = p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]).derivation(E);
  assert.equal(d.approved, false); assert.match(d.reasons.join(' '), /backslash/);
});

test('the newest approval in the whole history governs: a merge cannot bring back an older, looser one', t => {
  const p = round(t);
  // The owner, on main, makes docs/policy/** governing and signs that baseline, B1.
  p.git('checkout', '-q', 'main');
  p.edit('docs/workflow/config.json', text => { const c = JSON.parse(text); c.paths.governing.push('docs/policy/**'); return JSON.stringify(c, null, 2); });
  p.write('docs/policy/rules.md', 'owner rules\n');
  const B1 = p.commit('owner: govern docs/policy');
  // The agent merges main into its task branch and edits the newly governed file.
  p.git('checkout', '-q', 'T-0001-work');
  p.git('merge', '-q', '--no-edit', 'main');
  p.edit('docs/policy/rules.md', x => `${x}agent edit\n`);
  const E = p.commit('agent edits a governed file');
  const claims = [{ purpose: 'baseline', revision: p.B }, { purpose: 'baseline', revision: B1 }, { purpose: 'workflow-change', revision: B1, paths: ['docs/workflow/config.json'] }, ...p.evidence(p.C)];
  const d = p.trustOf(claims).derivation(E);
  assert.equal(d.approved, false, JSON.stringify(d)); assert.equal(d.from, B1);
  assert.match(d.reasons.join(' '), /governing path docs\/policy\/rules\.md/);
  // An ambiguous newest receipt refuses rather than falling back to B.
  const twice = p.trustOf([...claims, { purpose: 'baseline', revision: B1 }]).derivation(E);
  assert.equal(twice.approved, false); assert.match(twice.reasons.join(' '), /ambiguous/);
});

test('turning derived baselines off in a later config stops derivation', t => {
  const p = round(t);
  p.edit('docs/workflow/config.json', text => { const c = JSON.parse(text); c.approval.derived_baselines = false; return JSON.stringify(c, null, 2); });
  const E = p.commit('owner turns derivation off');
  const d = p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C), { purpose: 'workflow-change', revision: E, paths: ['docs/workflow/config.json'] }]).derivation(E);
  assert.equal(d.approved, false); assert.match(d.reasons.join(' '), /derived_baselines/);
});

test('a git failure never derives approval', t => {
  const p = round(t);
  p.write('src/a.js', 'export const result = 2;\n');
  const E = p.commit('unreceipted change');
  const bin = fs.mkdtempSync(path.join(p.temp, 'bin-'));
  const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  fakeExecutable(path.join(bin, 'git'), `const {spawnSync}=require('child_process');const a=process.argv.slice(2);if(a.includes('diff')&&a.includes(${JSON.stringify(p.C)}))process.exit(1);const r=spawnSync(${JSON.stringify(realGit)},a,{stdio:'inherit'});process.exit(r.status??1);\n`);
  const saved = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${saved}`;
  try { assert.equal(p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]).derivation(E).approved, false); }
  finally { process.env.PATH = saved; }
});

test('closeout refuses production changes outside a gated task, a task gated behind the tip, and a moved branch', t => {
  const p = round(t);
  p.write('scripts/deploy.sh', 'echo deploy\n');
  const X = p.commit('production change in no task');
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  const outside = p.run(['closeout', '--baseline', p.B, '--candidate', X]);
  assert.equal(outside.status, 1);
  assert.ok(outside.json.steps.some(s => !s.ok && /every production change/.test(s.name) && /scripts\/deploy\.sh/.test(s.detail.join(' '))));
  // The owner signs a newer tip B1 on main after the task started from B: its gate is stale.
  p.git('checkout', '-q', 'main'); p.write('docs/notes.md', 'owner note\n'); const B1 = p.commit('owner note'); p.git('checkout', '-q', 'T-0001-work');
  p.receipts([{ purpose: 'baseline', revision: p.B }, { purpose: 'baseline', revision: B1 }, ...p.evidence(p.C)]);
  const stale = p.run(['closeout', '--baseline', B1, '--candidate', p.D]);
  assert.equal(stale.status, 1);
  assert.ok(stale.json.steps.some(s => !s.ok && /descends from the baseline|chain/.test(s.name)));
  // Merging the new tip in does not refresh a gate taken against the old one.
  p.git('merge', '-q', '--no-edit', 'main'); const Mg = p.git('rev-parse', 'HEAD');
  const merged = p.run(['closeout', '--baseline', B1, '--candidate', Mg]);
  assert.equal(merged.status, 1); assert.ok(merged.json.steps.some(s => !s.ok && /chain/.test(s.name)), JSON.stringify(merged.json.steps));
  p.git('update-ref', 'refs/heads/main', p.C);
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  const moved = p.run(['closeout', '--baseline', p.B, '--candidate', p.D]);
  assert.equal(moved.status, 1); assert.ok(moved.json.steps.some(s => !s.ok && /local main is at the baseline/.test(s.name)));
});

test('the printed fast-forward is quoted for a POSIX shell', () => {
  assert.equal(quote(`/tmp/a b'$(touch x)\`y\``), `'/tmp/a b'\\''$(touch x)\`y\`'`);
});

test('status with the trust options reads the trusted branch from an approved revision', t => {
  const p = round(t);
  p.receipts([{ purpose: 'baseline', revision: p.B }]);
  const r = spawnSync(process.execPath, [cli, 'status', '--repo', p.repo, '--trust-key', path.join(p.temp, 'owner.pem'), '--receipts', path.join(p.temp, 'receipts.json'), '--repository', repository], { encoding: 'utf8' });
  assert.equal(r.status, 2); assert.match(r.stderr, /needs --baseline/);
});

test('the brief checks required checks and lists every path no payload covers', t => {
  const p = round(t);
  p.write('docs/guide.md', 'unreviewed guide\n');
  const E = p.commit('T-0001: guide after the candidate');
  const other = c => ({ ...c, checks: [{ name: 'lint', result: 'passed', evidence: 'evidence/log.txt' }] });
  const [verification, integration, review] = p.evidence(p.C);
  const f = p.file('round.json', [other(verification), other(integration), review, { purpose: 'baseline', revision: E }].map(p.payload));
  const r = spawnSync(process.execPath, [cli, 'brief', '--payloads', f, '--repo', p.repo, '--baseline', p.B], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /required check unit is missing/);
  assert.match(r.stdout, /Changed with no payload covering it.*docs\/guide\.md/);
  assert.match(r.stdout, /T-0001 Ready → Done/);
});

test('a milestone round gates each task on the unsigned work before it, and closes once signed', t => {
  const p = round(t);
  const t2 = 'docs/workflow/tasks/T-0002.md';
  p.write(t2, fs.readFileSync(path.join(p.repo, taskPath), 'utf8').replaceAll('T-0001', 'T-0002').replace('status: Done', 'status: Ready')
    .replace(/^(start_revision|governing_baseline_revision|baseline_revision):.*$/gm, `$1: ${p.D}`).replace(/^implemented:.*$/m, 'implemented:').replace('prerequisites: []', 'prerequisites: [T-0001]'));
  const E = p.commit('T-0002: claim the task on top of T-0001');
  p.write('src/b.js', 'export const b = 2;\n');
  const C2 = p.commit('T-0002: candidate');
  p.edit(t2, x => x.replace('status: Ready', 'status: Done').replace(/^implemented:.*$/m, `implemented: ${C2}`));
  const D2 = p.commit('T-0002: record done');
  p.receipts([{ purpose: 'baseline', revision: p.B }]);
  // Nothing of the round is signed: T-0002's gate runs on T-0001's staged payloads and is provisional.
  const draft = p.unsigned([...p.evidence(p.C), ...p.evidence(C2)]);
  const dry = p.run(['ci', '--baseline', p.D, '--candidate', C2, '--task', 'T-0002'], { unsignedFile: draft });
  assert.equal(dry.status, 3, dry.stdout + dry.stderr); assert.equal(dry.json.verdict, 'pass');
  assert.equal(p.run(['closeout', '--baseline', p.B, '--candidate', D2], { unsignedFile: draft }).status, 3);
  // One signed round closes the milestone's work; the claim commit E sits inside T-0002's own gated range.
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C), ...p.evidence(C2)]);
  const closed = p.run(['closeout', '--baseline', p.B, '--candidate', D2]);
  assert.equal(closed.status, 0, closed.stdout + closed.stderr);
  assert.ok(closed.json.steps.some(s => /wf ci for T-0001/.test(s.name)) && closed.json.steps.some(s => /wf ci for T-0002/.test(s.name)));
  assert.ok(E);
});

test('two separately receipted branches merged together derive nothing until the assembled whole is verified', t => {
  const p = round(t);
  p.git('checkout', '-q', '-b', 'other', p.B);
  p.write('src/c.js', 'export const c = 3;\n');
  const C2 = p.commit('T-0001: parallel candidate');
  p.git('checkout', '-q', 'T-0001-work');
  p.git('merge', '-q', '--no-edit', 'other');
  const M = p.git('rev-parse', 'HEAD');
  const both = [{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C), ...p.evidence(C2)];
  const d = p.trustOf(both).derivation(M);
  assert.equal(d.approved, false); assert.match(d.reasons.join(' '), /assembled/);
  assert.equal(p.trustOf([...both, ...p.evidence(M)]).derivation(M).approved, true);
});

test('replace refs cannot show the validator signed content for an unsigned commit', t => {
  const p = round(t);
  p.write('src/a.js', 'export const result = "evil";\n');
  const E = p.commit('T-0001: unsigned change');
  p.git('replace', p.git('rev-parse', `${E}^{tree}`), p.git('rev-parse', `${p.D}^{tree}`));
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  const r = p.run(['closeout', '--baseline', p.B, '--candidate', E]);
  assert.equal(r.status, 1, r.stdout); assert.equal(r.json.fast_forward, null);
  assert.equal(p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]).derivation(E).approved, false);
});

test('a required check added later is judged the same whatever was derived first', t => {
  const p = round(t);
  p.edit('docs/workflow/profile.md', x => x.replace('required_checks: [unit]', 'required_checks: [unit, lint]'));
  const W = p.commit('owner adds a required check');
  const claims = [{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C), { purpose: 'governing-change', revision: W, paths: ['docs/workflow/profile.md'] }];
  assert.equal(p.trustOf(claims).derivation(W).approved, false, 'fresh');
  const warm = p.trustOf(claims);
  assert.equal(warm.derivation(p.D).approved, true);
  assert.equal(warm.derivation(W).approved, false, 'after deriving D in the same run');
});

test('a git error while comparing history refuses derivation instead of reading as "no"', t => {
  const p = round(t);
  const bin = fs.mkdtempSync(path.join(p.temp, 'bin-'));
  const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  fakeExecutable(path.join(bin, 'git'), `const {spawnSync}=require('child_process');const a=process.argv.slice(2);if(a.includes('--is-ancestor'))process.exit(128);const r=spawnSync(${JSON.stringify(realGit)},a,{stdio:'inherit'});process.exit(r.status??1);\n`);
  const saved = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${saved}`;
  try {
    const d = p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]).derivation(p.D);
    assert.equal(d.approved, false); assert.match(d.reasons.join(' '), /git/);
  } finally { process.env.PATH = saved; }
});

test('Done records are removed after closeout, in a records-only round that needs no signature', t => {
  const p = round(t);
  fs.rmSync(path.join(p.repo, taskPath));
  const gone = p.commit('remove T-0001 in the round that completes it');
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  const early = p.run(['closeout', '--baseline', p.B, '--candidate', gone]);
  assert.equal(early.status, 1); assert.ok(early.json.steps.some(s => !s.ok && /removed in the round/.test(s.name)));
  // After the round closes at D, removing the Done record is a records-only round of its own.
  p.git('reset', '-q', '--hard', p.D);
  p.git('update-ref', 'refs/heads/main', p.D);
  fs.rmSync(path.join(p.repo, taskPath));
  const tidy = p.commit('remove the Done record');
  const later = p.run(['closeout', '--baseline', p.D, '--candidate', tidy]);
  assert.equal(later.status, 0, later.stdout + later.stderr);
});

test('a path with an invisible direction mark is never derived and is shown escaped in the brief', t => {
  const p = round(t);
  const name = 'docs/specs/‮dm.erutaef';
  p.write(name, 'looks like feature.md\n');
  const E = p.commit('disguised path');
  const d = p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C), { purpose: 'governing-change', revision: E, paths: [name] }]).derivation(E);
  assert.equal(d.approved, false); assert.match(d.reasons.join(' '), /invisible/);
  const f = p.file('disguised.json', [p.payload({ purpose: 'governing-change', revision: E, paths: [name] })]);
  const r = spawnSync(process.execPath, [cli, 'brief', '--payloads', f], { encoding: 'utf8' });
  assert.ok(r.stdout.includes('\\u{202e}') && !r.stdout.includes('‮'));
});

test('a review whose implementer owns no task, or a release for another revision, counts for nothing', t => {
  const p = round(t);
  const [verification, integration, review] = p.evidence(p.C);
  const stranger = { ...review, implementer: 'someone-else' };
  assert.equal(p.trustOf([{ purpose: 'baseline', revision: p.B }, verification, integration, stranger]).derivation(p.D).approved, false);
  p.edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised', 'status: Released'));
  const Rl = p.commit('release M-0001');
  const base = [{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C), { purpose: 'governing-change', revision: Rl, paths: ['docs/workflow/milestones/M-0001.md'] }, { purpose: 'acceptance', revision: p.C, decision: 'accepted', scenarios: ['AC-001-1'] }];
  const release = rev => ({ purpose: 'release', revision: p.C, authority: 'owner', artifact: 'build 1', candidate_revision: rev, readiness: Object.fromEntries(['configuration', 'permissions', 'migration', 'monitoring', 'recovery', 'support', 'devices', 'deferred_information'].map(k => [k, 'verified'])) });
  p.receipts([...base, release(p.B)]);
  assert.equal(p.run(['closeout', '--baseline', p.B, '--candidate', Rl]).status, 1, 'a release naming another revision');
  p.receipts([...base, release(p.C)]);
  const ok = p.run(['closeout', '--baseline', p.B, '--candidate', Rl]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});
