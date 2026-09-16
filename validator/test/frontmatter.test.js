import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontMatter } from '../lib/index.js';

test('parses key: value pairs into strings', () => {
  const r = parseFrontMatter('---\nrecord: task\nid: T-0001\n---\nbody');
  assert.equal(r.data.record, 'task');
  assert.equal(r.data.id, 'T-0001');
});

test('parses [a, b] into a trimmed list and [] into an empty list', () => {
  const r = parseFrontMatter('---\ndecisions: [D-0001, D-0002 ]\nsubset: []\n---\n');
  assert.deepEqual(r.data.decisions, ['D-0001', 'D-0002']);
  assert.deepEqual(r.data.subset, []);
});

test('an empty value is null and comment lines are ignored', () => {
  const r = parseFrontMatter('---\n# comment\nimplemented:\n---\n');
  assert.equal(r.data.implemented, null);
  assert.equal('#' in r.data, false);
});

test('returns the body after the closing delimiter', () => {
  const r = parseFrontMatter('---\nid: T-0001\n---\n# Title\ntext');
  assert.equal(r.body, '# Title\ntext');
});

test('a file without front matter yields null data and the whole text as body', () => {
  const r = parseFrontMatter('# just markdown');
  assert.equal(r.data, null);
  assert.equal(r.body, '# just markdown');
});

test('duplicate authority fields are rejected instead of silently taking the last value', () => {
  const r = parseFrontMatter('---\nstatus: Open\nstatus: Resolved\n---\n');
  assert.match(r.errors.join(' '), /duplicate.*status/);
});
