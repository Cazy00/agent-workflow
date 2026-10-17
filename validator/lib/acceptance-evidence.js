// The acceptance evidence (templates/acceptance-evidence.json, MAINT-0016): what the pull request that accepts a milestone
// carries in the pull-request modes when the project sets acceptance_evidence. It holds the milestone's review, the trial
// walked in a browser before the owner tries it (procedures/accept-release.md), and what the agent decided for the owner's
// acceptance. Like the delivery evidence it is the agent's own report: its completeness and its binding to the code being
// accepted are checked here, not its truth.
import { classifyPaths } from './paths.js';
import { list, loadConfig } from './records.js';
import { parseMarked } from './delivery-evidence.js';
import { mergedFrom } from './carry.js';

export const ACCEPTANCE_MARKER = '<!-- agent-workflow:acceptance-evidence@1 -->';
export const parseAcceptanceEvidence = text => parseMarked(text, ACCEPTANCE_MARKER, 'acceptance evidence');
const KEYS = ['schema', 'milestone', 'candidate', 'review', 'walkthrough', 'deferred', 'tests_changed'];
const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = v => typeof v === 'string' && v.trim() !== '';
const https = v => { if (typeof v !== 'string' || /\s/.test(v)) return false; try { const u = new URL(v); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; } catch { return false; } };
// MAINT-0020 P7(a), v2.9.0 review S4-3: an address as compared. A URL with its scheme and host in lower case, its default port
// dropped (new URL does both) and no trailing slash; anything else, a desktop app's say, trimmed. A build is compared trimmed.
const address = v => { const s = v.trim(); if (!/^[a-z][a-z\d+.-]*:\/\/\S*$/i.test(s)) return s; try { const u = new URL(s); return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}${u.hash}`; } catch { return s; } };
// v2.9.0 review S4-5: a first page slower than this, in seconds, is a finding the owner is told of (in deferred).
export const FIRST_LOAD_LIMIT = 5;

// MAINT-0018: the files bin/wf-upgrade writes (adapters/upgrade.mjs INSTALLED, and the pin), the only workflow files an
// upgrade brings in. A test keeps the two lists equal.
export const UPGRADE_FILES = ['docs/workflow/config.json', 'scripts/wf', '.github/workflows/wf-ci.yml', '.github/workflows/wf-status.yml', '.github/workflows/wf-client-page.yml', '.claude/agents/independent-reviewer.md', '.claude/agents/trial-walker.md'];
// A revision the acceptance relies on: in this pull request's history, with only records changed since (planning and
// governing paths, since the acceptance itself changes the milestone record), never an acceptance test. MAINT-0018: and
// the workflow files of an upgrade the trusted branch brought in, as a merge of it carries delivery evidence over
// (lib/carry.js): an upgrade the owner merged during the milestone changes nothing the review read or the walk used. The
// project's own code or deploy workflows from the trusted branch (other enforcement paths included, review S1) still need
// a new review and walk.
function covers(config, candidate, rev, what, baseline = null) {
  if (!/^[0-9a-f]{40,64}$/.test(rev ?? '')) return [`${what} needs a full commit hash`];
  if (rev === candidate.name) return [];
  if (candidate.kind !== 'git' || !candidate.isAncestor(rev)) return [`${what} ${rev.slice(0, 12)} is not in this pull request's history`];
  const merged = baseline?.kind === 'git' ? mergedFrom({ baseline, candidate, from: rev }) : () => false;
  const code = classifyPaths(config, candidate.changedPaths(rev)).filter(c => (!['planning', 'governing'].includes(c.category) || c.acceptance_test) && !(c.category === 'enforcement' && UPGRADE_FILES.includes(c.path) && merged(c.path))).map(c => c.path);
  return code.length ? [`${what} ${rev.slice(0, 12)} is followed by changes to ${code.slice(0, 5).join(', ')}${code.length > 5 ? ', …' : ''}; review and walk the code being accepted`] : [];
}
// The config at a revision in this pull request's history, or null (not Git, not in its history, no valid config there).
function configAt(candidate, rev) {
  if (candidate.kind !== 'git' || !/^[0-9a-f]{40,64}$/.test(rev ?? '') || (rev !== candidate.name && !candidate.isAncestor(rev))) return null;
  try { return loadConfig(candidate.atRevision(rev)); } catch { return null; }
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
    // MAINT-0020 (the owner, 17 October 2026): the milestone review, the one last check of everything built, is by the second
    // model's final_model or its model (review.md), or says in fallback why neither could run, as a deep task review does.
    // v2.9.0 review S3-1: covers() carries a review over an owner-approved config change the trusted branch brought in, so the
    // models the config at the reviewed revision named count too; one neither config names still needs the fallback.
    const named = c => [c?.review?.second_model?.final_model, c?.review?.second_model?.model];
    const second = config.review?.second_model, by = [...new Set([...named(config), ...(second ? named(configAt(candidate, r.revision)) : [])].filter(Boolean))];
    if (r.fallback !== undefined && !text(r.fallback)) errors.push('the milestone review\'s fallback must be a non-empty text when given');
    else if (second && text(r.model) && !by.includes(r.model) && r.fallback === undefined) errors.push(`the milestone review is by ${by.join(' or ')} (review.second_model), or says in fallback why it could not be`);
    if (!https(r.report)) errors.push('the milestone review needs an https reference to its report');
    errors.push(...covers(config, candidate, r.revision, 'the milestone review\'s revision', baseline));
  }
  const w = e.walkthrough;
  if (!isObject(w)) errors.push('the trial walkthrough is missing');
  else if (Object.hasOwn(w, 'not_applicable')) { if (!text(w.not_applicable) || Object.keys(w).length > 1) errors.push('a walkthrough that does not apply says only why, in not_applicable'); }
  else {
    errors.push(...covers(config, candidate, w.revision, 'the walkthrough\'s revision', baseline));
    for (const k of ['address', 'build', 'environment', 'walker']) if (!text(w[k])) errors.push(`the walkthrough needs its ${k}`);
    // MAINT-0020 P7(a): the walk is on the address and build the owner is given. In M-0005 the profile's trial-walk line started a
    // development server, and the owner's trial ran on it too, 30 s to open (record §§ 3, 9). The walker measures the first load.
    // v2.9.0 review S4-2: this holds the evidence to itself, the place walked to the place it names for the owner; both can name a
    // development server. The defence against one is the profile's trial line, the walker's instructions and first_load_seconds.
    const te = w.trial_environment;
    if (!isObject(te) || !text(te.address) || !text(te.build)) errors.push('the walkthrough needs its trial_environment, the address and build the owner is given: { address, build }');
    else for (const [k, same] of [['address', address], ['build', v => v.trim()]]) if (text(w[k]) && same(w[k]) !== same(te[k])) errors.push(`the walkthrough's ${k}, ${w[k]}, is not trial_environment's, ${te[k]}: the evidence must say the walk was on the ${k} the owner is given`);
    // v2.9.0 review S4-1: the walk's records, imports and setups stay out of the owner's trial, so the owner starts cold: the walker's
    // own demo accounts and business (a fresh one for each unguided pass), or one shared dataset reset after the last walk.
    if (!['separate', 'reset'].includes(w.walk_data)) errors.push('the walkthrough\'s walk_data is separate (the walker\'s own demo accounts and business, a fresh one for each unguided pass) or reset (the one shared dataset reset or reseeded after the last walk, before the owner is told), so the owner\'s trial starts cold');
    if (typeof w.first_load_seconds !== 'number' || !Number.isFinite(w.first_load_seconds) || w.first_load_seconds < 0) errors.push('the walkthrough needs first_load_seconds, the first page\'s load time the walker measured: a number, 0 or more');
    for (const k of ['languages', 'viewports']) if (!Array.isArray(w[k]) || !w[k].length || !w[k].every(text)) errors.push(`the walkthrough lists its ${k}`);
    if (!Array.isArray(w.steps) || !w.steps.length) errors.push('the walkthrough lists no steps');
    else w.steps.forEach((s, i) => {
      if (!isObject(s) || !['step', 'expected', 'observed'].every(k => text(s[k]))) errors.push(`walkthrough step ${i + 1} needs step, expected and observed`);
      // v2.9.0 final review S4: every step names its scenario, so each scenario walked has its unguided entry below; with the
      // scenario optional, one unguided entry stood for every scenario the steps walked.
      else if (!text(s.scenario)) errors.push(`walkthrough step ${i + 1} names no scenario: each step names the scenario it walks, which unguided then lists`);
      else if (s.result !== 'passed') errors.push(`walkthrough step ${i + 1} did not pass: fix it, or correct the step, and walk it again`);
      else if (!https(s.screenshot)) errors.push(`walkthrough step ${i + 1} needs an https screenshot reference`);
    });
    // MAINT-0020 P7(b): each scenario first from its outcome sentence alone, from a fresh sign-in. In M-0005 the owner, starting
    // cold, found that a new shop's Today never led to setup (T-0037); the walk followed the steps and could not. A stuck entry is a
    // finding for the acceptance package, fixed or listed for the owner, not a failed walk.
    const u = w.unguided, named = [...new Set((Array.isArray(w.steps) ? w.steps : []).map(s => s?.scenario).filter(text).map(s => s.trim()))];
    if (!Array.isArray(u) || !u.length) errors.push('the walkthrough lists no unguided entries: before the steps, try each scenario from its outcome sentence alone, from a fresh sign-in, and record reached or stuck');
    else {
      u.forEach((g, i) => {
        if (!isObject(g) || !['scenario', 'outcome'].every(k => text(g[k])) || !['reached', 'stuck'].includes(g.result)) errors.push(`unguided entry ${i + 1} needs scenario, outcome and a result, reached or stuck`);
        else if (g.result === 'stuck' && !text(g.note)) errors.push(`unguided entry ${i + 1} got stuck: its note says where`);
        else if (g.note !== undefined && !text(g.note)) errors.push(`unguided entry ${i + 1}'s note must be a non-empty text when given`);
      });
      const untried = named.filter(s => !u.some(g => typeof g?.scenario === 'string' && g.scenario.trim() === s));
      if (untried.length) errors.push(`the walkthrough's steps name ${untried.join(', ')}, with no unguided entry: try each from its outcome sentence alone first`);
    }
  }
  for (const k of ['deferred', 'tests_changed']) if (!Array.isArray(e[k]) || !e[k].every(text)) errors.push(`acceptance evidence ${k} must be a list of lines (empty when there is nothing)`);
  const lines = (Array.isArray(e.deferred) ? e.deferred : []).filter(d => typeof d === 'string');
  // v2.9.0 review S4-5: what the walk found reaches the owner. Each scenario still stuck, and a first load over the limit, are
  // listed in deferred, as accepted findings are; a fixed one shows as reached, or under the limit, after a re-walk.
  if (isObject(w) && !Object.hasOwn(w, 'not_applicable')) {
    const stuck = [...new Set((Array.isArray(w.unguided) ? w.unguided : []).filter(g => g?.result === 'stuck' && text(g.scenario)).map(g => g.scenario.trim()))].filter(s => !lines.some(d => d.includes(s)));
    if (stuck.length) errors.push(`deferred must list each scenario the walk still got stuck on, for the owner: ${stuck.join(', ')}`);
    if (typeof w.first_load_seconds === 'number' && w.first_load_seconds > FIRST_LOAD_LIMIT && !lines.some(d => /first load/i.test(d))) errors.push(`deferred must list the first load of ${w.first_load_seconds} s, over ${FIRST_LOAD_LIMIT} s, for the owner: a line naming the first load`);
  }
  // Every finding the milestone's tasks accepted rather than fixed (their accepted_findings) is listed for the owner. Read
  // from the trusted branch's records as well as the candidate's (the independent review of MAINT-0016, I1): the
  // acceptance pull request may also remove the Done task records, which would otherwise empty this check.
  const owed = [...new Set([records].flat().flatMap(r => [...r.tasks.values()]).map(t => t.data).filter(t => t?.milestone === milestone).flatMap(t => list(t.accepted_findings)))];
  const missing = owed.filter(id => !lines.some(d => d.includes(id)));
  if (missing.length) errors.push(`deferred must list the findings the milestone's tasks accepted rather than fixed: ${missing.join(', ')}`);
  return errors;
}
