import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource } from '../lib/index.js';
import { evaluateNext } from '../lib/next.js';
import { evaluateStatus } from '../lib/status.js';
import { parseDeliveryEvidence } from '../lib/github-approval.js';

// MAINT-0010: in the pull-request modes (owner-merge, enforced) the quality gates hold as they do in manual mode: a
// production change needs the agent's delivery evidence for the exact candidate (checks, the tests run, an independent
// review with every finding dealt with), and owner-merge's checkpoint says who merges and when the agent stops.
const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const taskPath = 'docs/workflow/tasks/T-0001.md';
const AREAS = ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'];

function setup(t, { label = 'owner-merge', checkpoint, configEdit = c => c, baselineEdit = () => {}, change = p => p.write('src/a.js', 'export const result = 1;\n') } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-checkpoint-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'project'); fs.cpSync(fixture, repo, { recursive: true });
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true }); fs.writeFileSync(path.join(repo, p), text); };
  const edit = (p, fn) => write(p, fn(fs.readFileSync(path.join(repo, p), 'utf8')));
  const git = (...args) => { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q'); git('config', 'user.name', 'Test Worker'); git('config', 'user.email', 'worker@example.invalid');
  edit('docs/workflow/config.json', text => {
    const c = JSON.parse(text);
    c.approval.label = label; c.approval.mechanism = label === 'enforced' ? 'github-rulesets-codeowners' : label;
    if (checkpoint !== undefined) c.approval.checkpoint = checkpoint;
    c.repository = 'fixture/project';
    return JSON.stringify(configEdit(c));
  });
  edit('docs/workflow/profile.md', x => x.replace('approval_label: enforced', `approval_label: ${label}`));
  const p = { repo, git, edit, write };
  baselineEdit(p);
  git('add', '.'); git('commit', '-qm', 'initial'); const initial = git('rev-parse', 'HEAD');
  edit(taskPath, x => x.replaceAll('fixture-rev', initial));
  git('add', '.'); git('commit', '-qm', 'authorised baseline'); const baseline = git('rev-parse', 'HEAD');
  edit(taskPath, x => x.replace(`governing_baseline_revision: ${initial}`, `governing_baseline_revision: ${baseline}`));
  change(p);
  git('add', '-A'); git('commit', '-qm', 'T-0001: candidate'); const candidate = git('rev-parse', 'HEAD');
  const evidenceFile = path.join(temp, 'evidence.json');
  const run = (cmd, { evidence, raw, args = [] } = {}) => {
    const extra = [];
    if (evidence !== undefined || raw !== undefined) { fs.writeFileSync(evidenceFile, raw ?? JSON.stringify(evidence)); extra.push('--delivery-evidence', evidenceFile); }
    return spawnSync(process.execPath, [cli, cmd, '--repo', repo, '--baseline', baseline, '--candidate', candidate, '--task', 'T-0001', '--json', ...extra, ...args], { encoding: 'utf8' });
  };
  return { ...p, temp, baseline, candidate, run };
}

const check = name => ({ name, result: 'passed', reference: `https://github.com/fixture/project/actions/runs/1#${name}` });
function evidence(candidate, over = {}) {
  const { review = {}, verification = {}, ...rest } = over;
  return {
    schema: 'agent-workflow/delivery-evidence@1', candidate, assurance: 'agent-attested', tasks: ['T-0001'],
    verification: { revision: candidate, environment: 'ubuntu-24.04 node 22', checks: [check('unit')], execution: { revision: candidate, tests: [] }, ...verification },
    integration: { revision: candidate, environment: 'ubuntu-24.04 node 22', checks: [check('unit')] },
    review: {
      reviewer: 'independent-reviewer', implementer: 'agent', separate_context: true,
      context: { provider: 'claude-code subagent', context_id: 'ctx-1', inherited_context: false, candidate, launch_evidence: 'https://github.com/fixture/project/pull/1#issuecomment-1' },
      coverage: AREAS, findings: [{ id: 'F1', severity: 'low', status: 'resolved', resolution: 'fixed in the head commit' }],
      tasks: ['T-0001'], report: 'https://github.com/fixture/project/pull/1#issuecomment-2', ...review,
    },
    ...rest,
  };
}
const out = r => JSON.parse(r.stdout);

