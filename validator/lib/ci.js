// The CI verdict for a change. SCHEMA.md "CI verdict".
import { loadConfig, validateRecords } from './records.js';
import { classifyPaths } from './paths.js';
import { evaluateReadiness, OUTCOMES } from './readiness.js';

const within = (p, prefix) => p === prefix || p.startsWith(prefix.replace(/\/+$/, '') + '/');

export function evaluateCi({ baseline, candidate = baseline, task, changed = [] }) {
  const config = loadConfig(baseline);
  const rd = config.records_dir ?? 'docs/workflow';
  const findings = [];
  let fail = false;

  const records = validateRecords(candidate, rd);
  for (const e of records.errors) { findings.push(`record: ${e}`); fail = true; }

  const classes = classifyPaths(config, changed);
  for (const c of classes) findings.push(`${c.category}: ${c.path}`);
  if (classes.some((c) => c.category === 'unclassified')) {
    findings.push('unclassified paths must be classified in docs/workflow/config.json before integration');
    fail = true;
  }

  const production = classes.filter((c) => c.category === 'production').map((c) => c.path);
  let readiness = null;
  if (production.length) {
    if (!task) { findings.push('production paths changed but no task id was given (branch T-xxxx-… or --task)'); fail = true; }
    else {
      readiness = evaluateReadiness({ baseline, candidate, task });
      findings.push(`readiness ${task}: ${readiness.outcome}`);
      for (const r of readiness.reasons) findings.push(`  ${r}`);
      const statusOk = ['Ready', 'Active'].includes(readiness.status);
      if (readiness.outcome === OUTCOMES.ready) {
        if (!statusOk) { findings.push(`task status is ${readiness.status}; production changes need Ready or Active`); fail = true; }
      } else if (readiness.outcome === OUTCOMES.subset) {
        const outside = production.filter((p) => !readiness.subset.some((s) => within(p, s)));
        if (outside.length) { findings.push(`outside the ready subset [${readiness.subset.join(', ')}]: ${outside.join(', ')}`); fail = true; }
        if (!statusOk) { findings.push(`task status is ${readiness.status}; production changes need Ready or Active`); fail = true; }
      } else fail = true;
    }
  }

  if (classes.some((c) => c.category === 'enforcement')) findings.push('enforcement paths changed: protected review required; this run used the trusted baseline validator and config');
  if (classes.some((c) => c.category === 'governing')) findings.push('governing paths changed: decision approval (code-owner review) required');
  for (const c of classes.filter((c) => c.category === 'generated')) findings.push(`generated artifact ${c.path}: regenerate with ${c.producer ?? 'its declared producer'}`);

  return { verdict: fail ? 'fail' : 'pass', findings, classes, readiness, records: records.counts };
}
