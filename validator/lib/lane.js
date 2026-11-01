// MAINT-0027: the lane of a change. The one judge, for `wf paths`, `wf ci` and `wf lane`, and for the delivery evidence, which
// accepts a required check reported `skipped` only on the fast lane, recomputed from the baseline and the candidate, never read
// from the evidence itself.
//   records  every path is a record (lib/paths.js recordsOnly): a project's CI skips its product jobs.
//   full     the candidate closes a milestone (a milestone record whose status moves to Verified, Accepted or Released versus the
//            baseline), changes an enforcement path, an owner-approved acceptance test or the acceptance map, or changes the config's
//            `checks`: the slow checks run once, here.
//   fast     anything else: the project's fast lane (`checks.fast`, `wf precheck`) is enough.
// A change that closes a milestone is `full` even when it is records only, so the slow checks run once when the milestone is ready.
import { loadAll, loadConfig } from './records.js';
import { classifyPaths, recordsOnly } from './paths.js';
import { ACCEPTANCE_MAP } from './acceptance-files.js';

export const LANES = ['records', 'fast', 'full'];
const CLOSING = ['Verified', 'Accepted', 'Released'];

// Whether any milestone record's status moves into Verified, Accepted or Released between the two sides.
export function closesMilestone(baselineRecords, candidateRecords) {
  for (const { data: m } of candidateRecords.milestones.values()) {
    if (!m?.id || !CLOSING.includes(m.status)) continue;
    if (!CLOSING.includes(baselineRecords.milestones.get(m.id)?.data?.status)) return true;
  }
  return false;
}

// `checks` as the candidate's config carries it, null when it has none; undefined when the config cannot be read.
const checksOf = source => { try { return loadConfig(source).checks ?? null; } catch { return undefined; } };

export function laneOf({ config, baseline, candidate, changed }) {
  const rd = config.records_dir ?? 'docs/workflow';
  try {
    // A change to the tests that judge a milestone (or the map that names them) is exactly when the slow suite must run.
    if (classifyPaths(config, changed).some(c => c.category === 'enforcement' || c.acceptance_test || c.path === ACCEPTANCE_MAP)) return 'full';
    const [then, now] = [checksOf(baseline), checksOf(candidate)];
    if (now === undefined || JSON.stringify(then ?? null) !== JSON.stringify(now)) return 'full';
    if (closesMilestone(loadAll(baseline, rd), loadAll(candidate, rd))) return 'full';
  } catch { return 'full'; } // a side that cannot be read is judged by the slowest lane
  return recordsOnly(config, changed) ? 'records' : 'fast';
}