test('owner-merge: a production change without delivery evidence fails, and says where the evidence goes', t => {
  const p = setup(t, { checkpoint: 'milestone' });
  const r = p.run('ci');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const o = out(r);
  assert.equal(o.verdict, 'fail');
  assert.ok(o.findings.some(f => /delivery evidence for this candidate is missing/.test(f)), o.findings.join(' | '));
  assert.ok(!o.findings.some(f => f.startsWith('unverified: review:')), 'the gate no longer refers the review to the pull request');
  assert.ok(o.findings.some(f => /pull request description/.test(f)), o.findings.join(' | '));
  assert.equal(o.merge, undefined, 'a failing candidate names no one to merge it');
});

test('owner-merge: complete evidence passes; checkpoint milestone or plan lets the agent merge, change or none leaves it to the owner', t => {
  for (const [checkpoint, merge] of [['milestone', 'agent'], ['plan', 'agent'], ['change', 'owner'], [undefined, 'owner']]) {
    const p = setup(t, { checkpoint });
    const r = p.run('ci', { evidence: evidence(p.candidate) });
    assert.equal(r.status, 0, `${checkpoint}: ${r.stdout}${r.stderr}`);
    const o = out(r);
    assert.equal(o.verdict, 'pass');
    assert.equal(o.merge, merge, `${checkpoint}: ${JSON.stringify(o.owner_reasons)}`);
    if (merge === 'owner') assert.match(o.owner_reasons.join(' | '), /the owner merges every change/);
    else assert.deepEqual(o.owner_reasons, []);
    for (const purpose of ['verification', 'review', 'integration', 'execution']) assert.ok(!o.findings.some(f => f.startsWith(`unverified: ${purpose}:`)), `${purpose} is checked, not referred: ${o.findings.join(' | ')}`);
    assert.ok(o.findings.some(f => /agent-attested delivery evidence/.test(f)), 'the evidence is labelled as the agent\'s own report');
  }
});

test('evidence for another candidate, an unresolved finding or a missing review area fails the gate', t => {
  const p = setup(t, { checkpoint: 'milestone' });
  const other = 'f'.repeat(40);
  for (const [bad, pattern] of [
    [evidence(other), /not for this candidate revision/],
    [evidence(p.candidate, { review: { findings: [{ id: 'F1', severity: 'high', status: 'open' }] } }), /finding "F1"/],
    [evidence(p.candidate, { review: { coverage: AREAS.slice(1) } }), /did not cover scope/],
    [evidence(p.candidate, { review: { reviewer: 'agent' } }), /reviewer must differ/],
    [evidence(p.candidate, { verification: { checks: [{ ...check('unit'), result: 'failed' }] } }), /required check unit did not pass/],
    [evidence(p.candidate, { verification: { execution: undefined } }), /execution evidence is missing/],
  ]) {
    const r = p.run('ci', { evidence: bad });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(out(r).findings.join('\n'), pattern);
  }
});

