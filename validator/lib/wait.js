// `wf wait --pr N` (MAINT-0018 B6): waits for a pull request's checks to finish, or with --merged for it to merge, so an
// agent does not write its own polling loop. In M-0004 of mateen-systems one such loop used a `gh pr checks` option the
// home server's gh lacked and silently saw no checks; another died on one network error. This one asks GitHub's REST API
// through `gh api` (any gh version), follows the pull request's current head, counts only the newest run of each check,
// and tolerates network errors. It grants nothing.
import { spawnSync } from 'node:child_process';

const sleep = seconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, seconds) * 1000);
function api(endpoint) {
  const r = spawnSync('gh', ['api', '--hostname', 'github.com', '-H', 'Accept: application/vnd.github+json', endpoint], { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.error?.code === 'ENOENT') throw Object.assign(new Error('gh is not on PATH'), { fatal: true });
  if (r.status !== 0) throw new Error((r.stderr || 'gh api failed').trim());
  return JSON.parse(r.stdout);
}
// The newest run of each check name.
function newest(runs) {
  const by = new Map();
  for (const c of runs) { const was = by.get(c.name); if (!was || String(c.started_at ?? '') >= String(was.started_at ?? '')) by.set(c.name, c); }
  return [...by.values()].map(c => ({ name: c.name, status: c.status, conclusion: c.conclusion }));
}
const FAILED = ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale'];

// Done when every required check has a run (a later workflow's or a `needs:` job's may not exist yet), every run has
// finished, and two polls in a row saw the same runs: an edited description reruns `wf ci` on the same head, and until the
// new run exists the old one would answer (review S6 of MAINT-0018 Part B). A failed run ends a --merged wait too.
const signature = checks => JSON.stringify(checks.map(c => [c.name, c.status, c.conclusion]).sort());
export function waitForPullRequest({ repository, number, merged = false, interval = 30, timeoutMinutes = 30, maxErrors = 10, required = [] }) {
  const deadline = Date.now() + timeoutMinutes * 60000;
  let errors = 0, last = null, seen = null;
  while (Date.now() < deadline) {
    try {
      const pr = api(`repos/${repository}/pulls/${number}`);
      errors = 0;
      if (pr.merged) return { ok: true, result: 'merged', head: pr.head?.sha ?? null };
      if (pr.state === 'closed') return { ok: false, result: 'closed', head: pr.head?.sha ?? null, detail: 'closed without merging' };
      const checks = newest(api(`repos/${repository}/commits/${pr.head.sha}/check-runs?per_page=100`).check_runs ?? []);
      const waitingFor = required.filter(n => !checks.some(c => c.name === n));
      last = { head: pr.head.sha, checks, ...(waitingFor.length ? { waiting_for: waitingFor } : {}) };
      const failed = checks.filter(c => c.status === 'completed' && FAILED.includes(c.conclusion));
      if (merged && failed.length) return { ok: false, result: 'failed', head: pr.head.sha, checks, failed: failed.map(c => c.name), detail: 'a check failed, so it will not merge as it is' };
      if (!merged && checks.length && !waitingFor.length && checks.every(c => c.status === 'completed')) {
        const now = `${pr.head.sha}:${signature(checks)}`;
        if (seen === now) return { ok: !failed.length, result: failed.length ? 'failed' : 'passed', head: pr.head.sha, checks, ...(failed.length ? { failed: failed.map(c => c.name) } : {}) };
        seen = now;
      } else seen = null;
    } catch (e) {
      if (e.fatal) return { ok: false, result: 'error', detail: e.message };
      if (++errors >= maxErrors) return { ok: false, result: 'error', detail: `${errors} errors in a row; the last: ${e.message}`, ...(last ?? {}) };
    }
    sleep(interval);
  }
  return { ok: false, result: 'timeout', detail: `not finished after ${timeoutMinutes} min`, ...(last ?? {}) };
}
