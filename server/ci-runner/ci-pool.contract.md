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

- `jobs`: jobs waiting for a runner. `id` is a string of digits, unique for the job; the pool launches at most once per `id`.
  `labels` are the job's `runs-on` labels; the pool serves the first one that is in its config.
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
  pool start it. The pool therefore counts containers against the queue, not job against container.
- The pool's own limits (the label cap, memory and pressure checks) apply before `create` is called.