test('a finding accepted with a resolution passes, but the owner merges it', t => {
  const p = setup(t, { checkpoint: 'plan' });
  const r = p.run('ci', { evidence: evidence(p.candidate, { review: { findings: [{ id: 'F2', severity: 'medium', status: 'accepted', resolution: 'kept: the cost of fixing outweighs the risk' }] } }) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(out(r).merge, 'owner');
  assert.match(out(r).owner_reasons.join(' | '), /accepted rather than fixed: F2/);
});

test('a mapped acceptance test must have run once and passed', t => {
  const p = setup(t, {
    checkpoint: 'milestone',
    baselineEdit: q => { q.write('tests/a.test.js', 'test("works", () => {});\n'); q.write('tests/acceptance-map.json', JSON.stringify([{ acceptance: 'AC-001-1', file: 'tests/a.test.js', name: 'works' }])); },
  });
  const missing = p.run('ci', { evidence: evidence(p.candidate) });
  assert.equal(missing.status, 1, missing.stdout);
  assert.match(out(missing).findings.join('\n'), /required test did not run exactly once and pass: tests\/a\.test\.js \/ works/);
  const ran = p.run('ci', { evidence: evidence(p.candidate, { verification: { execution: { revision: p.candidate, tests: [{ file: 'tests/a.test.js', name: 'works', status: 'passed' }] } } }) });
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
});

test('acceptance tests, the plan or the workflow changing leave the merge to the owner, whatever the checkpoint', t => {
  const acceptance = setup(t, {
    checkpoint: 'plan', configEdit: c => ({ ...c, paths: { ...c.paths, acceptance_tests: ['tests/acceptance-map.json', 'src/acceptance/**'] } }),
    change: q => { q.write('src/a.js', 'export const result = 1;\n'); q.write('src/acceptance/a.test.js', 'test("a", () => {});\n'); },
  });
  const a = acceptance.run('ci', { evidence: evidence(acceptance.candidate) });
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.equal(out(a).merge, 'owner');
  assert.match(out(a).owner_reasons.join(' | '), /acceptance tests: src\/acceptance\/a\.test\.js/);

  const governing = setup(t, { checkpoint: 'plan', change: q => { q.write('src/a.js', 'export const result = 1;\n'); q.edit('docs/specs/feature.md', x => `${x}\nMore.\n`); } });
  const g = governing.run('ci', { evidence: evidence(governing.candidate) });
  assert.equal(g.status, 0, g.stdout + g.stderr);
  assert.equal(out(g).merge, 'owner');
  assert.match(out(g).owner_reasons.join(' | '), /plan or requirements: docs\/specs\/feature\.md/);
});

test('a records-only change needs no evidence, and the agent may merge it under a milestone checkpoint', t => {
  const p = setup(t, { checkpoint: 'milestone', change: q => q.edit(taskPath, x => x.replace('status: Ready', 'status: Active')) });
  const r = p.run('ci');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(out(r).merge, 'agent');
});

test('the checkpoint comes from the baseline: a candidate cannot give itself the merge', t => {
  const p = setup(t, { change: q => { q.write('src/a.js', 'export const result = 1;\n'); q.edit('docs/workflow/config.json', x => { const c = JSON.parse(x); c.approval.checkpoint = 'plan'; return JSON.stringify(c); }); } });
  const r = p.run('ci', { evidence: evidence(p.candidate) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(out(r).merge, 'owner');
  assert.match(out(r).owner_reasons.join(' | '), /the owner merges every change \(checkpoint change\)/);
});

test('enforced mode also requires the evidence, and leaves merging to its code-owner route', t => {
  const p = setup(t, { label: 'enforced' });
  const missing = p.run('ci');
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.match(out(missing).findings.join('\n'), /delivery evidence for this candidate is missing/);
  const ok = p.run('ci', { evidence: evidence(p.candidate) });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(out(ok).merge, undefined);
});

test('the evidence can come as a pull request description: the marker and a fenced JSON block', t => {
  const p = setup(t, { checkpoint: 'milestone' });
  const body = `## Summary\n\nDoes the thing.\n\n<details><summary>Delivery evidence</summary>\n\n<!-- agent-workflow:delivery-evidence@1 -->\n\`\`\`json\n${JSON.stringify(evidence(p.candidate), null, 2)}\n\`\`\`\n\n</details>\n`;
  const r = p.run('ci', { raw: body });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(out(r).merge, 'agent');
  const none = p.run('ci', { raw: '## Summary\n\nNo evidence here.\n' });
  assert.equal(none.status, 1);
  assert.match(out(none).findings.join('\n'), /delivery evidence for this candidate is missing/);
});

test('parseDeliveryEvidence reads JSON, a marked comment or a marked fence, and refuses two blocks', () => {
  const e = { schema: 'agent-workflow/delivery-evidence@1' };
  const marker = '<!-- agent-workflow:delivery-evidence@1 -->';
  assert.deepEqual(parseDeliveryEvidence(JSON.stringify(e)), e);
  assert.deepEqual(parseDeliveryEvidence(`${marker}\n${JSON.stringify(e)}`), e);
  assert.deepEqual(parseDeliveryEvidence(`intro\n${marker}\n\`\`\`json\n${JSON.stringify(e)}\n\`\`\`\nafter`), e);
  assert.equal(parseDeliveryEvidence('no evidence at all'), null);
  assert.equal(parseDeliveryEvidence(''), null);
  assert.throws(() => parseDeliveryEvidence(`${marker}\n\`\`\`json\n{}\n\`\`\`\n${marker}\n\`\`\`json\n{}\n\`\`\``), /more than one/);
  assert.throws(() => parseDeliveryEvidence(`${marker}\n\`\`\`json\n{not json\n\`\`\``), /not valid JSON/);
});

test('approval.checkpoint takes change, milestone or plan, and only with owner-merge approval', t => {
  for (const [label, checkpoint, pattern] of [['owner-merge', 'sometimes', /change, milestone or plan/], ['manual', 'milestone', /only to owner-merge/], ['enforced', 'plan', /only to owner-merge/]]) {
    const p = setup(t, { label, change: q => q.edit('docs/workflow/config.json', x => { const c = JSON.parse(x); c.approval.checkpoint = checkpoint; return JSON.stringify(c); }) });
    const r = spawnSync(process.execPath, [cli, 'records', '--repo', p.repo, '--json'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, `${label}/${checkpoint}`);
    assert.match(r.stdout + r.stderr, pattern);
  }
});

// The milestone hold: with checkpoint change or milestone, work in a later milestone waits until the owner accepts
// the earlier one; with plan, every authorised milestone is open.
function twoMilestones(t, checkpoint, firstStatus = 'Active') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-hold-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(fixture, root, { recursive: true });
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), text); };
  const read = p => fs.readFileSync(path.join(root, p), 'utf8');
  const config = JSON.parse(read('docs/workflow/config.json'));
  config.approval.label = 'owner-merge'; config.approval.mechanism = 'owner-merge';
  if (checkpoint !== undefined) config.approval.checkpoint = checkpoint;
  write('docs/workflow/config.json', JSON.stringify(config));
  write('docs/workflow/profile.md', read('docs/workflow/profile.md').replace('approval_label: enforced', 'approval_label: owner-merge'));
  write('docs/workflow/milestones/M-0001.md', read('docs/workflow/milestones/M-0001.md').replace('status: Authorised', `status: ${firstStatus}\ntasks: [T-0001]`));
  write(taskPath, read(taskPath).replace('status: Ready', 'status: Done'));
  write('docs/workflow/milestones/M-0002.md', read('docs/workflow/milestones/M-0001.md').replace('id: M-0001', 'id: M-0002').replace(`status: ${firstStatus}`, 'status: Authorised').replace('tasks: [T-0001]', 'tasks: [T-0002]'));
  write('docs/workflow/tasks/T-0002.md', read(taskPath).replace('id: T-0001', 'id: T-0002').replace('title: Task T-0001', 'title: Task T-0002').replace('milestone: M-0001', 'milestone: M-0002').replace('status: Done', 'status: Ready'));
  return dirSource(root);
}

test('checkpoint milestone: the next milestone waits for the owner to accept the finished one', t => {
  for (const checkpoint of ['milestone', 'change']) {
    const source = twoMilestones(t, checkpoint);
    const n = evaluateNext({ baseline: source, candidate: source });
    assert.equal(n.next.kind, 'present', `${checkpoint}: ${JSON.stringify(n.next)}`);
    assert.equal(n.next.item, 'M-0001');
    assert.ok(![n.next, ...n.also].some(a => a.item === 'T-0002'), `${checkpoint}: T-0002 is not offered`);
    const held = n.held.find(h => h.task === 'T-0002');
    assert.ok(held, JSON.stringify(n.held));
    assert.match(held.reasons.join(' '), /waits for the owner's acceptance of M-0001/);
  }
  const verified = twoMilestones(t, 'milestone', 'Verified');
  const stop = evaluateNext({ baseline: verified, candidate: verified });
  assert.equal(stop.next.kind, 'stop', JSON.stringify(stop.next));
  assert.ok(stop.owner.some(w => w.kind === 'acceptance' && w.item === 'M-0001'), JSON.stringify(stop.owner));
});

test('checkpoint plan, or none, keeps every authorised milestone open', t => {
  for (const checkpoint of ['plan', undefined]) {
    const source = twoMilestones(t, checkpoint);
    const n = evaluateNext({ baseline: source, candidate: source });
    assert.ok(!n.held.some(h => h.task === 'T-0002'), `${checkpoint}: ${JSON.stringify(n.held)}`);
  }
});

test('the setup counts leave out optional steps, so an owner with nothing to do waits on nothing', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-optional-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(fixture, root, { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/workflow/setup.md'), [
    '# Workflow setup — SETUP-0001', '', '## Owner steps', '', 'Arrangement: one account.', '',
    '### Optional', '', '- [ ] 5. **Protect the main branch.** One command.', '- [ ] **Pin the status issue.**', '',
    '## Agent steps', '', '- [x] 1. **Write the project profile.**', '- [ ] 8. **Test the setup.**', '',
  ].join('\n'));
  const view = evaluateStatus({ baseline: dirSource(root), candidate: dirSource(root) });
  assert.deepEqual(view.setup_open, { owner: 0, agent: 1 });
  assert.ok(!view.waiting.some(w => w.kind === 'setup' && w.owner === 'owner'), JSON.stringify(view.waiting));
});
