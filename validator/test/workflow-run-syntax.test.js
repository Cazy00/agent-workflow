import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseYaml } from '../lib/ci-lint.js';

// v2.15.1: v2.14.0 put an ASCII apostrophe into the single-quoted `node -e '…'` script of the "Run the gate" step of
// templates/github/wf-ci.yml; it closed the quote and the step failed with a shell syntax error on every pull request. Every `run:`
// script of the templates and of the repository's own workflows must at least parse as bash once each `${{ … }}` is a word.
const dirs = ['../../templates/github/', '../../.github/workflows/'].map(d => new URL(d, import.meta.url));
const files = dirs.flatMap(d => readdirSync(d).filter(f => f.endsWith('.yml')).map(f => ({ name: d.pathname.split('/').slice(-3, -1).join('/') + '/' + f, url: new URL(f, d) })));

test('there are workflow files to check', () => {
  assert.ok(files.length >= 6, files.map(f => f.name).join(', '));
});

for (const f of files) {
  test(`every run: script of ${f.name} is valid bash`, () => {
    const workflow = parseYaml(readFileSync(f.url, 'utf8'));
    let scripts = 0;
    for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
      for (const [i, step] of (job.steps ?? []).entries()) {
        if (typeof step.run !== 'string') continue;
        scripts++;
        const script = step.run.replace(/\$\{\{[\s\S]*?\}\}/g, 'PLACEHOLDER');
        const r = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
        assert.equal(r.status, 0, `${jobName} step ${i + 1} (${step.name ?? step.run.split('\n')[0]}): ${r.stderr}`);
      }
    }
    assert.ok(scripts > 0, 'no run: step found, so nothing was checked');
  });
}
