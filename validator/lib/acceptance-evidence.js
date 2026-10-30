// The acceptance evidence (templates/acceptance-evidence.json, MAINT-0016): what the pull request that accepts a milestone
// carries in the pull-request modes when the project sets acceptance_evidence. It holds the milestone's review, the trial
// walked in a browser before the owner tries it (procedures/accept-release.md), and what the agent decided for the owner's
// acceptance. Like the delivery evidence it is the agent's own report: its completeness and its binding to the code being
// accepted are checked here, not its truth.
import { classifyPaths, deepChanges } from './paths.js';
import { FINDING, list, loadAll, loadConfig } from './records.js';
import { parseFrontMatter } from './frontmatter.js';
import { parseMarked, sameVendorError } from './delivery-evidence.js';
import { mergedFrom } from './carry.js';
import { milestonePathOf, owedTasks } from './tasks-only.js';

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

const vendorErrors = (r, config, who, field) => {
  const errors = [];
  for (const k of ['vendor', 'implementer_vendor']) if (r[k] !== undefined && !text(r[k])) errors.push(`${who}'s ${k.replace('_', ' ')} must be a non-empty text when given`);
  if (r.fresh_session !== undefined && typeof r.fresh_session !== 'boolean') errors.push(`${who}'s fresh_session must be true or false when given`);
  const same = sameVendorError({ vendor: r.vendor, implementer: r.implementer_vendor, fresh: r.fresh_session, sameVendor: config.review?.same_vendor, who, field });
  return same ? [...errors, same] : errors;
};
const SHA = /^[0-9a-f]{40,64}$/;
// The commit where the trusted branch's own line first held the milestone past Draft: its authorisation, as it landed there.
export function authorisedAt(source, path) {
  for (const c of [...(source.firstParentVersions?.(path) ?? [])].reverse()) {
    const status = parseFrontMatter(source.atRevision(c).read(path) ?? '').data?.status;
    if (status && status !== 'Draft') return c;
  }
  return null;
}
// MAINT-0023 P6 (the owner approved it, 27 October 2026): a milestone diff larger than any reviewer model takes is reviewed in
// parts. The base the review starts from comes at or before the trusted branch's authorisation of the milestone (above).
const authorisationErrors = ({ base, milestone, recordsDir, candidate, baseline }) => {
  const authorised = authorisedAt(baseline?.kind === 'git' ? baseline : candidate, `${recordsDir}/milestones/${milestone}.md`);
  if (!authorised) return [`the trusted branch's history does not show where ${milestone} was authorised, so the milestone review's base cannot be checked`];
  return candidate.atRevision(authorised)?.isAncestor(base) ? [] : [`the milestone review's base ${base.slice(0, 12)} comes after ${milestone}'s authorisation ${authorised.slice(0, 12)}, where the trusted branch first set it past Draft: under review.cadence milestone it reviews the whole milestone diff, from a base at or before the authorisation`];
};
const PARTS_SHAPE = 'the milestone review\'s parts must be a non-empty list of { base, revision } full commit hashes';
// The one judge of a set of review parts, for the acceptance evidence and for `wf usage` (lib/usage.js), which counts several
// runs as one review only when this finds nothing (v2.12.0 review finding 6): each part is a non-empty range inside this pull
// request's history, each starts exactly where the one before ended, the first starts at or before the authorisation, and the
// last ends at the revision the review names. A run that only calls itself a part is none of these.
export function reviewPartsErrors({ parts, revision, milestone, recordsDir = 'docs/workflow', candidate, baseline = null }) {
  if (!Array.isArray(parts) || !parts.length || !parts.every(p => isObject(p) && Object.keys(p).every(k => ['base', 'revision'].includes(k)) && SHA.test(p.base ?? '') && SHA.test(p.revision ?? ''))) return [PARTS_SHAPE];
  const at = rev => { try { return candidate.kind === 'git' && SHA.test(rev ?? '') ? candidate.atRevision(rev) : null; } catch { return null; } };
  const short = x => x.slice(0, 12), errors = [];
  parts.forEach((p, i) => {
    const n = i + 1, prev = parts[i - 1];
    if (p.base === p.revision) errors.push(`review part ${n} is empty: its base and revision are both ${short(p.base)}`);
    else if (!at(p.revision) || (p.revision !== candidate.name && !candidate.isAncestor(p.revision))) errors.push(`review part ${n}'s revision ${short(p.revision)} is not in this pull request's history`);
    else if (!at(p.revision).isAncestor(p.base)) errors.push(`review part ${n}'s base ${short(p.base)} is not an earlier revision of its revision ${short(p.revision)}`);
    if (prev && p.base !== prev.revision) errors.push(at(prev.revision)?.isAncestor(p.base) ? `review part ${n} starts at ${short(p.base)}, before part ${i} ended at ${short(prev.revision)}: the parts overlap` : `review part ${n} starts at ${short(p.base)}, after part ${i} ended at ${short(prev.revision)}: a gap of unreviewed code`);
  });
  const last = parts.at(-1).revision;
  if (last !== revision) errors.push(`the last review part ends at ${short(last)}, not at the milestone review's revision ${short(String(revision ?? ''))}: the parts together cover the milestone to its end`);
  if (candidate.kind === 'git') errors.push(...authorisationErrors({ base: parts[0].base, milestone, recordsDir, candidate, baseline }));
  return errors;
}
// The paths each part changed, together: a path a later part changed back still belongs to what a reviewer was asked to read.
const partsPaths = (parts, at) => parts.flatMap(p => at(p.revision).changedPaths(p.base));

