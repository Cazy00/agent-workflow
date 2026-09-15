import test from 'node:test';
import assert from 'node:assert/strict';
import { matchGlob } from '../lib/index.js';

test('** crosses directories', () => {
  assert.equal(matchGlob('src/**', 'src/a/b.ts'), true);
  assert.equal(matchGlob('src/**', 'docs/a.ts'), false);
});

test('**/ matches zero or more leading directories', () => {
  assert.equal(matchGlob('**/*.sh', 'run.sh'), true);
  assert.equal(matchGlob('**/*.sh', 'docs/x/run.sh'), true);
});

test('* stays within one path segment', () => {
  assert.equal(matchGlob('docs/*.md', 'docs/a.md'), true);
  assert.equal(matchGlob('docs/*.md', 'docs/sub/a.md'), false);
});

test('{a,b} alternation and literal dots', () => {
  assert.equal(matchGlob('**/*.{ts,sh}', 'x/y.sh'), true);
  assert.equal(matchGlob('**/*.{ts,sh}', 'x/y.tsx'), false);
  assert.equal(matchGlob('next.config.*', 'next.config.mjs'), true);
  assert.equal(matchGlob('next.config.*', 'nextXconfig.mjs'), false);
});
