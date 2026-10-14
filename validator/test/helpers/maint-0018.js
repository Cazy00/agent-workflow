// Shared by the MAINT-0018 tests: an owner-merge project from fixture 04a, pinned to v2.6.0, run through the CLI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const fixture = fileURLToPath(new URL('../../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
export const cli = fileURLToPath(new URL('../../cli.js', import.meta.url));
export const taskPath = 'docs/workflow/tasks/T-0001.md';
export const AREAS = ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'];

export function project(t, { configEdit = c => c, baselineEdit = () => {} } = {}) {
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
export const check = name => ({ name, result: 'passed', reference: `https://github.com/fixture/project/actions/runs/1#${name}` });
export function evidence(candidate, reviewed = candidate) {
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

