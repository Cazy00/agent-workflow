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
import { repoLayout, safeEnv, showPath, unsafePath, verifiedMirror } from '../lib/git.js';
import { gitSource } from '../lib/sources.js';

const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const taskPath = 'docs/workflow/tasks/T-0001.md';
const repository = 'fixture/project';
const REVIEW = ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'];

// main holds the approved baseline B; the task works on its own branch: candidate C (src/a.js) with its receipts, then
// D, the records-only commit that marks T-0001 Done.
function round(t, { derived = true, mapped = false, ownerTests = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-rounds-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'project'); fs.cpSync(fixture, repo, { recursive: true });
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true }); fs.writeFileSync(path.join(repo, p), text); };
  const edit = (p, fn) => write(p, fn(fs.readFileSync(path.join(repo, p), 'utf8')));
  const git = (...args) => { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const commit = message => { git('add', '-A'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Test Worker'); git('config', 'user.email', 'worker@example.invalid');
  edit('docs/workflow/config.json', text => { const c = JSON.parse(text); return JSON.stringify({ ...c, repository, approval: { ...c.approval, ...(derived ? { derived_baselines: true } : {}) }, ...(ownerTests ? { paths: { ...c.paths, acceptance_tests: ['tests/**'] } } : {}) }, null, 2); });
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
  assert.equal(r.json.fast_forward, `git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c merge.verifySignatures=false -c submodule.recurse=false -C ${quote(p.repo)} update-ref 'refs/heads/main' ${p.D} ${p.B}`);
  assert.equal(p.git('rev-parse', 'main'), p.B, 'closeout moves nothing');
});

test('closeout refuses tasks that share one gated candidate, a batch removed in v2.0.0 (MAINT-0011 review S1)', t => {
  const p = round(t);
  p.write('docs/workflow/tasks/T-0002.md', fs.readFileSync(path.join(p.repo, taskPath), 'utf8').replaceAll('T-0001', 'T-0002'));
  const E = p.commit('T-0002: recorded Done against the same candidate');
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  const r = p.run(['closeout', '--baseline', p.B, '--candidate', E]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const batch = r.json.steps.find(s => /wf ci for T-0001, T-0002/.test(s.name));
  assert.ok(batch && !batch.ok && /one pull request carries one task/.test(batch.detail.join(' ')), JSON.stringify(r.json.steps));
});

test('closeout refuses a records-only candidate two Done tasks share, which passed before v2.0.0 with no per-task gate (MAINT-0011 fix review)', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-rounds-batch-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'project'); fs.cpSync(fixture, repo, { recursive: true });
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true }); fs.writeFileSync(path.join(repo, p), text); };
  const read = p => fs.readFileSync(path.join(repo, p), 'utf8');
  const edit = (p, fn) => write(p, fn(read(p)));
  const git = (...args) => { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const commit = m => { git('add', '-A'); git('commit', '-qm', m); return git('rev-parse', 'HEAD'); };
  const second = 'docs/workflow/tasks/T-0002.md';
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Test Worker'); git('config', 'user.email', 'worker@example.invalid');
  edit('docs/workflow/config.json', x => { const c = JSON.parse(x); return JSON.stringify({ ...c, repository, approval: { ...c.approval, derived_baselines: true } }, null, 2); });
  const initial = commit('initial');
  edit(taskPath, x => x.replaceAll('fixture-rev', initial));
  write(second, read(taskPath).replaceAll('T-0001', 'T-0002'));
  const B = commit('authorised baseline');
  git('checkout', '-q', '-b', 'work');
  for (const p of [taskPath, second]) edit(p, x => x.replace(`governing_baseline_revision: ${initial}`, `governing_baseline_revision: ${B}`).replace(/^baseline_revision:.*$/m, `baseline_revision: ${B}`));
  write('docs/workflow/inbox/note.md', 'a planning note, no production change\n');
  const C = commit('both tasks: a records-only candidate');
  for (const p of [taskPath, second]) edit(p, x => x.replace('status: Ready', 'status: Done').replace(/^implemented:.*$/m, `implemented: ${C}`));
  const D = commit('T-0001, T-0002: recorded Done against one candidate');
  const keys = generateKeyPairSync('ed25519');
  const key = path.join(temp, 'owner.pem'); fs.writeFileSync(key, keys.publicKey.export({ type: 'spki', format: 'pem' }));
  const check = { environment: 'isolated', checks: [{ name: 'unit', result: 'passed', evidence: 'evidence/log.txt' }] };
  const claims = [{ purpose: 'baseline', revision: B }, { purpose: 'verification', revision: C, ...check, execution: { revision: C, tests: [] } }, { purpose: 'integration', revision: C, ...check }, { purpose: 'review', revision: C, reviewer: 'independent', implementer: 'agent', separate_context: 'fresh', evidence: 'evidence/log.txt', coverage: REVIEW, findings: [] }];
  const receipts = path.join(temp, 'receipts.json');
  fs.writeFileSync(receipts, JSON.stringify(claims.map(c => { const p = { ...c, repository, expires_at: '2099-01-01T00:00:00Z' }; return { payload: p, signature: sign(null, Buffer.from(JSON.stringify(p)), keys.privateKey).toString('base64') }; })));
  const r = spawnSync(process.execPath, [cli, 'closeout', '--baseline', B, '--candidate', D, '--repo', repo, '--trust-key', key, '--receipts', receipts, '--repository', repository, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(!out.fast_forward, 'no fast-forward is printed');
  assert.ok(out.steps.some(s => !s.ok && /wf ci for T-0001, T-0002/.test(s.name) && /one pull request carries one task/.test((s.detail ?? []).join(' '))), JSON.stringify(out.steps));
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
  assert.equal(early.status, 1); assert.ok(early.json.steps.some(s => !s.ok && /removed in a round that changes production/.test(s.name)));
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

test('hostile config in the clone cannot hide changes from derivation, closeout or the brief', t => {
  const p = round(t);
  p.write('src/a.js', 'export const result = "evil";\n');
  const E = p.commit('T-0001: unsigned change');
  p.git('config', 'core.worktree', '../..'); p.git('config', 'diff.relative', 'true');
  const trust = p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  assert.equal(trust.derivation(E).approved, false);
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  assert.equal(p.run(['closeout', '--baseline', p.B, '--candidate', E]).status, 1);
  const f = p.file('hostile.json', p.evidence(p.C).map(p.payload));
  const brief = spawnSync(process.execPath, [cli, 'brief', '--payloads', f, '--repo', p.repo, '--baseline', p.B, '--candidate', E], { encoding: 'utf8' });
  assert.match(brief.stdout, /Changed with no payload covering it.*src\/a\.js/);
});

test('rendering the brief never runs a program the clone configures', t => {
  const p = round(t);
  const marker = path.join(p.temp, 'ran');
  const gpg = path.join(p.temp, 'fake-gpg');
  fs.writeFileSync(gpg, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o755 });
  p.git('config', 'log.showSignature', 'true'); p.git('config', 'gpg.program', gpg);
  const raw = p.git('cat-file', 'commit', p.C).replace('\n\n', '\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n -----END PGP SIGNATURE-----\n\n');
  const signedCommit = spawnSync('git', ['-C', p.repo, 'hash-object', '-t', 'commit', '-w', '--stdin'], { input: raw, encoding: 'utf8' }).stdout.trim();
  const f = p.file('signed.json', [p.payload({ purpose: 'baseline', revision: signedCommit })]);
  const r = spawnSync(process.execPath, [cli, 'brief', '--payloads', f, '--repo', p.repo], { encoding: 'utf8', env: { ...process.env, OWNER_SIGNING_PASSPHRASE: 'secret' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.existsSync(marker), false, 'gpg.program must not run');
  const env = safeEnv('/x');
  assert.equal(env.OWNER_SIGNING_PASSPHRASE, undefined);
  for (const key of ['core.commitGraph', 'log.showSignature', 'diff.relative']) assert.ok(Object.entries(env).some(([k, v]) => k.startsWith('GIT_CONFIG_KEY_') && v === key), key);
});

test('a round without production changes may drop a Draft task cut from the plan', t => {
  const p = round(t);
  p.git('checkout', '-q', 'main');
  p.write('docs/workflow/tasks/T-0002.md', fs.readFileSync(path.join(p.repo, taskPath), 'utf8').replaceAll('T-0001', 'T-0002').replace('status: Ready', 'status: Draft'));
  const B2 = p.commit('plan T-0002');
  fs.rmSync(path.join(p.repo, 'docs/workflow/tasks/T-0002.md'));
  const cut = p.commit('cut T-0002 from the plan');
  p.git('branch', 'cut-plan', cut); // the round's end is on a branch, as closeout's verified mirror needs
  p.git('update-ref', 'refs/heads/main', B2);
  p.receipts([{ purpose: 'baseline', revision: B2 }]);
  const r = p.run(['closeout', '--baseline', B2, '--candidate', cut]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('a receipt for a commit missing from the clone does not block derivation', t => {
  const p = round(t);
  const absent = 'f'.repeat(40);
  const d = p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C), { purpose: 'baseline', revision: absent }, ...p.evidence(absent)]).derivation(p.D);
  assert.equal(d.approved, true, JSON.stringify(d));
});

test('paths that can pass for another are never derived and are shown exactly', () => {
  for (const bad of ['docs/specs/feature.md ', 'docs/specs/feature md', 'a  b', ' a', 'x‮y', 'tag\u{e0041}', 'a\\b', 'x͏y']) assert.equal(unsafePath(bad), true, JSON.stringify(bad));
  for (const good of ['src/a.js', 'docs/My Notes.md', 'résumé.md']) assert.equal(unsafePath(good), false, good);
  assert.equal(showPath('docs/specs/feature.md '), 'docs/specs/feature.md\\u{20}');
  assert.equal(showPath('a b'), 'a\\u{a0}b');
});

test('the brief covers the round to its end, and recording implemented leaves the gate at integrate', t => {
  const p = round(t);
  p.write('src/late.js', 'export const late = 1;\n');
  const L = p.commit('T-0001: production after the receipted candidate');
  const f = p.file('round.json', p.evidence(p.C).map(p.payload));
  const r = spawnSync(process.execPath, [cli, 'brief', '--payloads', f, '--repo', p.repo, '--baseline', p.B, '--candidate', L], { encoding: 'utf8' });
  assert.match(r.stdout, /T-0001 Ready → Done/);
  assert.match(r.stdout, /Changed with no payload covering it.*src\/late\.js/);
  // An Open decision required before accept does not block the Done commit's own ci, because implemented maps below integrate.
  const q = round(t);
  q.git('checkout', '-q', 'main');
  q.write('docs/workflow/decisions/D-0002.md', fs.readFileSync(path.join(q.repo, 'docs/workflow/decisions/D-0001.md'), 'utf8').replaceAll('D-0001', 'D-0002').replace('status: Resolved', 'status: Open').replace(/required_before: \w+/, 'required_before: accept'));
  const B2 = q.commit('owner: open D-0002 before acceptance');
  q.git('checkout', '-q', 'T-0001-work'); q.git('merge', '-q', '--no-edit', 'main');
  q.edit(taskPath, x => x.replace(/^start_revision:.*$/m, `start_revision: ${B2}`).replace(/^baseline_revision:.*$/m, `baseline_revision: ${B2}`).replace(/^governing_baseline_revision:.*$/m, `governing_baseline_revision: ${B2}`));
  const D2 = q.commit('T-0001: record done against the new tip');
  q.receipts([{ purpose: 'baseline', revision: B2 }, ...q.evidence(D2)]);
  const ci = q.run(['ci', '--baseline', B2, '--candidate', D2, '--task', 'T-0001']);
  assert.equal(ci.status, 0, ci.stdout + ci.stderr);
});

test('a rewritten object file cannot pass closeout or the brief: both read a verified mirror', t => {
  const p = round(t);
  p.write('src/a.js', 'export const result = "evil";\n');
  const E = p.commit('T-0001: unsigned change');
  // Make E's src tree read as D's: overwrite its loose object file with D's src tree.
  const object = sha => path.join(p.repo, '.git', 'objects', sha.slice(0, 2), sha.slice(2));
  const [forged, real] = [p.git('rev-parse', `${E}:src`), p.git('rev-parse', `${p.D}:src`)];
  fs.chmodSync(object(forged), 0o644); fs.copyFileSync(object(real), object(forged));
  assert.equal(p.git('diff', '--name-only', p.D, E), '', 'the local object store now hides the change');
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  const r = p.run(['closeout', '--baseline', p.B, '--candidate', E]);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /failed verification/);
  const f = p.file('forged.json', p.evidence(p.C).map(p.payload));
  const brief = spawnSync(process.execPath, [cli, 'brief', '--payloads', f, '--repo', p.repo, '--baseline', p.B, '--candidate', E], { encoding: 'utf8' });
  assert.equal(brief.status, 2); assert.match(brief.stderr, /failed verification/);
});

test('a missing object in the approval history refuses derivation rather than finding an older approval', t => {
  const p = round(t);
  p.git('checkout', '-q', 'main');
  p.write('docs/notes.md', 'owner note\n');
  const B1 = p.commit('owner note');
  p.git('checkout', '-q', 'T-0001-work'); p.git('merge', '-q', '--no-edit', 'main');
  const E = p.git('rev-parse', 'HEAD');
  const object = path.join(p.repo, '.git', 'objects', B1.slice(0, 2), B1.slice(2));
  fs.chmodSync(object, 0o644); fs.rmSync(object);
  const d = p.trustOf([{ purpose: 'baseline', revision: p.B }, { purpose: 'baseline', revision: B1 }, ...p.evidence(p.C)]).derivation(E);
  assert.equal(d.approved, false); assert.match(d.reasons.join(' '), /git|history/);
});

test('working-tree diagnostics refuse clean filters, and a trusted ci refuses a working-tree candidate before reading it', t => {
  const p = round(t);
  const marker = path.join(p.temp, 'filtered');
  p.git('config', 'filter.x.clean', `touch '${marker}'; cat`);
  fs.writeFileSync(path.join(p.repo, '.git', 'info', 'attributes'), '* filter=x\n');
  p.write('src/a.js', 'export const result = 3;\n');
  p.receipts([{ purpose: 'baseline', revision: p.B }]);
  const ci = spawnSync(process.execPath, [cli, 'ci', '--repo', p.repo, '--baseline', p.B, '--task', 'T-0001', '--trust-key', path.join(p.temp, 'owner.pem'), '--receipts', path.join(p.temp, 'receipts.json'), '--repository', repository], { encoding: 'utf8' });
  assert.equal(ci.status, 2); assert.match(ci.stderr, /committed candidate/);
  const paths = spawnSync(process.execPath, [cli, 'paths', '--repo', p.repo, '--baseline', p.B], { encoding: 'utf8' });
  assert.equal(paths.status, 2); assert.match(paths.stderr, /filters/);
  assert.equal(fs.existsSync(marker), false, 'no filter ran');
});

test('hostile log settings cannot hide where a record first appeared', t => {
  const p = round(t);
  p.git('config', 'log.showRoot', 'false'); p.git('config', 'log.follow', 'true');
  assert.equal(gitSource(p.repo, p.B).versions(taskPath).length, 2, 'the root commit that added it counts');
});

test('the safe environment blocks transports, keeps the operator\'s own config and handles a bare mirror', t => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '*', USERPROFILE: 'C:\\Users\\o', OWNER_SIGNING_KEY: '/secret' });
    const env = safeEnv('/x');
    assert.equal(env.GIT_ALLOW_PROTOCOL, 'none');
    assert.equal(env.GIT_CONFIG_KEY_0, 'safe.directory');
    assert.equal(env[`GIT_CONFIG_KEY_${Number(env.GIT_CONFIG_COUNT) - 1}`], 'advice.graftFileDeprecated');
    assert.equal(env.USERPROFILE, 'C:\\Users\\o'); assert.equal(env.OWNER_SIGNING_KEY, undefined);
  } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
  const p = round(t);
  const mirror = verifiedMirror(p.repo);
  try {
    assert.deepEqual(repoLayout(mirror.path), { root: mirror.path, bare: true });
    assert.equal(gitSource(mirror.path, p.D).read('src/a.js'), 'export const result = 1;\n');
  } finally { mirror.cleanup(); }
  assert.equal(showPath('a\\b`c'), 'a\\u{5c}b\\u{60}c');
  assert.equal(unsafePath('blank\u2800name'), true);
});

