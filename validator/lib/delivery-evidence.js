// The agent's delivery evidence (templates/delivery-evidence.json): what the pull-request modes (enforced, owner-merge)
// require of a production change, checked by ci.js like a receipt. It is the agent's own report: its completeness and its
// binding to the exact candidate are checked here, not its truth.
import { WfError } from './records.js';
import { unsafePath } from './git.js';

const REVIEW_AREAS = ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'];
export const DELIVERY_MARKER = '<!-- agent-workflow:delivery-evidence@1 -->';
// Evidence from a pull request description: a marked block, the JSON in a fenced block after the marker (MAINT-0016
// reuses this for the acceptance evidence). A text without the marker holds none (null); two marked blocks are ambiguous.
export function parseMarked(text, marker, what) {
  const raw = String(text ?? '');
  if (Buffer.byteLength(raw, 'utf8') > 128 * 1024) throw new WfError(`${what} is larger than 128 KiB`);
  const parse = json => { try { return JSON.parse(json); } catch { throw new WfError(`the ${what} is not valid JSON`); } };
  const parts = raw.split(marker);
  if (parts.length === 1) return null;
  if (parts.length > 2) throw new WfError(`the text holds more than one ${what} block; keep only the one for the current head`);
  const fenced = parts[1].match(/^\s*```(?:json)?[^\n]*\n([\s\S]*?)\n\s*```/);
  return parse(fenced ? fenced[1] : parts[1].trim());
}
// Delivery evidence from a file: the JSON itself, a marked comment (the marker, then the JSON), or a pull request
// description holding the marker followed by a fenced JSON block, which is how the `wf ci` workflow passes it.
export function parseDeliveryEvidence(text) {
  const raw = String(text ?? '');
  return parseMarked(raw.trim().startsWith('{') ? `${DELIVERY_MARKER}\n${raw}` : raw, DELIVERY_MARKER, 'delivery evidence');
}

const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const reference = v => {
  if (typeof v !== 'string' || /\s/.test(v)) return false;
  try { const u = new URL(v); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; } catch { return false; }
};
// A path a finding names is matched literally against the changed paths (ci.js): no glob, and nothing that could pass for another.
const repoPath = p => typeof p === 'string' && !unsafePath(p) && !/[*?[\]{}]/.test(p) && p.split('/').every(s => s && s !== '.' && s !== '..');
const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && new Set(a).size === a.length && b.every(x => a.includes(x));
const EVIDENCE_KEYS = ['schema', 'candidate', 'assurance', 'tasks', 'verification', 'integration', 'review'];

