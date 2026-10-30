import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The template's database step waits for the server the tests reach: over TCP, not the socket, which the image's
// first-start server also answers before it restarts.
test('the CI template waits for Postgres over TCP', () => {
  const tpl = readFileSync(new URL('../../templates/github/project-ci.yml', import.meta.url), 'utf8');
  const checks = tpl.split('\n').filter(l => /pg_isready/.test(l) && !/^\s*#/.test(l));
  assert.ok(checks.length >= 1, 'the template checks readiness with pg_isready');
  for (const l of checks) assert.match(l, /pg_isready\s+(?:\S+\s+)*-h\s+127\.0\.0\.1\b/, l.trim());
});