test('operator settings that are theirs keep working: safe.bareRepository=explicit and a global git-lfs filter', t => {
  const p = round(t);
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  const global = path.join(p.temp, 'gitconfig');
  fs.writeFileSync(global, '[safe]\n\tbareRepository = explicit\n[filter "lfs"]\n\tclean = git-lfs clean -- %f\n\tprocess = git-lfs filter-process\n');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: global };
  const args = ['closeout', '--repo', p.repo, '--baseline', p.B, '--candidate', p.D, '--trust-key', path.join(p.temp, 'owner.pem'), '--receipts', path.join(p.temp, 'receipts.json'), '--repository', repository, '--json'];
  const closeout = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env });
  assert.equal(closeout.status, 0, closeout.stdout + closeout.stderr);
  const paths = spawnSync(process.execPath, [cli, 'paths', '--repo', p.repo, '--baseline', p.B, '--json'], { encoding: 'utf8', env });
  assert.equal(paths.status, 0, paths.stdout + paths.stderr);
});

test('with the clone\'s own smudge filter the printed fast-forward moves the ref without a checkout', t => {
  const p = round(t);
  p.git('checkout', '-q', 'main');
  p.git('config', 'filter.x.smudge', 'cat');
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  const r = p.run(['closeout', '--baseline', p.B, '--candidate', p.D]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.json.fast_forward, /update-ref 'refs\/heads\/main'/);
  assert.ok(r.json.notes.some(n => /without a checkout/.test(n)));
});

