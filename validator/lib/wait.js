// `wf wait --pr N` (MAINT-0018 B6): waits for a pull request's checks to finish, or with --merged for it to merge, so an
// agent does not write its own polling loop. In M-0004 of mateen-systems one such loop used a `gh pr checks` option the
// home server's gh lacked and silently saw no checks; another died on one network error. This one asks GitHub's REST API
// through `gh api` (any gh version), follows the pull request's current head, counts only the newest run of each check,
// and tolerates network errors. It grants nothing.
// MAINT-0020 P12: one call returns after WAIT_CEILING_SECONDS with `pending`, because a wait past the harness's five-minute
// prompt cache rewrites the waiting agent's whole context (about $50 in M-0005); the agent runs the command again. A fresh
// call restarts the two-agreeing-polls rule, which costs one interval. P10: `--commit SHA` waits the same way for the
// checks on a commit of the trusted branch, through the same loop.
import { spawnSync } from 'node:child_process';

const sleep = seconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, seconds) * 1000);
export const WAIT_CEILING_SECONDS = 270;
function api(endpoint, timeout = 30000) {
  const r = spawnSync('gh', ['api', '--hostname', 'github.com', '-H', 'Accept: application/vnd.github+json', endpoint], { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
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
// In a --merged wait, a cancelled run is not a failure (`wf ci` cancels its own older run when the description is edited
// or auto-merge is turned on), only the required checks count, and a failure must also be seen twice (the fix review).
const signature = checks => JSON.stringify(checks.map(c => [c.name, c.status, c.conclusion]).sort());
// The target says what to follow: a pull request's current head (which may merge or close), or one fixed commit.
// `ask(endpoint)` is `call` with a timeout that ends by the deadline; tests inject `call`, `now`, `pause`.
// v2.8.0 review X4: a request's timeout was at least 5 s, so one started near the deadline ended the call at 275 s, past the
// cache. Each now gets at most the time left, and with under MIN_REQUEST_MS left none starts and the call returns pending.
const MIN_REQUEST_MS = 1000;
function follow({ repository, target, merged = false, interval = 30, seconds = WAIT_CEILING_SECONDS, maxErrors = 10, required = [], call = api, now = Date.now, pause = sleep }) {
  const deadline = now() + seconds * 1000;
  const late = { late: true };
  const ask = endpoint => { const left = deadline - now(); if (left < MIN_REQUEST_MS) throw late; return call(endpoint, Math.min(30000, left)); };
  let errors = 0, last = null, seen = null, seenFailed = null;
  while (now() < deadline) {
    try {
      const t = target(ask);
      errors = 0;
      if (t.end) return t.end;
      const head = t.head;
      const checks = newest(ask(`repos/${repository}/commits/${head}/check-runs?per_page=100`).check_runs ?? []);
      const waitingFor = required.filter(n => !checks.some(c => c.name === n));
      last = { head, checks, ...(waitingFor.length ? { waiting_for: waitingFor } : {}) };
      const failed = checks.filter(c => c.status === 'completed' && FAILED.includes(c.conclusion));
      if (merged) {
        const blocking = failed.filter(c => c.conclusion !== 'cancelled' && (!required.length || required.includes(c.name)));
        const sig = blocking.length ? `${head}:${signature(blocking)}` : null;
        if (sig && seenFailed === sig) return { ok: false, result: 'failed', head, checks, failed: blocking.map(c => c.name), detail: 'a required check failed, so it will not merge as it is' };
        seenFailed = sig;
      }
      if (!merged && checks.length && !waitingFor.length && checks.every(c => c.status === 'completed')) {
        const sig = `${head}:${signature(checks)}`;
        if (seen === sig) return { ok: !failed.length, result: failed.length ? 'failed' : 'passed', head, checks, ...(failed.length ? { failed: failed.map(c => c.name) } : {}) };
        seen = sig;
      } else seen = null;
    } catch (e) {
      if (e === late) break;
      if (e.fatal) return { ok: false, result: 'error', detail: e.message };
      if (++errors >= maxErrors) return { ok: false, result: 'error', detail: `${errors} errors in a row; the last: ${e.message}`, ...(last ?? {}) };
    }
    pause(Math.min(interval, Math.max(0, (deadline - now()) / 1000)));
  }
  return { ok: false, result: 'pending', detail: `not finished after ${Math.round(seconds)} s: run it again`, ...(last ?? {}) };
}
export function waitForPullRequest({ repository, number, ...rest }) {
  const target = ask => {
    const pr = ask(`repos/${repository}/pulls/${number}`);
    if (pr.merged) return { end: { ok: true, result: 'merged', head: pr.head?.sha ?? null } };
    if (pr.state === 'closed') return { end: { ok: false, result: 'closed', head: pr.head?.sha ?? null, detail: 'closed without merging' } };
    return { head: pr.head.sha };
  };
  return follow({ repository, target, ...rest });
}
export function waitForCommit({ repository, sha, ...rest }) { return follow({ repository, target: () => ({ head: sha }), ...rest, merged: false }); }

// MAINT-0023 P5: the workflow runs of one commit, for the baseline a claim records (lib/baseline-run.js). Like the checks above,
// through `gh api`; an error is the caller's to report.
export function workflowRuns({ repository, sha, call = api }) { return call(`repos/${repository}/actions/runs?head_sha=${sha}&per_page=100`).workflow_runs ?? []; }
