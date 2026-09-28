import { verifyManagedFiles } from './installation.mjs';
import { inspectRuntime } from './runtime.mjs';

export function verifyInstallation({ repo, lock, integration, python }) {
  const files = verifyManagedFiles({ repo, lock, integration });
  const runtime = inspectRuntime(python);
  return { ...files, ok: files.ok && runtime.ok, runtime,
    certified: false, authority: 'local-integrity-only',
    mismatches: [...files.mismatches, ...runtime.mismatches] };
}
