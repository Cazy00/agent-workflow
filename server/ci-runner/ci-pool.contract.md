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

- `jobs`: jobs in progress and the name of the runner each one runs on. The pool uses it to tell a runner that took a job
  from one that never got one. The list is not taken as complete: GitHub's listing can miss a run whose job is running
  (I-121), so a runner it leaves out is checked inside its container before it counts as unassigned (Notes).

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
- **Unassigned** means both: the runner is not named in `running`, **and** no `Runner.Worker` process runs in its container
  (the runner starts one per job). Only a container past `unassigned_timeout_seconds` (300) is looked into: `ps -e -o comm=`
  inside it, as root (as for `ps.txt`), at most 64 KiB read and 10 s. A `Runner.Worker` there holds the container: the pool
  marks it assigned, logs `assigned_by_worker` (`container`, `job`, `runner_name`, `workers`) the first time, and neither
  unregisters the runner (`jit_cmd remove`: GitHub then cancels the job, `UserCancelled`) nor deletes the container; the
  runner exits when its job ends and the container is reaped as `runner_exited`. A check that fails, times out or fills the
  64 KiB is no answer and holds the container too (`worker_check_failed`: `container`, `job`, `error`, once per pass), since
  unknown is never a reason to delete. Only a container seen to run no `Runner.Worker` is unregistered and deleted as
  `unassigned`, and if GitHub still refuses to let its runner go it stays (`delete_skipped`), as before. The hard timeout
  (`hard_timeout_seconds`) does not look inside: past it the container is deleted whatever runs in it. A source that does
  not answer `running` deletes nothing and looks into nothing.
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
  - **`diag_dir` is the pool's own.** When it does not exist the pool makes it, mode 0700. An existing one is never changed
    (no chmod) and is used only when it is a real directory (not a symbolic link) of the pool's user (root) with mode 0700;
    otherwise nothing is copied (`diag_failed`, `step: diag_dir`) and the delete goes on. `ci-pool check-config` (and the
    service at start) refuses `/`, a top-level directory, a home directory (`/home/<name>`), a path not written plainly (`..`,
    `//`, a trailing `/`), well-known shared directories such as `/var/log`, `/var/lib`, `/var/backups` or
    `/var/log/ci-pool`, and anything under `/etc`, `/usr`, `/proc`, `/sys`, `/dev`, `/run`, `/boot`, `/tmp` and the like.
  - **Allowlist of names; the content is not trusted.** From the container: the files `*.log` that sit directly in
    `diag_runner_dir` (default `/opt/actions-runner/_diag`, where `ci-pool-image` installs the runner), whose names match
    `[A-Za-z0-9_.-]{1,100}.log`, regular files with one link (`find -type f -links 1`), the newest `diag_max_files` (10),
    the last `diag_max_file_kb` KiB (2048) of each. The allowlist filters names only: job code runs as the runner user that
    owns `_diag` and can write anything into a `*.log` there, including the content of the runner's own files, so what is
    copied is untrusted data, kept root only on the host. The listing and the reads run inside the container as the user
    and group that own `diag_runner_dir` (`lxc exec --user --group`, read with `stat` first), never as root; a `_diag` owned
    by root is not read. So a name swapped for a symbolic link between the listing and the read can reach only what that
    user can read anyway, never a root-only file such as the JIT config (which the entrypoint removes after reading it). From
    the host: the container's cgroup `memory.events` and `memory.peak` (as read, at most 4 KiB each), and a `meta.json` (job,
    container, reason, repository, label, runner name, start and copy times), written last: a directory whose `meta.json`
    cannot be written is removed. A job directory therefore holds at most: the `_diag` `*.log` copies, `ps.txt`,
    `journal-runner.txt`, `journal.txt` (below), `memory.events`, `memory.peak` and `meta.json`, each 0600.
  - **The process list and the journals, read as root; the content is not trusted.** Before the `_diag` logs (they say who
    signalled the runner: a systemd stop of `ci-pool-runner.service` and its cause, or a kill of the process group that the
    entrypoint, `sudo`, `run.sh`, the Listener, the Worker and the steps share), three commands run inside the container as
    root (journald's files are root's), in this order: `ps.txt` from `ps -eo pid,ppid,pgid,sid,user,stat,lstart,comm`, its
    first 64 KiB (the command name only, never the arguments: a step's command line can hold its secrets);
    `journal-runner.txt` from `journalctl -b --no-pager -o short-iso-precise -u ci-pool-runner.service -n 100` (the unit's
    stop and its reason, even when a Docker job's `dockerd` lines fill the whole journal's last 400); and `journal.txt` from
    `journalctl -b --no-pager -o short-iso-precise -n 400`. Each journal keeps its last 256 KiB from a line start (at most
    1 MiB is read; past it the process is killed and the last 256 KiB of what was read is kept; a window that already starts
    at a line start keeps that line). Each call gets 10 s at most, never more than the copy and the pass have left. Job code
    can write to the journal and name its processes, so all three are untrusted text, written as data, never parsed or run.
    Before a byte is written the pool (`scrub`) replaces, on `sudo`'s lines (`sudo[<pid>]: ` or `sudo: `), everything after
    `COMMAND=` or `(command continued)` with `[removed by ci-pool]` (`sudo` logs the whole command it ran, split into
    continued lines when long: a step's `sudo docker login -p ...`, and the entrypoint's `run.sh --jitconfig <config>`);
    then the value after `--jitconfig` (with ` ` or `=`, quoted or not) with `[removed by ci-pool]` and any run of 200 or more
    base64 characters with `[long token removed by ci-pool]`. That is all it removes: anything else a job prints to the
    journal (a step's own log lines, another program's arguments) is kept as printed, so these files may hold a job's output,
    secrets included, and are root only like the rest. The snapshots run before the `_diag` logs on purpose, so a slow
    container's snapshots can leave the logs of a later container in the same pass to the budget (review F5, kept).
  - **Bounded.** What a container prints is never trusted with host memory: the pool reads at most the cap from each `lxc exec`
    and kills a process that says more; each lxc call of the copy has 20 s (at least 1 s; 10 s for `ps` and `journalctl`),
    the process list and the journals count in both budgets below, the copy of one container
    `diag_timeout_seconds` (60), and all copies of one reap pass together `diag_pass_budget_seconds` (45). Once a pass has
    spent its budget, the containers it still deletes are deleted without a copy (`diag_failed`, `step: budget`), so a
    pass with several slow copies does not hold up launches. Retention after each copy: the oldest job directories go while
    there are more than `diag_max_jobs` (50) or they hold more than `diag_max_mb` (200) MB; only real directories named like
    a job id that hold a `meta.json` (a regular file: the pool's own) are counted or removed, and the one just written stays.
  - **Bounded against a stop.** The copy runs inside the reap, and SIGTERM waits for the pass under way. The copying checks
    the stop request before each container and each file (`ps.txt`, `journal-runner.txt` and `journal.txt` included): after SIGTERM no copy starts
    (`diag_failed`, `step: stopping`) and
    the one under way ends after its current lxc call (at most 20 s), then the deletes and `state.save()` finish. With
    `ci-pool.service`'s stop timeout (systemd's default `TimeoutStopSec`, 90 s) a stop therefore spends at most about 20 s
    in the copy; without a stop a pass spends at most `diag_pass_budget_seconds` plus a few seconds (each call gets at least
    1 s) in it. Keep `diag_pass_budget_seconds` well below the stop timeout if the unit's timeout is lowered.
  - **Never blocks the delete.** A copy that fails in whole or in part is logged (`diag_failed`, with the `step` and
    `error`) and the delete goes on; a failure of any kind is caught, not only a failed `lxc` call. Nothing is copied for a
    container the pool keeps (`delete_skipped`: its runner could not be unregistered), and a container whose delete failed is
    copied once, not on every later pass.
  - **Events** (one JSON line each): `diag_kept` (`container`, `job`, `why`, `path`, `files`, `bytes`) before `deleted` when
    anything was kept; `diag_failed` (`container`, `job`, `step`: `diag_dir`, `budget`, `stopping`, `list`, `keep`,
    `retention`, `meta.json`, `memory.events`, `memory.peak`, `ps.txt`, `journal-runner.txt`, `journal.txt` or a file name, and `error`);
    `diag_removed` (`path`,
    `why: retention`).
  - The copy uses `lxc exec` (`find`, `tail`, `ps`, `journalctl`) inside the container, so it only works while the container
    is running, which holds for both reasons; a stopped container (`runner_exited`) is not copied. It trusts nothing it reads
    from the container; replacing it means changing `DiagKeeper`, `scrub` and the five `Lxc` read methods (`owner`,
    `list_logs`, `tail_file`, `processes`, `journal`) only. (The Worker check above is apart: `Pool.holds_job` and
    `Lxc.workers`.)
