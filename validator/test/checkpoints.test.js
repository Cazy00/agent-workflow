import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource, evaluateCi, gitSource } from '../lib/index.js';
import { createEnforcedTrust } from '../lib/trust.js';
import { evaluateNext } from '../lib/next.js';
import { evaluateStatus } from '../lib/status.js';
import { parseDeliveryEvidence } from '../lib/delivery-evidence.js';

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

// MAINT-0012: acceptance tests are approved before the work, so a scenario's tests fail until the tasks serving it are
// done. While its milestone is in progress and another of its tasks is not Done on the baseline, its mapped test may
// fail; once they are Done, or in the pull request that delivers one, it must run once and pass.
const OWNED = ['tests/acceptance-map.json', 'tests/*.test.js'];
function pendingSetup(t, { milestoneStatus = 'Authorised', milestoneAcceptance = '[AC-001-1, AC-001-2]', otherStatus = 'Ready', change, label = 'owner-merge', configEdit, baselineExtra } = {}) {
  return setup(t, {
    label, checkpoint: label === 'owner-merge' ? 'milestone' : undefined,
    // The project names its acceptance tests, so the owner approves them (pending applies only then).
    configEdit: c => { const d = { ...c, paths: { ...c.paths, acceptance_tests: OWNED } }; return configEdit ? configEdit(d) : d; },
    baselineEdit: q => {
      q.write('tests/a.test.js', 'test("works", () => {});\n');
      q.write('tests/b.test.js', 'test("later", () => {});\n');
      q.write('tests/acceptance-map.json', JSON.stringify([{ acceptance: 'AC-001-1', file: 'tests/a.test.js', name: 'works' }, { acceptance: 'AC-001-2', file: 'tests/b.test.js', name: 'later' }]));
      q.edit('docs/workflow/acceptance.json', x => { const a = JSON.parse(x); a.examples.push({ id: 'AC-001-2', requirement: 'docs/specs/feature.md', method: 'automated' }); return JSON.stringify(a); });
      q.edit('docs/workflow/milestones/M-0001.md', x => x.replace('acceptance: [AC-001-1]', `acceptance: ${milestoneAcceptance}`).replace('status: Authorised', `status: ${milestoneStatus}`));
      q.write('docs/workflow/tasks/T-0002.md', fs.readFileSync(path.join(q.repo, taskPath), 'utf8').replaceAll('T-0001', 'T-0002').replace('acceptance: [AC-001-1]', 'acceptance: [AC-001-2]').replace('status: Ready', `status: ${otherStatus}`));
      baselineExtra?.(q);
    },
    change: change ?? (q => q.write('src/a.js', 'export const result = 1;\n')),
  });
}
const runs = (p, a, b) => evidence(p.candidate, { verification: { execution: { revision: p.candidate, tests: [...(a ? [{ file: 'tests/a.test.js', name: 'works', status: a }] : []), ...(b ? [{ file: 'tests/b.test.js', name: 'later', status: b }] : [])] } } });
const requiredB = /required test did not run exactly once and pass: tests\/b\.test\.js \/ later/;

test('a mapped test whose scenario waits for another task of an in-progress milestone may fail, and is named', t => {
  const p = pendingSetup(t);
  for (const b of ['failed', 'skipped']) {
    const r = p.run('ci', { evidence: runs(p, 'passed', b) });
    assert.equal(r.status, 0, `${b}: ${r.stdout}${r.stderr}`);
    const o = out(r);
    assert.equal(o.merge, 'agent', JSON.stringify(o.owner_reasons));
    assert.ok(o.findings.includes(`note: pending acceptance test tests/b.test.js / later (AC-001-2) ${b}; it may fail until T-0002 is Done, and must pass from then on`), o.findings.join(' | '));
  }
  const missing = p.run('ci', { evidence: runs(p, 'passed', null) });
  assert.equal(missing.status, 1, 'a pending test must still run and be reported');
  assert.match(out(missing).findings.join('\n'), /pending test did not run exactly once: tests\/b\.test\.js \/ later/);
  const own = p.run('ci', { evidence: runs(p, 'failed', 'passed') });
  assert.equal(own.status, 1, 'the scenario this pull request delivers must pass');
  assert.match(out(own).findings.join('\n'), /required test did not run exactly once and pass: tests\/a\.test\.js \/ works/);
});

