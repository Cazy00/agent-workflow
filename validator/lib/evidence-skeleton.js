// `wf evidence` (MAINT-0016): the delivery evidence for a candidate with what the validator can derive already filled in:
// revisions, tasks, the profile's required checks, the mapped tests to run, and an earlier review and verification that
// carry over (lib/carry.js). The agent writes only what it ran and what the review found; `wf ci` checks the result like any
// evidence, and this grants nothing.
import { list, loadAll, loadConfig } from './records.js';
import { ACCEPTANCE_MAP } from './acceptance-files.js';
import { carriedFrom } from './carry.js';
import { byMilestone } from './roles.js';

const AREAS = ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'];
export function evidenceSkeleton({ baseline, candidate, task, previous = null }) {
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  const requiredChecks = list(loadAll(baseline, rd).profile?.data?.required_checks);
  const record = loadAll(candidate, rd).tasks.get(task)?.data ?? {};
  const enforced = config.approval?.auto_merge === true;
  let map = [];
  try { map = JSON.parse(candidate.read(ACCEPTANCE_MAP) ?? '[]'); } catch { map = []; }
  const ids = new Set(list(record.acceptance));
  const required = () => requiredChecks.map(name => ({ name, result: enforced ? 'enforced' : 'passed', reference: '' }));
  const evidence = {
    schema: 'agent-workflow/delivery-evidence@1', candidate: candidate.name, assurance: 'agent-attested', tasks: [task],
    verification: {
      revision: candidate.name, environment: '',
      checks: [...(enforced ? [{ name: '', result: 'passed', reference: '' }] : []), ...required()],
      execution: { revision: candidate.name, tests: (Array.isArray(map) ? map : []).filter(m => ids.has(m?.acceptance)).map(m => ({ file: m.file, name: m.name, status: '' })) },
    },
    integration: { revision: candidate.name, environment: enforced ? 'GitHub Actions, required by the ruleset before any merge' : '', checks: required() },
    review: {
      reviewer: '', implementer: record.owner ?? '', separate_context: true, level: 'standard', model: '',
      context: { provider: '', context_id: '', inherited_context: false, candidate: candidate.name, launch_evidence: '' },
      coverage: AREAS, findings: [], tasks: [task], report: '',
    },
  };
  const notes = [];
  // MAINT-0022: under review.cadence milestone the task has no review of its own; the milestone's one review covers it (ci.js).
  if (byMilestone(config)) { evidence.review = { level: 'none' }; notes.push('review.cadence milestone: no task review; the milestone review covers this task, so review is level none'); }
  for (const [stage, from] of [['verification', previous?.verification?.revision], ...(byMilestone(config) ? [] : [['review', previous?.review?.context?.candidate]])]) {
    if (typeof from !== 'string') continue;
    const c = carriedFrom({ config, baseline, candidate, from });
    if (c.ok) { evidence[stage] = previous[stage]; notes.push(`the ${stage} of ${from.slice(0, 12)} carries over`); }
    else notes.push(`the ${stage} of ${from.slice(0, 12)} does not carry over (${c.why}): run it again for this candidate`);
  }
  return { evidence, notes };
}
