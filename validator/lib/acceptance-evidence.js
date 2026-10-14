// The acceptance evidence (templates/acceptance-evidence.json, MAINT-0016): what the pull request that accepts a milestone
// carries in the pull-request modes when the project sets acceptance_evidence. It holds the milestone's review, the trial
// walked in a browser before the owner tries it (procedures/accept-release.md), and what the agent decided for the owner's
// acceptance. Like the delivery evidence it is the agent's own report: its completeness and its binding to the code being
// accepted are checked here, not its truth.
import { classifyPaths } from './paths.js';
import { list } from './records.js';
import { parseMarked } from './delivery-evidence.js';
import { mergedFrom } from './carry.js';

export const ACCEPTANCE_MARKER = '<!-- agent-workflow:acceptance-evidence@1 -->';
export const parseAcceptanceEvidence = text => parseMarked(text, ACCEPTANCE_MARKER, 'acceptance evidence');
const KEYS = ['schema', 'milestone', 'candidate', 'review', 'walkthrough', 'deferred', 'tests_changed'];
const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = v => typeof v === 'string' && v.trim() !== '';
const https = v => { if (typeof v !== 'string' || /\s/.test(v)) return false; try { const u = new URL(v); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; } catch { return false; } };

// A revision the acceptance relies on: in this pull request's history, with only records changed since (planning and
// governing paths, since the acceptance itself changes the milestone record), never an acceptance test. MAINT-0018: and
// workflow files (enforcement paths) the trusted branch brought in, as a merge of it carries delivery evidence over
// (lib/carry.js): an upgrade the owner merged during the milestone changes nothing the review read or the walk used. The
// project's own code from the trusted branch still needs a new review and walk.
function covers(config, candidate, rev, what, baseline = null) {
  if (!/^[0-9a-f]{40,64}$/.test(rev ?? '')) return [`${what} needs a full commit hash`];
  if (rev === candidate.name) return [];
  if (candidate.kind !== 'git' || !candidate.isAncestor(rev)) return [`${what} ${rev.slice(0, 12)} is not in this pull request's history`];
  const merged = baseline?.kind === 'git' ? mergedFrom({ baseline, candidate, from: rev }) : () => false;
  const code = classifyPaths(config, candidate.changedPaths(rev)).filter(c => (!['planning', 'governing'].includes(c.category) || c.acceptance_test) && !(c.category === 'enforcement' && merged(c.path))).map(c => c.path);
  return code.length ? [`${what} ${rev.slice(0, 12)} is followed by changes to ${code.slice(0, 5).join(', ')}${code.length > 5 ? ', …' : ''}; review and walk the code being accepted`] : [];
}

export function acceptanceEvidenceErrors({ evidence: e, milestone, config, candidate, records, baseline = null }) {
  if (!isObject(e)) return ['acceptance evidence is missing'];
  const errors = [];
  for (const k of Object.keys(e)) if (!KEYS.includes(k)) errors.push(`acceptance evidence has an unknown field ${k}`);
  if (e.schema !== 'agent-workflow/acceptance-evidence@1') errors.push('acceptance evidence schema must be agent-workflow/acceptance-evidence@1');
  if (e.milestone !== milestone) errors.push(`acceptance evidence must name the milestone this pull request accepts, ${milestone}`);
  errors.push(...covers(config, candidate, e.candidate, 'the accepted candidate', baseline));
  const r = e.review;
  if (!isObject(r)) errors.push('the milestone review is missing');
  else {
    for (const k of ['reviewer', 'model']) if (!text(r[k])) errors.push(`the milestone review needs its ${k}`);
    if (!https(r.report)) errors.push('the milestone review needs an https reference to its report');
    errors.push(...covers(config, candidate, r.revision, 'the milestone review\'s revision', baseline));
  }
  const w = e.walkthrough;
  if (!isObject(w)) errors.push('the trial walkthrough is missing');
  else if (Object.hasOwn(w, 'not_applicable')) { if (!text(w.not_applicable) || Object.keys(w).length > 1) errors.push('a walkthrough that does not apply says only why, in not_applicable'); }
  else {
    errors.push(...covers(config, candidate, w.revision, 'the walkthrough\'s revision', baseline));
    for (const k of ['environment', 'walker']) if (!text(w[k])) errors.push(`the walkthrough needs its ${k}`);
    for (const k of ['languages', 'viewports']) if (!Array.isArray(w[k]) || !w[k].length || !w[k].every(text)) errors.push(`the walkthrough lists its ${k}`);
    if (!Array.isArray(w.steps) || !w.steps.length) errors.push('the walkthrough lists no steps');
    else w.steps.forEach((s, i) => {
      if (!isObject(s) || !['step', 'expected', 'observed'].every(k => text(s[k]))) errors.push(`walkthrough step ${i + 1} needs step, expected and observed`);
      else if (s.result !== 'passed') errors.push(`walkthrough step ${i + 1} did not pass: fix it, or correct the step, and walk it again`);
      else if (!https(s.screenshot)) errors.push(`walkthrough step ${i + 1} needs an https screenshot reference`);
    });
  }
  for (const k of ['deferred', 'tests_changed']) if (!Array.isArray(e[k]) || !e[k].every(text)) errors.push(`acceptance evidence ${k} must be a list of lines (empty when there is nothing)`);
  // Every finding the milestone's tasks accepted rather than fixed (their accepted_findings) is listed for the owner. Read
  // from the trusted branch's records as well as the candidate's (the independent review of MAINT-0016, I1): the
  // acceptance pull request may also remove the Done task records, which would otherwise empty this check.
  const owed = [...new Set([records].flat().flatMap(r => [...r.tasks.values()]).map(t => t.data).filter(t => t?.milestone === milestone).flatMap(t => list(t.accepted_findings)))];
  const missing = owed.filter(id => !(Array.isArray(e.deferred) ? e.deferred : []).some(d => typeof d === 'string' && d.includes(id)));
  if (missing.length) errors.push(`deferred must list the findings the milestone's tasks accepted rather than fixed: ${missing.join(', ')}`);
  return errors;
}