test('a pending test must pass once its tasks are Done, once its milestone is no longer in progress, or outside every milestone', t => {
  for (const [label, options] of [
    ['the other task is Done on the baseline', { otherStatus: 'Done' }],
    ['the milestone is Verified', { milestoneStatus: 'Verified' }],
    ['the milestone is still a Draft', { milestoneStatus: 'Draft' }],
    ['no milestone lists the scenario', { milestoneAcceptance: '[AC-001-1]' }],
  ]) {
    const p = pendingSetup(t, options);
    const r = p.run('ci', { evidence: runs(p, 'passed', 'failed') });
    assert.match(out(r).findings.join('\n'), requiredB, `${label}: ${r.stdout}${r.stderr}`);
    assert.equal(r.status, 1, label);
  }
});

test('a candidate cannot make its own failing test pending by editing the records in the same pull request', t => {
  for (const [label, change] of [
    ['reopening the other task', q => q.edit('docs/workflow/tasks/T-0002.md', x => x.replace('status: Done', 'status: Ready'))],
    ['adding a task that serves the scenario', q => q.write('docs/workflow/tasks/T-0003.md', fs.readFileSync(path.join(q.repo, 'docs/workflow/tasks/T-0002.md'), 'utf8').replaceAll('T-0002', 'T-0003').replace('status: Done', 'status: Draft'))],
  ]) {
    const p = pendingSetup(t, { otherStatus: 'Done', change: q => { q.write('src/a.js', 'export const result = 1;\n'); change(q); } });
    const r = p.run('ci', { evidence: runs(p, 'passed', 'failed') });
    assert.match(out(r).findings.join('\n'), requiredB, `${label}: ${r.stdout}${r.stderr}`);
    assert.equal(r.status, 1, label);
  }
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

test('a milestone record change goes to the owner even where an older config does not class it as governing', t => {
  // The fixture's config, like v1.0.0's defaults, has no docs/workflow/milestones/** entry among the governing paths.
  const p = setup(t, { checkpoint: 'milestone', change: q => q.edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised', 'status: Accepted')) });
  const r = p.run('ci');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(out(r).merge, 'owner', 'the agent can never accept its own milestone');
  assert.match(out(r).owner_reasons.join(' | '), /records the owner approves: docs\/workflow\/milestones\/M-0001\.md/);
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

// The wf ci workflow's summary step, run as the workflow runs it: who merges and why, every failing reason, and a
// plain line when wf ci printed nothing (exit 2).
test('the wf ci workflow summary names who merges, lists failing reasons and never stays blank', t => {
  const template = fs.readFileSync(fileURLToPath(new URL('../../templates/github/wf-ci.yml', import.meta.url)), 'utf8');
  const script = template.slice(template.indexOf('# Who merges')).match(/node -e '\n([\s\S]*?)\n\s*' "\$RUNNER_TEMP\/ci\.json"/)[1];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-summary-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = result => {
    const file = path.join(dir, 'ci.json'), summary = path.join(dir, 'summary.md');
    fs.writeFileSync(file, result === null ? '' : JSON.stringify(result)); fs.writeFileSync(summary, '');
    const r = spawnSync(process.execPath, ['-e', script, file], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summary } });
    assert.equal(r.status, 0, r.stderr);
    return { out: r.stdout, summary: fs.readFileSync(summary, 'utf8') };
  };
  const owner = run({ verdict: 'pass', findings: [], merge: 'owner', owner_reasons: ['it changes acceptance tests: a\n::warning::x%y'] });
  assert.match(owner.summary, /\*\*Merge:\*\* the owner\./);
  assert.equal(owner.out.trim(), '::notice title=The owner merges this::it changes acceptance tests: a ::warning::x y', 'a path cannot start a workflow command of its own');
  assert.match(run({ verdict: 'pass', findings: [], merge: 'agent', owner_reasons: [] }).summary, /the agent may merge this once every required check has passed/);
  const failed = run({ verdict: 'fail', findings: ['production: src/a.js', 'production path src/a.js must belong to exactly one selected task (found 0)', 'readiness T-0001: Needs discovery or resolution', '  readiness is stale', 'unverified: x', 'note: y'] }).summary;
  assert.match(failed, /- production path src\/a\.js must belong/);
  assert.match(failed, /- readiness is stale/);
  assert.doesNotMatch(failed, /- production: src\/a\.js|unverified: x|note: y/);
  assert.match(run(null).summary, /wf ci could not run/);
});

// The review of MAINT-0012 (R2, R3): records the agent merges by itself must not decide which tests may fail.
const t3 = (q, status = 'Draft', acceptance = '[AC-001-2]') => q.write('docs/workflow/tasks/T-0003.md', fs.readFileSync(path.join(q.repo, 'docs/workflow/tasks/T-0002.md'), 'utf8').replaceAll('T-0002', 'T-0003').replace(/^status: .*$/m, `status: ${status}`).replace(/^acceptance: .*$/m, `acceptance: ${acceptance}`));
test('a records change that makes a scenario wait for a task it did not wait for goes to the owner', t => {
  for (const [label, options, reason] of [
    ['a new task serving a scenario', { change: q => t3(q, 'Draft', '[AC-001-1]') }, 'AC-001-1 for T-0003'],
    ['a planned task given another scenario', { change: q => q.edit('docs/workflow/tasks/T-0002.md', x => x.replace('acceptance: [AC-001-2]', 'acceptance: [AC-001-1, AC-001-2]')) }, 'AC-001-1 for T-0002'],
    ['a follow-up task on a delivered scenario', { otherStatus: 'Done', change: q => t3(q) }, 'AC-001-2 for T-0003'],
    ['reopening a Done task', { otherStatus: 'Done', change: q => q.edit('docs/workflow/tasks/T-0002.md', x => x.replace('status: Done', 'status: Ready')) }, 'AC-001-2 for T-0002'],
  ]) {
    const p = pendingSetup(t, options);
    const r = p.run('ci');
    assert.equal(r.status, 0, `${label}: ${r.stdout}${r.stderr}`);
    assert.equal(out(r).merge, 'owner', label);
    assert.ok(out(r).owner_reasons.includes(`it makes acceptance scenarios wait for tasks they did not wait for, so their mapped tests may fail until then: ${reason}`), `${label}: ${out(r).owner_reasons.join(' | ')}`);
  }
  // A task that serves no scenario of an in-progress milestone, or a status move between open states, changes nothing.
  for (const change of [q => t3(q, 'Draft', '[]'), q => q.edit('docs/workflow/tasks/T-0002.md', x => x.replace('status: Ready', 'status: Active'))]) {
    const p = pendingSetup(t, { change });
    assert.equal(out(p.run('ci')).merge, 'agent');
  }
});

const m9 = q => q.write('docs/workflow/milestones/M-0009.md', fs.readFileSync(path.join(q.repo, 'docs/workflow/milestones/M-0001.md'), 'utf8').replace('id: M-0001', 'id: M-0009').replace(/^acceptance: .*$/m, 'acceptance: []').replace('status: Authorised', 'status: Draft'));
test('enforced mode refuses that change unless it comes with the record of the milestone concerned, which the owner reviews', t => {
  const p = pendingSetup(t, { label: 'enforced', change: q => t3(q, 'Draft', '[AC-001-1]') });
  const r = p.run('ci');
  assert.equal(r.status, 1, r.stdout);
  assert.match(out(r).findings.join('\n'), /it makes acceptance scenarios wait for tasks they did not wait for, so their mapped tests may fail until then \(AC-001-1 for T-0003\): only the owner approves that/);
  const reviewed = pendingSetup(t, { label: 'enforced', change: x => { t3(x, 'Draft', '[AC-001-1]'); x.edit('docs/workflow/milestones/M-0001.md', y => `${y}\nT-0003 serves AC-001-1 too.\n`); } });
  const ok = reviewed.run('ci');
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.doesNotMatch(out(ok).findings.join('\n'), /only the owner approves that/);
  // Another milestone's record does not stand in for the one concerned.
  const unrelated = pendingSetup(t, { label: 'enforced', baselineExtra: m9, change: x => { t3(x, 'Draft', '[AC-001-1]'); x.edit('docs/workflow/milestones/M-0009.md', y => `${y}\nAn unrelated note.\n`); } });
  assert.equal(unrelated.run('ci').status, 1);
});

test('enforced mode refuses a records-only change that completes a scenario, unless the milestone record changes too', t => {
  const done = q => q.edit('docs/workflow/tasks/T-0002.md', x => x.replace('status: Ready', 'status: Done'));
  const p = pendingSetup(t, { label: 'enforced', change: done });
  const r = p.run('ci');
  assert.equal(r.status, 1, r.stdout);
  assert.match(out(r).findings.join('\n'), /it completes acceptance scenarios without a test run \(AC-001-2\): mark the last task Done in the pull request that delivers it/);
  const gone = pendingSetup(t, { label: 'enforced', change: q => fs.rmSync(path.join(q.repo, 'docs/workflow/tasks/T-0002.md')) });
  assert.match(out(gone.run('ci')).findings.join('\n'), /it completes acceptance scenarios without a test run \(AC-001-2\)/, 'deleting the task completes it too');
  const reviewed = pendingSetup(t, { label: 'enforced', change: q => { done(q); q.edit('docs/workflow/milestones/M-0001.md', y => `${y}\nT-0002 is done.\n`); } });
  assert.equal(reviewed.run('ci').status, 0);
});

test('scenarios with no test change nothing: records about them stay bookkeeping', t => {
  // Fixture 04a's AC-001-1 is an inspection scenario with nothing mapped: adding or completing a task on it is merged as
  // before MAINT-0012, in a project that names its acceptance tests.
  for (const [label, change] of [
    ['a follow-up task', q => q.write('docs/workflow/tasks/T-0002.md', fs.readFileSync(path.join(q.repo, taskPath), 'utf8').replaceAll('T-0001', 'T-0002').replace('status: Ready', 'status: Draft'))],
    ['marking the task Done', q => q.edit(taskPath, x => x.replace('status: Ready', 'status: Done'))],
  ]) {
    for (const label2 of ['owner-merge', 'enforced']) {
      const p = setup(t, { label: label2, checkpoint: label2 === 'owner-merge' ? 'milestone' : undefined, change, configEdit: c => ({ ...c, paths: { ...c.paths, acceptance_tests: OWNED } }) });
      const r = p.run('ci');
      assert.equal(r.status, 0, `${label}, ${label2}: ${r.stdout}${r.stderr}`);
      if (label2 === 'owner-merge') assert.equal(out(r).merge, 'agent', `${label}: ${JSON.stringify(out(r).owner_reasons)}`);
      assert.doesNotMatch(out(r).findings.join('\n'), /acceptance scenarios/, label);
    }
  }
});

test('closeout\'s gate also needs the scenario pending on the trusted tip', t => {
  const p = pendingSetup(t);
  const gate = approved => evaluateCi({ baseline: gitSource(p.repo, p.baseline), candidate: gitSource(p.repo, p.candidate), task: 'T-0001', changed: ['src/a.js'], trust: createEnforcedTrust({ baseline: p.baseline, label: 'owner-merge' }), deliveryEvidence: runs(p, 'passed', 'failed'), approved });
  assert.equal(gate(null).verdict, 'pass');
  const milestone = { data: { id: 'M-0001', status: 'Authorised', acceptance: ['AC-001-1', 'AC-001-2'] } };
  const tip = tasks => ({ milestones: new Map([['M-0001', milestone]]), tasks: new Map(tasks.map(t => [t.id, { data: { milestone: 'M-0001', ...t } }])) });
  assert.equal(gate(tip([{ id: 'T-0002', status: 'Ready', acceptance: ['AC-001-2'] }])).verdict, 'pass');
  const r = gate(tip([{ id: 'T-0002', status: 'Done', acceptance: ['AC-001-2'] }]));
  assert.equal(r.verdict, 'fail');
  assert.match(r.findings.join('\n'), requiredB);
});

test('a scenario completed in the pull request, by marking its last task Done, must pass there', t => {
  const p = pendingSetup(t, { change: q => { q.write('src/a.js', 'export const result = 1;\n'); q.edit('docs/workflow/tasks/T-0002.md', x => x.replace('status: Ready', 'status: Done')); } });
  const r = p.run('ci', { evidence: runs(p, 'passed', 'failed') });
  assert.equal(r.status, 1, r.stdout);
  assert.match(out(r).findings.join('\n'), requiredB);
});

test('a records change that completes a scenario without a test run goes to the owner, and says so', t => {
  const p = pendingSetup(t, { change: q => q.edit('docs/workflow/tasks/T-0002.md', x => x.replace('status: Ready', 'status: Done')) });
  const r = p.run('ci');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(out(r).merge, 'owner');
  assert.ok(out(r).owner_reasons.includes('it completes acceptance scenarios without a test run, so their mapped tests must pass from now on: AC-001-2'), out(r).owner_reasons.join(' | '));
});

test('the acceptance tests of an authorised milestone land in a task of their own, failing, and the owner merges them', t => {
  // readiness.md: authorise the milestone first; then one task's pull request adds every scenario's tests. That task
  // serves each scenario with the tasks that implement it, which are still open, so every test is pending.
  const p = setup(t, {
    checkpoint: 'milestone',
    configEdit: c => ({ ...c, paths: { ...c.paths, production: [...c.paths.production, 'tests/**'], acceptance_tests: ['tests/acceptance-map.json', 'tests/acceptance/**'] } }),
    baselineEdit: q => {
      q.edit('docs/workflow/acceptance.json', x => { const a = JSON.parse(x); a.examples.push({ id: 'AC-001-2', requirement: 'docs/specs/feature.md', method: 'automated' }); return JSON.stringify(a); });
      for (const r of ['docs/workflow/milestones/M-0001.md', taskPath]) q.edit(r, x => x.replace('acceptance: [AC-001-1]', 'acceptance: [AC-001-1, AC-001-2]').replace('scope: [src, docs/workflow/tasks]', 'scope: [src, tests, docs/workflow/tasks]'));
      for (const [id, ac] of [['T-0002', 'AC-001-1'], ['T-0003', 'AC-001-2']]) q.write(`docs/workflow/tasks/${id}.md`, fs.readFileSync(path.join(q.repo, taskPath), 'utf8').replaceAll('T-0001', id).replace('acceptance: [AC-001-1, AC-001-2]', `acceptance: [${ac}]`));
    },
    change: q => {
      q.write('tests/acceptance/a.test.js', 'test("works", () => { throw new Error("not yet"); });\n');
      q.write('tests/acceptance/b.test.js', 'test("later", () => { throw new Error("not yet"); });\n');
      q.write('tests/acceptance-map.json', JSON.stringify([{ acceptance: 'AC-001-1', file: 'tests/acceptance/a.test.js', name: 'works' }, { acceptance: 'AC-001-2', file: 'tests/acceptance/b.test.js', name: 'later' }]));
    },
  });
  const tests = [{ file: 'tests/acceptance/a.test.js', name: 'works', status: 'failed' }, { file: 'tests/acceptance/b.test.js', name: 'later', status: 'failed' }];
  const r = p.run('ci', { evidence: evidence(p.candidate, { verification: { execution: { revision: p.candidate, tests } } }) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(out(r).merge, 'owner');
  assert.match(out(r).owner_reasons.join(' | '), /it changes acceptance tests/);
  assert.equal(out(r).findings.filter(f => f.startsWith('note: pending acceptance test')).length, 2);
});

test('wf pending lists the mapped tests that may fail at a candidate, as ci decides it', t => {
  const p = pendingSetup(t);
  const r = p.run('pending');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.trim(), r.stderr);
  assert.deepEqual(out(r).pending, [{ acceptance: 'AC-001-2', file: 'tests/b.test.js', name: 'later', waiting: ['T-0002'] }]);
  assert.deepEqual(out(r).required, [{ acceptance: 'AC-001-1', file: 'tests/a.test.js', name: 'works' }]);
  // Delivering T-0002 instead, its scenario's test must pass and T-0001's may fail. The task can come from the branch
  // name, as in CI.
  const other = spawnSync(process.execPath, [cli, 'pending', '--repo', p.repo, '--baseline', p.baseline, '--candidate', p.candidate, '--branch', 'claude/T-0002-later', '--json'], { encoding: 'utf8' });
  assert.equal(other.status, 0, other.stderr);
  assert.deepEqual(out(other).pending, [{ acceptance: 'AC-001-1', file: 'tests/a.test.js', name: 'works', waiting: ['T-0001'] }]);
  assert.deepEqual(out(other).required, [{ acceptance: 'AC-001-2', file: 'tests/b.test.js', name: 'later' }]);
});

test('wf pending never lists a test that one of its scenarios requires', t => {
  const p = pendingSetup(t, { change: q => { q.write('src/a.js', 'export const result = 1;\n'); } , baselineExtra: q => q.edit('tests/acceptance-map.json', x => JSON.stringify([...JSON.parse(x), { acceptance: 'AC-001-1', file: 'tests/b.test.js', name: 'later' }])) });
  const r = p.run('pending');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(out(r).delivered, 'T-0001');
  assert.deepEqual(out(r).pending, []);
  assert.deepEqual(out(r).required.map(m => `${m.acceptance} ${m.file}`), ['AC-001-1 tests/a.test.js', 'AC-001-2 tests/b.test.js', 'AC-001-1 tests/b.test.js']);
  // As ci: the failing test is required through AC-001-1.
  const gate = p.run('ci', { evidence: runs(p, 'passed', 'failed') });
  assert.equal(gate.status, 1);
});

// The third review of MAINT-0012 (R3-1): an automated scenario counts before its tests are mapped, so a task added while
// it waits for its tests cannot later excuse a failing one.
test('a task added to an automated scenario before its tests are mapped goes to the owner too', t => {
  const automated = c => ({ ...c, paths: { ...c.paths, acceptance_tests: OWNED } });
  const baselineEdit = q => q.edit('docs/workflow/acceptance.json', x => x.replace('inspection', 'automated'));
  const follow = q => q.write('docs/workflow/tasks/T-0002.md', fs.readFileSync(path.join(q.repo, taskPath), 'utf8').replaceAll('T-0001', 'T-0002').replace('status: Ready', 'status: Draft'));
  const p = setup(t, { checkpoint: 'milestone', configEdit: automated, baselineEdit, change: follow });
  const r = p.run('ci');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(out(r).merge, 'owner');
  assert.match(out(r).owner_reasons.join(' | '), /wait for tasks they did not wait for, so their mapped tests may fail until then: AC-001-1 for T-0002/);
  const q = setup(t, { label: 'enforced', configEdit: automated, baselineEdit, change: follow });
  assert.equal(q.run('ci').status, 1);
});

// R3-7: a project that names no owner-approved acceptance tests keeps every mapped test required, as before.
test('without owner-approved acceptance tests nothing is pending', t => {
  const p = pendingSetup(t, { configEdit: c => ({ ...c, paths: { ...c.paths, acceptance_tests: [] } }) });
  const r = p.run('ci', { evidence: runs(p, 'passed', 'failed') });
  assert.equal(r.status, 1, r.stdout);
  assert.match(out(r).findings.join('\n'), requiredB);
  assert.deepEqual(out(p.run('pending')).pending, []);
  const q = pendingSetup(t, { configEdit: c => ({ ...c, paths: { ...c.paths, acceptance_tests: [] } }), change: q2 => t3(q2, 'Draft', '[AC-001-1]') });
  assert.equal(out(q.run('ci')).merge, 'agent', 'its task records stay bookkeeping');
});

