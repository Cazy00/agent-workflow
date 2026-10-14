import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitSource } from '../lib/index.js';
import { acceptanceEvidenceErrors } from '../lib/acceptance-evidence.js';
import { deepChanges } from '../lib/paths.js';

// MAINT-0018: what M-0004 of mateen-systems (12–14 October 2026) showed the workflow still cost: a Done pull request of
// its own after every task, an acceptance that a workflow upgrade would have voided, test files reviewed as deep, and no
// record of which workflow version any of the work ran under.
const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const taskPath = 'docs/workflow/tasks/T-0001.md';
const AREAS = ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'];

function project(t, { configEdit = c => c, baselineEdit = () => {} } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-maint-0018-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'project'); fs.cpSync(fixture, repo, { recursive: true });
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true }); fs.writeFileSync(path.join(repo, p), text); };
  const edit = (p, fn) => write(p, fn(fs.readFileSync(path.join(repo, p), 'utf8')));
  const git = (...args) => { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const commit = message => { git('add', '-A'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Test Worker'); git('config', 'user.email', 'worker@example.invalid');
  edit('docs/workflow/config.json', text => {
    const c = JSON.parse(text);
    c.approval.label = 'owner-merge'; c.approval.mechanism = 'owner-merge'; c.approval.checkpoint = 'milestone'; c.repository = 'fixture/project';
    c.workflow = { repo: 'fixture/agent-workflow', version: 'v2.6.0', revision: 'a'.repeat(40) };
    return JSON.stringify(configEdit(c));
  });
  edit('docs/workflow/profile.md', x => x.replace('approval_label: enforced', 'approval_label: owner-merge'));
  baselineEdit({ edit, write });
  const initial = commit('initial');
  edit(taskPath, x => x.replaceAll('fixture-rev', initial));
  const baseline = commit('authorised baseline');
  const run = (args, { evidence, env = {} } = {}) => {
    const extra = [];
    if (evidence) { const file = path.join(temp, 'evidence.json'); fs.writeFileSync(file, JSON.stringify(evidence)); extra.push('--delivery-evidence', file); }
    const r = spawnSync(process.execPath, [cli, ...args, '--repo', repo, '--json', ...extra], { encoding: 'utf8', env: { ...process.env, ...env } });
    let out = null; try { out = JSON.parse(r.stdout); } catch { /* left null */ }
    return { ...r, out };
  };
  return { temp, repo, write, edit, git, commit, initial, baseline, run };
}
const check = name => ({ name, result: 'passed', reference: `https://github.com/fixture/project/actions/runs/1#${name}` });
function evidence(candidate, reviewed = candidate) {
  return {
    schema: 'agent-workflow/delivery-evidence@1', candidate, assurance: 'agent-attested', tasks: ['T-0001'],
    verification: { revision: reviewed, environment: 'node 22', checks: [check('unit')], execution: { revision: reviewed, tests: [] } },
    integration: { revision: candidate, environment: 'node 22', checks: [check('unit')] },
    review: {
      reviewer: 'independent-reviewer', implementer: 'agent', separate_context: true,
      context: { provider: 'claude-code subagent', context_id: 'ctx-1', inherited_context: false, candidate: reviewed, launch_evidence: 'https://github.com/fixture/project/pull/1#issuecomment-1' },
      coverage: AREAS, findings: [], tasks: ['T-0001'], report: 'https://github.com/fixture/project/pull/1#issuecomment-2',
    },
  };
}

// Item 1. A planned task waits as Draft on the trusted branch and is claimed on its own branch (procedures/execute.md), so
// the trusted branch never held it Ready or Active and its Done record needed a pull request of its own: six in M-0004.
test('MAINT-0018: a Draft task claimed in its own pull request carries its Done record as that pull request\'s last commit', t => {
  const p = project(t, { baselineEdit: q => q.edit(taskPath, x => x.replace('status: Ready', 'status: Draft')) });
  p.edit(taskPath, x => x.replace(`governing_baseline_revision: ${p.initial}`, `governing_baseline_revision: ${p.baseline}`).replace('status: Draft', 'status: Active'));
  p.commit('T-0001: start');
  p.write('src/a.js', 'export const result = 1;\n'); const code = p.commit('T-0001: the work');
  p.edit(taskPath, x => x.replace('status: Active', 'status: Done').replace(/^implemented:.*$/m, `implemented: ${code}`)); const done = p.commit('T-0001: Done');
  const r = p.run(['ci', '--baseline', p.baseline, '--candidate', done, '--task', 'T-0001'], { evidence: evidence(done, code) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.out.merge, 'agent', r.stdout);
});

test('MAINT-0018: a Draft task marked Done without its claim in the pull request still fails, and says what is missing', t => {
  const p = project(t, { baselineEdit: q => q.edit(taskPath, x => x.replace('status: Ready', 'status: Draft')) });
  p.edit(taskPath, x => x.replace(`governing_baseline_revision: ${p.initial}`, `governing_baseline_revision: ${p.baseline}`).replace('status: Draft', 'status: Done'));
  p.write('src/a.js', 'export const result = 1;\n'); const head = p.commit('T-0001: the work, Done');
  const r = p.run(['ci', '--baseline', p.baseline, '--candidate', head, '--task', 'T-0001'], { evidence: evidence(head) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.out.findings.join(' | '), /task status is Done \(T-0001\); production changes need Ready or Active, or Done in the pull request that claims the task/);
});

// Item 2. The acceptance of M-0004 had to merge before the owner's workflow upgrade (#79): merged first, the upgrade's
// workflow files would have followed the accepted revision and voided its review and walk.
function acceptanceRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-maint-0018-acc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  const commit = m => { git('add', '-A'); git('commit', '-qm', m); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  write('src/a.js', 'a\n'); write('.github/workflows/wf-ci.yml', 'v1\n'); write('docs/workflow/config.json', '{"workflow":{"version":"v2.5.0"}}\n'); write('docs/workflow/milestones/M-0001.md', 'status: Active\n');
  commit('main');
  git('checkout', '-q', '-b', 'accept');
  write('src/a.js', 'the milestone\'s code\n'); write('docs/workflow/milestones/M-0001.md', 'status: Verified\n'); const accepted = commit('the code being accepted');
  write('docs/workflow/milestones/M-0001.md', 'status: Accepted\n'); commit('Accept M-0001');
  return { dir, git, write, commit, accepted, at: rev => gitSource(dir, rev) };
}
const accConfig = { paths: { enforcement: ['.github/**', 'docs/workflow/config.json'], production: ['src/**'], governing: ['docs/workflow/milestones/**'], planning: ['docs/**'] } };
function accEvidence(rev) {
  return {
    schema: 'agent-workflow/acceptance-evidence@1', milestone: 'M-0001', candidate: rev,
    review: { reviewer: 'codex exec, fresh context', model: 'gpt-6.1-sol', revision: rev, report: 'https://github.com/o/r/pull/9#issuecomment-1' },
    walkthrough: { revision: rev, environment: 'local build', walker: 'trial-walker subagent', languages: ['en'], viewports: ['1366x900'], steps: [{ step: '1', expected: 'x', observed: 'x', result: 'passed', screenshot: 'https://github.com/o/r/pull/9#step-1' }] },
    deferred: [], tests_changed: [],
  };
}
const accErrors = (r, head, base) => acceptanceEvidenceErrors({ evidence: accEvidence(r.accepted), milestone: 'M-0001', config: accConfig, candidate: r.at(head), baseline: r.at(base), records: { tasks: new Map() } });

test('MAINT-0018: a workflow upgrade merged in from the trusted branch after the accepted revision keeps its review and walk', t => {
  const r = acceptanceRepo(t);
  r.git('checkout', '-q', 'main');
  r.write('.github/workflows/wf-ci.yml', 'v2\n'); r.write('docs/workflow/config.json', '{"workflow":{"version":"v2.5.1"}}\n'); const upgrade = r.commit('the owner\'s workflow upgrade');
  r.git('checkout', '-q', 'accept'); r.git('merge', '-q', '--no-edit', 'main'); const head = r.git('rev-parse', 'HEAD');
  assert.deepEqual(accErrors(r, head, upgrade), []);
});

test('MAINT-0018: the project\'s own code merged in after the accepted revision, or a workflow file the pull request changes itself, still needs a new review and walk', t => {
  const code = acceptanceRepo(t);
  code.git('checkout', '-q', 'main'); code.write('src/b.js', 'another task\'s code\n'); const other = code.commit('another change');
  code.git('checkout', '-q', 'accept'); code.git('merge', '-q', '--no-edit', 'main');
  assert.match(accErrors(code, code.git('rev-parse', 'HEAD'), other).join(' | '), /the accepted candidate [0-9a-f]{12} is followed by changes to src\/b\.js/);

  const own = acceptanceRepo(t);
  own.write('.github/workflows/wf-ci.yml', 'changed by this pull request\n'); const head = own.commit('a workflow edit of its own');
  assert.match(accErrors(own, head, own.git('rev-parse', 'main')).join(' | '), /is followed by changes to \.github\/workflows\/wf-ci\.yml/);
});

// Item 3. mateen-systems names `**/*{invoice,numbering,issuer}*` deep, which also matched
// apps/server/test/acceptance/numbering.ts: a test-only task took three deep second-model reviews.
test('MAINT-0018: a deep path glob reaches test files only when it names a test location itself', () => {
  const globs = ['**/*{invoice,numbering,issuer}*', 'apps/server/migrations/**'];
  assert.deepEqual(deepChanges(globs, ['apps/server/src/numbering.ts', 'apps/server/test/acceptance/numbering.ts', 'apps/web/src/invoice.test.tsx', 'apps/web/__tests__/issuer.ts', 'apps/server/migrations/0017.sql']), ['apps/server/src/numbering.ts', 'apps/server/migrations/0017.sql']);
  assert.deepEqual(deepChanges(['apps/server/test/acceptance/**', '**/*.spec.ts'], ['apps/server/test/acceptance/numbering.ts', 'apps/web/src/x.spec.ts', 'apps/web/src/x.ts']), ['apps/server/test/acceptance/numbering.ts', 'apps/web/src/x.spec.ts']);
  assert.deepEqual(deepChanges(undefined, ['src/a.js']), []);
});
