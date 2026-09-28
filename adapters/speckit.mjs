#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { verifyManagedFiles } from './speckit/installation.mjs';
import { inspectRuntime } from './speckit/runtime.mjs';

export function verifyInstallation({ repo, lock, integration, python }) {
  const files = verifyManagedFiles({ repo, lock, integration });
  const runtime = inspectRuntime(python);
  return { ...files, ok: files.ok && runtime.ok, runtime,
    certified: false, authority: 'local-integrity-only',
    mismatches: [...files.mismatches, ...runtime.mismatches] };
}
export function main(argv) {
  try {
    const [command, ...rest] = argv;
    if (command !== 'check-install') throw new Error('only check-install is implemented; planning commands remain unavailable');
    const options = {};
    for (let i = 0; i < rest.length; i += 2) {
      const key = rest[i];
      if (!['--repo', '--integration', '--lock', '--python'].includes(key) || key in options || !rest[i + 1] || rest[i + 1].startsWith('--'))
        throw new Error(`unknown, duplicate or missing option: ${key}`);
      options[key] = rest[i + 1];
    }
    for (const key of ['--repo', '--integration', '--lock', '--python']) if (!options[key]) throw new Error(`required option: ${key}`);
    const result = verifyInstallation({ repo: options['--repo'], integration: options['--integration'],
      lock: JSON.parse(fs.readFileSync(options['--lock'], 'utf8')), python: options['--python'] });
    return { code: result.ok ? 0 : 1, result };
  } catch (error) { return { code: 2, result: { ok: false, error: error.message } }; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, result } = main(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = code;
}
