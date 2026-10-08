// The agent's delivery evidence (templates/delivery-evidence.json): what the pull-request modes (enforced, owner-merge)
// require of a production change, checked by ci.js like a receipt. It is the agent's own report: its completeness and its
// binding to the exact candidate are checked here, not its truth.
import { WfError } from './records.js';

const REVIEW_AREAS = ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'];
export const DELIVERY_MARKER = '<!-- agent-workflow:delivery-evidence@1 -->';
// Delivery evidence from a file: the JSON itself, a marked comment (the marker, then the JSON), or a pull request
// description holding the marker followed by a fenced JSON block, which is how the `wf ci` workflow passes it. A text
// without the marker holds no evidence (null); two marked blocks are ambiguous and refused.
export function parseDeliveryEvidence(text) {
  const raw = String(text ?? '');
  if (Buffer.byteLength(raw, 'utf8') > 128 * 1024) throw new WfError('delivery evidence is larger than 128 KiB');
  const parse = json => { try { return JSON.parse(json); } catch { throw new WfError('the delivery evidence is not valid JSON'); } };
  if (raw.trim().startsWith('{')) return parse(raw);
  const parts = raw.split(DELIVERY_MARKER);
  if (parts.length === 1) return null;
  if (parts.length > 2) throw new WfError('the text holds more than one delivery evidence block; keep only the one for the current head');
  const after = parts[1];
  const fenced = after.match(/^\s*```(?:json)?[^\n]*\n([\s\S]*?)\n\s*```/);
  return parse(fenced ? fenced[1] : after.trim());
}

const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const reference = v => {
  if (typeof v !== 'string' || /\s/.test(v)) return false;
  try { const u = new URL(v); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; } catch { return false; }
};
const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && new Set(a).size === a.length && b.every(x => a.includes(x));
const EVIDENCE_KEYS = ['schema', 'candidate', 'assurance', 'tasks', 'verification', 'integration', 'review'];

// Agent-attested evidence for the exact candidate. Every problem is an error; nothing becomes `unverified`. A finding the
// agent accepted rather than fixed needs a stated resolution, and ci.js leaves that candidate's merge to the owner.
export function evidenceErrors({ evidence, revision, taskIds, owner, requiredChecks }) {
  const errors = [];
  if (!isObject(evidence)) return ['delivery evidence is missing'];
  for (const k of Object.keys(evidence)) if (!EVIDENCE_KEYS.includes(k)) errors.push(`delivery evidence has an unknown field ${k}`);
  if (evidence.schema !== 'agent-workflow/delivery-evidence@1') errors.push('delivery evidence schema must be agent-workflow/delivery-evidence@1');
  if (evidence.candidate !== revision) errors.push('delivery evidence is not for this candidate revision');
  if (evidence.assurance !== 'agent-attested') errors.push('delivery evidence assurance must be agent-attested');
  if (!sameSet(evidence.tasks, taskIds)) errors.push('delivery evidence must name exactly the candidate\'s tasks');
  if (!requiredChecks.length) errors.push('the profile names no required checks');
  for (const stage of ['verification', 'integration']) {
    const s = evidence[stage];
    if (!isObject(s)) { errors.push(`${stage} evidence is missing`); continue; }
    if (s.revision !== revision) errors.push(`${stage} evidence is not for this candidate revision`);
    if (typeof s.environment !== 'string' || !s.environment.trim()) errors.push(`${stage} evidence needs its environment`);
    if (!Array.isArray(s.checks) || !s.checks.length) { errors.push(`${stage} evidence has no checks`); continue; }
    if (new Set(s.checks.map(c => c?.name)).size !== s.checks.length) errors.push(`${stage} contains duplicate check names`);
    for (const c of s.checks) if (!isObject(c) || typeof c.name !== 'string' || !c.name.trim() || c.result !== 'passed' || !reference(c.reference)) errors.push(`${stage} check ${JSON.stringify(c?.name)} did not pass or has no https reference`);
    for (const name of requiredChecks) if (!s.checks.some(c => c?.name === name && c.result === 'passed')) errors.push(`${stage}: required check ${name} did not pass`);
  }
  const r = evidence.review;
  if (!isObject(r)) return [...errors, 'independent review evidence is missing'];
  if (typeof r.reviewer !== 'string' || !r.reviewer.trim()) errors.push('review needs a reviewer');
  if (r.implementer !== owner) errors.push('review implementer must be the tasks\' owner');
  if (typeof r.reviewer === 'string' && [r.implementer, owner].some(v => typeof v === 'string' && r.reviewer.trim().toLowerCase() === v.trim().toLowerCase())) errors.push('reviewer must differ from the implementer');
  if (r.separate_context !== true) errors.push('review must be in a separate context');
  const x = r.context;
  if (!isObject(x)) errors.push('review context is missing');
  else {
    for (const k of ['provider', 'context_id']) if (typeof x[k] !== 'string' || !x[k].trim()) errors.push(`review context needs ${k}`);
    if (x.inherited_context !== false) errors.push('review context must not inherit the implementer\'s context');
    if (x.candidate !== revision) errors.push('review was not of this candidate revision');
    if (!reference(x.launch_evidence)) errors.push('review context needs an https launch_evidence reference');
  }
  for (const area of REVIEW_AREAS) if (!Array.isArray(r.coverage) || !r.coverage.includes(area)) errors.push(`review did not cover ${area}`);
  if (!Array.isArray(r.findings)) errors.push('review findings are missing');
  else for (const f of r.findings) {
    const dealt = isObject(f) && ['resolved', 'accepted'].includes(f.status) && typeof f.resolution === 'string' && f.resolution.trim();
    if (!dealt) errors.push(`review finding ${JSON.stringify(f?.id)} is not resolved, or accepted with a resolution`);
  }
  if (!sameSet(r.tasks, taskIds)) errors.push('review must cover exactly the candidate\'s tasks');
  if (!reference(r.report)) errors.push('review needs an https reference to its report');
  return errors;
}
