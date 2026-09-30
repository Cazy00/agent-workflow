import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareReview } from '../lib/review-packet.js';
const fixture = fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url));
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo'); fs.cpSync(fixture, repo, { recursive: true });
  const git = (...args) => { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q'); git('config', 'user.name', 'worker'); git('config', 'user.email', 'worker@example.invalid'); git('add', '.'); git('commit', '-qm', 'baseline');
  const baseline = git('rev-parse', 'HEAD');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true }); fs.writeFileSync(path.join(repo, 'src/a.js'), 'export const answer = 42;\n');
  git('add', '.'); git('commit', '-qm', 'T-0001 candidate'); const candidate = git('rev-parse', 'HEAD');
  const evidence = [path.join(root, 'checks.txt')]; fs.writeFileSync(evidence[0], 'Checks observed on ' + candidate);
  const args = { repo, baseline, candidate, tasks: ['T-0001'], evidence };
  return { ...args, git, run: extra => prepareReview({ ...args, ...extra }) };
}
test('packet fixes canonical revisions and explicit empty-context launch, without embedding conversation or evidence bodies', t => {
  const p = setup(t), result = p.run();
  assert.equal(result.authority, 'none');
  assert.equal(result.launch.codex.fork_turns, 'none');
  assert.equal(result.launch.claude_code.resume, false);
  assert.equal(result.candidate, p.candidate);
  assert.ok(result.canonical_sources.some(s => s.path.endsWith('M-0001.md') && s.revision === p.baseline));
  assert.ok(result.canonical_sources.some(s => s.path.endsWith('T-0001.md') && s.revision === p.candidate));
  assert.ok(!JSON.stringify(result).includes('Checks observed on'));
  assert.equal(p.git('status', '--porcelain'), '');
});
test('mutable candidate, untracked changes, wrong HEAD and symbolic revision are refused', t => {
  const p = setup(t);
  assert.throws(() => p.run({ candidate: 'HEAD' }), /exact committed/);
  assert.throws(() => p.run({ candidate: p.baseline }), /HEAD differs/);
  fs.writeFileSync(path.join(p.repo, 'src/a.js'), 'changed during review');
  assert.throws(() => p.run(), /dirty/);
  p.git('checkout', '--', 'src/a.js');
  fs.writeFileSync(path.join(p.repo, 'unexpected.txt'), 'untracked');
  assert.throws(() => p.run(), /dirty/);
});
test('the same packet can be rechecked after review; changing the commit invalidates it', t => {
  const p = setup(t), packet = p.run();
  assert.equal(p.run().candidate_tree, packet.candidate_tree);
  fs.writeFileSync(path.join(p.repo, 'src/a.js'), 'export const answer = 43;\n'); p.git('add', '.'); p.git('commit', '-qm', 'T-0001 fix');
  assert.throws(() => p.run(), /HEAD differs/);
});
test('missing task/evidence is not a useful review packet; evidence cannot live in the candidate tree', t => {
  const p = setup(t);
  assert.throws(() => p.run({ tasks: ['T-9999'] }), /missing/);
  assert.throws(() => p.run({ evidence: [] }), /needs --evidence/);
  assert.throws(() => p.run({ evidence: [path.join(p.repo, 'src/a.js')] }), /outside/);
});
test('review preparation does not execute configured filters or filesystem monitors', t => {
  const p = setup(t), marker = path.join(p.repo, 'executed');
  p.git('config', 'core.fsmonitor', `touch '${marker}'`);
  assert.equal(p.run().candidate, p.candidate);
  p.git('config', 'filter.evil.clean', `touch '${marker}'`);
  assert.throws(() => p.run(), /clean\/process filters/);
  assert.equal(fs.existsSync(marker), false);
});
for (const flag of ['assume-unchanged', 'skip-worktree']) test(`hidden changes under ${flag} invalidate initial and repeated review packets`, t => {
  const p = setup(t);
  const original = p.run();
  p.git('update-index', `--${flag}`, 'src/a.js');
  fs.writeFileSync(path.join(p.repo, 'src/a.js'), 'export const answer = "unreviewed";\n');
  assert.equal(p.git('status', '--porcelain'), '', 'ordinary status hides this change');
  assert.equal(p.git('rev-parse', 'HEAD'), original.candidate);
  assert.throws(() => p.run(), /assume-unchanged or skip-worktree/);
  assert.throws(() => p.run(), /assume-unchanged or skip-worktree/, 'a repeated check must not bless it');
  assert.match(p.git('ls-files', '-v', 'src/a.js'), flag === 'assume-unchanged' ? /^h / : /^S /, 'inspection must not clear the flag');
});
test('custom record directories retain the fixed baseline acceptance definitions; missing definitions fail', t => {
  const p = setup(t);
  fs.mkdirSync(path.join(p.repo, 'records'));
  for (const name of ['profile.md', 'tasks', 'milestones', 'decisions']) fs.renameSync(path.join(p.repo, 'docs/workflow', name), path.join(p.repo, 'records', name));
  const configPath = path.join(p.repo, 'docs/workflow/config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.records_dir = 'records'; fs.writeFileSync(configPath, JSON.stringify(config));
  p.git('add', '.'); p.git('commit', '-qm', 'custom records location');
  const revision = p.git('rev-parse', 'HEAD');
  const packet = p.run({ baseline: revision, candidate: revision });
  assert.ok(packet.canonical_sources.some(s => s.path === 'docs/workflow/acceptance.json' && s.revision === revision));
  assert.ok(packet.canonical_sources.some(s => s.path === 'records/tasks/T-0001.md'));
  p.git('rm', 'docs/workflow/acceptance.json'); p.git('commit', '-qm', 'missing definitions');
  const missing = p.git('rev-parse', 'HEAD');
  assert.throws(() => p.run({ baseline: missing, candidate: missing }), /canonical acceptance source is missing/);
});