test('a round end on no branch is named as such, and a dirty submodule runs none of its filters', t => {
  const p = round(t);
  p.git('checkout', '-q', '--detach', p.D);
  p.write('docs/notes.md', 'loose\n');
  const loose = p.commit('a commit on no branch');
  p.git('checkout', '-q', 'T-0001-work');
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  const r = p.run(['closeout', '--baseline', p.B, '--candidate', loose]);
  assert.equal(r.status, 2); assert.match(r.stderr, /on a branch/);
  // A submodule whose own config names a clean filter, made dirty.
  const sub = path.join(p.temp, 'sub');
  fs.mkdirSync(sub);
  const g = (cwd, ...args) => { const x = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }); assert.equal(x.status, 0, x.stderr); return x.stdout.trim(); };
  g(sub, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(sub, 'f.txt'), 'x\n'); g(sub, 'add', '.'); g(sub, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 's');
  g(p.repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'vendor/sub');
  p.git('commit', '-qm', 'add submodule');
  const withSub = p.git('rev-parse', 'HEAD');
  const marker = path.join(p.temp, 'submodule-filter-ran');
  g(path.join(p.repo, 'vendor/sub'), 'config', 'filter.y.clean', `touch '${marker}'; cat`);
  fs.writeFileSync(path.join(p.repo, '.git', 'modules', 'vendor', 'sub', 'info', 'attributes'), '* filter=y\n');
  fs.writeFileSync(path.join(p.repo, 'vendor/sub/f.txt'), 'y\n'); // same size: Git must hash it, through the filter
  const paths = spawnSync(process.execPath, [cli, 'paths', '--repo', p.repo, '--baseline', withSub, '--json'], { encoding: 'utf8' });
  assert.equal(paths.status, 0, paths.stdout + paths.stderr);
  assert.equal(fs.existsSync(marker), false, 'the submodule filter must not run');
});

