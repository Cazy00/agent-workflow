import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// MAINT-0023 P3: the order that gives one CI cycle per pull request, in every place that tells an agent how to deliver.
const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

test('the delivery text says: push the head, let its CI finish, then write the evidence into the description', () => {
  for (const file of ['procedures/execute.md', 'QUICKSTART.md', 'procedures/approval-evidence.md', 'templates/github/wf-ci.yml']) {
    const text = read(file).replace(/\n# ?/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, /let its CI finish/i, file);
    assert.match(text, /same head/, file);
  }
});

test('the empty commit is only a fallback for a merge route that still counts superseded runs', () => {
  for (const file of ['procedures/execute.md', 'procedures/approval-evidence.md', 'templates/github/wf-ci.yml']) {
    const text = read(file).replace(/\n# ?/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, /still counts superseded runs, (as .*? does )?an empty commit after the evidence remains the fallback/, file);
  }
});
