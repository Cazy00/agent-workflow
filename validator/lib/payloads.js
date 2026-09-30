// Unsigned receipt payloads, as staged for a signing round (procedures/approval-evidence.md *Signing rounds*): the
// shape each purpose needs, checked before anyone signs. The brief renders these problems for the owner, and a derived
// baseline (derived.js) counts a receipt only when it has none of them and its checks passed.
export const PURPOSES = ['baseline', 'governing-change', 'workflow-change', 'verification', 'review', 'integration', 'acceptance', 'release'];
const REVIEW_AREAS = ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'];
const READINESS = ['configuration', 'permissions', 'migration', 'monitoring', 'recovery', 'support', 'devices', 'deferred_information'];
const SHA = /^[0-9a-f]{40,64}$/;

const text = v => (typeof v === 'string' && v.trim() ? v : null);
const checkList = (p, errors) => {
  if (!text(p.environment)) errors.push('environment is missing');
  if (!Array.isArray(p.checks) || !p.checks.length) errors.push('checks are missing');
  for (const c of Array.isArray(p.checks) ? p.checks : []) if (!text(c?.name) || !text(c?.evidence) || !text(c?.result)) errors.push(`check ${JSON.stringify(c?.name ?? null)} needs name, result and evidence`);
};

// Everything the gates would reject in one payload, found before anyone signs it.
export function payloadProblems(p, { now = Date.now() } = {}) {
  const errors = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['not a payload object'];
  if (!PURPOSES.includes(p.purpose)) errors.push(`unknown purpose ${JSON.stringify(p.purpose ?? null)}`);
  if (!text(p.repository)) errors.push('repository is missing');
  if (!SHA.test(p.revision ?? '')) errors.push('revision must be a full commit hash');
  if (!Number.isFinite(Date.parse(p.expires_at))) errors.push('expires_at is not a date');
  else if (Date.parse(p.expires_at) <= now) errors.push('expires_at has passed');
  switch (p.purpose) {
    case 'governing-change': case 'workflow-change':
      if (!Array.isArray(p.paths) || !p.paths.length || p.paths.some(x => !text(x))) errors.push('paths must list the approved paths'); break;
    case 'verification':
      checkList(p, errors);
      if (p.execution?.revision !== p.revision || !Array.isArray(p.execution?.tests)) errors.push('execution must name this revision and list the tests run'); break;
    case 'integration': checkList(p, errors); break;
    case 'review':
      for (const f of ['reviewer', 'implementer', 'evidence']) if (!text(p[f])) errors.push(`${f} is missing`);
      if (!p.separate_context) errors.push('separate_context is missing'); // lifecycle.js asks only that it be set
      if (text(p.reviewer) && p.reviewer === p.implementer) errors.push('reviewer and implementer are the same');
      for (const area of REVIEW_AREAS) if (!Array.isArray(p.coverage) || !p.coverage.includes(area)) errors.push(`review does not cover ${area}`);
      if (!Array.isArray(p.findings)) errors.push('findings are missing');
      for (const f of Array.isArray(p.findings) ? p.findings : []) {
        if (!['resolved', 'accepted'].includes(f?.status)) errors.push(`finding ${f?.id ?? '?'} is ${f?.status ?? 'without a status'}`);
        else if (f.status === 'accepted' && !text(f.resolution)) errors.push(`finding ${f.id ?? '?'} is accepted without a resolution`);
      }
      break;
    case 'acceptance':
      if (p.decision !== 'accepted') errors.push('decision must be accepted');
      if (!Array.isArray(p.scenarios) || !p.scenarios.length) errors.push('scenarios must list the accepted acceptance IDs'); break;
    case 'release':
      for (const f of ['authority', 'artifact', 'candidate_revision']) if (!text(p[f])) errors.push(`${f} is missing`);
      for (const f of READINESS) if (!['verified', 'not-applicable'].includes(p.readiness?.[f])) errors.push(`release readiness ${f} is not verified or not-applicable`);
      break;
    default: break;
  }
  return errors;
}

// Reads a payload file: an array of payloads, or of {payload, signature?} envelopes.
export function readPayloads(raw) {
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('the payload file must hold a JSON array');
  return data.map(item => (item && typeof item === 'object' && item.payload && typeof item.payload === 'object' ? item.payload : item));
}