test('a stop signal to the wf process still stops it while it reads the verified mirror', t => {
  const p = round(t);
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  const child = spawnSync(process.execPath, ['-e', `const { spawn } = require('child_process'); const c = spawn(process.execPath, ${JSON.stringify([cli, 'closeout', '--repo', p.repo, '--baseline', p.B, '--candidate', p.D, '--trust-key', path.join(p.temp, 'owner.pem'), '--receipts', path.join(p.temp, 'receipts.json'), '--repository', repository, '--json'])}, { stdio: 'ignore' }); setTimeout(() => c.kill('SIGTERM'), 300); c.on('exit', (code, signal) => process.stdout.write(String(signal ?? code)));`], { encoding: 'utf8' });
  assert.equal(child.stdout, 'SIGTERM', 'Node\'s default termination stays in place');
});

// MAINT-0012: task records ride along without a receipt, but which scenarios with a mapped test wait for which tasks is
// the owner's.
test('a derived baseline refuses records that make a mapped scenario wait for a task it did not wait for', t => {
  const p = round(t, { mapped: true, ownerTests: true });
  p.write('docs/workflow/tasks/T-0002.md', fs.readFileSync(path.join(p.repo, 'docs/workflow/tasks/T-0001.md'), 'utf8').replaceAll('T-0001', 'T-0002').replace('status: Done', 'status: Draft'));
  const E = p.commit('plan a follow-up on AC-001-1');
  const trust = p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  assert.equal(trust.derivation(p.D).approved, true, 'marking the task Done, with its test run in the round, still derives');
  const d = trust.derivation(E);
  assert.equal(d.approved, false);
  assert.match(d.reasons.join(' '), /records make acceptance scenarios wait for tasks they did not wait for at the approved baseline \(AC-001-1 for T-0002\); only an explicit baseline receipt approves that/);
  // With the milestone's own record changed in the round, under the owner's governing-change, it derives (R3-4).
  p.edit('docs/workflow/milestones/M-0001.md', x => `${x}\nT-0002 follows up on AC-001-1.\n`);
  const F = p.commit('the milestone records the follow-up');
  const covered = p.trustOf([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C), { purpose: 'governing-change', revision: F, paths: ['docs/workflow/milestones/M-0001.md'] }]).derivation(F);
  assert.equal(covered.approved, true, JSON.stringify(covered.reasons));
  // The same follow-up on a scenario with no test is bookkeeping, as before.
  const q = round(t, { ownerTests: true });
  q.write('docs/workflow/tasks/T-0002.md', fs.readFileSync(path.join(q.repo, 'docs/workflow/tasks/T-0001.md'), 'utf8').replaceAll('T-0001', 'T-0002').replace('status: Done', 'status: Draft'));
  const G = q.commit('plan a follow-up on unmapped AC-001-1');
  assert.equal(q.trustOf([{ purpose: 'baseline', revision: q.B }, ...q.evidence(q.C)]).derivation(G).approved, true);
});

