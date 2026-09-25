import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// templates/github/wf-status.yml runs with a token that can write issues, so its triggers, branch guard
// and permissions are part of the workflow's safety: candidate code must never run with that token.
const text = fs.readFileSync(fileURLToPath(new URL('../../templates/github/wf-status.yml', import.meta.url)), 'utf8');
const block = key => text.match(new RegExp(`^${key}:\\n((?:[ \\t]+.*\\n)+)`, 'm'))?.[1] ?? '';

test('the status workflow never runs on pull requests and acts only on the trusted branch', () => {
  assert.deepEqual([...block('on').matchAll(/^ {2}(\w+):/gm)].map(m => m[1]), ['push', 'schedule', 'workflow_dispatch']);
  assert.doesNotMatch(text, /pull_request/);
  assert.match(block('on'), /^ {4}branches: \[__TRUSTED_BRANCH__\]$/m);
  assert.match(text, /^ {4}if: github\.ref == 'refs\/heads\/__TRUSTED_BRANCH__'$/m);
});

test('the status workflow may write issues and nothing else, with pinned actions', () => {
  assert.deepEqual(block('permissions').trim().split('\n').map(l => l.trim()).sort(), ['contents: read', 'issues: write', 'pull-requests: read']);
  assert.equal(text.match(/^\s*permissions:/gm).length, 1, 'no job-level permissions');
  const uses = [...text.matchAll(/uses: ([^@\s]+)@(\S+)/g)];
  assert.ok(uses.length > 0);
  for (const [, action, ref] of uses) assert.match(ref, /^[0-9a-f]{40}$/, `${action} is pinned to a full commit hash`);
  assert.equal(text.match(/persist-credentials: false/g)?.length, text.match(/actions\/checkout@/g).length);
});
