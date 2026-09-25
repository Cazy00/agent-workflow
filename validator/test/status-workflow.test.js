import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// templates/github/wf-status.yml holds a token that can write issues, so its triggers, branch guard and
// permissions are part of the workflow's safety: this workflow must never run candidate code.
const text = fs.readFileSync(fileURLToPath(new URL('../../templates/github/wf-status.yml', import.meta.url)), 'utf8');
const block = key => text.match(new RegExp(`^${key}:\\n((?:[ \\t]+.*\\n)+)`, 'm'))?.[1] ?? '';
const steps = text.split(/^ {6}- /m).slice(1);

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

test('the status workflow keeps expressions out of its scripts and the token away from the validator', () => {
  for (const line of text.split('\n').filter(l => l.includes('${{'))) assert.match(line, /^ {10}(GH_TOKEN|GH_REPO): \$\{\{ github\.(token|repository) \}\}$/);
  const render = steps.filter(s => s.includes('scripts/wf status --baseline'));
  assert.equal(render.length, 1);
  assert.doesNotMatch(render[0], /GH_TOKEN|env:/);
  assert.equal(text.match(/GH_TOKEN/g).length, 1);
});

test('the status workflow fetches the full history that readiness previews check revisions against', () => {
  assert.equal(text.match(/^ {10}fetch-depth: 0\b/gm)?.length, text.match(/actions\/checkout@/g).length);
});