test('a derived baseline refuses a records-only round that completes a mapped scenario without a test run', t => {
  const p = round(t, { mapped: true, ownerTests: true });
  p.write('docs/workflow/tasks/T-0002.md', fs.readFileSync(path.join(p.repo, 'docs/workflow/tasks/T-0001.md'), 'utf8').replaceAll('T-0001', 'T-0002').replace('status: Done', 'status: Active'));
  const E1 = p.commit('T-0002 serves AC-001-1 too');
  p.edit('docs/workflow/tasks/T-0002.md', x => x.replace('status: Active', 'status: Done'));
  const E2 = p.commit('T-0002 Done, with no test run');
  const d = p.trustOf([{ purpose: 'baseline', revision: E1 }]).derivation(E2);
  assert.equal(d.approved, false);
  assert.match(d.reasons.join(' '), /records complete acceptance scenarios without a test run \(AC-001-1\); only an explicit baseline receipt approves that/);
});

// MAINT-0012: wf acceptance (and lifecycle) name a pending test that did not pass, as ci does; a missing one fails.
test('wf acceptance lets another task\'s pending test fail and names it', t => {
  const p = round(t, { mapped: true, ownerTests: true });
  p.git('checkout', '-q', 'main');
  p.edit('docs/workflow/acceptance.json', x => { const a = JSON.parse(x); a.examples.push({ id: 'AC-001-2', requirement: 'docs/specs/feature.md', method: 'automated' }); return JSON.stringify(a); });
  p.edit('docs/workflow/milestones/M-0001.md', x => x.replace('acceptance: [AC-001-1]', 'acceptance: [AC-001-1, AC-001-2]'));
  p.write('docs/workflow/tasks/T-0002.md', fs.readFileSync(path.join(p.repo, 'docs/workflow/tasks/T-0001.md'), 'utf8').replaceAll('T-0001', 'T-0002').replace('acceptance: [AC-001-1]', 'acceptance: [AC-001-2]'));
  p.edit('tests/acceptance-map.json', x => JSON.stringify([...JSON.parse(x), { acceptance: 'AC-001-2', file: 'tests/later.js', name: 'later scenario' }]));
  p.write('tests/later.js', 'later test file\n');
  const B2 = p.commit('authorise the second scenario');
  p.git('checkout', '-q', '-b', 'T-0001-again');
  p.write('src/a.js', 'export const result = 2;\n');
  const C2 = p.commit('T-0001: candidate');
  const verification = later => ({ ...p.evidence(C2)[0], execution: { revision: C2, tests: [{ file: 'tests/feature.js', name: 'required scenario', status: 'passed' }, ...(later ? [{ file: 'tests/later.js', name: 'later scenario', status: later }] : [])] } });
  p.receipts([{ purpose: 'baseline', revision: B2 }, verification('failed')]);
  const r = p.run(['acceptance', '--baseline', B2, '--candidate', C2, '--task', 'T-0001']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.json.notes, ['pending acceptance test tests/later.js / later scenario (AC-001-2) failed; it may fail until T-0002 is Done, and must pass from then on']);
  const life = p.run(['lifecycle', '--baseline', B2, '--candidate', C2, '--task', 'T-0001']);
  assert.deepEqual(life.json.notes, r.json.notes, 'lifecycle names it too');
  p.receipts([{ purpose: 'baseline', revision: B2 }, verification(null)]);
  const missing = p.run(['acceptance', '--baseline', B2, '--candidate', C2, '--task', 'T-0001']);
  assert.equal(missing.status, 1, missing.stdout);
  assert.match(missing.json.errors.join(' '), /pending test did not run exactly once: tests\/later\.js \/ later scenario/);
});

