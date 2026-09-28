import fs from 'node:fs';
import { read, inventory, digest, sha256 } from './files.mjs';
import { renderAuthorityPointer } from './authority.mjs';

export const compatibility = JSON.parse(fs.readFileSync(new URL('../../integrations/speckit/compatibility.json', import.meta.url)));
const HEX = /^[a-f0-9]{64}$/;
const REV = /^[a-f0-9]{40}$/;
const SELECTOR = '.specify/integration.json';
export const managedPath = p => p.startsWith('.specify/') || /^\.(agents|claude)\/skills\/speckit-[^/]+\//.test(p);
export function managedInventory(repo) {
  return ['.specify', '.agents/skills', '.claude/skills'].flatMap(p => inventory(repo, p)).filter(managedPath).sort();
}

// Local content integrity only. Approval still comes from the adopted workflow.
export function verifyManagedFiles({ repo, lock, integration }) {
  const mismatches = [];
  const require = (condition, message) => { if (!condition) mismatches.push(message); };
  const equal = (a, b) => digest(a) === digest(b);
  try {
    require(compatibility.integrations.includes(integration), 'explicit supported integration required');
    require(lock?.schema === 'wf-speckit-lock/v1', 'unsupported lock schema');
    require(lock?.upstream?.version === compatibility.upstream.version && lock?.upstream?.revision === compatibility.upstream.revision, 'unsupported upstream pin');
    require(lock?.upstream?.distribution_sha256 === compatibility.distribution_sha256, 'unsupported distribution digest');
    require(lock?.upstream?.dependency_lock_sha256 === compatibility.dependency_lock_sha256, 'unsupported dependency lock digest');
    require(REV.test(lock?.adapter?.revision) && typeof lock?.adapter?.version === 'string' && lock.adapter.version.length > 0, 'invalid adapter pin');
    require(REV.test(lock?.core?.revision) && lock?.core?.compatibility_api === 1, 'invalid core pin');
    for (const key of ['preset_id', 'extension_id', 'script', 'feature_root', 'integrations', 'allowed_overrides'])
      require(equal(lock?.[key] ?? null, compatibility[key]), `unsupported ${key}`);
    require(equal(lock?.runtime_paths ?? null, [SELECTOR]), 'unsupported runtime paths');
    require(equal(lock?.unsupported_commands ?? null, ['analyze', 'checklist', 'converge', 'taskstoissues']), 'unsupported command contract');
    if (mismatches.length) return { ok: false, mismatches };
    require(lock.authority?.core_revision === lock.core.revision, 'authority/core revisions differ');
    require(read(repo, '.specify/memory/constitution.md').toString('utf8') === renderAuthorityPointer(lock.authority), 'authority pointer differs from locked source bindings');
    const selector = JSON.parse(read(repo, SELECTOR));
    const expected = { version: compatibility.upstream.version, integration_state_schema: 1,
      installed_integrations: ['codex', 'claude'], integration_settings: {
        codex: { script: 'py', invoke_separator: '-' }, claude: { script: 'py', invoke_separator: '-' } },
      integration, default_integration: integration };
    require(equal(selector, expected), `${SELECTOR}: unsupported or conflicting integration selection`);
    require(Array.isArray(lock.managed_files), 'managed_files must be an array');
    if (!Array.isArray(lock.managed_files)) return { ok: false, mismatches };
    const paths = lock.managed_files.map(f => f.path);
    require(equal(paths, compatibility.managed_paths), 'managed_files must match the complete sorted expected inventory without duplicates');
    const actual = managedInventory(repo).filter(p => p !== SELECTOR);
    for (const p of actual) if (!paths.includes(p)) mismatches.push(`unexpected managed file: ${p}`);
    for (const p of paths) if (!actual.includes(p)) mismatches.push(`missing managed file: ${p}`);
    for (const file of lock.managed_files) {
      require(HEX.test(file.sha256) && ['upstream', 'adapter', 'materialized'].includes(file.role), `invalid managed entry: ${file.path}`);
      if (file.integration_sha256 !== undefined) {
        require(equal(Object.keys(file.integration_sha256).sort(), ['claude', 'codex']) &&
          Object.values(file.integration_sha256).every(h => HEX.test(h)) && file.integration_sha256.codex === file.sha256,
        `invalid integration variants: ${file.path}`);
      }
      // Do not read an arbitrary path from a malformed or incomplete lock.
      if (!compatibility.managed_paths.includes(file.path) || !actual.includes(file.path)) continue;
      const expectedHash = file.integration_sha256?.[integration] ?? file.sha256;
      require(sha256(read(repo, file.path)) === expectedHash, `content mismatch: ${file.path}`);
    }
  } catch (error) { mismatches.push(error.message); }
  return { ok: mismatches.length === 0, integration, lock_digest: lock ? digest(lock) : null, mismatches };
}
