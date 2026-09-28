import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compatibility, verifyManagedFiles } from '../../adapters/speckit/installation.mjs';
import { sha256, writeNew } from '../../adapters/speckit/files.mjs';

function fixture(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-speckit-install-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const files = {
    ...Object.fromEntries(compatibility.managed_paths.map(p => [p, 'synthetic managed content'])),
    '.specify/scripts/python/common.py': 'trusted script',
    '.specify/templates/plan-template.md': 'Codex plan',
    '.agents/skills/speckit-plan/SKILL.md': 'Codex entry',
    '.claude/skills/speckit-plan/SKILL.md': 'Claude entry',
  };
  for (const [p, text] of Object.entries(files)) writeNew(repo, p, text);
  const selector = { version: compatibility.upstream.version, integration_state_schema: 1,
    installed_integrations: ['codex', 'claude'], integration_settings: {
      codex: { script: 'py', invoke_separator: '-' }, claude: { script: 'py', invoke_separator: '-' } },
    integration: 'codex', default_integration: 'codex' };
  writeNew(repo, '.specify/integration.json', JSON.stringify(selector));
  const lock = { schema: 'wf-speckit-lock/v1', upstream: { ...compatibility.upstream,
    distribution_sha256: compatibility.distribution_sha256, dependency_lock_sha256: compatibility.dependency_lock_sha256 },
    adapter: { version: '0.1.0-dev', revision: 'b'.repeat(40) }, core: { revision: 'c'.repeat(40), compatibility_api: 1 },
    preset_id: 'agent-workflow', extension_id: 'agent-workflow', script: 'py', integrations: ['codex', 'claude'],
    feature_root: 'docs/specs', runtime_paths: ['.specify/integration.json'], allowed_overrides: [],
    unsupported_commands: ['analyze', 'checklist', 'converge', 'taskstoissues'],
    managed_files: Object.entries(files).sort(([a],[b]) => a < b ? -1 : 1).map(([p, bytes]) => ({path: p, sha256: sha256(bytes), role: 'materialized'})) };
  const run = () => verifyManagedFiles({ repo, lock, integration: 'codex' });
  const write = (p, bytes) => fs.writeFileSync(path.join(repo, p), bytes);
  return { repo, lock, run, write, selector };
}

test('managed content accepts an intact supported installation', t => {
  assert.equal(fixture(t).run().ok, true);
});
for (const damage of ['script', 'inactive integration', 'missing', 'extra override', 'unknown root file', 'revision', 'dependency lock', 'selector', 'duplicate', 'unsafe', 'symlink']) {
  test(`installation rejects ${damage} without changing project files`, t => {
    const f = fixture(t);
    if (damage === 'script') f.write('.specify/scripts/python/common.py', 'altered');
    if (damage === 'inactive integration') f.write('.claude/skills/speckit-plan/SKILL.md', 'stale');
    if (damage === 'missing') fs.unlinkSync(path.join(f.repo, '.agents/skills/speckit-plan/SKILL.md'));
    if (damage === 'extra override') writeNew(f.repo, '.specify/templates/overrides/plan.md', 'override');
    if (damage === 'unknown root file') writeNew(f.repo, '.specify/unknown.yml', 'unreviewed generator');
    if (damage === 'revision') f.lock.upstream.revision = 'd'.repeat(40);
    if (damage === 'dependency lock') f.lock.upstream.dependency_lock_sha256 = 'd'.repeat(64);
    if (damage === 'selector') f.write('.specify/integration.json', JSON.stringify({...f.selector, integration: 'claude'}));
    if (damage === 'duplicate') f.lock.managed_files.push(f.lock.managed_files[0]);
    if (damage === 'unsafe') f.lock.managed_files[0].path = '../outside';
    if (damage === 'symlink') { fs.unlinkSync(path.join(f.repo, '.specify/scripts/python/common.py')); fs.symlinkSync('/nonexistent', path.join(f.repo, '.specify/scripts/python/common.py')); }
    const before = fs.readFileSync(path.join(f.repo, '.claude/skills/speckit-plan/SKILL.md'));
    assert.equal(f.run().ok, false, damage);
    assert.ok(f.run().mismatches.length, damage);
    assert.deepEqual(fs.readFileSync(path.join(f.repo, '.claude/skills/speckit-plan/SKILL.md')), before);
  });
}

test('only pre-recorded integration-specific materialization hashes are accepted', t => {
  const f = fixture(t), p = '.specify/templates/plan-template.md';
  const entry = f.lock.managed_files.find(x => x.path === p);
  entry.integration_sha256 = { codex: entry.sha256, claude: sha256('Claude plan') };
  f.write(p, 'Claude plan');
  assert.equal(f.run().ok, false);
  f.write('.specify/integration.json', JSON.stringify({...f.selector, integration: 'claude', default_integration: 'claude'}));
  assert.equal(verifyManagedFiles({ repo: f.repo, lock: f.lock, integration: 'claude' }).ok, true);
});

import { applyStagedInstallation } from '../../adapters/speckit/staging.mjs';
import { main } from '../../adapters/speckit.mjs';
function staged(t) {
  const f = fixture(t);
  writeNew(f.repo, 'docs/workflow/speckit.lock.json', JSON.stringify(f.lock));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-speckit-target-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  return { ...f, target };
}
test('collision refusal happens before any target writes and preserves unknown files', t => {
  const f = staged(t);
  writeNew(f.target, '.claude/skills/speckit-plan/SKILL.md', 'user customization');
  assert.throws(() => applyStagedInstallation({ stage: f.repo, repo: f.target }), /collision/);
  assert.equal(fs.existsSync(path.join(f.target, '.specify')), false);
  assert.equal(fs.readFileSync(path.join(f.target, '.claude/skills/speckit-plan/SKILL.md'), 'utf8'), 'user customization');
});
test('interrupted create-only installation resumes from actual bytes without deletion', t => {
  const f = staged(t);
  writeNew(f.target, 'README.md', 'user project');
  assert.throws(() => applyStagedInstallation({ stage: f.repo, repo: f.target, afterWrite: () => { throw new Error('interrupt'); } }), /interrupt/);
  assert.equal(fs.existsSync(path.join(f.target, 'docs/workflow/speckit.lock.json')), false);
  const result = applyStagedInstallation({ stage: f.repo, repo: f.target });
  assert.ok(result.created.length > 0);
  assert.equal(verifyManagedFiles({ repo: f.target, lock: f.lock, integration: 'codex' }).ok, true);
  assert.equal(fs.readFileSync(path.join(f.target, 'README.md'), 'utf8'), 'user project');
  assert.deepEqual(applyStagedInstallation({ stage: f.repo, repo: f.target }).created, []);
});
test('CLI rejects unsupported commands and incomplete or duplicate arguments', () => {
  for (const args of [['implement'], ['check-install'], ['check-install', '--repo', '.','--repo','.'], ['check-install','--bogus','value']])
    assert.equal(main(args).code, 2);
});
