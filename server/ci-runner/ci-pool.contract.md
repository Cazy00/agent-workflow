# ci-pool contract, v1

`ci-pool` (the pool service) knows nothing about where jobs or runner tokens come from. It runs two commands named in its
config and reads JSON from their standard output. Replace either command and the pool does not change. The reference
implementation is `ci-pool-github`. A change that is not backward compatible bumps `version`; the pool refuses a document
with another version.

Both are argument lists, not shell strings. The pool appends the verb and its arguments. Exit status 0 means the answer is
on stdout; anything else (or output that is not JSON of this contract) is a failure, logged, and the pool does nothing on
it: an unknown answer never deletes or starts a container. A command gets 120 s.

## Job source: `source_cmd`

`<source_cmd> queued OWNER/REPO` prints

```json
{"version": 1, "repo": "OWNER/REPO", "private": true,
 "jobs": [{"id": "123456789", "labels": ["wf-build"], "created_at": "2026-10-29T19:00:00Z"}]}
```

- `jobs`: every job waiting for a runner, whether or not its workflow run has other jobs in progress. `id` is a string of
  digits, unique for the job; it names the container the pool starts and keeps a launch from repeating a moment. `labels` are
  the job's `runs-on` labels; the pool serves the first one that is in its config.
- `private` must be `true`. Anything else makes the pool ignore the repository's jobs (a public repository's pull requests
  could run code here).
- `repo` must equal the repository asked.

`<source_cmd> running OWNER/REPO` prints

```json
{"version": 1, "repo": "OWNER/REPO", "jobs": [{"id": "123456789", "runner_name": "ci-pool-wf-build-56789012"}]}
```

- `jobs`: jobs in progress and the name of the runner each one runs on. The pool asks only about a container past the
  unassigned timeout, to tell a runner that took a job from one that never got one.

## JIT source: `jit_cmd`

`<jit_cmd> create OWNER/REPO LABEL NAME` prints

```json
{"version": 1, "runner_id": "42", "encoded_jit_config": "<opaque>"}
```

- A runner config for exactly one job, registered for `OWNER/REPO` under the single label `LABEL` (no default labels), named
  `NAME`. The pool puts `encoded_jit_config` into the container (mode 0600, through stdin, never an argument or the log).

`<jit_cmd> remove OWNER/REPO RUNNER_ID` prints `{"version": 1}`; it unregisters the runner. A runner that is already gone
is success. The pool calls it whenever it deletes a container.

## Notes

- A just-in-time runner takes any one job whose labels it has, in its repository, not necessarily the job whose `id` made the
  pool start it. The pool therefore counts containers against the queue, not job against container: per repository and label
  it starts a container while the queued jobs outnumber the containers whose runner has no job yet.
- `running` is asked every pass for a repository that has live containers, so a runner that took a job is known at once.
- **`api_calls`** (optional, in both `queued` and `running` answers): a non-negative integer, the API calls that answer
  cost. The pool sums them over a pass. A source that omits it is counted at the fixed estimate below.
- **API budget.** The pool stretches `poll_seconds` so that `api_calls_per_hour` (default 1500) is not exceeded: the pause
  is at least `ceil(repositories × api_calls_per_repo_poll × 3600 / api_calls_per_hour)` (the fixed estimate, default 6
  per repository) and at least `ceil(last pass's reported api_calls × 3600 / api_calls_per_hour)`, the second capped at
  300 s. The fixed estimate leaves out the one jobs listing per unfinished run, which a busy repository adds every pass;
  the reported count includes it. JIT `create` and `remove` (one call each, per job) are not counted.
- The pool's own limits (the label cap, memory and pressure checks) apply before `create` is called.
- **Admission limits** are config, not part of the job or JIT sources. `admission` holds three keys: `min_mem_available_mib`,
  `max_cpu_psi_avg60` and `max_mem_psi_avg60` (pressure is PSI `some`, avg60, 0..100). A label may carry its own `admission`
  with any of the same keys; its limits are the global ones overlaid, key by key, by its own. The config is refused (at
  start, and by `ci-pool check-config`) for another key, a value that is not a number, a pressure outside 0..100 or a
  negative memory. A reading that is missing refuses. A `max_cpu_psi_avg60` of 100 means CPU pressure does not hold that
  label (its reading must still exist); below 100 a reading at or above the limit refuses. The 100 rule is for CPU only:
  `max_mem_psi_avg60` keeps `>=` at every value. The label is also a trust boundary: only the installed wf workflows (`wf ci`,
  `wf-status` and the client page, from the trusted branch) run on `wf-gate`; a job that runs code from a pull request or its base runs on `wf-build`.
- **A refusal holds only its label.** When the admission rule refuses a start, that label starts nothing more in the pass, in
  any repository; other labels still try, against their own limits. The memory of containers started a moment ago counts for
  every label. The event `admission_refused` names the `label`, the `job` and the `why`.
- **`ci-pool check-config --config FILE`** reads and validates the config only (no `lxc`, no network). It exits 0, or exits 2
  with the reason on stderr.
- **The diagnostic copy (not part of the two source contracts; the pool's own behaviour).** Before it deletes a container
  whose reason is `unassigned` or `hard_timeout`, the pool copies what explains the end of a runner that never reported
  (I-121) to `diag_dir` (default `/var/log/ci-pool/diag`; `""` turns it off), in `<diag_dir>/<job id>/`
  (`<job id>.<n>` if that exists), root only: directories 0700, files 0600.
  - **Allowlist, nothing else.** From the container: the files `*.log` that sit directly in `diag_runner_dir` (default
    `/opt/actions-runner/_diag`, where `ci-pool-image` installs the runner), whose names match `[A-Za-z0-9_.-]{1,100}.log`, as
    regular files (`find -type f`), the newest `diag_max_files` (10), the last `diag_max_file_kb` KiB (2048) of each. The
    runner's `.credentials`, `.credentials_rsaparams`, `.runner` and the JIT config (which the entrypoint removes after
    reading it) are not logs and are never listed, read or copied; nor is anything outside that directory. From the host: the
    container's cgroup `memory.events` and `memory.peak` (as read, at most 4 KiB each), and a `meta.json` (job, container,
    reason, repository, label, runner name, start and copy times).
  - **Bounded.** What a container prints is never trusted with host memory: the pool reads at most the cap from each `lxc exec`
    and kills a process that says more; each lxc call of the copy has 20 s and the copy of one container
    `diag_timeout_seconds` (60). Retention after each copy: the oldest job directories go while there are more than
    `diag_max_jobs` (50) or they hold more than `diag_max_mb` (200) MB; only real directories named like a job id are
    removed, and the one just written stays.
  - **Never blocks the delete.** A copy that fails in whole or in part is logged (`diag_failed`, with the `step` and
    `error`) and the delete goes on; a failure of any kind is caught, not only a failed `lxc` call. Nothing is copied for a
    container the pool keeps (`delete_skipped`: its runner could not be unregistered), and a container whose delete failed is
    copied once, not on every later pass.
  - **Events** (one JSON line each): `diag_kept` (`container`, `job`, `why`, `path`, `files`, `bytes`) before `deleted` when
    anything was kept; `diag_failed`; `diag_removed` (`path`, `why: retention`).
  - The copy uses `lxc exec` (`find`, `tail`) inside the container, so it only works while the container is running, which
    holds for both reasons; a stopped container (`runner_exited`) is not copied. It trusts nothing it reads from the container
    beyond the allowlist above; replacing it means changing `DiagKeeper` and the two `Lxc` read methods only.