// R3-2, R3-5: a milestone round whose first task's evidence has a pending test failing. Closeout gates each task as ci
// does, but no derived baseline rests on failing evidence, so the brief asks for the baseline payload closeout needs.
test('a milestone round with a pending failure closes once the baseline it needs is signed, and the brief asks for it', t => {
  const p = round(t, { mapped: true, ownerTests: true });
  p.git('checkout', '-q', 'main');
  p.edit('docs/workflow/acceptance.json', x => { const a = JSON.parse(x); a.examples.push({ id: 'AC-001-2', requirement: 'docs/specs/feature.md', method: 'automated' }); return JSON.stringify(a); });
  p.edit('docs/workflow/milestones/M-0001.md', x => x.replace('acceptance: [AC-001-1]', 'acceptance: [AC-001-1, AC-001-2]'));
  p.write('docs/workflow/tasks/T-0002.md', fs.readFileSync(path.join(p.repo, taskPath), 'utf8').replaceAll('T-0001', 'T-0002').replace('acceptance: [AC-001-1]', 'acceptance: [AC-001-2]'));
  p.edit('tests/acceptance-map.json', x => JSON.stringify([...JSON.parse(x), { acceptance: 'AC-001-2', file: 'tests/later.js', name: 'later scenario' }]));
  p.write('tests/later.js', 'later test file\n');
  const B2 = p.commit('authorise the second scenario');
  p.git('checkout', '-q', '-b', 'round');
  for (const id of ['T-0001', 'T-0002']) p.edit(`docs/workflow/tasks/${id}.md`, x => x.replace(/^(start_revision|governing_baseline_revision|baseline_revision):.*$/gm, `$1: ${B2}`));
  p.write('src/a.js', 'export const result = 3;\n');
  const C1 = p.commit('T-0001: candidate');
  p.edit(taskPath, x => x.replace('status: Ready', 'status: Done').replace(/^implemented:.*$/m, `implemented: ${C1}`));
  const D1 = p.commit('T-0001: record done');
  p.edit('docs/workflow/tasks/T-0002.md', x => x.replace(/^(start_revision|governing_baseline_revision|baseline_revision):.*$/gm, `$1: ${D1}`));
  p.write('src/b.js', 'export const b = 2;\n');
  const C2 = p.commit('T-0002: candidate');
  p.edit('docs/workflow/tasks/T-0002.md', x => x.replace('status: Ready', 'status: Done').replace(/^implemented:.*$/m, `implemented: ${C2}`));
  const D2 = p.commit('T-0002: record done');
  const run = (rev, later) => [{ ...p.evidence(rev)[0], execution: { revision: rev, tests: [{ file: 'tests/feature.js', name: 'required scenario', status: 'passed' }, { file: 'tests/later.js', name: 'later scenario', status: later }] } }, ...p.evidence(rev).slice(1)];
  const round1 = [{ purpose: 'baseline', revision: B2 }, ...run(C1, 'failed'), ...run(C2, 'passed')];
  p.git('checkout', '-q', 'main');
  p.receipts(round1);
  const refused = p.run(['closeout', '--baseline', B2, '--candidate', D2]);
  assert.equal(refused.status, 1, 'D1 cannot be derived from evidence with a failing test');
  p.receipts([...round1, { purpose: 'baseline', revision: D1 }]);
  const closed = p.run(['closeout', '--baseline', B2, '--candidate', D2]);
  assert.equal(closed.status, 0, closed.stdout + closed.stderr);
  // The brief lets the pending failure through for judgement and asks for the baseline at D1, until it is in the file.
  const brief = file => spawnSync(process.execPath, [cli, 'brief', '--payloads', file, '--repo', p.repo, '--baseline', B2, '--candidate', D2], { encoding: 'utf8' }).stdout;
  const without = brief(p.unsigned(round1.slice(1)));
  assert.match(without, /\*\*Pending acceptance test\*\* at `[0-9a-f]{12}`: `pending acceptance test tests\/later\.js/);
  assert.match(without.split('## Problems')[1] ?? '', new RegExp(`add a baseline payload at ${D1.slice(0, 12)}`));
  const withIt = brief(p.unsigned([...round1.slice(1), { purpose: 'baseline', revision: D1 }]));
  assert.doesNotMatch(withIt.split('## Problems')[1] ?? '', /baseline payload at|later scenario/);
});