// Agent-attested evidence for the exact candidate. Every problem is an error; nothing becomes `unverified`. A finding the
// agent accepted rather than fixed needs a stated resolution, and ci.js leaves that candidate's merge to the owner.
// MAINT-0021: reviewOptional, for a test-only change (ci.js), lets the review be left out or name level none.
export function evidenceErrors({ evidence, revision, taskIds, owner, requiredChecks, enforcedChecks = false, carried = {}, reviewOptional = false }) {
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
    // MAINT-0016: verification of an earlier revision counts where ci.js found it carries over; integration is always
    // the exact candidate's.
    if (s.revision !== revision && !(stage === 'verification' && carried.verification && s.revision === carried.verification)) errors.push(`${stage} evidence is not for this candidate revision`);
    if (typeof s.environment !== 'string' || !s.environment.trim()) errors.push(`${stage} evidence needs its environment`);
    if (!Array.isArray(s.checks) || !s.checks.length) { errors.push(`${stage} evidence has no checks`); continue; }
    if (new Set(s.checks.map(c => c?.name)).size !== s.checks.length) errors.push(`${stage} contains duplicate check names`);
    // MAINT-0016: under auto-merge GitHub requires the profile's checks before any merge, so a required check may be
    // `enforced` rather than waited for; what the agent ran itself is listed too, and at least one of those passed.
    const counts = c => c?.result === 'passed' || (enforcedChecks && c?.result === 'enforced' && requiredChecks.includes(c?.name));
    for (const c of s.checks) {
      if (isObject(c) && c.result === 'enforced' && !enforcedChecks) errors.push(`${stage} check ${JSON.stringify(c.name)} is "enforced", which only a project with approval.auto_merge may use`);
      else if (!isObject(c) || typeof c.name !== 'string' || !c.name.trim() || !counts(c) || !reference(c.reference)) errors.push(`${stage} check ${JSON.stringify(c?.name)} did not pass or has no https reference`);
    }
    for (const name of requiredChecks) if (!s.checks.some(c => c?.name === name && counts(c))) errors.push(`${stage}: required check ${name} did not pass`);
    if (stage === 'verification' && !s.checks.some(c => c?.result === 'passed')) errors.push('verification lists no check the agent ran and saw pass');
  }
  const r = evidence.review;
  if (reviewOptional && (r == null || (isObject(r) && r.level === 'none'))) return errors;
  if (!isObject(r)) return [...errors, 'independent review evidence is missing'];
  if (r.level === 'none') errors.push('review level none is only for a test-only change (procedures/review.md)');
  if (typeof r.reviewer !== 'string' || !r.reviewer.trim()) errors.push('review needs a reviewer');
  if (r.implementer !== owner) errors.push('review implementer must be the tasks\' owner');
  if (typeof r.reviewer === 'string' && [r.implementer, owner].some(v => typeof v === 'string' && r.reviewer.trim().toLowerCase() === v.trim().toLowerCase())) errors.push('reviewer must differ from the implementer');
  // MAINT-0021: independence is of context and of vendor (POLICY *Independent review*). Both vendors are optional; given
  // together, they must differ, compared trimmed and in any case.
  for (const k of ['vendor', 'implementer_vendor']) if (r[k] !== undefined && (typeof r[k] !== 'string' || !r[k].trim())) errors.push(`review ${k.replace('_', ' ')} must be a non-empty text when given`);
  if (typeof r.vendor === 'string' && typeof r.implementer_vendor === 'string' && r.vendor.trim() && r.vendor.trim().toLowerCase() === r.implementer_vendor.trim().toLowerCase()) errors.push('the reviewer\'s vendor must differ from the implementer\'s (procedures/review.md)');
  if (r.separate_context !== true) errors.push('review must be in a separate context');
  const x = r.context;
  if (!isObject(x)) errors.push('review context is missing');
  else {
    for (const k of ['provider', 'context_id']) if (typeof x[k] !== 'string' || !x[k].trim()) errors.push(`review context needs ${k}`);
    if (x.inherited_context !== false) errors.push('review context must not inherit the implementer\'s context');
    if (x.candidate !== revision && !(carried.review && x.candidate === carried.review)) errors.push('review was not of this candidate revision');
    if (!reference(x.launch_evidence)) errors.push('review context needs an https launch_evidence reference');
  }
  for (const area of REVIEW_AREAS) if (!Array.isArray(r.coverage) || !r.coverage.includes(area)) errors.push(`review did not cover ${area}`);
  if (!Array.isArray(r.findings)) errors.push('review findings are missing');
  else for (const f of r.findings) {
    const dealt = isObject(f) && ['resolved', 'accepted'].includes(f.status) && typeof f.resolution === 'string' && f.resolution.trim();
    if (!dealt) errors.push(`review finding ${JSON.stringify(f?.id)} is not resolved, or accepted with a resolution`);
    // MAINT-0018 B4: severity follows exposure (procedures/review.md); a blocking finding says what it exposes.
    else if (isBlocking(f) && !(typeof f.exposure === 'string' && f.exposure.trim())) errors.push(`review finding ${JSON.stringify(f.id)} is blocking: say in exposure what it exposes and to whom, or that nothing is exposed (then it is not blocking)`);
    // MAINT-0020 P11: a blocking finding in code the pull request does not change, carried by a found task; ci.js judges it.
    if (!isObject(f)) continue;
    if (f.carried_by !== undefined && !(typeof f.carried_by === 'string' && /^T-\d{4}$/.test(f.carried_by))) errors.push(`review finding ${JSON.stringify(f.id)}: carried_by must be the T-NNNN of the found task that fixes it`);
    if (f.paths !== undefined && !(Array.isArray(f.paths) && f.paths.length && f.paths.every(repoPath))) errors.push(`review finding ${JSON.stringify(f.id)}: paths must list the files or folders of its code as Git names them (no globs, no ./ or ..)`);
    if (f.merge_increases_exposure !== undefined && typeof f.merge_increases_exposure !== 'boolean') errors.push(`review finding ${JSON.stringify(f.id)}: merge_increases_exposure must be true or false`);
  }
  if (!sameSet(r.tasks, taskIds)) errors.push('review must cover exactly the candidate\'s tasks');
  if (!reference(r.report)) errors.push('review needs an https reference to its report');
  return errors;
}

