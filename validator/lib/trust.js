// Assisted execution uses explicit owner-signed receipts. The public key is an external
// trust anchor; neither candidate files nor a branch name can establish that anchor.
import { verify } from 'node:crypto';
export function createTrust({ publicKey, repository, envelopes = [], now = Date.now() }) {
  const valid = [];
  for (const envelope of envelopes) {
    try {
      const p = envelope.payload;
      if (!p || p.repository !== repository || typeof p.revision !== 'string' || !p.purpose || !Number.isFinite(Date.parse(p.expires_at)) || Date.parse(p.expires_at) <= now) continue;
      if (typeof envelope.signature !== 'string' || !verify(null, Buffer.from(JSON.stringify(p)), publicKey, Buffer.from(envelope.signature, 'base64'))) continue;
      // Retain an immutable copy so callers cannot mutate verified claims afterward.
      valid.push(JSON.stringify(p));
    } catch { /* Bad receipts never provide authority. */ }
  }
  const claim = (purpose, revision) => {
    const found = valid.map(s => JSON.parse(s)).filter(p => p.purpose === purpose && p.revision === revision);
    return found.length === 1 ? found[0] : null; // ambiguous receipts require resolution
  };
  return Object.freeze({ claim, allows: (purpose, revision) => claim(purpose, revision) !== null });
}

// Enforced mode (POLICY § 7): the owner verified GitHub protection, code-owner review and the approval-path
// test at setup and recorded `enforced` in the baseline's config and profile, which code owners protect. The
// fetched authoritative branch is then the approved baseline. Nothing else is inferred: receipt-dependent
// checks report what the pull request review covers instead of failing. Supplying receipts runs the manual
// gate instead; there is no hybrid. Only an immutable Git revision can carry this trust.
export function createEnforcedTrust({ baseline }) {
  if (!/^[0-9a-f]{40,64}$/.test(baseline ?? '')) throw new Error('enforced trust needs an immutable baseline revision');
  return Object.freeze({ mode: 'enforced', claim: () => null, allows: (purpose, revision) => purpose === 'baseline' && revision === baseline });
}
