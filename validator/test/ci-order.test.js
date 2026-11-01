import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// MAINT-0023 P3: the order that gives one CI cycle per pull request, in every place that tells an agent how to deliver.
const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

test('the delivery text says: a draft pull request, one push, the evidence in the description, then gh pr ready reruns wf ci', () => {
  for (const file of ['procedures/execute.md', 'QUICKSTART.md', 'procedures/approval-evidence.md', 'templates/github/wf-ci.yml']) {
    const text = read(file).replace(/\n# ?/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, /draft/i, file);
    assert.match(text, /gh pr ready/, file);
    assert.match(text, /same head|reruns? (this check|`wf ci`|the check)/, file);
  }
});

test('MAINT-0027: the old order, a failing run on missing evidence and an empty commit as the fallback, is gone', () => {
  for (const file of ['procedures/execute.md', 'QUICKSTART.md', 'procedures/approval-evidence.md', 'procedures/delivery.md', 'templates/github/wf-ci.yml']) {
    const text = read(file).replace(/\n# ?/g, ' ').replace(/\s+/g, ' ');
    assert.doesNotMatch(text, /let its CI finish|an empty commit after the evidence/i, file);
  }
});
