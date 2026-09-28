import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compatibility, verifyManagedFiles } from '../../adapters/speckit/installation.mjs';
import { stageInstallation } from '../../adapters/speckit/staging.mjs';
import { sha256 } from '../../adapters/speckit/files.mjs';
import { verifyInstallation } from '../../adapters/speckit.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const live = process.env.WF_SPECKIT_UPSTREAM === '1';
if (!live && (process.env.WF_SPECKIT_UPSTREAM || process.env.WF_SPECKIT_SOURCE || process.env.WF_SPECKIT_EXECUTABLE))
  throw new Error('live lane variables require WF_SPECKIT_UPSTREAM=1');

test('preset and extension advertise only shipped bounded entries and exact upstream pin', () => {
  for (const kind of ['preset', 'extension']) {
    const packageRoot = path.join(root, 'integrations/speckit', kind);
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, `${kind}.yml`)));
    assert.equal(manifest.requires.speckit_version, `==${compatibility.upstream.version}`);
    assert.equal(manifest[kind].id, 'agent-workflow');
    assert.equal(manifest.hooks, undefined);
    for (const entry of manifest.provides.templates ?? manifest.provides.commands) {
      assert.ok(!entry.file.includes('..') && !path.isAbsolute(entry.file));
      const text = fs.readFileSync(path.join(packageRoot, entry.file), 'utf8');
      assert.ok(text.trim().length > 20, entry.file);
      if (entry.type === 'command') assert.match(text, /Stop:/);
    }
  }
});
test('compatibility inventories are complete sorted distinct paths and fixed hashes', () => {
  assert.equal(compatibility.certified, false);
  assert.ok(compatibility.packaged_assets.length > 0);
  const paths = compatibility.packaged_assets.map(f => f.path);
  assert.deepEqual(paths, [...new Set(paths)].sort());
  assert.deepEqual(compatibility.managed_paths, [...new Set(compatibility.managed_paths)].sort());
  for (const f of compatibility.packaged_assets) assert.match(f.sha256, /^[a-f0-9]{64}$/);
  assert.equal(sha256(fs.readFileSync(path.join(root, 'integrations/speckit/python-requirements.lock'))), compatibility.dependency_lock_sha256);
});

if (live) {
  test('real pinned package stages both integrations, blocks tampering and preserves stop entries', t => {
    const source = process.env.WF_SPECKIT_SOURCE, executable = process.env.WF_SPECKIT_EXECUTABLE;
    assert.ok(source && executable, 'source checkout and isolated executable required in live lane');
    assert.ok(path.isAbsolute(source) && path.isAbsolute(executable), 'absolute live paths required');
    const revision = spawnSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    assert.equal(revision.status, 0, revision.stderr);
    assert.equal(revision.stdout.trim(), compatibility.upstream.revision);
    assert.equal(spawnSync('git', ['-C', source, 'diff', '--quiet', 'HEAD']).status, 0, 'upstream source must be unchanged');
    for (const file of compatibility.packaged_assets) {
      const rel = file.path.startsWith('specify_cli/core_pack/') ? file.path.slice('specify_cli/core_pack/'.length) : `src/${file.path}`;
      assert.equal(sha256(fs.readFileSync(path.join(source, rel))), file.sha256, rel);
    }
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-speckit-live-'));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const python = path.join(path.dirname(executable), 'python');
    const ownRevision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    assert.equal(ownRevision.status, 0, ownRevision.stderr);
    const staged = stageInstallation({ directory: path.join(temp, 'stage'), python, coreRevision: ownRevision.stdout.trim() });
    assert.equal(verifyInstallation({ repo: staged.directory, lock: staged.lock, integration: 'codex', python }).ok, true);
    for (const tool of ['.agents', '.claude']) {
      for (const command of ['specify', 'clarify', 'plan', 'tasks', 'implement', 'constitution'])
        assert.match(fs.readFileSync(path.join(staged.directory, tool, 'skills', `speckit-${command}`, 'SKILL.md'), 'utf8'), /Stop:.*incomplete/);
    }
    assert.match(fs.readFileSync(path.join(staged.directory, '.specify/memory/constitution.md'), 'utf8'), /not an independent constitution/);
    fs.appendFileSync(path.join(staged.directory, '.claude/skills/speckit-plan/SKILL.md'), '\nTampered inactive entry.');
    const damaged = verifyManagedFiles({ repo: staged.directory, lock: staged.lock, integration: 'codex' });
    assert.equal(damaged.ok, false);
    assert.ok(damaged.mismatches.some(m => m.includes('.claude/skills/speckit-plan/SKILL.md')));
  });
}