// MAINT-0016: the review's level (procedures/review.md). A change to a path the project names in review.deep_paths needs a
// deep review, by the configured second model or with the reason it could not be used (review.fallback); running out of
// a second model is then a recorded fallback, not a stop.
export const REVIEW_LEVELS = ['none', 'light', 'standard', 'deep'];
const BLOCKING = /^(?:blocking|critical|high)$/i;
export const isBlocking = f => BLOCKING.test(String(f?.severity ?? '').trim());
export function reviewLevelErrors({ review, deep = [], secondModel = null, command = false }) {
  if (!isObject(review)) return [];
  const errors = [];
  if (review.level !== undefined && !REVIEW_LEVELS.includes(review.level)) errors.push(`review level must be one of ${REVIEW_LEVELS.join(', ')}`);
  for (const k of ['model', 'fallback']) if (review[k] !== undefined && (typeof review[k] !== 'string' || !review[k].trim())) errors.push(`review ${k} must be a non-empty text when given`);
  if (deep.length && review.level !== 'deep') errors.push(`it changes paths that need a deep review (review.deep_paths): ${deep.join(', ')}; this review's level is ${review.level ?? 'standard'}`);
  // MAINT-0020 (the owner, 17 October 2026): a task's review stays on `model`; final_model is the milestone review's alone.
  // v2.9.0 final review S2: at any level and with a fallback too, which accepted it: a task review's fallback is another vendor's
  // next model (review.md, MAINT-0021), never the usage the owner keeps for the one last check of everything built.
  const final = secondModel?.final_model;
  if (final && final !== secondModel.model && typeof review.model === 'string' && review.model.trim() === final) errors.push(`a task's review is never by ${final}, review.second_model's final_model, which the owner keeps for the milestone review, even as a fallback: it is by ${secondModel.model}, or, where that cannot run, by another vendor's next model, and review.fallback says why`);
  // v2.10.0 review R4: with review.reviewer_command the command picks the deep reviewer, so second_model.model is not required.
  else if (!command && deep.length && review.level === 'deep' && secondModel && review.model !== secondModel.model && !(typeof review.fallback === 'string' && review.fallback.trim())) errors.push(`a deep review is by ${secondModel.model} (review.second_model${final ? `; its final_model, ${final}, is for the milestone review only` : ''}), or says in review.fallback why it could not be`);
  return errors;
}

// MAINT-0021 (v2.10.0 review R2): the review of an earlier revision stands for the fixes after it (procedures/review.md *How
// many*): review.fixes_after names the tests that failed without each blocking fix, and after a blocking finding at deep one
// fix check of this candidate (review.fix_check) is required. Returns why it does not stand, or null. `isAncestor` and
// `carries` come from ci.js, which holds the Git sources.
export function fixedAfterError({ review, candidate, from, isAncestor, carries }) {
  if (!isObject(review) || review.fixes_after == null) return null;
  // v2.10.0 fix check R6: a malformed fixes_after never lets an earlier review stand.
  if (!isObject(review.fixes_after)) return 'review.fixes_after must be an object: { "tests": [the tests that failed without each blocking fix] }';
  if (!/^[0-9a-f]{40,64}$/.test(from ?? '') || !isAncestor(from)) return `${String(from).slice(0, 12)} is not an earlier revision of this candidate`;
  const tests = review.fixes_after.tests ?? [];
  if (!Array.isArray(tests) || tests.some(x => typeof x !== 'string' || !x.trim())) return 'review.fixes_after.tests must list the tests that prove the fixes';
  const blocking = Array.isArray(review.findings) && review.findings.some(isBlocking);
  if (blocking && !tests.length) return 'a blocking finding was fixed after the review: review.fixes_after.tests names the test that failed without each fix';
  if (blocking && review.level === 'deep') {
    const fc = review.fix_check;
    const named = isObject(fc) && ['reviewer', 'model'].every(k => typeof fc[k] === 'string' && fc[k].trim()) && reference(fc.report);
    const current = isObject(fc) && (fc.candidate === candidate || (/^[0-9a-f]{40,64}$/.test(fc.candidate ?? '') && carries(fc.candidate)));
    if (!named || !current) return 'after a blocking finding at deep, the fixes need review.fix_check of this candidate (candidate, reviewer, model, an https report)';
    if (typeof fc.vendor === 'string' && typeof review.implementer_vendor === 'string' && fc.vendor.trim().toLowerCase() === review.implementer_vendor.trim().toLowerCase()) return 'the fix check\'s vendor must differ from the implementer\'s';
  }
  return null;
}
