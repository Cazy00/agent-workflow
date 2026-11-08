import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../lib/ci-lint.js';

// v2.19.1: a run of a draft payload must never cancel a run named `wf ci`. The agent writes the delivery evidence into
// the description (`edited`, draft payload) and runs `gh pr ready` (`ready_for_review`, ready payload) moments apart; with
// one concurrency group for both, a draft run queued second cancelled the `wf ci` run (headless-lightroom PR #120). The
// templates' own `group:` and job `name:` expressions are evaluated here for each event, so the test follows the files.
const root = fileURLToPath(new URL('../..', import.meta.url));
const TEMPLATES = ['templates/github/wf-ci.yml', 'templates/github/channel/wf-ci.yml'];

// Evaluates a GitHub expression string (`text ${{ expr }} text`) against a context, for the operators these templates use.
const evaluate = (template, ctx) => template.replace(/\$\{\{\s*(.+?)\s*\}\}/g, (_, expr) => {
  const js = expr.replace(/github((?:\.[A-Za-z_]+)+)/g, (__, p) => `ctx${p.replace(/\./g, '?.')}`);
  return String(new Function('ctx', `return (${js});`)(ctx));
});
const context = ({ event_name = 'pull_request', action, draft, number = 7, ref = 'refs/pull/7/merge' }) => ({
  event_name, ref, event: event_name === 'pull_request' ? { action, pull_request: { number, draft } } : {},
});
const PR_EVENTS = ['opened', 'synchronize', 'reopened', 'edited', 'ready_for_review', 'converted_to_draft', 'auto_merge_enabled', 'auto_merge_disabled'];

for (const file of TEMPLATES) {
  const y = parseYaml(fs.readFileSync(path.join(root, file), 'utf8'));
  const group = ctx => evaluate(y.concurrency.group, ctx);
  const name = ctx => evaluate(y.jobs.ci.name, ctx);

  test(`${file}: a draft run never shares the group of a run named wf ci`, () => {
    assert.equal(y.concurrency['cancel-in-progress'], true, 'a newer run of the same group still supersedes');
    for (const number of [7, 8]) for (const d of PR_EVENTS) for (const r of PR_EVENTS) {
      const draft = context({ action: d, draft: true, number }), ready = context({ action: r, draft: false, number });
      assert.equal(name(draft), 'wf ci (draft)');
      assert.equal(name(ready), 'wf ci');
      assert.notEqual(group(draft), group(ready), `PR ${number}: ${d} on a draft and ${r} on a ready pull request`);
    }
    // The evidence flow: `edited` on the draft, then `ready_for_review` on the now-ready pull request.
    assert.notEqual(group(context({ action: 'edited', draft: true })), group(context({ action: 'ready_for_review', draft: false })));
    // Every run in a group that is not a draft group is named `wf ci`, and the other way round, for every event and state.
    for (const action of PR_EVENTS) for (const draft of [true, false]) {
      const ctx = context({ action, draft });
      assert.equal(group(ctx).endsWith('-draft'), name(ctx) === 'wf ci (draft)', `${action} draft=${draft}`);
    }
  });

  test(`${file}: ready runs of one pull request supersede each other, and pull requests stay apart`, () => {
    const gates = PR_EVENTS.map(action => group(context({ action, draft: false })));
    assert.equal(new Set(gates).size, 1, 'one group for every run of a ready pull request');
    const drafts = PR_EVENTS.map(action => group(context({ action, draft: true })));
    assert.equal(new Set(drafts).size, 1, 'one group for every run of a draft pull request');
    assert.notEqual(group(context({ action: 'opened', draft: false, number: 7 })), group(context({ action: 'opened', draft: false, number: 8 })));
    assert.notEqual(group(context({ action: 'opened', draft: true, number: 7 })), group(context({ action: 'opened', draft: true, number: 8 })));
  });

  test(`${file}: runs that are not a pull request never share a draft group`, { skip: !y.on.schedule }, () => {
    for (const event_name of ['schedule', 'workflow_dispatch', 'repository_dispatch']) {
      const g = group(context({ event_name, ref: 'refs/heads/main' }));
      assert.ok(g.endsWith('-gate'), event_name);
      assert.notEqual(g, group(context({ action: 'edited', draft: true })));
    }
  });
}
