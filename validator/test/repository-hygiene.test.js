import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Run evidence (logs, transcripts, session outcomes, handoffs) belongs on GitHub pull
// requests and issues, never in this repository. See POLICY.md section 3.
const RUN_EVIDENCE = [
  /\.(tap|ndjson|log)$/,
  /\.(raw|parsed)\.json$/,
  /\.(stderr|stdout|prompt)\.txt$/,
  /(^|\/)docs\/audit\//,
  /(^|\/)docs\/workflow\/(runs|checkpoints)\//,
  /handoff/i,
  /(^|\/)session\.json$/,
];
const ALLOWED = new Set(['templates/session.json']);

function trackedFiles() {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  try { return execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean); }
  catch { return null; }
}

test('the repository does not commit run evidence', t => {
  const files = trackedFiles();
  if (!files) return t.skip('not a Git checkout');
  const offending = files.filter(f => !ALLOWED.has(f) && RUN_EVIDENCE.some(p => p.test(f)));
  assert.deepEqual(offending, [], 'post run evidence on the GitHub pull request or issue instead');
});
