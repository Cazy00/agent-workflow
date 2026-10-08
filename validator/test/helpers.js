import fs from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createTrust } from '../lib/trust.js';
const keys = generateKeyPairSync('ed25519');
export function fixtureTrust(baseline, candidate = baseline, extra = []) {
  const repository = 'fixture/project';
  const payloads = [{ purpose: 'baseline', revision: baseline.name }, ...extra];
  const envelopes = payloads.map(p => {
    const payload = { ...p, repository, expires_at: '2099-01-01T00:00:00Z' };
    return { payload, signature: sign(null, Buffer.from(JSON.stringify(payload)), keys.privateKey).toString('base64') };
  });
  return createTrust({ publicKey: keys.publicKey, repository, envelopes });
}

export function integrationClaims(candidate, owner = 'agent') {
  return [
    { purpose: 'integration', revision: candidate.name, environment: 'assembled fixture', checks: [{ name: 'unit', result: 'passed', evidence: 'evidence/log.txt' }] },
    { purpose: 'verification', revision: candidate.name, environment: 'isolated fixture', checks: [{ name: 'unit', result: 'passed', evidence: 'evidence/log.txt' }], execution: { revision: candidate.name, tests: [] } },
    { purpose: 'review', revision: candidate.name, reviewer: 'reviewer', implementer: owner, separate_context: 'fixture-review', evidence: 'evidence/log.txt', coverage: ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'], findings: [] },
  ];
}

// A fake command on PATH (gh, git) backed by a CommonJS script. A `#!<node path>` line breaks when the path holds a
// space (a Node under "Application Support"), so a POSIX shell wrapper runs the script with the quoted executable.
export function fakeExecutable(file, script) {
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  fs.writeFileSync(`${file}.cjs`, script);
  fs.writeFileSync(file, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(`${file}.cjs`)} "$@"\n`, { mode: 0o755 });
}

// Complete agent-attested delivery evidence for one candidate (templates/delivery-evidence.json): what the pull-request
// modes require for a production change (MAINT-0010).
export function deliveryEvidence(candidate, { owner = 'agent', checks = ['unit'], tasks = ['T-0001'] } = {}) {
  const ran = { revision: candidate, environment: 'ubuntu-24.04 node 22', checks: checks.map(name => ({ name, result: 'passed', reference: `https://github.com/fixture/project/actions/runs/1#${name}` })) };
  return {
    schema: 'agent-workflow/delivery-evidence@1', candidate, assurance: 'agent-attested', tasks,
    verification: { ...ran, execution: { revision: candidate, tests: [] } }, integration: ran,
    review: {
      reviewer: 'independent-reviewer', implementer: owner, separate_context: true,
      context: { provider: 'fixture subagent', context_id: 'ctx-1', inherited_context: false, candidate, launch_evidence: 'https://github.com/fixture/project/pull/1#issuecomment-1' },
      coverage: ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'], findings: [], tasks,
      report: 'https://github.com/fixture/project/pull/1#issuecomment-2',
    },
  };
}
