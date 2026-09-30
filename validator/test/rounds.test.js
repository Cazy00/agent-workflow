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
import { withDerivedBaselines } from '../lib/derived.js';

const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const taskPath = 'docs/workflow/tasks/T-0001.md';
const repository = 'fixture/project';
const REVIEW = ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'];

// main holds the approved baseline B; the task works on its own branch: candidate C (src/a.js) with its receipts, then
// D, the records-only commit that marks T-0001 Done.
function round(t, { derived = true } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-rounds-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'project'); fs.cpSync(fixture, repo, { recursive: true });
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true }); fs.writeFileSync(path.join(repo, p), text); };
  const edit = (p, fn) => write(p, fn(fs.readFileSync(path.join(repo, p), 'utf8')));
  const git = (...args) => { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const commit = message => { git('add', '-A'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Test Worker'); git('config', 'user.email', 'worker@example.invalid');
  edit('docs/workflow/config.json', text => { const c = JSON.parse(text); return JSON.stringify({ ...c, repository, approval: { ...c.approval, ...(derived ? { derived_baselines: true } : {}) } }, null, 2); });
  const initial = commit('initial');
  edit(taskPath, x => x.replaceAll('fixture-rev', initial));
  const B = commit('authorised baseline');
  git('checkout', '-q', '-b', 'T-0001-work');
  edit(taskPath, x => x.replace(`governing_baseline_revision: ${initial}`, `governing_baseline_revision: ${B}`).replace(/^baseline_revision:.*$/m, `baseline_revision: ${B}`));
  write('src/a.js', 'export const result = 1;\n');
  const C = commit('T-0001: candidate');
  edit(taskPath, x => x.replace('status: Ready', 'status: Done').replace(/^implemented:.*$/m, `implemented: ${C}\nverified: ${C}`));
  const D = commit('T-0001: record done');
  const keys = generateKeyPairSync('ed25519');
  const key = path.join(temp, 'owner.pem'); fs.writeFileSync(key, keys.publicKey.export({ type: 'spki', format: 'pem' }));
  const check = { environment: 'isolated', checks: [{ name: 'unit', result: 'passed', evidence: 'evidence/log.txt' }] };
  const evidence = rev => [
    { purpose: 'verification', revision: rev, ...check, execution: { revision: rev, tests: [] } },
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
  assert.deepEqual(d.covered.map(c => [c.path, c.receipt]), [['src/a.js', p.C]]);
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
  assert.match(r.json.fast_forward, new RegExp(`update-ref refs/heads/main ${p.D} ${p.B}$`));
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
  p.edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised', 'status: Accepted'));
  const M = p.commit('close M-0001');
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C)]);
  const unaccepted = p.run(['closeout', '--baseline', p.B, '--candidate', M]);
  assert.equal(unaccepted.status, 1); assert.ok(unaccepted.json.steps.some(s => !s.ok && /M-0001 acceptance/.test(s.name)));
  p.receipts([{ purpose: 'baseline', revision: p.B }, ...p.evidence(p.C), { purpose: 'acceptance', revision: p.C, decision: 'accepted', scenarios: ['AC-001-1'] }]);
  const accepted = p.run(['closeout', '--baseline', p.B, '--candidate', M]);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
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
  assert.match(r.stdout, /Accepted, not fixed.*R-1/);
  assert.match(r.stdout, /Protected paths.*docs\/specs\/feature\.md/);
  assert.match(r.stdout, /T-0001 Ready → Done/);
  assert.ok(!r.stdout.includes('<script>'), 'payload text cannot open HTML');
  assert.ok(r.stdout.includes('kept \\| &lt;script>'));
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
  assert.match(r.stdout, /Check not passed/);
  const json = JSON.parse(spawnSync(process.execPath, [cli, 'brief', '--payloads', p.file('bad.json', bad), '--json'], { encoding: 'utf8' }).stdout);
  assert.equal(json.ok, false); assert.equal(json.count, 4);
});
