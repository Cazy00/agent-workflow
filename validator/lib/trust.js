// Assisted execution uses explicit owner-signed receipts. The public key is an external
// trust anchor; neither candidate files nor a branch name can establish that anchor.
//
// Unsigned payloads (`--unsigned-receipts`) are a dry run of a round the owner has not signed yet: a gate that passes
// only because of one is provisional, never satisfied (exit 3, procedures/approval-evidence.md *Unsigned dry runs*).
// A signed receipt always takes precedence over an unsigned payload of the same purpose and revision, and an
// ambiguity in either tier supplies nothing. `provisional()` names every unsigned payload a gate relied on.
import { verify } from 'node:crypto';
export function createTrust({ publicKey, repository, envelopes = [], unsigned = [], now = Date.now() }) {
  const usable = p => p && typeof p === 'object' && p.repository === repository && typeof p.revision === 'string' && typeof p.purpose === 'string' && p.purpose && Number.isFinite(Date.parse(p.expires_at)) && Date.parse(p.expires_at) > now;
  const valid = [];
  for (const envelope of envelopes) {
    try {
      const p = envelope.payload;
      if (!usable(p)) continue;
      if (typeof envelope.signature !== 'string' || !verify(null, Buffer.from(JSON.stringify(p)), publicKey, Buffer.from(envelope.signature, 'base64'))) continue;
      // Retain an immutable copy so callers cannot mutate verified claims afterward.
      valid.push(JSON.stringify(p));
    } catch { /* Bad receipts never provide authority. */ }
  }
  const pending = [];
  for (const item of unsigned) {
    try { const p = item?.payload ?? item; if (usable(p)) pending.push(JSON.stringify(p)); } catch { /* ignored like a bad receipt */ }
  }
  const used = new Map();
  const find = (tier, purpose, revision) => tier.map(s => JSON.parse(s)).filter(p => p.purpose === purpose && p.revision === revision);
  // Looks without recording: 'signed', 'provisional' or null, and the payload behind it.
  const peek = (purpose, revision) => {
    const signed = find(valid, purpose, revision);
    if (signed.length) return signed.length === 1 ? { level: 'signed', payload: signed[0] } : null; // ambiguous receipts require resolution
    const draft = find(pending, purpose, revision);
    return draft.length === 1 ? { level: 'provisional', payload: draft[0] } : null;
  };
  const claim = (purpose, revision) => {
    const found = peek(purpose, revision);
    if (found?.level === 'provisional') used.set(`${purpose}@${revision}`, { purpose, revision });
    return found?.payload ?? null;
  };
  // Two receipts, or two unsigned payloads, for one purpose and revision supply nothing; a derivation must not step
  // around such a revision to an older approval, so it asks.
  const ambiguous = (purpose, revision) => {
    const signed = find(valid, purpose, revision);
    return signed.length > 1 || (signed.length === 0 && find(pending, purpose, revision).length > 1);
  };
  return Object.freeze({
    claim,
    allows: (purpose, revision) => claim(purpose, revision) !== null,
    peek,
    ambiguous,
    revisions: () => new Set([...valid, ...pending].map(s => JSON.parse(s).revision)),
    provisional: () => [...used.values()],
  });
}

// Enforced mode (POLICY § 7): the owner verified GitHub protection, code-owner review and the approval-path
// test at setup and recorded `enforced` in the baseline's config and profile, which code owners protect. The
// fetched authoritative branch is then the approved baseline. Nothing else is inferred: receipt-dependent
// checks report what the pull request review covers instead of failing. Supplying receipts runs the manual
// gate instead; there is no hybrid. Only an immutable Git revision can carry this trust.
export function createEnforcedTrust({ baseline }) {
  if (!/^[0-9a-f]{40,64}$/.test(baseline ?? '')) throw new Error('enforced trust needs an immutable baseline revision');
  return Object.freeze({ mode: 'enforced', claim: () => null, allows: (purpose, revision) => purpose === 'baseline' && revision === baseline, peek: () => null, ambiguous: () => false, revisions: () => new Set(), provisional: () => [] });
}
