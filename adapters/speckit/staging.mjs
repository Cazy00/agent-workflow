import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compatibility, managedInventory, verifyManagedFiles } from './installation.mjs';
import { inspectRuntime, cleanEnvironment } from './runtime.mjs';
import { contained, read, inventory, sha256, writeNew } from './files.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SELECTOR = '.specify/integration.json';
const LOCK = compatibility.lock_path;
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env: cleanEnvironment(), encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  return result.stdout.trim();
}
const snapshot = root => Object.fromEntries(managedInventory(root).filter(p => p !== SELECTOR).map(p => [p, sha256(read(root, p))]));

// Only a fresh scratch directory. Never run upstream's overwrite/update commands
// against a consumer. This function neither approves nor adopts the result.
export function stageInstallation({ directory, python, coreRevision }) {
  if (!path.isAbsolute(directory) || fs.existsSync(directory)) throw new Error('stage directory must be an absent absolute path');
  if (!/^[a-f0-9]{40}$/.test(coreRevision)) throw new Error('exact core revision required');
  const runtime = inspectRuntime(python);
  if (!runtime.ok) throw new Error(runtime.mismatches.join('; '));
  const adapterRevision = run('git', ['rev-parse', 'HEAD'], ROOT);
  if (run('git', ['status', '--porcelain', '--untracked-files=all'], ROOT)) throw new Error('commit the adapter candidate before staging');
  fs.mkdirSync(directory, { recursive: true });
  const launch = "import pathlib,sys; sys.path.insert(0,str(pathlib.Path(sys.executable).parent.parent/'lib'/('python%d.%d'%sys.version_info[:2])/'site-packages')); from specify_cli import main; main()";
  const specify = (...args) => run(python, ['-I', '-S', '-c', launch, ...args], directory);
  specify('init', '--here', '--non-interactive', '--integration', 'codex', '--script', 'py', '--ignore-agent-tools');
  specify('preset', 'add', '--dev', path.join(ROOT, 'integrations/speckit/preset'));
  specify('extension', 'add', '--dev', path.join(ROOT, 'integrations/speckit/extension'));
  specify('integration', 'install', 'claude', '--script', 'py');
  // Prime both registries/materializations, then collect the stable pair.
  specify('integration', 'use', 'claude');
  specify('integration', 'use', 'codex');
  // Keep the memory entry a bounded authority pointer, not the upstream draft
  // constitution. This experimental stage cannot authorise planning commands.
  const pointer = fs.readFileSync(path.join(ROOT, 'integrations/speckit/preset/templates/constitution-template.md'));
  fs.writeFileSync(contained(directory, '.specify/memory/constitution.md'), pointer);
  fs.writeFileSync(contained(directory, '.specify/memory/.constitution-template.json'), JSON.stringify({ sha256: sha256(pointer), source: 'preset:agent-workflow' }, null, 2) + '\n');
  writeNew(directory, '.specify/UPSTREAM-LICENSE', fs.readFileSync(path.join(ROOT, 'integrations/speckit/UPSTREAM-LICENSE')));
  const codex = snapshot(directory);
  specify('integration', 'use', 'claude');
  const claude = snapshot(directory);
  if (JSON.stringify(Object.keys(codex)) !== JSON.stringify(compatibility.managed_paths) ||
      JSON.stringify(Object.keys(claude)) !== JSON.stringify(compatibility.managed_paths)) throw new Error('staged upstream inventory differs from the reviewed contract');
  const managed_files = Object.entries(codex).map(([p, hash]) => ({ path: p, sha256: hash,
    role: p.startsWith('.specify/presets/') || p.startsWith('.specify/extensions/') ? 'adapter' : 'materialized',
    ...(hash !== claude[p] ? { integration_sha256: { codex: hash, claude: claude[p] } } : {}) }));
  const lock = { schema: 'wf-speckit-lock/v1',
    upstream: { ...compatibility.upstream, distribution_sha256: compatibility.distribution_sha256, dependency_lock_sha256: compatibility.dependency_lock_sha256 },
    adapter: { version: '0.1.0-dev', revision: adapterRevision }, core: { revision: coreRevision, compatibility_api: 1 },
    preset_id: 'agent-workflow', extension_id: 'agent-workflow', script: 'py', integrations: ['codex', 'claude'],
    feature_root: 'docs/specs', runtime_paths: [SELECTOR], allowed_overrides: [],
    unsupported_commands: ['analyze', 'checklist', 'converge', 'taskstoissues'], managed_files };
  for (const integration of ['claude', 'codex']) {
    specify('integration', 'use', integration);
    const check = verifyManagedFiles({ repo: directory, lock, integration });
    if (!check.ok) throw new Error(check.mismatches.join('; '));
  }
  const finalRuntime = inspectRuntime(python);
  if (!finalRuntime.ok) throw new Error(finalRuntime.mismatches.join('; '));
  writeNew(directory, LOCK, JSON.stringify(lock, null, 2) + '\n');
  return { directory, lock, runtime: finalRuntime, certified: false };
}

// Collision-first, create-only publication of an already reviewed staged diff.
// On interruption, the stage is the manifest of intended bytes; rerunning only
// completes missing files after rechecking every byte. It never deletes a file.
export function applyStagedInstallation({ stage, repo, afterWrite = () => {} }) {
  const lock = JSON.parse(read(stage, LOCK));
  const selector = JSON.parse(read(stage, SELECTOR));
  const check = verifyManagedFiles({ repo: stage, lock, integration: selector.integration });
  if (!check.ok) throw new Error(`invalid stage: ${check.mismatches.join('; ')}`);
  const files = [...lock.managed_files.map(f => f.path), SELECTOR, LOCK];
  if (inventory(stage).some(p => !files.includes(p))) throw new Error('unexpected staged file');
  for (const p of managedInventory(repo)) if (!files.includes(p)) throw new Error(`unknown target file: ${p}`);
  const pending = [];
  for (const p of files) {
    const target = contained(repo, p), bytes = read(stage, p);
    if (fs.existsSync(target)) {
      if (!fs.statSync(target).isFile() || !fs.readFileSync(target).equals(bytes)) throw new Error(`target collision: ${p}`);
    } else pending.push({ path: p, bytes });
  }
  for (const item of pending) { writeNew(repo, item.path, item.bytes); afterWrite(item.path); }
  return { created: pending.map(p => p.path), unchanged: files.length - pending.length, certified: false };
}
