import { list } from './records.js';
const REVIEW_AREAS = ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'];
export function evaluateLifecycle({ candidate, task, requiredChecks = [], stage = 'verify', trust }) {
  const errors = [];
  const claim = purpose => trust?.claim(purpose, candidate.name);
  const evidence = (p, report) => {
    if (typeof p === 'string' && typeof report?.artifacts?.[p] === 'string' && report.artifacts[p].trim()) return true;
    try { return typeof p === 'string' && !!candidate.read(p)?.trim(); } catch { return false; }
  };
  const check = purpose => {
    const report = claim(purpose);
    if (!report?.environment || !Array.isArray(report.checks) || !report.checks.length) { errors.push(`${purpose}: verified candidate-bound check results are missing`); return; }
    for (const name of requiredChecks) if (!report.checks.some(c => c.name === name && c.result === 'passed')) errors.push(`${purpose}: required check ${name} did not pass`);
    for (const c of report.checks) if (c.result !== 'passed' || !evidence(c.evidence, report)) errors.push(`${purpose}: failed or unsupported check ${c.name}`);
  };
  if (!['verify', 'integrate', 'accept', 'release'].includes(stage)) errors.push(`invalid lifecycle stage ${stage}`);
  check('verification');
  const review = claim('review');
  if (!review?.reviewer || review.reviewer === task.owner || review.implementer !== task.owner || !review.separate_context || !evidence(review.evidence, review)) errors.push('independent review evidence for this candidate is missing or invalid');
  if (!Array.isArray(review?.findings)) errors.push('review findings and their disposition are missing');
  else if (review.findings.some(f => !['resolved', 'accepted'].includes(f.status) || (f.status === 'accepted' && !f.resolution))) errors.push('unresolved review findings remain');
  for (const area of REVIEW_AREAS) if (!review?.coverage?.includes(area)) errors.push(`review did not cover ${area}`);
  if (['integrate', 'accept', 'release'].includes(stage)) check('integration');
  if (stage === 'accept' || stage === 'release') {
    const acceptance = claim('acceptance');
    if (acceptance?.decision !== 'accepted') errors.push('owner product acceptance for this candidate is missing');
    for (const id of list(task.acceptance)) if (!acceptance?.scenarios?.includes(id)) errors.push(`owner acceptance missing scenario ${id}`);
  }
  if (stage === 'release') {
    const release = claim('release');
    if (!release?.authority || !release.artifact || release.candidate_revision !== candidate.name) errors.push('release authority and accepted-artifact relationship are missing');
    for (const field of ['configuration', 'permissions', 'migration', 'monitoring', 'recovery', 'support', 'devices', 'deferred_information']) {
      if (!['verified', 'not-applicable'].includes(release?.readiness?.[field])) errors.push(`release readiness missing: ${field}`);
    }
  }
  return { ok: errors.length === 0, errors, stage, revision: candidate.name };
}
// Run evidence lives on the task's GitHub pull request or issue; a link to it is durable evidence.
const GITHUB_EVIDENCE = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/\d+(#[\w-]+)?$/;
export function evaluateSession({ record: r, candidate, lifecycle, repository }) {
  const errors = [];
  const require = (...fields) => { for (const f of fields) if (!r?.[f]) errors.push(`session requires ${f}`); };
  require('outcome', 'next_action', 'friction');
  const checkEvidence = () => {
    if (!Array.isArray(r.evidence) || !r.evidence.length) errors.push('session requires durable evidence');
    for (const p of r.evidence ?? []) {
      const link = typeof p === 'string' && p.match(GITHUB_EVIDENCE);
      if (link) { if (repository && link[1].toLowerCase() !== repository.toLowerCase()) errors.push(`session evidence is from another repository: ${p}`); continue; }
      try { if (!candidate.read(p)?.trim()) errors.push(`session evidence missing: ${p}`); } catch { errors.push(`invalid session evidence: ${p}`); }
    }
  };
  switch (r?.outcome) {
    case 'progress': require('summary'); checkEvidence(); break;
    case 'ready-for-review': require('candidate', 'summary'); checkEvidence(); if (r.candidate !== candidate.name) errors.push('session candidate does not match'); break;
    case 'verified-complete': if (!lifecycle?.ok || lifecycle.revision !== candidate.name) errors.push('technical completion evidence has not passed validation'); break;
    case 'blocked': require('prerequisite', 'impact', 'responsible'); break;
    case 'stopped-by-limit': require('limit', 'usage', 'checkpoint'); checkEvidence(); break;
    case 'no-progress': require('failure', 'retry_difference'); break;
    default: errors.push('unknown session outcome');
  }
  return { ok: !errors.length, errors, outcome: r?.outcome, limitation: 'Evidence content must still be assessed for meaningful progress; process exit and record fields do not prove it.' };
}