// MAINT-0022 (the owner's review diet, 22 October 2026): under review.cadence milestone the milestone review is the only review of
// its tasks' code (ci.js). Its `base` comes at or before the trusted branch's authorisation of the milestone, read from that branch's
// own history, never from records a later change can edit (v2.11.0 review B2), so base..revision holds every task's code. It lists
// the review.deep_paths the reviewed and fixed code reaches, its security focus. One fix check may follow it, whose revision then
// covers the code after the review; every task not Done at the review's revision must fix one of its findings, so the fix check
// never stands in for the review (B1). No round three: code after the fix check fails covers, as code after an uncovered review does.
// MAINT-0023 P6: `parts` may stand for `base`: the deep paths are read over the union of the parts, and the fix check follows the last.
function onlyReviewErrors({ r, milestone, config, candidate, baseline, records }) {
  const errors = [];
  const rd = config.records_dir ?? 'docs/workflow';
  const at = rev => { try { return SHA.test(rev ?? '') ? candidate.atRevision(rev) : null; } catch { return null; } };
  const fc = r.fix_check;
  const end = isObject(fc) && at(fc.revision) ? fc.revision : r.revision;
  const split = r.parts !== undefined;
  const partsErrors = split ? reviewPartsErrors({ parts: r.parts, revision: r.revision, milestone, recordsDir: rd, candidate, baseline }) : [];
  if (split && r.base !== undefined) errors.push('name the milestone review\'s base or its parts, not both');
  errors.push(...partsErrors);
  // The single base is checked as before; with parts, reviewPartsErrors has judged the chain, and the deep paths are read once it holds.
  let readable = split && !partsErrors.length;
  if (!split) {
    if (!SHA.test(r.base ?? '')) errors.push('the milestone review needs its base, the full commit hash its diff starts from (review.cadence milestone)');
    else if (candidate.kind !== 'git' || !at(r.revision)?.isAncestor(r.base)) errors.push(`the milestone review's base ${r.base.slice(0, 12)} is not an earlier revision of the reviewed one`);
    else { readable = true; errors.push(...authorisationErrors({ base: r.base, milestone, recordsDir: rd, candidate, baseline })); }
  }
  if (readable && at(end)) {
    const changed = [...at(end).changedPaths(split ? r.parts[0].base : r.base), ...(split ? partsPaths(r.parts, at) : [])];
    const production = classifyPaths(config, [...new Set(changed)]).filter(c => ['production', 'generated'].includes(c.category)).map(c => c.path);
    const reached = (config.review?.deep_paths ?? []).filter(g => deepChanges([g], production).length);
    const listed = Array.isArray(r.deep_paths) && r.deep_paths.every(text) ? r.deep_paths : null;
    if (r.deep_paths !== undefined && !listed) errors.push('the milestone review\'s deep_paths must be a list of review.deep_paths globs');
    else if (reached.some(g => !(listed ?? []).includes(g))) errors.push(`the milestone review's deep_paths must list the review.deep_paths the milestone changed, its security focus: ${reached.join(', ')}`);
  }
  if (fc === undefined) return [...errors, ...covers(config, candidate, r.revision, 'the milestone review\'s revision', baseline)];
  if (!isObject(fc) || !['reviewer', 'model'].every(k => text(fc[k])) || !https(fc.report)) errors.push('the milestone review\'s fix check needs its reviewer, model and an https report');
  if (!isObject(fc)) return errors;
  if (!at(fc.revision) || fc.revision === r.revision || !at(r.revision) || !at(fc.revision).isAncestor(r.revision)) errors.push('the milestone review\'s fix check must come after the review\'s revision: one fix check of the fixes to its findings');
  else {
    const reviewed = loadAll(at(r.revision), rd).tasks;
    const versions = [loadAll(at(fc.revision), rd), records].flat().flatMap(x => [...x.tasks.values()]).map(x => x.data).filter(d => d?.id && d.milestone === milestone && d.status !== 'Draft');
    for (const id of new Set(versions.map(d => d.id))) {
      const fixes = versions.filter(d => d.id === id).every(d => typeof d.found_from === 'string' && FINDING.test(d.found_from));
      if (reviewed.get(id)?.data?.status !== 'Done' && !fixes) errors.push(`${id} was not Done at the milestone review's revision ${r.revision.slice(0, 12)} and fixes none of its findings (found_from): the milestone review covers every task's code; only fixes of its findings follow it, under its one fix check`);
    }
  }
  errors.push(...vendorErrors({ ...fc, implementer_vendor: r.implementer_vendor }, config, 'the milestone review\'s fix check', 'review.fix_check.fresh_session'));
  return [...errors, ...covers(config, candidate, fc.revision, 'the milestone review\'s fix check revision', baseline)];
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
    // MAINT-0022: the reviewer's vendor, as in the delivery evidence (delivery-evidence.js sameVendorError).
    errors.push(...vendorErrors(r, config, 'the milestone review', 'review.fresh_session'));
    if (config.review?.cadence === 'milestone') errors.push(...onlyReviewErrors({ r, milestone, config, candidate, baseline, records }));
    else errors.push(...covers(config, candidate, r.revision, 'the milestone review\'s revision', baseline));
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
  // MAINT-0026: under approval.defer_to_acceptance a task appended to the milestone's tasks: since its plan was last authorised went
  // in with an agent's merge (lib/tasks-only.js), so the owner approves it here and deferred names each. The revision is found by
  // walking the trusted branch's history of the record; the check fails closed, naming why, when that cannot be done.
  const rd = config.records_dir ?? 'docs/workflow';
  const appended = owedTasks({ config, rd, trusted: baseline, milestone, now: parseFrontMatter(candidate.read(milestonePathOf(rd, milestone)) ?? '').data });
  if (appended.error) errors.push(`deferred must list the tasks added to ${milestone}'s tasks: since its plan was last authorised, but they cannot be worked out: ${appended.error}`);
  else {
    const unlisted = appended.ids.filter(id => !lines.some(d => d.includes(id)));
    if (unlisted.length) errors.push(`deferred must list the tasks added to ${milestone}'s tasks: since its plan was last authorised (${appended.revision.slice(0, 12)}), which the owner approves here: ${unlisted.join(', ')}`);
  }
  return errors;
}
