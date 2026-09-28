import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compatibility } from './installation.mjs';
import { digest } from './files.mjs';

// Inspect metadata and bytes without importing specify_cli or executing .pth files.
const INSPECT = String.raw`
import hashlib, importlib.metadata, json, pathlib, sys
venv = pathlib.Path(sys.executable).parent.parent
if not (venv / 'pyvenv.cfg').is_file(): raise RuntimeError('isolated Python virtual environment required')
site = venv / 'lib' / ('python%d.%d' % sys.version_info[:2]) / 'site-packages'
root = site / 'specify_cli'
files = []
for p in sorted(root.rglob('*')):
    if p.is_symlink(): raise RuntimeError('symlink in runtime package: ' + str(p.relative_to(site)))
    if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc':
        files.append({'path': p.relative_to(site).as_posix(), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()})
norm = lambda n: n.lower().replace('_','-').replace('.','-')
versions = {}
for d in importlib.metadata.distributions(path=[str(site)]):
    name = norm(d.metadata['Name'])
    if name in versions: raise RuntimeError('duplicate runtime distribution: ' + name)
    versions[name] = d.version
print(json.dumps({'python': list(sys.version_info[:3]), 'platform': sys.platform, 'versions': versions, 'files': files}))
`;
export function cleanEnvironment() {
  return Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
}
export function inspectRuntime(python) {
  const mismatches = [];
  if (!python || !path.isAbsolute(python) || !fs.existsSync(python)) return { ok: false, mismatches: ['explicit isolated Python executable required'] };
  const run = spawnSync(python, ['-I', '-S', '-c', INSPECT], { encoding: 'utf8', env: cleanEnvironment(), timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  if (run.error || run.status !== 0) return { ok: false, mismatches: [`runtime inspection failed: ${run.error?.message ?? run.stderr.trim()}`] };
  try {
    const state = JSON.parse(run.stdout);
    if (state.python[0] !== 3 || state.python[1] < 11) mismatches.push('Python 3.11+ required');
    if (!compatibility.hosts.includes(state.platform)) mismatches.push('unsupported runtime platform');
    if (state.versions['specify-cli'] !== compatibility.upstream.version) mismatches.push('runtime Spec Kit version differs');
    for (const [name, version] of Object.entries(compatibility.dependencies))
      if (state.versions[name] !== version) mismatches.push(`runtime dependency differs: ${name}`);
    if (digest(state.files) !== digest(compatibility.packaged_assets)) mismatches.push('runtime packaged assets differ from the pinned inventory');
    return { ok: mismatches.length === 0, python: state.python, package_digest: digest(state.files), mismatches };
  } catch (e) { return { ok: false, mismatches: [`invalid runtime inspection: ${e.message}`] }; }
}
