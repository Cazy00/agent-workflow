// Read-only GitHub Actions snapshot. This is check evidence, not approval or deployment evidence.
import { spawnSync } from 'node:child_process';
import { WfError } from './records.js';
const SHA = /^[0-9a-f]{40,64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW = /^\.github\/workflows\/[^/\\\x00-\x1f]+\.ya?ml$/;
export function githubGet(endpoint) {
  const p = spawnSync('gh', ['api', '--hostname', 'github.com', '--method', 'GET', '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28', endpoint], { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  // Do not echo authentication environment, request bodies or raw API errors into evidence.
  if (p.status !== 0) throw new WfError('GitHub read failed or timed out; check worker access and retry once the cause changes');
  try { return JSON.parse(p.stdout); } catch { throw new WfError('GitHub returned invalid JSON'); }
}
function pages(get, endpoint, key) {
  const all = [];
  let total;
  for (let page = 1; page <= 10; page++) {
    const data = get(`${endpoint}&per_page=100&page=${page}`);
    if (!Number.isSafeInteger(data.total_count) || data.total_count < 0 || !Array.isArray(data[key]) || data[key].length > 100) throw new WfError(`incomplete GitHub ${key} response`);
    if (total !== undefined && data.total_count !== total) throw new WfError(`GitHub ${key} changed during collection; collect a fresh snapshot`);
    total = data.total_count;
    all.push(...data[key]);
    if (all.length === total) return all;
    if (all.length > total || !data[key].length) throw new WfError(`incomplete GitHub ${key} pagination`);
  }
  throw new WfError(`GitHub ${key} exceeds the bounded 1000-item collection; narrow the query`);
}
export function checkDelivery({ repository, revision, workflow, branch, event = 'push', requiredChecks = [], get = githubGet, now = () => new Date().toISOString() }) {
  if (!REPOSITORY.test(repository ?? '') || repository.split('/').some(p => ['.', '..'].includes(p))) throw new WfError('delivery-check needs --repository OWNER/REPO');
  if (!SHA.test(revision ?? '')) throw new WfError('delivery-check needs an exact --candidate commit SHA');
  if (!WORKFLOW.test(workflow ?? '')) throw new WfError('delivery-check needs --workflow-file .github/workflows/NAME.yml');
  if (typeof branch !== 'string' || !branch.trim() || /[\x00-\x1f]/.test(branch)) throw new WfError('delivery-check needs an explicit --branch');
  if (!['push', 'pull_request', 'workflow_dispatch', 'merge_group'].includes(event)) throw new WfError('unsupported delivery-check event');
  if (!requiredChecks.length || requiredChecks.some(c => typeof c !== 'string' || !c.trim()) || new Set(requiredChecks).size !== requiredChecks.length) throw new WfError('delivery-check needs distinct --required-check job names');
  const prefix = `repos/${repository}`;
  const query = new URLSearchParams({ head_sha: revision, branch, event });
  const runs = pages(get, `${prefix}/actions/workflows/${encodeURIComponent(workflow.split('/').at(-1))}/runs?${query}`, 'workflow_runs');
  const matches = runs.filter(r => r.head_sha === revision && r.head_branch === branch && r.event === event && r.path === workflow && r.repository?.full_name?.toLowerCase() === repository.toLowerCase());
  const errors = [];
  const result = { ok: false, repository, revision, workflow, branch, event, observed_at: null, run: null, checks: [], errors,
    limitation: 'Read-only GitHub snapshot for the supplied commit, workflow and event. It does not identify the deployed artifact, authenticate independent review, approve a merge, accept a product, or grant release authority. Other required workflows must be checked separately.' };
  if (!matches.length) errors.push('no matching workflow run exists for this exact revision, repository, branch and event');
  else {
    if (matches.some(r => !Number.isSafeInteger(r.id) || !Number.isSafeInteger(r.run_number) || !Number.isSafeInteger(r.run_attempt))) throw new WfError('GitHub workflow run identity is incomplete');
    if (new Set(matches.map(r => r.id)).size !== matches.length) throw new WfError('duplicate GitHub workflow runs in snapshot');
    // run_number orders runs within this specific workflow. A rerun increments run_attempt on that run.
    const run = matches.sort((a, b) => b.run_number - a.run_number)[0];
    result.run = { id: run.id, attempt: run.run_attempt, number: run.run_number, status: run.status, conclusion: run.conclusion, url: `https://github.com/${repository}/actions/runs/${run.id}` };
    if (run.status !== 'completed' || run.conclusion !== 'success') errors.push(`latest exact-revision run is ${run.status}/${run.conclusion ?? 'pending'}`);
    const jobs = pages(get, `${prefix}/actions/runs/${run.id}/jobs?filter=latest`, 'jobs');
    if (jobs.some(j => j.run_id !== run.id || j.head_sha !== revision) || new Set(jobs.map(j => j.id)).size !== jobs.length) throw new WfError('GitHub jobs do not belong uniquely to the selected run and commit');
    result.checks = jobs.map(j => ({ name: j.name, status: j.status, conclusion: j.conclusion, id: j.id }));
    for (const name of requiredChecks) {
      const found = jobs.filter(j => j.name === name);
      if (found.length !== 1 || found[0].status !== 'completed' || found[0].conclusion !== 'success') errors.push(`required job ${name} did not complete successfully exactly once in the latest run`);
    }
    const current = get(`${prefix}/actions/runs/${run.id}`);
    if (['head_sha', 'head_branch', 'event', 'path', 'run_attempt', 'status', 'conclusion', 'updated_at'].some(k => current[k] !== run[k]) || current.id !== run.id) errors.push('workflow state changed during collection; collect a fresh snapshot');
  }
  result.observed_at = now();
  result.ok = errors.length === 0;
  return result;
}
