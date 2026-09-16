import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirSource, evaluateReadiness, evaluateCi } from '../lib/index.js';

import { fixtureTrust, integrationClaims } from './helpers.js';

const root = fileURLToPath(new URL('../../fixtures/', import.meta.url));

for (const name of fs.readdirSync(root).sort()) {
  const caseFile = path.join(root, name, 'case.json');
  if (!fs.existsSync(caseFile)) continue;
  const c = JSON.parse(fs.readFileSync(caseFile, 'utf8'));
  const baseline = dirSource(path.join(root, name, 'baseline'));
  const candDir = path.join(root, name, 'candidate');
  const candidate = fs.existsSync(candDir) ? dirSource(candDir) : baseline;

  c.runs.forEach((run, i) => {
    test(`${name} #${i + 1} ${run.command} ${run.task ?? ''} ${(run.changed ?? []).join(',')}`, () => {
      if (run.command === 'readiness') {
        const r = evaluateReadiness({ baseline, candidate, trust: fixtureTrust(baseline, candidate, integrationClaims(candidate)), task: run.task });
        assert.equal(r.outcome, run.expect.outcome, `reasons: ${r.reasons.join(' | ')}`);
        for (const s of run.expect.reasons ?? [])
          assert.ok(r.reasons.join('\n').includes(s), `expected reason containing "${s}" in: ${r.reasons.join(' | ')}`);
      } else if (run.command === 'ci') {
        const r = evaluateCi({ baseline, candidate, trust: fixtureTrust(baseline, candidate, integrationClaims(candidate)), task: run.task, changed: run.changed });
        assert.equal(r.verdict, run.expect.verdict, `findings: ${r.findings.join(' | ')}`);
        for (const s of run.expect.findings ?? [])
          assert.ok(r.findings.join('\n').includes(s), `expected finding containing "${s}" in: ${r.findings.join(' | ')}`);
      } else {
        assert.fail(`unknown command ${run.command}`);
      }
    });
  });
}
