"""Tests for ci-pool and ci-pool-github (MAINT-0017 D1). Run: python3 -m unittest discover -s server/ci-runner
No lxc, no network beyond a loopback stub: the lxc wrapper and the source/JIT commands are faked."""
import contextlib
import http.server
import importlib.machinery
import importlib.util
import io
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import unittest
import unittest.mock

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    loader = importlib.machinery.SourceFileLoader(name.replace("-", "_"), os.path.join(HERE, name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


pool = load("ci-pool")
YOUNG = pool.YOUNG_SECONDS
GOOD = {"mem_available_mib": 8000, "cpu_psi": 5.0, "mem_psi": 0.5}


class FakeLxc:
    """Stands in for pool.Lxc: instances as {name: {status, created_at, base_image}}, and a log of calls."""

    def __init__(self, fingerprint="fp1"):
        self.instances, self.calls, self.fingerprint, self.fail = {}, [], fingerprint, set()
        self.logs = {}  # container -> {file name: (mtime, bytes)} : what the runner's _diag directory holds
        self.tail_hook = lambda: None  # called on every tail_file
        self.list_budget = None  # a number: that many more list() calls work, the next one raises
        self.diag_owner = (1001, 1001)  # who owns the runner's _diag directory in every container
        self.exec_users = []  # the user every list_logs / tail_file ran as
        self.journal_text = b"2026-11-05T09:39:41.000000+00:00 c systemd[1]: Stopping ci-pool-runner.service...\n"
        self.runner_journal_text = b"2026-11-05T09:39:41.000000+00:00 c systemd[1]: ci-pool-runner.service: Deactivated.\n"
        self.ps_text = b"PID PPID PGID SID USER STAT STARTED COMMAND\n1 0 1 1 root Ss Thu Nov 5 09:30:00 2026 systemd\n"
        self.snapshot_hook = lambda: None  # called on every journal / processes
        self.worker_count = {}  # container -> Runner.Worker processes running in it (none when absent)

    def _do(self, what):
        self.calls.append(what)
        if what[0] in self.fail:
            raise pool.PoolError(f"{what[0]} refused")

    def list(self):
        if self.list_budget is not None:
            if self.list_budget <= 0:
                raise pool.PoolError("list refused")
            self.list_budget -= 1
        return [{"name": n, "status": i["status"], "created_at": i.get("created_at", 0), "base_image": i.get("base_image", "")}
                for n, i in self.instances.items()]

    def image_fingerprint(self, alias):
        return self.fingerprint

    def init(self, name, image, profile, memory):
        self._do(("init", name, image, profile, memory))
        self.instances[name] = {"status": "Stopped", "base_image": self.fingerprint}

    def rename(self, old, new):
        self._do(("rename", old, new))
        self.instances[new] = self.instances.pop(old)

    def push_secret(self, name, path, data):
        self._do(("push", name, path))

    def start(self, name):
        self._do(("start", name))
        self.instances[name]["status"] = "Running"

    def delete(self, name):
        self._do(("delete", name))
        self.instances.pop(name, None)

    def profile_show(self, name):
        return ""

    def owner(self, name, path, timeout):
        self.calls.append(("owner", name, path))
        if "owner" in self.fail:
            raise pool.PoolError("owner refused")
        return self.diag_owner

    def list_logs(self, name, directory, timeout, user):
        self.calls.append(("list_logs", name, directory))
        self.exec_users.append(user)
        if "list_logs" in self.fail:
            raise pool.PoolError("list_logs refused")
        return sorted(((m, len(d), f) for f, (m, d) in self.logs.get(name, {}).items()), reverse=True)

    def tail_file(self, name, path, nbytes, timeout, user):
        self.calls.append(("tail_file", name, path))
        self.exec_users.append(user)
        if "tail_file" in self.fail:
            raise pool.PoolError("tail_file refused")
        self.tail_hook()
        return self.logs[name][os.path.basename(path)][1][-nbytes:]

    def journal(self, name, lines, limit, timeout, unit=None):
        op = "journal" if unit is None else "journal_unit"  # the whole journal, or ci-pool-runner.service's alone
        self.calls.append((op, name, lines, limit, timeout) + (() if unit is None else (unit,)))
        if op in self.fail:
            raise pool.PoolError("lxc exec journalctl exited 1")
        self.snapshot_hook()
        return (self.journal_text if unit is None else self.runner_journal_text)[-limit:]

    def processes(self, name, limit, timeout):
        self.calls.append(("processes", name, limit, timeout))
        if "processes" in self.fail:
            raise pool.PoolError("lxc exec ps exited 1")
        self.snapshot_hook()
        return self.ps_text[:limit]

    def workers(self, name, limit, timeout):
        self.calls.append(("workers", name, limit, timeout))
        if "workers" in self.fail:
            raise pool.PoolError("lxc exec c ps: timed out after 10s")
        return self.worker_count.get(name, 0)

    def names(self, op):
        return [c[1] for c in self.calls if c[0] == op]


class Env:
    """A pool on a fake lxc, a fake source and JIT command, a settable clock and host reading."""

    def __init__(self, tc, **over):
        self.tmp = tempfile.TemporaryDirectory()
        tc.addCleanup(self.tmp.cleanup)
        self.cfg = {**pool.DEFAULTS, "version": 1, "repos": ["o/r"], "source_cmd": ["src"], "jit_cmd": ["jit"],
                    "state_file": os.path.join(self.tmp.name, "state.json"),
                    "diag_dir": os.path.join(self.tmp.name, "diag"),
                    "labels": {"wf-build": {"profile": "ci-pool-build", "image": "ci-pool-build", "cap": 1, "memory": "5GiB"},
                               "wf-gate": {"profile": "ci-pool-gate", "image": "ci-pool-gate", "cap": 2, "memory": "2GiB"}}}
        self.cfg.update(over)
        self.diag_dir = self.cfg["diag_dir"]
        self.lxc, self.now, self.host = FakeLxc(), 1000.0, dict(GOOD)
        self.queued, self.running, self.private, self.source_fails = [], set(), True, False
        self.api_calls = None  # what each source answer reports as `api_calls`; None leaves the field out
        self.commands, self.removed, self.remove_fails = [], [], False
        self.runner_id = "77"  # the id the next `jit create` answers
        self.held = set()  # runner names GitHub still holds: a `create` with one fails, as GitHub refuses a taken name
        self.create_fails = lambda name: False  # True: that `create` fails (an upstream error, the broker's cap)
        self.create_seconds = 0  # how long each `create` takes, on the pool's clock
        self.stop = False  # a SIGTERM the pool has seen
        self.mem = {}  # container -> what read_memory would answer for it
        self.cgroup = os.path.join(self.tmp.name, "cgroup")
        self.restart()

    def restart(self):
        """A new pool process on the same host: everything it knows comes from the state file."""
        self.pool = pool.Pool(self.cfg, self.lxc, pool.State(self.cfg["state_file"]), run_cmd=self.cmd,
                              host=lambda: self.host, clock=lambda: self.now,
                              diag=pool.DiagKeeper(self.cfg, self.lxc, lambda: self.now, cgroup_root=self.cgroup),
                              memory=lambda n: self.mem.get(n, {"memory_peak_mib": None, "oom_kill": None}),
                              stopping=lambda: self.stop)

    def cmd(self, argv):
        self.commands.append(argv)
        if argv[0] == "src":
            if self.source_fails:
                raise pool.PoolError("source down")
            extra = {} if self.api_calls is None else {"api_calls": self.api_calls}
            if argv[1] == "queued":
                return json.dumps({"version": 1, "repo": argv[2], "private": self.private, "jobs": self.queued, **extra})
            return json.dumps({"version": 1, "repo": argv[2], "jobs": [{"id": "1", "runner_name": n} for n in self.running], **extra})
        if argv[1] == "create":
            self.now += self.create_seconds
            if argv[4] in self.held:
                raise pool.PoolError("jit failed: upstream_error (422: a runner with this name already exists)")
            if self.create_fails(argv[4]):
                raise pool.PoolError("jit failed: upstream_error")
            return json.dumps({"version": 1, "runner_id": self.runner_id, "encoded_jit_config": "SECRET-JIT"})
        if self.remove_fails:
            raise pool.PoolError("runner is still running a job")
        self.removed.append(argv[2:])
        return json.dumps({"version": 1})

    def tick(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.pool.tick()

    def job(self, jid, label="wf-build", created="2026-10-29T19:00:00Z"):
        self.queued.append({"id": jid, "labels": [label], "created_at": created})

    def creates(self):
        return sum(1 for c in self.commands if c[:2] == ["jit", "create"])

    def created(self):
        """The runner names `jit create` was asked for, in order."""
        return [c[4] for c in self.commands if c[:2] == ["jit", "create"]]

    def events(self):
        """One pass; the events it logged, as dicts."""
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.pool.tick()
        return [json.loads(line) for line in out.getvalue().splitlines()]


class LaunchTests(unittest.TestCase):
    def test_a_queued_job_gets_one_container_and_is_never_launched_twice(self):
        e = Env(self)
        e.job("100")
        e.tick()
        self.assertEqual(e.lxc.names("start"), ["pool-wf-build-100"])
        for _ in range(3):  # the queue still lists it (GitHub lags), later passes, even after a restart of the service
            e.now += 15
            e.tick()
        e.pool = pool.Pool(e.cfg, e.lxc, pool.State(e.cfg["state_file"]), run_cmd=e.cmd, host=lambda: e.host, clock=lambda: e.now)
        e.tick()
        self.assertEqual(e.lxc.names("start"), ["pool-wf-build-100"])
        self.assertEqual(sum(1 for c in e.commands if c[:2] == ["jit", "create"]), 1)

    def test_a_launch_a_crash_left_without_a_container_is_closed_and_the_job_launched_again(self):  # F3
        e = Env(self)
        e.pool.state.jobs["100"] = {"container": "pool-wf-build-100", "repo": "o/r", "label": "wf-build", "runner_id": "1",
                                    "runner_name": "x", "started": e.now, "status": "launching", "assigned": False}
        e.pool.state.save()
        e.job("100")
        e.tick()
        self.assertEqual(e.pool.state.jobs["100"]["status"], "finished", "the dead entry is closed")
        self.assertIn(["o/r", "1"], e.removed, "its runner is unregistered")
        self.assertEqual(e.lxc.names("start"), [], "not in the same breath")
        e.now += 15
        e.tick()
        self.assertEqual(e.lxc.names("start"), ["pool-wf-build-100"], "the job is not stranded")

    def test_a_job_whose_runner_took_another_job_is_launched_again(self):  # F3, review T3
        e = Env(self)
        e.job("100", created="2026-10-29T19:00:00Z")
        e.job("101", created="2026-10-29T19:00:05Z")
        e.tick()  # cap 1: pool-wf-build-100
        e.queued = [j for j in e.queued if j["id"] == "100"]  # its JIT runner took 101
        e.lxc.instances["pool-wf-build-100"]["status"] = "Stopped"  # 101 done, powered off
        e.now += 15
        e.tick()  # reaped, entry 100 "finished"
        e.now += 15
        e.tick()
        self.assertEqual(e.creates(), 2)

    def test_a_second_job_gets_a_container_while_the_first_runner_runs_another_job(self):  # F3
        e = Env(self, labels={"wf-gate": {"profile": "p", "image": "i", "cap": 3, "memory": "1GiB"}})
        e.job("200", "wf-gate")
        e.job("201", "wf-gate")
        e.tick()
        self.assertEqual(sorted(e.lxc.names("start")), ["pool-wf-gate-200", "pool-wf-gate-201"])
        e.queued = [j for j in e.queued if j["id"] == "200"]  # the runner named for 201 took 201's job? no: took 201 and 200 is left
        e.running = {"ci-pool-wf-gate-201-a1"}  # runner 201 holds a job; the runner named for 200 is unassigned
        e.job("202", "wf-gate")
        e.now += 15
        e.tick()  # queued: 200, 202 ; unassigned containers: 200 only -> one more
        self.assertEqual(sorted(e.lxc.names("start")), ["pool-wf-gate-200", "pool-wf-gate-201", "pool-wf-gate-202"])

    def test_a_listing_that_lags_does_not_launch_for_a_job_a_container_already_waits_for(self):  # F3
        e = Env(self)
        e.job("100")
        for _ in range(5):
            e.tick()
            e.now += 15
        self.assertEqual(e.creates(), 1)

    def test_the_hosts_memory_counts_what_this_pass_already_started(self):  # F8
        e = Env(self)
        e.host = {"mem_available_mib": 3500, "cpu_psi": 1.0, "mem_psi": 0.0}
        e.job("100", "wf-build")
        e.job("201", "wf-gate")
        e.job("202", "wf-gate")
        e.tick()
        self.assertEqual(e.lxc.names("start"), ["pool-wf-build-100"], "5 GiB are spoken for; 3.5 GiB left would not admit a gate")
        e.now += YOUNG
        e.tick()  # the build container has now used its memory, which MemAvailable shows
        self.assertEqual(len(e.lxc.names("start")), 2)

    def test_the_jit_config_goes_to_the_container_and_is_never_logged(self):
        e = Env(self)
        e.job("100")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            e.pool.tick()
        self.assertNotIn("SECRET-JIT", out.getvalue())
        self.assertIn(("push", "pool-wf-build-100", "/etc/ci-pool/jit"), e.lxc.calls)
        for line in out.getvalue().splitlines():
            json.loads(line)  # one JSON object per line

    def test_the_cap_holds_a_second_job_until_a_container_is_gone(self):
        e = Env(self)
        e.job("100", created="2026-10-29T19:00:00Z")
        e.job("101", created="2026-10-29T19:00:05Z")
        e.tick()
        e.tick()
        self.assertEqual(e.lxc.names("start"), ["pool-wf-build-100"])
        e.lxc.instances["pool-wf-build-100"]["status"] = "Stopped"  # the runner exited
        e.now += 15
        e.tick()
        self.assertEqual(e.lxc.names("start"), ["pool-wf-build-100", "pool-wf-build-101"])

    def test_the_caps_are_per_label(self):
        e = Env(self)
        e.host = {**GOOD, "mem_available_mib": 20000}  # room for all three, the memory rule has its own test
        e.job("100", "wf-build")
        e.job("201", "wf-gate")
        e.job("202", "wf-gate")
        e.job("203", "wf-gate")
        e.tick()
        self.assertEqual(sorted(e.lxc.names("start")), ["pool-wf-build-100", "pool-wf-gate-201", "pool-wf-gate-202"])

    def test_admission_refuses_on_memory_and_on_pressure_and_starts_nothing(self):
        for host in ({"mem_available_mib": 2000, "cpu_psi": 1.0, "mem_psi": 0.0},
                     {"mem_available_mib": 9000, "cpu_psi": 40.0, "mem_psi": 0.0},
                     {"mem_available_mib": 9000, "cpu_psi": 1.0, "mem_psi": 10.0},
                     {"mem_available_mib": None, "cpu_psi": 1.0, "mem_psi": 0.0},
                     {"mem_available_mib": 9000, "cpu_psi": None, "mem_psi": 0.0}):
            e = Env(self)
            e.host = host
            e.job("100")
            e.tick()
            self.assertEqual(e.lxc.names("start"), [], host)
            self.assertNotIn(["jit", "create"], [c[:2] for c in e.commands], "no runner is registered for a refused start")
            e.host = dict(GOOD)  # the same job starts once the host has room
            e.now += 15
            e.tick()
            self.assertEqual(e.lxc.names("start"), ["pool-wf-build-100"], host)

    def test_a_repository_that_is_not_private_or_not_listed_gets_nothing(self):
        e = Env(self)
        e.private = False
        e.job("100")
        e.tick()
        self.assertEqual(e.lxc.names("start"), [])
        self.assertEqual({c[2] for c in e.commands if c[0] == "src"}, {"o/r"}, "only the listed repository is asked about")

    def test_a_source_that_fails_changes_nothing(self):
        e = Env(self)
        e.job("100")
        e.tick()
        e.source_fails = True
        e.now += 400  # past the unassigned timeout: with no answer, nothing may be deleted
        e.tick()
        self.assertEqual(e.lxc.names("delete"), [])

    def test_a_failed_launch_cleans_up_and_retries_after_a_pause(self):
        e = Env(self)
        e.lxc.fail = {"start"}
        e.job("100")
        e.tick()
        self.assertIn(["o/r", "77"], e.removed, "the runner is unregistered")
        self.assertNotIn("pool-wf-build-100", e.lxc.instances)
        e.lxc.fail = set()
        e.now += 15
        e.tick()
        self.assertEqual(e.lxc.names("start"), ["pool-wf-build-100"], "the one failed start; no retry before the pause")
        self.assertEqual(e.pool.state.jobs["100"]["status"], "failed")
        e.now += 200
        e.tick()
        self.assertEqual(e.pool.state.jobs["100"]["status"], "running")


# the workspace broker's checks of a pool runner's name: `ci-jit-config`'s `name` (broker/broker/schema.py, `pool_runner`),
# and `remove`, which refuses a name that does not start `ci-pool-` or ends like a persistent runner's (ops_ci_pool.py)
BROKER_POOL_RUNNER = re.compile(r"^ci-pool-[a-z0-9][a-z0-9._-]{0,50}$")
BROKER_PERSISTENT = re.compile(r"-(ci|gate)$")


class BackoffTests(unittest.TestCase):  # I-132; workspace plan 2026-11-09-subtract-first.md, A2 item 1
    def jit_calls(self, e):
        return [c for c in e.commands if c[0] == "jit"]

    def test_a_job_whose_config_fails_pauses_and_the_next_queued_job_of_its_label_starts(self):
        e = Env(self)  # wf-build: cap 1
        e.job("100", created="2026-10-29T19:00:00Z")
        e.job("101", created="2026-10-29T19:00:05Z")
        e.create_fails = lambda name: "-100-" in name
        e.tick()
        self.assertEqual(e.created(), ["ci-pool-wf-build-100-a1", "ci-pool-wf-build-101-a1"], "the next job, in the same pass")
        self.assertEqual(e.lxc.names("start"), ["pool-wf-build-101"])
        failed = e.pool.state.jobs["100"]
        self.assertEqual((failed["status"], failed["failures"], failed["retry_after"]), ("failed", 1, e.now + 120))
        e.lxc.instances["pool-wf-build-101"]["status"] = "Stopped"  # 101's job is done
        e.queued = [j for j in e.queued if j["id"] == "100"]
        for _ in range(7):  # 105 s: the cap has room again, but 100's pause runs
            e.now += 15
            e.tick()
        self.assertEqual(e.creates(), 2, "inside its pause the failed job is not asked for again")
        e.create_fails = lambda name: False
        e.now += 15  # 120 s after the failure
        e.tick()
        self.assertEqual(e.created()[-1], "ci-pool-wf-build-100-a2")
        self.assertEqual(e.lxc.names("start"), ["pool-wf-build-101", "pool-wf-build-100"])

    def test_jobs_that_all_fail_are_each_asked_once_and_each_waits_its_own_pause(self):
        e = Env(self)
        e.job("100", created="2026-10-29T19:00:00Z")
        e.job("101", created="2026-10-29T19:00:05Z")
        e.create_fails = lambda name: True
        e.tick()
        self.assertEqual(e.created(), ["ci-pool-wf-build-100-a1", "ci-pool-wf-build-101-a1"])
        e.now += 15
        e.tick()
        self.assertEqual(e.creates(), 2, "no job is asked for every pass")

    def test_the_pause_after_each_failure_in_a_row_is_2_4_8_16_then_30_minutes(self):
        self.assertEqual([pool.retry_pause(pool.DEFAULTS, n) for n in range(1, 9)], [120, 240, 480, 960, 1800, 1800, 1800, 1800])
        e = Env(self)
        e.job("100")
        e.create_fails = lambda name: True
        asked, pauses = [], []
        for _ in range(3 * 3600 // 15 + 1):  # three hours of passes, 15 s apart
            events = e.events()
            pauses += [ev["retry_in"] for ev in events if ev["event"] == "jit_failed"]
            if len(e.created()) > len(asked):
                asked.append(e.now)
            e.now += 15
        gaps = [b - a for a, b in zip(asked, asked[1:])]
        self.assertEqual(gaps, [120, 240, 480, 960, 1800, 1800, 1800, 1800, 1800])
        self.assertEqual(pauses, [120, 240, 480, 960, 1800, 1800, 1800, 1800, 1800, 1800], "jit_failed says the pause")
        self.assertEqual(e.pool.state.jobs["100"]["failures"], len(asked))

    def test_a_start_that_works_ends_the_run_of_failures(self):
        e = Env(self)
        e.job("100")
        e.create_fails = lambda name: name.endswith(("-a1", "-a2"))
        e.tick()  # a1 fails: 2 minutes
        e.now += 120
        e.tick()  # a2 fails: 4 minutes
        e.now += 240
        e.tick()  # a3 starts
        self.assertEqual(e.lxc.names("start"), ["pool-wf-build-100"])
        e.lxc.instances["pool-wf-build-100"]["status"] = "Stopped"  # its runner took another job; 100 is still queued
        e.create_fails = lambda name: True
        e.now += 15
        e.tick()  # reaped
        e.now += 15
        e.tick()  # a4 fails
        entry = e.pool.state.jobs["100"]
        self.assertEqual((entry["attempt"], entry["failures"], entry["retry_after"] - e.now), (4, 1, 120))

    def test_the_runner_name_carries_the_attempt_so_a_name_github_still_holds_never_blocks(self):
        e = Env(self)
        e.job("128388341032", "wf-gate")
        e.held = {"ci-pool-wf-gate-88341032-a1"}  # GitHub kept attempt 1's runner
        e.tick()
        e.now += 120
        e.tick()
        self.assertEqual(e.created(), ["ci-pool-wf-gate-88341032-a1", "ci-pool-wf-gate-88341032-a2"])
        self.assertEqual(e.lxc.names("start"), ["pool-wf-gate-128388341032"])
        self.assertEqual(e.pool.state.jobs["128388341032"]["runner_name"], "ci-pool-wf-gate-88341032-a2")
        e.running = {"ci-pool-wf-gate-88341032-a2"}  # the running list names the new runner: the container is assigned
        e.now += 400
        e.tick()
        self.assertIn("pool-wf-gate-128388341032", e.lxc.instances)

    def test_every_name_passes_the_broker_s_runner_name_checks(self):
        for label in ("wf-build", "wf-gate", "linux-x64-ci", "a" + "b" * 30):  # the broker's labels, and the longest label
            e = Env(self, labels={label: {"profile": "p", "image": "i", "cap": 1, "memory": "1GiB"}})
            e.job("12345678901234567890", label)
            e.create_fails = lambda name: True
            for _ in range(12):
                e.tick()
                e.now += 1800
            self.assertEqual(len(e.created()), 12)
            for name in e.created():
                self.assertRegex(name, BROKER_POOL_RUNNER)
                self.assertNotRegex(name, BROKER_PERSISTENT)
            self.assertEqual(e.created()[-1], f"ci-pool-{label}-34567890-a12")

    def test_after_a_host_restart_the_stale_runner_of_a_requeued_job_is_removed_before_its_next_attempt(self):
        e = Env(self)
        e.job("900", "wf-gate")
        e.tick()  # runner 77, ci-pool-wf-gate-900-a1
        e.queued, e.running = [], {"ci-pool-wf-gate-900-a1"}
        e.now += 60
        e.tick()
        # the host goes down mid-job: at boot its container is stopped and GitHub still holds the job on runner 77
        e.lxc.instances["pool-wf-gate-900"]["status"] = "Stopped"
        e.running, e.remove_fails = set(), True
        e.restart()
        e.now += 60
        e.tick()  # reaped as runner_exited; GitHub refuses the removal
        entry = pool.State(e.cfg["state_file"]).jobs["900"]
        self.assertEqual((entry["status"], entry["runner_gone"]), ("finished", False))
        # GitHub queues the job again and keeps runner 77 registered under its old name
        e.job("900", "wf-gate")
        e.held, e.remove_fails, e.runner_id = {"ci-pool-wf-gate-900-a1"}, False, "78"
        e.restart()
        e.commands.clear()
        e.now += 60
        events = e.events()
        self.assertEqual(self.jit_calls(e), [["jit", "remove", "o/r", "77"],
                                             ["jit", "create", "o/r", "wf-gate", "ci-pool-wf-gate-900-a2"]])
        self.assertIn({"job": "900", "repo": "o/r", "runner_id": "77"},
                      [{k: ev[k] for k in ("job", "repo", "runner_id")} for ev in events if ev["event"] == "stale_runner_removed"])
        self.assertEqual(e.lxc.names("start"), ["pool-wf-gate-900", "pool-wf-gate-900"])
        self.assertEqual(e.pool.state.jobs["900"]["stale"], [])

    def test_a_stale_runner_github_still_refuses_does_not_hold_the_job_and_is_tried_again(self):
        e = Env(self)
        e.job("900", "wf-gate")
        e.tick()
        e.lxc.instances["pool-wf-gate-900"]["status"] = "Stopped"
        e.remove_fails = True
        e.now += 60
        e.tick()  # reaped; runner 77 not removed. The job is still queued: GitHub gave it back
        e.lxc.fail, e.runner_id = {"start"}, "78"
        e.commands.clear()
        e.now += 60
        e.tick()  # 77 refused again; a2 (runner 78) is made all the same, its start fails and 78 is refused too
        self.assertEqual(self.jit_calls(e), [["jit", "remove", "o/r", "77"],
                                             ["jit", "create", "o/r", "wf-gate", "ci-pool-wf-gate-900-a2"],
                                             ["jit", "remove", "o/r", "78"]])
        entry = e.pool.state.jobs["900"]
        self.assertEqual((entry["status"], entry["stale"], entry["runner_gone"]), ("failed", ["77"], False))
        e.lxc.fail, e.remove_fails, e.runner_id = set(), False, "79"
        e.commands.clear()
        e.now += 120
        e.tick()
        self.assertEqual(self.jit_calls(e), [["jit", "remove", "o/r", "77"], ["jit", "remove", "o/r", "78"],
                                             ["jit", "create", "o/r", "wf-gate", "ci-pool-wf-gate-900-a3"]])
        self.assertEqual(e.pool.state.jobs["900"]["status"], "running")

    def test_a_state_file_from_before_attempts_gets_its_old_runner_removed_and_a_new_name(self):  # I-132 as it was
        e = Env(self)
        e.pool.state.jobs["128388341032"] = {
            "container": "pool-wf-gate-128388341032", "repo": "o/r", "label": "wf-gate", "runner_id": "1099",
            "runner_name": "ci-pool-wf-gate-88341032", "started": e.now - 3000, "status": "finished", "assigned": False,
            "finished": e.now - 2000}
        e.pool.state.save()
        e.restart()
        e.held = {"ci-pool-wf-gate-88341032"}
        e.job("128388341032", "wf-gate")
        e.tick()
        self.assertEqual(self.jit_calls(e), [["jit", "remove", "o/r", "1099"],
                                             ["jit", "create", "o/r", "wf-gate", "ci-pool-wf-gate-88341032-a1"]])
        self.assertEqual(e.lxc.names("start"), ["pool-wf-gate-128388341032"])

    # the review of #119 (rv7c372ca2367a0304): S1 a failure every job shares, S2 a source that hangs, S3 a long wait, S4 the cap
    def wide_gate(self):
        e = Env(self, labels={"wf-gate": {"profile": "p", "image": "i", "cap": 10, "memory": "1GiB"}})
        e.host = {**GOOD, "mem_available_mib": 100000}
        return e

    def test_a_failure_every_job_shares_costs_two_calls_a_pass_doubles_no_pause_and_ends_within_two_minutes(self):  # S1
        e = self.wide_gate()
        for n in range(10):
            e.job(str(500 + n), "wf-gate", created=f"2026-10-29T19:00:{n:02d}Z")
        e.create_fails = lambda name: True
        per_pass, deferred = [], 0
        for _ in range(31 * 60 // 15):  # a 31-minute outage of the source
            n = e.creates()
            deferred += sum(1 for ev in e.events() if ev["event"] == "label_deferred")
            per_pass.append(e.creates() - n)
            e.now += 15
        self.assertEqual(max(per_pass), 2, "a second failure in a pass stops the label for the pass")
        self.assertGreater(deferred, 0)
        self.assertEqual(max(j["failures"] for j in e.pool.state.jobs.values()), 1, "only the first failure was a job's own")
        self.assertEqual({j["retry_after"] - j["finished"] for j in e.pool.state.jobs.values()}, {120})
        over = e.now
        e.create_fails = lambda name: False
        for _ in range(20):
            if e.lxc.names("start"):
                break
            e.tick()
            e.now += 15
        self.assertTrue(e.lxc.names("start"))
        self.assertLessEqual(e.now - over, 120 + 15, "a start within retry_seconds of the source's return")

    def test_a_job_that_fails_while_its_neighbours_start_still_doubles_its_own_pause(self):  # S1: I-132's case stays per job
        e = self.wide_gate()
        e.job("100", "wf-gate", created="2026-10-29T19:00:00Z")
        e.create_fails = lambda name: "-100-" in name
        pauses = []
        for n in range(4):
            e.job(str(200 + n), "wf-gate", created=f"2026-10-29T19:01:{n:02d}Z")  # a neighbour, which starts
            pauses += [ev["retry_in"] for ev in e.events() if ev["event"] == "jit_failed"]
            e.now += pauses[-1]
        self.assertEqual(pauses, [120, 240, 480, 960])

    def test_a_slow_or_hung_source_spends_the_launch_budget_and_the_rest_waits_for_the_next_pass(self):  # S2
        e = self.wide_gate()
        for n in range(3):
            e.job(str(300 + n), "wf-gate", created=f"2026-10-29T19:00:{n:02d}Z")
        e.create_seconds = 70  # each create works, slowly
        events = e.events()
        self.assertEqual(e.created(), ["ci-pool-wf-gate-300-a1", "ci-pool-wf-gate-301-a1"])
        self.assertIn("launch_deferred", [ev["event"] for ev in events])
        e.create_seconds = 0
        e.now += 15
        e.tick()
        self.assertEqual(e.created()[-1], "ci-pool-wf-gate-302-a1")
        h = self.wide_gate()
        for n in range(3):
            h.job(str(300 + n), "wf-gate", created=f"2026-10-29T19:00:{n:02d}Z")
        h.create_seconds, h.create_fails = 125, (lambda name: True)  # a create that hangs to the command timeout
        h.tick()
        self.assertEqual(h.creates(), 1, "one hung call a pass, not one a job")

    def test_after_a_stop_is_asked_for_no_start_begins(self):  # S2
        e = Env(self)
        e.job("100")
        e.stop = True
        events = e.events()
        self.assertEqual(e.creates(), 0)
        self.assertIn(("launch_deferred", "the pool is stopping"), [(ev["event"], ev.get("why")) for ev in events])

    def test_the_first_refused_stale_removal_ends_the_removals_of_that_attempt(self):  # S2
        e = Env(self)
        e.pool.state.jobs["900"] = {
            "container": "pool-wf-gate-900", "repo": "o/r", "label": "wf-gate", "runner_id": "7",
            "runner_name": "ci-pool-wf-gate-900-a3", "started": e.now - 500, "status": "failed", "assigned": False,
            "attempt": 3, "failures": 1, "retry_after": e.now - 1, "finished": e.now - 200, "runner_gone": False,
            "stale": ["5", "6"]}
        e.job("900", "wf-gate")
        e.remove_fails = True
        e.tick()
        self.assertEqual(self.jit_calls(e), [["jit", "remove", "o/r", "5"],
                                             ["jit", "create", "o/r", "wf-gate", "ci-pool-wf-gate-900-a4"]])
        self.assertEqual(e.pool.state.jobs["900"]["stale"], ["5", "6", "7"], "kept, the refused one first")
        e.lxc.instances["pool-wf-gate-900"]["status"] = "Stopped"  # a4's runner took another job and is done
        e.remove_fails = False
        e.now += 15
        e.tick()  # reaped; runner 77 removed
        e.commands.clear()
        e.now += 15
        e.tick()
        self.assertEqual(self.jit_calls(e), [["jit", "remove", "o/r", "5"], ["jit", "remove", "o/r", "6"],
                                             ["jit", "remove", "o/r", "7"],
                                             ["jit", "create", "o/r", "wf-gate", "ci-pool-wf-gate-900-a5"]])

    def test_a_failed_entry_keeps_its_stale_runner_and_attempt_past_the_hard_timeout_and_goes_a_day_after(self):  # S3
        e = Env(self)
        e.lxc.fail, e.remove_fails = {"start"}, True
        e.job("900", "wf-gate")
        e.tick()  # a1's start fails and GitHub refuses the removal of its runner 77
        e.queued = []  # the job waits longer than the hard timeout (behind the cap, in the review's case)
        e.lxc.fail, e.remove_fails, e.runner_id = set(), False, "78"
        e.now += e.cfg["hard_timeout_seconds"] + 100
        e.tick()
        self.assertIn("900", e.pool.state.jobs)
        e.job("900", "wf-gate")
        e.commands.clear()
        e.now += 15
        e.tick()
        self.assertEqual(self.jit_calls(e), [["jit", "remove", "o/r", "77"],
                                             ["jit", "create", "o/r", "wf-gate", "ci-pool-wf-gate-900-a2"]])
        d = Env(self)
        old = {"container": "c", "repo": "o/r", "label": "wf-gate", "runner_id": None, "runner_name": "x", "assigned": False,
               "status": "failed", "started": d.now - 90000, "retry_after": 0}
        d.pool.state.jobs.update({"1": dict(old, finished=d.now - 86401), "2": dict(old, finished=d.now - 86000)})
        d.tick()
        self.assertEqual(sorted(d.pool.state.jobs), ["2"], "an ended failed entry stays a day after it ended")

    def test_a_container_whose_cleanup_failed_still_counts_against_the_cap(self):  # S4
        e = Env(self)  # wf-build: cap 1
        e.job("100", created="2026-10-29T19:00:00Z")
        e.job("101", created="2026-10-29T19:00:05Z")
        e.lxc.fail = {"start", "delete"}
        e.tick()
        self.assertEqual([n for n in e.lxc.instances if n.startswith("pool-wf-build-") and not n.endswith("-spare")],
                         ["pool-wf-build-100"])
        self.assertEqual(e.creates(), 1)


class ReaperTests(unittest.TestCase):
    def started(self):
        e = Env(self)
        e.job("100")
        e.tick()
        return e

    def test_a_container_with_no_job_assigned_in_five_minutes_is_unregistered_and_deleted(self):
        e = self.started()
        e.now += 299
        e.tick()
        self.assertIn("pool-wf-build-100", e.lxc.instances)
        e.now += 2
        e.tick()
        self.assertNotIn("pool-wf-build-100", e.lxc.instances)
        self.assertEqual(e.removed, [["o/r", "77"]])

    def test_a_container_whose_runner_took_a_job_is_left_to_run(self):
        e = self.started()
        e.running = {"ci-pool-wf-build-100-a1"}
        e.now += 600
        e.tick()
        self.assertIn("pool-wf-build-100", e.lxc.instances)
        e.running = set()  # assignment is asked every pass; a runner GitHub will not let go holds a job
        e.remove_fails = True
        e.now += 600
        e.tick()
        self.assertIn("pool-wf-build-100", e.lxc.instances)

    def test_a_job_past_the_hard_timeout_is_deleted_but_not_before(self):
        e = self.started()
        e.running = {"ci-pool-wf-build-100-a1"}
        e.now += 7199
        e.tick()
        self.assertIn("pool-wf-build-100", e.lxc.instances)
        e.now += 2
        e.tick()
        self.assertNotIn("pool-wf-build-100", e.lxc.instances)

    def test_a_stopped_container_is_deleted_and_a_running_one_is_never_killed_for_room(self):
        e = self.started()
        e.running = {"ci-pool-wf-build-100-a1"}
        e.host = {"mem_available_mib": 100, "cpu_psi": 90.0, "mem_psi": 50.0}  # the host is full
        e.job("101")
        e.now += 20
        e.tick()
        self.assertIn("pool-wf-build-100", e.lxc.instances)
        self.assertEqual(e.lxc.names("delete"), [])
        e.lxc.instances["pool-wf-build-100"]["status"] = "Stopped"
        e.now += 15
        e.tick()
        self.assertNotIn("pool-wf-build-100", e.lxc.instances)

    def test_an_unknown_stopped_container_is_cleaned_up_but_a_young_running_one_is_left(self):
        e = Env(self)
        e.lxc.instances["pool-wf-gate-999"] = {"status": "Stopped", "created_at": e.now}
        e.lxc.instances["pool-wf-gate-998"] = {"status": "Running", "created_at": e.now - 60}
        e.lxc.instances["not-a-pool-box"] = {"status": "Stopped", "created_at": 1}
        e.tick()
        self.assertEqual(e.lxc.names("delete"), ["pool-wf-gate-999"])


class WorkerGuardTests(unittest.TestCase):  # I-121: GitHub's running list missed busy runners; removing them cancelled jobs
    C = "pool-wf-build-100"

    def started(self):
        e = Env(self)
        e.job("100")
        e.tick()
        e.queued = []
        return e

    def events(self, e):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            e.pool.tick()
        return [json.loads(line) for line in out.getvalue().splitlines()]

    def jit_removes(self, e):
        return [c for c in e.commands if c[:2] == ["jit", "remove"]]

    def test_a_runner_with_a_worker_missing_from_the_running_list_is_neither_removed_nor_deleted(self):
        e = self.started()
        e.lxc.worker_count[self.C] = 1
        e.now += 301
        evs = self.events(e)
        self.assertIn(self.C, e.lxc.instances)
        self.assertEqual(e.lxc.names("delete"), [])
        self.assertEqual(self.jit_removes(e), [], "never unregistered: that is what cancelled the step")
        self.assertTrue(e.pool.state.jobs["100"]["assigned"])
        [d] = [v for v in evs if v["event"] == "assigned_by_worker"]
        self.assertEqual((d["container"], d["job"], d["workers"]), (self.C, "100", 1))
        self.assertFalse([v for v in evs if v["event"] in ("deleted", "delete_skipped", "diag_kept")])
        e.now += 600  # later passes: still held, and the event is not repeated
        evs = self.events(e)
        self.assertIn(self.C, e.lxc.instances)
        self.assertEqual(self.jit_removes(e), [])
        self.assertFalse([v for v in evs if v["event"] == "assigned_by_worker"])
        e.lxc.instances[self.C]["status"] = "Stopped"  # the job ends, the runner exits: reaped as before
        e.now += 15
        e.tick()
        self.assertNotIn(self.C, e.lxc.instances)

    def test_a_runner_with_no_worker_is_removed_and_deleted_unassigned_as_before(self):
        e = self.started()
        e.now += 301
        evs = self.events(e)
        self.assertEqual(e.lxc.names("workers"), [self.C], "looked inside first")
        self.assertEqual(self.jit_removes(e), [["jit", "remove", "o/r", "77"]])
        self.assertNotIn(self.C, e.lxc.instances)
        [d] = [v for v in evs if v["event"] == "deleted"]
        self.assertEqual(d["why"], "unassigned")
        self.assertFalse([v for v in evs if v["event"] in ("assigned_by_worker", "worker_check_failed")])

    def test_a_check_that_fails_holds_the_container_and_is_logged_once_per_pass(self):
        e = self.started()
        e.lxc.fail.add("workers")
        e.now += 301
        for _ in range(2):
            evs = self.events(e)
            self.assertEqual([(v["container"], v["job"]) for v in evs if v["event"] == "worker_check_failed"],
                             [(self.C, "100")])
            e.now += 15
        self.assertIn(self.C, e.lxc.instances)
        self.assertEqual(e.lxc.names("delete"), [])
        self.assertEqual(self.jit_removes(e), [])
        e.lxc.fail.discard("workers")  # the check answers again, with no Worker: deleted unassigned
        e.tick()
        self.assertNotIn(self.C, e.lxc.instances)

    def test_no_look_inside_before_the_timeout_or_for_a_listed_runner_and_the_hard_timeout_is_unchanged(self):
        e = self.started()
        e.now += 299
        e.tick()
        e.running = {e.pool.state.jobs["100"]["runner_name"]}
        e.now += 600
        e.tick()
        self.assertEqual(e.lxc.names("workers"), [])
        e.lxc.worker_count[self.C] = 1  # a Worker does not hold a container past the hard timeout
        e.running = set()
        e.now = e.pool.state.jobs["100"]["started"] + 7201
        e.tick()
        self.assertNotIn(self.C, e.lxc.instances)
        self.assertEqual(e.lxc.names("workers"), [])

    def test_a_source_that_fails_still_deletes_nothing_and_looks_inside_nothing(self):
        e = self.started()
        e.source_fails = True
        e.now += 301
        e.tick()
        self.assertIn(self.C, e.lxc.instances)
        self.assertEqual(e.lxc.names("workers"), [])


class MemoryTests(unittest.TestCase):  # B41 item 14
    def events(self, e, name):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            e.pool.tick()
        return [d for d in map(json.loads, out.getvalue().splitlines()) if d.get("event") == name]

    def test_the_deleted_event_carries_the_highest_peak_and_oom_kill_seen(self):
        e = Env(self)
        e.job("100")
        e.tick()
        c = "pool-wf-build-100"
        e.running = {e.pool.state.jobs["100"]["runner_name"]}
        e.queued = []
        e.mem[c] = {"memory_peak_mib": 3000, "oom_kill": 0}
        e.tick()
        e.mem[c] = {"memory_peak_mib": 4500, "oom_kill": 1}
        e.tick()
        e.lxc.instances[c]["status"] = "Stopped"
        del e.mem[c]  # a stopped container has no cgroup left
        [d] = self.events(e, "deleted")
        self.assertEqual((d["container"], d["why"], d["memory_peak_mib"], d["oom_kill"]), (c, "runner_exited", 4500, 1))

    def test_an_orphan_reports_null_memory(self):  # review of #84, F3
        e = Env(self)
        e.lxc.instances["pool-wf-gate-999"] = {"status": "Stopped", "created_at": e.now - 60}
        [d] = self.events(e, "deleted")
        self.assertEqual((d["why"], d["memory_peak_mib"], d["oom_kill"]), ("orphan", None, None))

    def test_a_container_never_read_reports_null(self):
        e = Env(self)
        e.job("100")
        e.tick()
        e.lxc.instances["pool-wf-build-100"]["status"] = "Stopped"
        [d] = self.events(e, "deleted")
        self.assertIsNone(d["memory_peak_mib"])
        self.assertIsNone(d["oom_kill"])

    def test_read_memory_reads_the_containers_cgroup(self):
        with tempfile.TemporaryDirectory() as d:
            base = os.path.join(d, "lxc.payload.pool-wf-build-1")
            os.mkdir(base)
            with open(os.path.join(base, "memory.peak"), "w") as f:
                f.write("%d\n" % (4 * 1024 ** 3 + 1))
            with open(os.path.join(base, "memory.events"), "w") as f:
                f.write("low 0\nhigh 0\nmax 7\noom 2\noom_kill 1\noom_group_kill 0\n")
            self.assertEqual(pool.read_memory("pool-wf-build-1", root=d), {"memory_peak_mib": 4097, "oom_kill": 1})
            self.assertEqual(pool.read_memory("gone", root=d), {"memory_peak_mib": None, "oom_kill": None})


class DiagTests(unittest.TestCase):  # I-121: the runner's _diag log survives the delete of an unassigned container
    C = "pool-wf-build-100"

    def started(self, **over):
        e = Env(self, **over)
        e.job("100")
        e.tick()
        e.lxc.logs[self.C] = {"Runner_20261105-050000-utc.log": (50.0, b"runner log\n"),
                              "Worker_20261105-050100-utc.log": (60.0, b"Worker: received SIGTERM\n")}
        os.makedirs(os.path.join(e.cgroup, "lxc.payload." + self.C))
        for k, v in (("memory.events", "oom_kill 1\n"), ("memory.peak", "12345\n")):
            with open(os.path.join(e.cgroup, "lxc.payload." + self.C, k), "w") as f:
                f.write(v)
        return e

    def events(self, e, name=None):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            e.pool.tick()
        return [d for d in map(json.loads, out.getvalue().splitlines()) if name is None or d.get("event") == name]

    def tick_events(self, e):
        e.now += 301
        return self.events(e)

    @staticmethod
    def mode(path):
        return os.stat(path).st_mode & 0o777

    def test_an_unassigned_container_keeps_its_logs_and_memory_files_before_it_is_deleted(self):
        e = self.started()
        evs = self.tick_events(e)
        [kept] = [d for d in evs if d["event"] == "diag_kept"]
        path = os.path.join(e.diag_dir, "100")
        self.assertEqual((kept["path"], kept["container"], kept["job"], kept["why"]), (path, self.C, "100", "unassigned"))
        self.assertEqual(kept["files"], ["Runner_20261105-050000-utc.log", "Worker_20261105-050100-utc.log",
                                         "journal-runner.txt", "journal.txt", "memory.events", "memory.peak", "meta.json", "ps.txt"])
        with open(os.path.join(path, "Worker_20261105-050100-utc.log"), "rb") as f:
            self.assertEqual(f.read(), b"Worker: received SIGTERM\n")
        with open(os.path.join(path, "memory.events")) as f:
            self.assertEqual(f.read(), "oom_kill 1\n")
        with open(os.path.join(path, "meta.json")) as f:
            self.assertEqual(json.load(f)["why"], "unassigned")
        self.assertEqual(kept["bytes"], sum(os.path.getsize(os.path.join(path, f)) for f in os.listdir(path)))
        self.assertEqual((self.mode(e.diag_dir), self.mode(path)), (0o700, 0o700))
        for f in os.listdir(path):
            self.assertEqual(self.mode(os.path.join(path, f)), 0o600, f)
        order = [d["event"] for d in evs if d["event"] in ("diag_kept", "deleted")]
        self.assertEqual(order, ["diag_kept", "deleted"])
        self.assertLess([c[0] for c in e.lxc.calls].index("tail_file"), [c[0] for c in e.lxc.calls].index("delete"))

    def test_a_job_past_the_hard_timeout_keeps_them_too(self):
        e = self.started()
        e.running = {e.pool.state.jobs["100"]["runner_name"]}
        e.now += 7201
        evs = self.events(e)
        self.assertEqual([d["why"] for d in evs if d["event"] == "diag_kept"], ["hard_timeout"])

    def test_other_deletions_keep_nothing_and_do_not_look_inside(self):
        e = self.started()
        e.lxc.instances[self.C]["status"] = "Stopped"
        evs = self.events(e)
        self.assertEqual([d["why"] for d in evs if d["event"] == "deleted"], ["runner_exited"])
        e.lxc.instances["pool-wf-gate-999"] = {"status": "Stopped", "created_at": e.now - 60}
        self.events(e)
        self.assertEqual(e.lxc.names("list_logs"), [])
        self.assertFalse(os.path.exists(e.diag_dir))

    def test_a_runner_that_could_not_be_unregistered_keeps_its_container_and_nothing_is_copied(self):
        e = self.started()
        e.remove_fails = True
        self.tick_events(e)
        self.assertIn(self.C, e.lxc.instances)
        self.assertEqual(e.lxc.names("list_logs"), [])

    def test_only_log_files_directly_in_the_diag_directory_are_read(self):
        e = self.started()
        e.lxc.logs[self.C].update({".credentials": (99.0, b"SECRET"), ".runner": (98.0, b"SECRET"), "../evil.log": (97.0, b"x"),
                                   "a b.log": (96.0, b"x"), "jit": (95.0, b"SECRET-JIT"), "x.log.gz": (94.0, b"x")})
        self.tick_events(e)
        self.assertEqual(sorted(os.path.basename(c[2]) for c in e.lxc.calls if c[0] == "tail_file"),
                         ["Runner_20261105-050000-utc.log", "Worker_20261105-050100-utc.log"])
        self.assertEqual(sorted(os.listdir(os.path.join(e.diag_dir, "100"))),
                         ["Runner_20261105-050000-utc.log", "Worker_20261105-050100-utc.log", "journal-runner.txt",
                          "journal.txt", "memory.events", "memory.peak", "meta.json", "ps.txt"])
        for f in os.listdir(os.path.join(e.diag_dir, "100")):
            with open(os.path.join(e.diag_dir, "100", f), "rb") as fh:
                self.assertNotIn(b"SECRET", fh.read())
        self.assertEqual(os.listdir(e.diag_dir), ["100"])  # nothing escaped by a name with ..

    def test_the_runner_directory_is_the_configured_one(self):
        e = self.started(diag_runner_dir="/srv/runner/_diag")
        self.tick_events(e)
        self.assertIn(("list_logs", self.C, "/srv/runner/_diag"), e.lxc.calls)
        self.assertIn(("tail_file", self.C, "/srv/runner/_diag/Worker_20261105-050100-utc.log"), e.lxc.calls)

    def test_a_copy_that_fails_never_blocks_the_delete(self):
        for fail in ({"list_logs"}, {"tail_file"}):
            e = self.started()
            e.lxc.fail = fail
            evs = self.tick_events(e)
            self.assertNotIn(self.C, e.lxc.instances, fail)
            self.assertEqual([d["event"] for d in evs if d["event"] == "deleted"], ["deleted"])
            self.assertTrue([d for d in evs if d["event"] == "diag_failed"], fail)
        # the memory files, the journals and the process list are still kept when the logs are not
        self.assertEqual(sorted(os.listdir(os.path.join(e.diag_dir, "100"))),
                         ["journal-runner.txt", "journal.txt", "memory.events", "memory.peak", "meta.json", "ps.txt"])
        self.assertEqual([d["event"] for d in evs if d["event"] == "diag_kept"], ["diag_kept"])

    def test_nothing_readable_leaves_no_directory_and_no_diag_kept(self):
        e = Env(self)
        e.job("100")
        e.tick()
        e.lxc.fail = {"list_logs", "journal", "journal_unit", "processes"}
        evs = self.tick_events(e)
        self.assertNotIn(self.C, e.lxc.instances)
        self.assertEqual([d["event"] for d in evs if d["event"] in ("diag_kept", "diag_failed")].count("diag_kept"), 0)
        self.assertEqual(os.listdir(e.diag_dir), [])

    def test_a_diag_directory_that_cannot_be_made_never_blocks_the_delete(self):
        e = self.started()
        with open(e.diag_dir, "w") as f:  # a file where the directory should be
            f.write("x")
        evs = self.tick_events(e)
        self.assertNotIn(self.C, e.lxc.instances)
        self.assertEqual([d["step"] for d in evs if d["event"] == "diag_failed"], ["diag_dir"])

    def test_a_delete_that_fails_does_not_copy_again_on_the_next_pass(self):
        e = self.started()
        e.lxc.fail = {"delete"}
        self.tick_events(e)
        e.now += 15
        self.events(e)
        self.assertEqual(e.lxc.names("list_logs"), [self.C])
        self.assertEqual(os.listdir(e.diag_dir), ["100"])
        e.lxc.fail = set()
        e.now += 15
        self.events(e)
        self.assertNotIn(self.C, e.lxc.instances)
        self.assertEqual(e.lxc.names("list_logs"), [self.C])

    def test_the_off_switch(self):
        e = self.started(diag_dir="")
        evs = self.tick_events(e)
        self.assertNotIn(self.C, e.lxc.instances)
        self.assertEqual(e.lxc.names("list_logs"), [])
        self.assertFalse([d for d in evs if d["event"].startswith("diag_")])

    def test_the_newest_files_and_the_last_kilobytes_only(self):
        e = self.started(diag_max_files=2, diag_max_file_kb=1)
        e.lxc.logs[self.C] = {f"f{i}.log": (float(i), bytes([65 + i]) * 3000) for i in range(5)}
        self.tick_events(e)
        got = sorted(f for f in os.listdir(os.path.join(e.diag_dir, "100")) if f.endswith(".log"))
        self.assertEqual(got, ["f3.log", "f4.log"])
        self.assertEqual(os.path.getsize(os.path.join(e.diag_dir, "100", "f4.log")), 1024)

    def test_the_copy_stops_at_its_time_limit_and_the_delete_goes_on(self):
        e = self.started(diag_timeout_seconds=10)
        e.lxc.tail_hook = lambda: setattr(e, "now", e.now + 11)  # every read takes 11 s
        evs = self.tick_events(e)
        self.assertNotIn(self.C, e.lxc.instances)
        self.assertEqual(len(e.lxc.names("tail_file")), 1)
        self.assertTrue([d for d in evs if d["event"] == "diag_failed" and d["error"] == "copy time is up"])

    @staticmethod
    def own_dir(path):
        """A diag directory as the pool makes it: 0700, this user's."""
        os.makedirs(path)
        os.chmod(path, 0o700)

    @staticmethod
    def job_dir(root, jid, data, mtime, meta=True):
        d = os.path.join(root, jid)
        os.mkdir(d)
        with open(os.path.join(d, "x.log"), "wb") as f:
            f.write(data)
        if meta:
            with open(os.path.join(d, "meta.json"), "w") as f:
                f.write("{}")
        os.utime(d, (mtime, mtime))
        return d

    def test_retention_removes_the_oldest_directories_by_count_and_size_and_nothing_else(self):
        e = self.started(diag_max_jobs=3, diag_max_mb=1)
        self.own_dir(e.diag_dir)
        for i, jid in enumerate(("1", "2", "3")):
            self.job_dir(e.diag_dir, jid, b"x" * 100, 100 + i)
        os.mkdir(os.path.join(e.diag_dir, "keep-me"))  # not a job directory
        os.symlink("/", os.path.join(e.diag_dir, "9"))  # not a real directory
        self.job_dir(e.diag_dir, "0", b"x" * 100, 50, meta=False)  # the oldest, but not the pool's: no meta.json
        evs = self.tick_events(e)
        self.assertEqual(sorted(os.listdir(e.diag_dir)), ["0", "100", "2", "3", "9", "keep-me"])
        self.assertEqual([d["path"] for d in evs if d["event"] == "diag_removed"], [os.path.join(e.diag_dir, "1")])
        e = self.started(diag_max_jobs=50, diag_max_mb=1)  # by size: an old 1 MB directory goes, the new one stays
        self.own_dir(e.diag_dir)
        self.job_dir(e.diag_dir, "7", b"x" * 1048576, 100)
        self.tick_events(e)
        self.assertEqual(os.listdir(e.diag_dir), ["100"])

    def test_one_job_id_kept_twice_gets_its_own_directory(self):
        e = self.started()
        self.own_dir(e.diag_dir)
        os.mkdir(os.path.join(e.diag_dir, "100"))
        evs = self.tick_events(e)
        [kept] = [d for d in evs if d["event"] == "diag_kept"]
        self.assertEqual(kept["path"], os.path.join(e.diag_dir, "100.1"))

    def test_an_existing_shared_directory_is_neither_changed_nor_pruned(self):  # review F1, the reviewer's case
        e = self.started(diag_max_jobs=1, diag_max_mb=1)
        os.makedirs(e.diag_dir)
        os.chmod(e.diag_dir, 0o755)  # a shared directory, such as /var/log or /srv/backups
        old = self.job_dir(e.diag_dir, "2024", b"x" * 2000000, 100)  # someone else's data: digit-named, old and big
        evs = self.tick_events(e)
        self.assertNotIn(self.C, e.lxc.instances)  # the delete goes on
        self.assertEqual(self.mode(e.diag_dir), 0o755)  # not chmodded
        self.assertEqual(sorted(os.listdir(e.diag_dir)), ["2024"])  # not pruned, nothing written
        self.assertEqual(os.path.getsize(os.path.join(old, "x.log")), 2000000)
        self.assertEqual([d["step"] for d in evs if d["event"] == "diag_failed"], ["diag_dir"])
        self.assertFalse([d for d in evs if d["event"] in ("diag_kept", "diag_removed")])
        self.assertEqual(e.lxc.names("list_logs"), [])

    def test_retention_leaves_a_job_directory_without_the_pool_s_meta_json(self):
        e = self.started(diag_max_jobs=1, diag_max_mb=1)
        self.own_dir(e.diag_dir)  # the pool's user, 0700: used
        self.job_dir(e.diag_dir, "2024", b"x" * 2000000, 100, meta=False)
        evs = self.tick_events(e)
        self.assertEqual(sorted(os.listdir(e.diag_dir)), ["100", "2024"])
        self.assertFalse([d for d in evs if d["event"] == "diag_removed"])
        self.assertEqual(self.mode(e.diag_dir), 0o700)

    def test_a_missing_diag_directory_is_made_0700_and_a_symlink_is_refused(self):
        e = self.started()
        old = os.umask(0o277)  # a umask that would leave it 0500
        try:
            self.tick_events(e)
        finally:
            os.umask(old)
        self.assertEqual(self.mode(e.diag_dir), 0o700)
        self.assertEqual(os.listdir(e.diag_dir), ["100"])
        e = self.started()
        target = os.path.join(e.tmp.name, "elsewhere")
        self.own_dir(target)
        os.symlink(target, e.diag_dir)
        evs = self.tick_events(e)
        self.assertEqual([d["step"] for d in evs if d["event"] == "diag_failed"], ["diag_dir"])
        self.assertEqual(os.listdir(target), [])

    def test_a_meta_json_that_cannot_be_written_keeps_nothing(self):  # retention needs it, so no directory goes without it
        e = self.started()
        orig = os.open

        def no_meta(path, *a, **kw):
            if os.path.basename(str(path)) == "meta.json":
                raise OSError("disk full")
            return orig(path, *a, **kw)
        with unittest.mock.patch("os.open", no_meta):
            evs = self.tick_events(e)
        self.assertNotIn(self.C, e.lxc.instances)
        self.assertEqual(os.listdir(e.diag_dir), [])
        self.assertIn("meta.json", [d["step"] for d in evs if d["event"] == "diag_failed"])
        self.assertFalse([d for d in evs if d["event"] == "diag_kept"])

    def test_the_logs_are_read_as_the_owner_of_the_runner_directory_never_as_root(self):  # review F2
        e = self.started()
        self.tick_events(e)
        self.assertIn(("owner", self.C, "/opt/actions-runner/_diag"), e.lxc.calls)
        self.assertEqual(e.lxc.exec_users, [(1001, 1001)] * 3)  # one listing, two reads
        e = self.started()
        e.lxc.diag_owner = (0, 0)
        evs = self.tick_events(e)
        self.assertNotIn(self.C, e.lxc.instances)
        self.assertEqual(e.lxc.names("list_logs") + e.lxc.names("tail_file"), [])
        [fail] = [d for d in evs if d["event"] == "diag_failed"]
        self.assertEqual(fail["step"], "list")
        self.assertIn("owned by root", fail["error"])

    def two_unassigned(self, **over):
        e = self.started(labels={"wf-build": {"profile": "p", "image": "i", "cap": 2, "memory": "1GiB"}}, **over)
        e.lxc.logs[self.C]["Worker_20261105-050200-utc.log"] = (70.0, b"third\n")
        e.job("200")
        e.tick()
        e.lxc.logs["pool-wf-build-200"] = dict(e.lxc.logs[self.C])
        self.assertEqual(sorted(e.lxc.instances), [self.C, "pool-wf-build-200", "pool-wf-build-spare"])
        return e

    def test_a_pass_spends_at_most_its_copy_budget_then_deletes_without_copying(self):  # review F3
        e = self.two_unassigned(diag_pass_budget_seconds=30, diag_timeout_seconds=60)
        e.lxc.tail_hook = lambda: setattr(e, "now", e.now + 20)  # every read takes 20 s
        evs = self.tick_events(e)
        self.assertEqual(sorted(e.lxc.instances), ["pool-wf-build-spare"])  # both deleted
        self.assertEqual(len([d for d in evs if d["event"] == "deleted"]), 2)
        self.assertEqual(len(e.lxc.names("tail_file")), 2)  # the first copy stops at the pass budget (30 s), not at its 60 s
        self.assertEqual(e.lxc.names("list_logs"), [self.C])  # the second container is not looked into
        self.assertEqual([(d["container"], d["step"]) for d in evs if d["event"] == "diag_failed" and d["step"] == "budget"],
                         [("pool-wf-build-200", "budget")])
        self.assertEqual([d["container"] for d in evs if d["event"] == "diag_kept"], [self.C])
        e.lxc.tail_hook = lambda: None  # the next pass has a fresh budget
        with contextlib.redirect_stdout(io.StringIO()):
            e.pool.diag.start_pass()
            self.assertIsNotNone(e.pool.diag.keep("pool-wf-build-200", {"repo": "o/r"}, "200", "unassigned"))

    def test_a_stop_request_ends_the_copying_and_the_deletes_go_on(self):
        stop = []
        e = self.two_unassigned()
        e.pool.diag.stopping = lambda: bool(stop)
        e.lxc.tail_hook = lambda: stop.append(1)  # SIGTERM arrives during the first read
        evs = self.tick_events(e)
        self.assertEqual(sorted(e.lxc.instances), ["pool-wf-build-spare"])
        self.assertEqual(len(e.lxc.names("tail_file")), 1)
        self.assertEqual(e.lxc.names("list_logs"), [self.C])
        self.assertEqual([d["container"] for d in evs if d["event"] == "diag_failed" and d["step"] == "stopping"],
                         ["pool-wf-build-200"])
        self.assertTrue(pool.Pool(e.cfg, e.lxc, e.pool.state, stopping=lambda: True).diag.stopping())

    JIT = b"QUJD" * 300  # a long base64 run standing in for a just-in-time config, 1.2 KB

    def test_the_journal_and_the_process_list_are_kept_as_root_with_the_jit_config_removed(self):  # I-121 follow-up
        e = self.started()
        e.lxc.journal_text = (b"2026-11-05T09:39:41.1+00:00 c sudo[42]: root : PWD=/opt/actions-runner ; USER=runner ; "
                              b"COMMAND=./run.sh --jitconfig " + self.JIT + b"\n"
                              b"2026-11-05T09:39:41.2+00:00 c systemd[1]: Stopping ci-pool-runner.service...\n")
        # ps prints command names only (Lxc.processes), but ps.txt is scrubbed all the same
        e.lxc.ps_text = (b"  PID  PPID  PGID   SID USER STAT STARTED COMMAND\n"
                         b"   80    79    79    79 root S Thu Nov  5 09:30:01 2026 sudo -u runner -H ./run.sh --jitconfig "
                         + self.JIT + b"\n   81    80    79    79 runner S Thu Nov  5 09:30:01 2026 /bin/bash ./run.sh "
                         b"--jitconfig=" + self.JIT[:150] + b"\n")
        self.tick_events(e)
        path = os.path.join(e.diag_dir, "100")
        with open(os.path.join(path, "journal.txt"), "rb") as f:
            journal = f.read()
        with open(os.path.join(path, "ps.txt"), "rb") as f:
            ps = f.read()
        self.assertIn(b"systemd[1]: Stopping ci-pool-runner.service...", journal)
        self.assertIn(b"; USER=runner ; COMMAND=[removed by ci-pool]\n", journal)  # sudo's logged command, whole
        self.assertIn(b"   80    79    79    79 root S Thu Nov  5 09:30:01 2026 sudo -u runner -H ./run.sh --jitconfig "
                      b"[removed by ci-pool]\n", ps)
        self.assertIn(b"--jitconfig=[removed by ci-pool]\n", ps)
        for text in (journal, ps):
            self.assertNotIn(self.JIT[:100], text)
            self.assertNotIn(b"QUJDQUJD", text)
        for f in ("journal.txt", "ps.txt"):
            self.assertEqual(self.mode(os.path.join(path, f)), 0o600)
        [journal_call] = [c for c in e.lxc.calls if c[0] == "journal"]
        [ps_call] = [c for c in e.lxc.calls if c[0] == "processes"]
        self.assertEqual(journal_call[1:4], (self.C, 400, 256 * 1024))
        self.assertEqual(ps_call[1:3], (self.C, 64 * 1024))
        self.assertLessEqual(max(journal_call[4], ps_call[3]), pool.DIAG_SNAPSHOT_SECONDS)
        calls = [c[0] for c in e.lxc.calls]
        self.assertLess(max(calls.index("journal"), calls.index("processes")), calls.index("delete"))

    def test_sudo_s_logged_command_does_not_reach_the_journal(self):  # review F1: a step's `sudo` with a secret
        e = self.started()
        e.lxc.journal_text = (b"2026-11-05T09:35:00.1+00:00 c sudo[77]:   runner : PWD=/w ; USER=root ; "
                              b"COMMAND=/usr/bin/docker login -p hunter2 ghcr.io\n"
                              b"2026-11-05T09:35:00.2+00:00 c sudo[77]: pam_unix(sudo:session): session opened for user root\n")
        self.tick_events(e)
        with open(os.path.join(e.diag_dir, "100", "journal.txt"), "rb") as f:
            journal = f.read()
        self.assertNotIn(b"hunter2", journal)
        self.assertNotIn(b"docker", journal)
        self.assertIn(b"sudo[77]:   runner : PWD=/w ; USER=root ; COMMAND=[removed by ci-pool]\n", journal)  # who ran it stays
        self.assertIn(b"session opened for user root\n", journal)

    def test_a_jit_config_split_by_sudo_into_continued_lines_does_not_survive(self):  # review F2
        e = self.started()
        e.lxc.journal_text = (b"2026-11-05T09:30:01.1+00:00 c sudo[42]: root : PWD=/opt/actions-runner ; USER=runner ; "
                              b"COMMAND=./run.sh --jitconfig\n"
                              b"2026-11-05T09:30:01.1+00:00 c sudo[42]: root : (command continued) " + self.JIT[:950] + b"\n"
                              b"2026-11-05T09:30:01.1+00:00 c sudo[42]: root : (command continued) " + self.JIT[950:1100]
                              + b"\n")
        self.tick_events(e)
        with open(os.path.join(e.diag_dir, "100", "journal.txt"), "rb") as f:
            journal = f.read()
        self.assertNotIn(b"QUJD", journal)
        self.assertEqual(journal.count(b"(command continued)[removed by ci-pool]\n"), 2)

    def test_the_runner_unit_s_journal_is_kept_apart_scrubbed(self):  # review F3: dockerd lines can fill the last 400
        e = self.started()
        e.lxc.runner_journal_text = (b"2026-11-05T09:39:41.1+00:00 c sudo[42]: root : (command continued) " + self.JIT[:150]
                                     + b"\n2026-11-05T09:39:41.2+00:00 c systemd[1]: Stopping ci-pool-runner.service...\n")
        evs = self.tick_events(e)
        path = os.path.join(e.diag_dir, "100", "journal-runner.txt")
        with open(path, "rb") as f:
            got = f.read()
        self.assertIn(b"systemd[1]: Stopping ci-pool-runner.service...\n", got)
        self.assertNotIn(b"QUJD", got)
        self.assertEqual(self.mode(path), 0o600)
        [call] = [c for c in e.lxc.calls if c[0] == "journal_unit"]
        self.assertEqual((call[1:4], call[5]), ((self.C, 100, 256 * 1024), "ci-pool-runner.service"))
        self.assertLessEqual(call[4], pool.DIAG_SNAPSHOT_SECONDS)
        [kept] = [d for d in evs if d["event"] == "diag_kept"]
        self.assertIn("journal-runner.txt", kept["files"])

    def test_scrub_removes_the_jit_config_in_every_form_and_leaves_other_text(self):
        for line, want in ((b"x --jitconfig abc+/= y", b"x --jitconfig [removed by ci-pool] y"),
                           (b"x --jitconfig 'abc' y", b"x --jitconfig '[removed by ci-pool]' y"),
                           (b'x --jitconfig="abc"', b'x --jitconfig="[removed by ci-pool]"'),
                           (b"x --jitconfig  abc", b"x --jitconfig  [removed by ci-pool]"),
                           (b"blob " + self.JIT + b" end", b"blob [long token removed by ci-pool] end"),
                           (b"Runner will be shutdown for UserCancelled", b"Runner will be shutdown for UserCancelled"),
                           (b"t c sudo[9]: a : USER=root ; COMMAND=/bin/x -p pw\nnext", b"t c sudo[9]: a : USER=root ; "
                            b"COMMAND=[removed by ci-pool]\nnext"),
                           (b"t c sudo: a : (command continued) rest", b"t c sudo: a : (command continued)[removed by ci-pool]"),
                           (b"t c app[3]: COMMAND=kept, not sudo", b"t c app[3]: COMMAND=kept, not sudo"),
                           (b"t c sudo[9]: pam_unix(sudo:session): session closed", b"t c sudo[9]: pam_unix(sudo:session): "
                            b"session closed"),
                           (b"sha256 " + b"a" * 64, b"sha256 " + b"a" * 64)):
            self.assertEqual(pool.scrub(line), want, line[:40])

    def test_a_journal_or_process_list_that_fails_is_logged_and_the_rest_is_kept_and_deleted(self):
        for fail, gone in (("journal", "journal.txt"), ("journal_unit", "journal-runner.txt"), ("processes", "ps.txt")):
            e = self.started()
            e.lxc.fail = {fail}
            evs = self.tick_events(e)
            self.assertNotIn(self.C, e.lxc.instances, fail)
            self.assertEqual([d["event"] for d in evs if d["event"] == "deleted"], ["deleted"])
            [failed] = [d for d in evs if d["event"] == "diag_failed"]
            self.assertEqual((failed["step"], failed["container"], failed["job"]), (gone, self.C, "100"))
            self.assertIn("exited 1", failed["error"])
            [kept] = [d for d in evs if d["event"] == "diag_kept"]
            self.assertNotIn(gone, kept["files"])
            self.assertIn("Worker_20261105-050100-utc.log", kept["files"])
            self.assertEqual(sorted(kept["files"]), sorted(os.listdir(os.path.join(e.diag_dir, "100"))))

    def test_the_journal_and_the_process_list_count_in_the_copy_and_pass_budgets(self):
        e = self.two_unassigned(diag_pass_budget_seconds=30, diag_timeout_seconds=60)
        e.lxc.snapshot_hook = lambda: setattr(e, "now", e.now + 20)  # every ps or journalctl takes 20 s
        evs = self.tick_events(e)
        self.assertEqual(sorted(e.lxc.instances), ["pool-wf-build-spare"])  # both deleted
        self.assertEqual([c[:2] for c in e.lxc.calls if c[0] in ("processes", "journal", "journal_unit")],
                         [("processes", self.C), ("journal_unit", self.C)])  # 40 s: past the 30 s pass budget
        self.assertEqual(e.lxc.names("tail_file"), [])  # the pass budget was spent before the logs
        self.assertEqual(sorted(os.listdir(os.path.join(e.diag_dir, "100"))),
                         ["journal-runner.txt", "memory.events", "memory.peak", "meta.json", "ps.txt"])
        self.assertEqual([(d["container"], d["step"]) for d in evs if d["event"] == "diag_failed" and d["step"] == "budget"],
                         [("pool-wf-build-200", "budget")])
        self.assertTrue([d for d in evs if d["event"] == "diag_failed" and d["error"] == "copy time is up"])
        # a short budget shortens the calls' own time limit, and a spent one skips the journal
        e = self.started(diag_timeout_seconds=5)
        e.lxc.snapshot_hook = lambda: setattr(e, "now", e.now + 6)
        evs = self.tick_events(e)
        self.assertEqual([c for c in e.lxc.calls if c[0] in ("processes", "journal", "journal_unit")],
                         [("processes", self.C, 65536, 5)])
        self.assertEqual([d["step"] for d in evs if d["event"] == "diag_failed"][:1], ["journal-runner.txt"])
        self.assertNotIn(self.C, e.lxc.instances)

    def test_a_stop_request_skips_the_journal(self):
        stop = []
        e = self.started()
        e.pool.diag.stopping = lambda: bool(stop)
        e.lxc.snapshot_hook = lambda: stop.append(1)
        evs = self.tick_events(e)
        self.assertEqual(e.lxc.names("processes"), [self.C])
        self.assertEqual(e.lxc.names("journal_unit") + e.lxc.names("journal"), [])
        self.assertIn(("journal-runner.txt", "the pool is stopping"),
                      [(d["step"], d["error"]) for d in evs if d["event"] == "diag_failed"])
        self.assertNotIn(self.C, e.lxc.instances)

    def test_the_config_checks_the_diag_keys(self):
        base = {"version": 1, "repos": ["o/r"], "source_cmd": ["a"], "jit_cmd": ["b"],
                "labels": {"wf-build": {"profile": "p", "image": "i", "cap": 1, "memory": "5GiB"}}}

        def load(**over):
            with tempfile.TemporaryDirectory() as d:
                p = os.path.join(d, "c.json")
                with open(p, "w") as f:
                    json.dump({**base, **over}, f)
                return pool.load_config(p)
        cfg = load()
        self.assertEqual((cfg["diag_dir"], cfg["diag_runner_dir"]), ("/var/log/ci-pool/diag", "/opt/actions-runner/_diag"))
        self.assertEqual(load(diag_dir="")["diag_dir"], "")
        self.assertEqual(cfg["diag_pass_budget_seconds"], 45)
        self.assertEqual(load(diag_dir="/srv/ci-pool/diag")["diag_dir"], "/srv/ci-pool/diag")
        for bad in ({"diag_dir": "relative"}, {"diag_dir": 5}, {"diag_runner_dir": "_diag"}, {"diag_max_files": 0},
                    {"diag_max_mb": True}, {"diag_max_jobs": "9"}, {"diag_timeout_seconds": -1}, {"diag_max_file_kb": 1.5},
                    {"diag_pass_budget_seconds": 0}):
            with self.assertRaises(pool.PoolError, msg=str(bad)):
                load(**bad)
        for d in ("/", "/var", "/srv", "/root", "/var/log", "/var/log/", "/var/lib", "/var/backups", "/etc/ci-pool",
                  "/usr/local/x", "/proc/1", "/home/someone", "/var/log/../log/diag", "//var/log/x", "/tmp/diag"):
            with self.assertRaises(pool.PoolError, msg=d):
                load(diag_dir=d)


class LxcDiagTests(unittest.TestCase):  # the real Lxc methods, against a stub `lxc` script
    def lxc(self, body):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = os.path.join(tmp.name, "lxc")
        with open(path, "w") as f:
            f.write("#!/bin/sh\n" + body)
        os.chmod(path, 0o755)
        return pool.Lxc(path)

    def test_list_logs_parses_find_output_and_drops_other_names(self):
        x = self.lxc('echo "$@" > "$0.args"\n'
                     'printf "10.5 120 Worker_a.log\\n20.25 7 Runner_b.log\\n30.0 9 .credentials\\n31.0 9 x y.log\\n'
                     '32.0 9 ..log\\nnot a line\\n"\n')
        self.assertEqual(x.list_logs("c1", "/opt/actions-runner/_diag", 5, (1001, 1002)),
                         [(32.0, 9, "..log"), (20.25, 7, "Runner_b.log"), (10.5, 120, "Worker_a.log")])
        with open(x.binary + ".args") as f:
            args = f.read().split()
        self.assertEqual(args[:8], ["exec", "c1", "--user", "1001", "--group", "1002", "--", "find"])  # never as root
        self.assertEqual(args[8:-1], ["/opt/actions-runner/_diag", "-maxdepth", "1", "-type", "f", "-links", "1", "-name",
                                      "*.log", "-printf", "%T@", "%s"])  # -links 1: a hard link to another file is not listed
        self.assertTrue(args[-1].startswith("%f"))  # the stub's echo turns the \\n into a newline

    def test_tail_file_runs_as_the_given_user_and_owner_reads_the_owner(self):
        x = self.lxc('echo "$@" > "$0.args"\necho "1001 1002"\n')
        x.tail_file("c1", "/d/f.log", 10, 5, (1001, 1002))
        with open(x.binary + ".args") as f:
            self.assertEqual(f.read().split(), ["exec", "c1", "--user", "1001", "--group", "1002", "--", "tail", "-c", "10",
                                                "--", "/d/f.log"])
        self.assertEqual(x.owner("c1", "/d", 5), (1001, 1002))
        with open(x.binary + ".args") as f:
            self.assertEqual(f.read().split(), ["exec", "c1", "--", "stat", "-c", "%u", "%g", "--", "/d"])
        for out in ("", "x y", "1 2 3", "-1 2"):
            with self.assertRaises(pool.PoolError, msg=out):
                self.lxc(f'echo "{out}"\n').owner("c1", "/d", 5)

    def test_a_slow_lxc_spends_the_pass_budget_and_the_next_container_is_not_copied(self):  # review F3, a real clock
        x = self.lxc('sleep 0.4\n'
                     'while [ "$1" != "--" ]; do shift; done; shift\n'
                     'case "$1" in stat) echo "1001 1001";; find) printf "1.0 3 a.log\\n";; tail) echo log;;\n'
                     '  journalctl) echo journal;; ps) echo ps;; esac\n')
        with tempfile.TemporaryDirectory() as d:  # six calls of 0.4 s: ps, journalctl -u, journalctl, stat, find, tail;
            # tail starts at about 2.0 s, inside the budget, and the pass ends at about 2.4 s, past it
            cfg = {**pool.DEFAULTS, "diag_dir": os.path.join(d, "diag"), "diag_pass_budget_seconds": 2.2}
            keeper = pool.DiagKeeper(cfg, x, cgroup_root=os.path.join(d, "cgroup"))
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                keeper.start_pass()
                first = keeper.keep("c1", {}, "1", "unassigned")
                second = keeper.keep("c2", {}, "2", "unassigned")
            evs = [json.loads(line) for line in out.getvalue().splitlines()]
            self.assertEqual(first, os.path.join(d, "diag", "1"))
            with open(os.path.join(first, "a.log")) as f:
                self.assertEqual(f.read(), "log\n")
            with open(os.path.join(first, "journal.txt")) as f:
                self.assertEqual(f.read(), "journal\n")
            self.assertIsNone(second)
            self.assertEqual([(v["container"], v["step"]) for v in evs if v["event"] == "diag_failed" and v["step"] == "budget"],
                             [("c2", "budget")])
            self.assertEqual(os.listdir(os.path.join(d, "diag")), ["1"])

    def test_tail_file_returns_at_most_the_limit_and_kills_a_flood(self):
        x = self.lxc("exec yes x\n")
        got = x.tail_file("c1", "/f.log", 1000, 10, (1, 1))
        self.assertEqual(len(got), 1000)

    def test_journal_and_processes_run_as_root_with_their_arguments(self):
        x = self.lxc('echo "$@" > "$0.args"\necho out\n')
        self.assertEqual(x.journal("c1", 400, 1000, 5), b"out\n")
        with open(x.binary + ".args") as f:
            self.assertEqual(f.read().split(), ["exec", "c1", "--", "journalctl", "-b", "--no-pager", "-o", "short-iso-precise",
                                                "-n", "400"])
        self.assertEqual(x.journal("c1", 100, 1000, 5, unit="ci-pool-runner.service"), b"out\n")
        with open(x.binary + ".args") as f:
            self.assertEqual(f.read().split(), ["exec", "c1", "--", "journalctl", "-b", "--no-pager", "-o", "short-iso-precise",
                                                "-u", "ci-pool-runner.service", "-n", "100"])
        self.assertEqual(x.processes("c1", 1000, 5), b"out\n")
        with open(x.binary + ".args") as f:  # comm, never args: a step's command line can hold its secrets (review F1)
            self.assertEqual(f.read().split(), ["exec", "c1", "--", "ps", "-eo", "pid,ppid,pgid,sid,user,stat,lstart,comm"])

    def test_workers_counts_runner_worker_processes_as_root(self):  # I-121 busy guard
        x = self.lxc('echo "$@" > "$0.args"\nprintf "systemd\\nRunner.Listener\\nRunner.Worker\\nbash\\n Runner.Worker \\n'
                     'Runner.Workers\\n"\n')
        self.assertEqual(x.workers("c1", 1000, 5), 2)
        with open(x.binary + ".args") as f:
            self.assertEqual(f.read().split(), ["exec", "c1", "--", "ps", "-e", "-o", "comm="])
        self.assertEqual(self.lxc('printf "systemd\\nRunner.Listener\\n"\n').workers("c1", 1000, 5), 0)

    def test_workers_with_cut_failed_or_stuck_output_is_a_pool_error(self):
        for body, timeout in (("exec yes Runner.Worker\n", 10), ("exit 1\n", 5), ("exec sleep 30\n", 0.3)):
            with self.assertRaises(pool.PoolError, msg=body):
                self.lxc(body).workers("c1", 1000, timeout)

    @unittest.skipUnless(shutil.which("ps"), "needs ps")
    def test_a_token_on_a_command_line_does_not_reach_the_process_list(self):  # review F1, the real ps
        token = "ghp_" + "A" * 36
        p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)", "-H", f"Authorization: token {token}"])
        self.addCleanup(p.wait)
        self.addCleanup(p.kill)
        x = self.lxc('while [ "$1" != "--" ]; do shift; done; shift\nexec "$@"\n')  # runs the command here, not in a container
        got = x.processes("c1", 1024 * 1024, 10)
        [line] = [ln for ln in got.split(b"\n") if ln.split()[:1] == [str(p.pid).encode()]]  # the process is listed
        self.assertNotIn(b"ghp_", got)
        self.assertNotIn(b"Authorization", got)
        self.assertNotIn(b"time.sleep", line)

    def test_a_window_that_starts_at_a_line_start_keeps_that_line(self):  # review F4
        x = self.lxc("i=10; while [ $i -lt 100 ]; do echo \"line-$i\"; i=$((i+1)); done\n")  # 90 lines of 8 bytes
        got = x.journal("c1", 400, 200, 5)  # the last 200 bytes are exactly the last 25 lines
        self.assertEqual(got, b"".join(b"line-%d\n" % i for i in range(75, 100)))

    def test_the_journal_keeps_its_last_whole_lines_within_the_cap(self):
        x = self.lxc("i=0; while [ $i -lt 100 ]; do echo \"line-$i\"; i=$((i+1)); done\n")
        got = x.journal("c1", 400, 300, 5)  # 790 bytes: over the cap, within the 4 x cap that is read
        self.assertLessEqual(len(got), 300)
        self.assertGreater(len(got), 290)
        self.assertTrue(got.startswith(b"line-") and got.endswith(b"line-99\n"), got)
        self.assertEqual(got.split(b"\n")[0], b"line-" + str(100 - len(got.split(b"\n")) + 1).encode())
        self.assertEqual(x.journal("c1", 400, 4096, 5).count(b"\n"), 100)  # under the cap: all of it

    def test_a_journal_or_process_flood_is_cut_at_the_cap_and_killed(self):
        x = self.lxc("exec yes x\n")
        got = x.journal("c1", 400, 1000, 10)
        self.assertLessEqual(len(got), 1000)
        self.assertTrue(got.endswith(b"x\n") and set(got) <= set(b"x\n"))
        self.assertEqual(len(x.processes("c1", 1000, 10)), 1000)
        with self.assertRaises(pool.PoolError):
            self.lxc("exit 1\n").journal("c1", 400, 1000, 5)
        with self.assertRaises(pool.PoolError):
            self.lxc("exec sleep 30\n").journal("c1", 400, 1000, 0.3)

    def test_a_failed_or_stuck_exec_is_a_pool_error(self):
        with self.assertRaises(pool.PoolError):
            self.lxc("exit 3\n").tail_file("c1", "/f.log", 10, 5, (1, 1))
        with self.assertRaises(pool.PoolError):
            self.lxc("exec sleep 30\n").tail_file("c1", "/f.log", 10, 0.3, (1, 1))
        with self.assertRaises(pool.PoolError):
            pool.Lxc("/nonexistent/lxc").tail_file("c1", "/f.log", 10, 5, (1, 1))


class ReaperFixTests(unittest.TestCase):
    def started(self):
        e = Env(self)
        e.job("100")
        e.tick()
        return e

    def test_an_unassigned_container_is_deleted_only_when_its_runner_could_be_unregistered(self):  # F5
        e = self.started()
        e.now += 301
        e.remove_fails = True  # GitHub: the runner is still running a job
        e.tick()
        self.assertIn("pool-wf-build-100", e.lxc.instances)
        self.assertEqual(e.lxc.names("delete"), [])
        self.assertTrue(e.pool.state.jobs["100"]["assigned"])
        e.remove_fails = False
        e.now += 15
        e.tick()
        self.assertNotIn("pool-wf-build-100", e.lxc.instances)

    def test_a_container_that_lost_its_job_is_not_held_for_ever_by_an_old_assignment(self):  # F6
        e = self.started()
        e.running = {"ci-pool-wf-build-100-a1"}
        e.now += 400
        e.tick()
        self.assertTrue(e.pool.state.jobs["100"]["assigned"])
        e.running = set()  # a reboot: the container is up, the runner is not
        e.now += 15
        e.tick()
        self.assertNotIn("pool-wf-build-100", e.lxc.instances)

    def test_what_the_reap_learned_is_saved_when_the_pass_stops_half_way(self):  # F7
        e = self.started()
        e.lxc.instances["pool-wf-build-100"]["status"] = "Stopped"
        e.lxc.list_budget = 1  # the first list works, the second one (before launching) fails
        with self.assertRaises(pool.PoolError):
            e.tick()
        saved = pool.State(e.cfg["state_file"]).jobs["100"]
        self.assertEqual(saved["status"], "finished")

    def test_an_entry_with_no_container_that_outlived_the_hard_timeout_is_dropped(self):  # F7
        e = Env(self)
        old = e.now - e.cfg["hard_timeout_seconds"] - 1
        entry = {"container": "pool-wf-build-5", "repo": "o/r", "label": "wf-build", "runner_id": "1", "runner_name": "x",
                 "started": old, "assigned": False}
        e.pool.state.jobs.update({"5": dict(entry, status="failed", retry_after=old + 120),
                                  "6": dict(entry, status="finished", finished=e.now - 100),
                                  "7": dict(entry, container="pool-wf-build-7", status="failed", started=e.now, retry_after=e.now)})
        e.tick()
        self.assertEqual(sorted(e.pool.state.jobs), ["6", "7"], "a finished entry stays a day; a young one stays")

    def test_a_running_entry_whose_container_vanished_is_closed(self):  # F7
        e = self.started()
        del e.lxc.instances["pool-wf-build-100"]
        e.tick()
        self.assertEqual(e.pool.state.jobs["100"]["status"], "finished")

    def test_the_poll_pause_grows_with_the_repositories(self):  # F10
        self.assertEqual(Env(self).pool.poll_seconds(), 15)
        self.assertEqual(Env(self, repos=["o/%d" % i for i in range(5)]).pool.poll_seconds(), 72)
        self.assertEqual(Env(self, repos=["o/r"], poll_seconds=60).pool.poll_seconds(), 60)

    def test_the_poll_pause_counts_the_calls_the_source_reported(self):  # B41 item 26
        e = Env(self, repos=["o/a", "o/b"])
        self.assertEqual(e.pool.poll_seconds(), 29)  # the fixed estimate: 2 × 6 calls
        e.api_calls = 8  # one queued answer per repository, no containers: 16 calls in the pass
        e.tick()
        self.assertEqual(e.pool.last_calls, 16)
        self.assertEqual(e.pool.poll_seconds(), 39)  # ceil(16 × 3600 / 1500)
        e.api_calls = 1  # a cheap pass never polls faster than the fixed estimate
        e.tick()
        self.assertEqual(e.pool.poll_seconds(), 29)

    def test_a_reported_call_count_is_checked_and_capped(self):  # B41 item 26
        e = Env(self)
        for bad in (-5, True, "40", 1.5):
            e.api_calls = bad
            e.tick()
            self.assertEqual(e.pool.last_calls, 0, bad)
        e.api_calls = 10 ** 9
        e.tick()
        self.assertEqual(e.pool.poll_seconds(), pool.MAX_REPORTED_PAUSE)

    def test_jit_answers_are_not_counted(self):  # review of #84, F4
        e = Env(self)
        real = e.cmd
        e.cmd = lambda argv: (json.dumps({**json.loads(real(argv)), "api_calls": 500}) if argv[:2] == ["jit", "create"]
                              else real(argv))
        e.pool.run_cmd = e.cmd
        e.job("100")
        e.tick()
        self.assertEqual(e.creates(), 1)
        self.assertEqual(e.pool.last_calls, 0)

    def test_a_pass_whose_source_fails_counts_only_what_answered(self):
        e = Env(self, repos=["o/a"])
        e.api_calls, e.source_fails = 50, True
        e.tick()
        self.assertEqual(e.pool.last_calls, 0)
        self.assertEqual(e.pool.poll_seconds(), 15)


class SpareTests(unittest.TestCase):
    def test_a_stopped_spare_is_made_per_label_and_replaced_after_use(self):
        e = Env(self)
        e.tick()
        self.assertEqual(sorted(n for n in e.lxc.instances), ["pool-wf-build-spare", "pool-wf-gate-spare"])
        self.assertTrue(all(i["status"] == "Stopped" for i in e.lxc.instances.values()))
        e.job("100")
        e.now += 15
        e.tick()
        self.assertIn(("rename", "pool-wf-build-spare", "pool-wf-build-100"), e.lxc.calls)
        self.assertEqual(e.lxc.instances["pool-wf-build-100"]["status"], "Running")
        self.assertEqual(e.lxc.instances["pool-wf-build-spare"]["status"], "Stopped", "a new spare stands ready")

    def test_a_spare_of_an_older_image_is_replaced_and_not_used(self):
        e = Env(self)
        e.tick()
        e.lxc.fingerprint = "fp2"  # the image was rebuilt
        e.job("100")
        e.now += 15
        e.tick()
        self.assertNotIn(("rename", "pool-wf-build-spare", "pool-wf-build-100"), e.lxc.calls)
        self.assertEqual(e.lxc.instances["pool-wf-build-spare"]["base_image"], "fp2")
        self.assertEqual(e.lxc.instances["pool-wf-build-100"]["base_image"], "fp2")

    def test_the_spare_costs_no_cap(self):
        e = Env(self)
        e.tick()
        self.assertEqual(e.pool.count({n: 1 for n in e.lxc.instances}, "wf-build"), 0)

    def test_no_image_means_no_spare_and_no_crash(self):
        e = Env(self)
        e.lxc.fingerprint = ""
        e.tick()
        self.assertEqual(e.lxc.instances, {})


class ProfileTests(unittest.TestCase):
    def file(self, name):
        with open(os.path.join(HERE, name)) as f:
            return f.read()

    def test_the_shipped_profiles_pass(self):
        self.assertEqual(pool.profile_refusals("build", self.file("ci-pool-build.yaml")), [])
        self.assertEqual(pool.profile_refusals("gate", self.file("ci-pool-gate.yaml")), [])

    def test_a_live_profile_as_lxc_prints_it_passes(self):
        live = self.file("ci-pool-gate.yaml").replace("devices:", "used_by:\n- /1.0/instances/pool-wf-gate-spare\nproject: default\ndevices:")
        self.assertEqual(pool.profile_refusals("gate", live), [])

    def refused(self, kind, text, *needles):
        got = pool.profile_refusals(kind, text)
        for n in needles:
            self.assertTrue(any(n in g for g in got), f"{n!r} not refused: {got}")

    def test_privileged_is_refused(self):
        base = self.file("ci-pool-build.yaml")
        self.refused("build", base.replace('security.privileged: "false"', 'security.privileged: "true"'), "security.privileged must be false")
        self.refused("build", base.replace('  security.privileged: "false"\n', ""), "security.privileged is required")

    def test_raw_lxc_raw_idmap_and_any_other_key_are_refused(self):
        base = self.file("ci-pool-build.yaml")
        for key in ("raw.lxc", "raw.idmap", "security.devlxd", "boot.priority", "security.idmap.isolated"):
            self.refused("build", base.replace("config:\n", f'config:\n  {key}: "x"\n'), f"config key {key} is not allowed")
        self.refused("build", base.replace("config:\n", "config:\n  raw.lxc: |\n    lxc.mount.entry = /dev dev none bind\n"), "raw.lxc")

    def test_boot_autostart_must_be_false(self):  # F6
        for kind, name in (("build", "ci-pool-build.yaml"), ("gate", "ci-pool-gate.yaml")):
            base = self.file(name)
            self.assertIn('boot.autostart: "false"', base)
            self.refused(kind, base.replace('  boot.autostart: "false"\n', ""), "boot.autostart is required")
            self.refused(kind, base.replace('boot.autostart: "false"', 'boot.autostart: "true"'), "boot.autostart must be false")

    def test_swap_memory_and_hard_limit_rules(self):
        base = self.file("ci-pool-build.yaml")
        self.refused("build", base.replace('limits.memory.swap: "false"', 'limits.memory.swap: "true"'), "limits.memory.swap must be false")
        self.refused("build", base.replace("limits.memory.enforce: hard", "limits.memory.enforce: soft"), "limits.memory.enforce must be hard")
        self.refused("build", base.replace("  limits.memory: 5GiB\n", ""), "limits.memory is required")

    def test_devices_beyond_the_root_disk_and_the_bridge_are_refused(self):
        base = self.file("ci-pool-build.yaml")
        extra = base + "  host:\n    type: disk\n    source: /\n    path: /host\n"
        self.refused("build", extra, "device host is not allowed")
        self.refused("build", base.replace("pool: ci", "pool: default"), "pool must be ci")
        self.refused("build", base.replace("network: lxdbr0", "network: lxdbr0\n    parent: eth1"), "key parent is not allowed")
        self.refused("build", base.replace("    type: nic\n    name: eth0\n    network: lxdbr0\n", ""), "device eth0 key type is required")

    def test_port_isolation_on_eth0_is_shipped_and_allowed_only_as_true(self):  # plan 2026-11-12 §5a
        line = '    security.port_isolation: "true"\n'
        for kind, name in (("build", "ci-pool-build.yaml"), ("gate", "ci-pool-gate.yaml")):
            with self.subTest(kind=kind):
                base = self.file(name)
                self.assertEqual(base.count(line), 1)
                self.assertLess(base.index("  eth0:\n"), base.index(line))  # on eth0, the bridge NIC
                self.assertEqual(pool.profile_refusals(kind, base), [])
                self.assertEqual(pool.profile_refusals(kind, base.replace(line, "    security.port_isolation: true\n")), [])
                self.assertEqual(pool.profile_refusals(kind, base.replace(line, "")), [])  # a profile made before it passes
                for bad in ('"false"', "false", '"yes"', '"1"', '""', '"TRUE"', '"true "', "truex"):
                    self.refused(kind, base.replace(line, "    security.port_isolation: %s\n" % bad),
                                 "device eth0 security.port_isolation must be true, is ")
                # on another device or in the profile's config it is a key like any other
                self.refused(kind, base.replace("    pool: ci\n", "    pool: ci\n" + line),
                             "device root key security.port_isolation is not allowed")
                self.refused(kind, base.replace("config:\n", 'config:\n  security.port_isolation: "true"\n'),
                             "config key security.port_isolation is not allowed")
                self.refused(kind, base.replace(line, '    security.port_isolation.x: "true"\n'),
                             "device eth0 key security.port_isolation.x is not allowed")

    def test_check_profiles_accepts_port_isolation_and_refuses_another_value(self):
        with tempfile.TemporaryDirectory() as d:
            for name in ("ci-pool-build.yaml", "ci-pool-gate.yaml"):
                for value, rc in (('"true"', 0), ('"false"', 1)):
                    with self.subTest(name=name, value=value):
                        path = os.path.join(d, name)
                        with open(path, "w") as f:
                            f.write(self.file(name).replace('security.port_isolation: "true"', "security.port_isolation: " + value))
                        r = subprocess.run([sys.executable, os.path.join(HERE, "ci-pool"), "check-profiles", "--file", path],
                                           capture_output=True, text=True)
                        self.assertEqual(r.returncode, rc, r.stderr)
                        if rc:
                            self.assertIn("device eth0 security.port_isolation must be true, is false", r.stderr)

    def test_a_gate_gets_no_nesting_or_intercepts(self):
        gate = self.file("ci-pool-gate.yaml")
        self.refused("gate", gate.replace("config:\n", 'config:\n  security.nesting: "true"\n'), "security.nesting is not allowed")

    def test_check_profiles_exits_1_and_names_the_key(self):
        with tempfile.TemporaryDirectory() as d:
            bad = os.path.join(d, "ci-pool-build.yaml")
            with open(bad, "w") as f:
                f.write(self.file("ci-pool-build.yaml").replace("config:\n", "config:\n  raw.lxc: x\n"))
            r = subprocess.run([sys.executable, os.path.join(HERE, "ci-pool"), "check-profiles", "--file", bad], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)
            self.assertIn("raw.lxc", r.stderr)
            r = subprocess.run([sys.executable, os.path.join(HERE, "ci-pool"), "check-profiles", "--file",
                                os.path.join(HERE, "ci-pool-build.yaml"), "--file", os.path.join(HERE, "ci-pool-gate.yaml")], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)


class ConfigTests(unittest.TestCase):
    def test_the_example_config_loads_and_a_bad_one_is_refused(self):
        cfg = pool.load_config(os.path.join(HERE, "ci-pool.config.example.json"))
        self.assertEqual(cfg["poll_seconds"], 15)
        self.assertEqual(cfg["hard_timeout_seconds"], 7200)
        self.assertEqual(cfg["unassigned_timeout_seconds"], 300)
        self.assertEqual(pool.mem_mib("5GiB"), 5120)
        self.assertIsNone(pool.mem_mib("50%"))
        self.assertEqual(cfg["admission"], {"min_mem_available_mib": 3072, "max_cpu_psi_avg60": 40, "max_mem_psi_avg60": 10})
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "c.json")
            with open(p, "w") as f:
                json.dump({"version": 1, "repos": ["bad repo"], "labels": {}, "source_cmd": ["a"], "jit_cmd": ["b"]}, f)
            with self.assertRaises(pool.PoolError):
                pool.load_config(p)


class LightLaneTests(unittest.TestCase):
    GATE_OPEN = {"max_cpu_psi_avg60": 100}

    def env(self, **gate_extra):
        e = Env(self)
        e.cfg["labels"]["wf-gate"]["admission"] = {**self.GATE_OPEN, **gate_extra}
        e.cfg["repos"] = ["o/r", "o/s"]
        return e

    def test_a_gate_job_starts_at_cpu_pressure_60_while_a_build_job_is_refused(self):
        e = self.env()
        e.host = {"mem_available_mib": 20000, "cpu_psi": 60.0, "mem_psi": 0.0}
        e.job("100", "wf-build")
        e.job("201", "wf-gate")
        e.tick()
        self.assertEqual(e.lxc.names("start"), ["pool-wf-gate-201"])

    def test_a_build_refusal_does_not_stop_a_gate_job_queued_after_it_in_the_same_or_another_repo(self):
        e = self.env()
        e.host = {"mem_available_mib": 20000, "cpu_psi": 60.0, "mem_psi": 0.0}
        sources = {"o/r": [("100", "wf-build"), ("201", "wf-gate")], "o/s": [("300", "wf-build"), ("401", "wf-gate")]}
        base = e.cmd

        def cmd(argv):
            if argv[0] == "src" and argv[1] == "queued":
                jobs = [{"id": i, "labels": [l], "created_at": "2026-10-29T19:00:00Z"} for i, l in sources[argv[2]]]
                e.commands.append(argv)
                return json.dumps({"version": 1, "repo": argv[2], "private": True, "jobs": jobs})
            return base(argv)
        e.pool.run_cmd = cmd
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            e.pool.tick()
        self.assertEqual(sorted(e.lxc.names("start")), ["pool-wf-gate-201", "pool-wf-gate-401"])
        refused = [json.loads(l) for l in out.getvalue().splitlines() if '"admission_refused"' in l]
        self.assertEqual([r["label"] for r in refused], ["wf-build"], "the label is refused once and then skipped, in every repository")

    def test_a_refused_label_is_tried_again_in_the_next_pass(self):
        e = self.env()
        e.host = {"mem_available_mib": 20000, "cpu_psi": 60.0, "mem_psi": 0.0}
        e.job("100", "wf-build")
        e.tick()
        self.assertEqual(e.lxc.names("start"), [])
        e.host["cpu_psi"] = 5.0
        e.now += 15
        e.tick()
        self.assertEqual(e.lxc.names("start"), ["pool-wf-build-100"])

    def test_a_gate_job_is_still_refused_on_memory_and_on_a_missing_reading(self):
        for host in ({"mem_available_mib": 2000, "cpu_psi": 60.0, "mem_psi": 0.0},
                     {"mem_available_mib": 20000, "cpu_psi": 60.0, "mem_psi": 10.0},
                     {"mem_available_mib": None, "cpu_psi": 60.0, "mem_psi": 0.0},
                     {"mem_available_mib": 20000, "cpu_psi": None, "mem_psi": 0.0},
                     {"mem_available_mib": 20000, "cpu_psi": 60.0, "mem_psi": None}):
            e = self.env()
            e.host = host
            e.job("201", "wf-gate")
            e.tick()
            self.assertEqual(e.lxc.names("start"), [], host)

    def test_a_label_limit_overlays_the_global_one_key_by_key(self):
        e = self.env(min_mem_available_mib=9000)
        e.host = {"mem_available_mib": 8000, "cpu_psi": 60.0, "mem_psi": 0.0}
        e.job("201", "wf-gate")
        e.tick()
        self.assertEqual(e.lxc.names("start"), [], "the label's own memory floor applies")
        e.host["mem_available_mib"] = 9500
        e.now += 15
        e.tick()
        self.assertEqual(e.lxc.names("start"), ["pool-wf-gate-201"])

    def test_a_cpu_limit_of_100_admits_a_reading_of_100_and_40_with_limit_40_refuses(self):
        host = {"mem_available_mib": 20000, "cpu_psi": 100.0, "mem_psi": 0.0}
        self.assertEqual(pool.admission_refusal(host, {**pool.DEFAULTS["admission"], "max_cpu_psi_avg60": 100}), "")
        self.assertEqual(pool.admission_refusal({**host, "cpu_psi": 100.0}, {**pool.DEFAULTS["admission"], "max_cpu_psi_avg60": 99.5}) != "", True)
        host40 = {**host, "cpu_psi": 40.0}
        self.assertNotEqual(pool.admission_refusal(host40, {**pool.DEFAULTS["admission"], "max_cpu_psi_avg60": 40}), "")
        self.assertEqual(pool.admission_refusal({**host, "cpu_psi": 39.9}, {**pool.DEFAULTS["admission"], "max_cpu_psi_avg60": 40}), "")
        self.assertNotEqual(pool.admission_refusal({**host, "cpu_psi": None}, {**pool.DEFAULTS["admission"], "max_cpu_psi_avg60": 100}), "")

    def test_a_config_with_no_label_admission_behaves_as_before(self):
        e = Env(self)  # the global limits alone
        e.host = {"mem_available_mib": 20000, "cpu_psi": 60.0, "mem_psi": 0.0}
        e.job("100", "wf-build")
        e.job("201", "wf-gate")
        e.tick()
        self.assertEqual(e.lxc.names("start"), [], "both labels are held by the global CPU limit")
        e.host["cpu_psi"] = 5.0
        e.now += 15
        e.tick()
        self.assertEqual(sorted(e.lxc.names("start")), ["pool-wf-build-100", "pool-wf-gate-201"])
        self.assertEqual(pool.label_limits(e.cfg, "wf-gate"), e.cfg["admission"])


class AdmissionConfigTests(unittest.TestCase):
    def write(self, admission=None, label_admission=None):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        label = {"profile": "p", "image": "i", "cap": 1, "memory": "1GiB"}
        if label_admission is not None:
            label["admission"] = label_admission
        doc = {"version": 1, "repos": [], "labels": {"wf-gate": label}, "source_cmd": ["a"], "jit_cmd": ["b"]}
        if admission is not None:
            doc["admission"] = admission
        p = os.path.join(d.name, "c.json")
        with open(p, "w") as f:
            json.dump(doc, f)
        return p

    def test_a_good_label_admission_loads_and_overlays(self):
        cfg = pool.load_config(self.write(label_admission={"max_cpu_psi_avg60": 100, "min_mem_available_mib": 0, "max_mem_psi_avg60": 12.5}))
        self.assertEqual(pool.label_limits(cfg, "wf-gate"), {"min_mem_available_mib": 0, "max_cpu_psi_avg60": 100, "max_mem_psi_avg60": 12.5})

    def test_unknown_keys_non_numbers_and_out_of_range_values_are_refused(self):
        for bad in ({"max_cpu": 50}, {"max_cpu_psi_avg60": "100"}, {"max_cpu_psi_avg60": True}, {"max_cpu_psi_avg60": None},
                    {"max_cpu_psi_avg60": 100.5}, {"max_cpu_psi_avg60": -1}, {"max_mem_psi_avg60": 101},
                    {"min_mem_available_mib": -1}, {"min_mem_available_mib": "3072"}, [1], "x"):
            with self.assertRaises(pool.PoolError, msg=bad):
                pool.load_config(self.write(label_admission=bad))
            if isinstance(bad, dict):
                with self.assertRaises(pool.PoolError, msg=bad):
                    pool.load_config(self.write(admission=bad))

    def test_check_config_exits_0_for_a_good_config_and_2_with_the_reason_for_a_bad_one(self):
        run = lambda path: subprocess.run([sys.executable, os.path.join(HERE, "ci-pool"), "check-config", "--config", path], capture_output=True, text=True)
        r = run(self.write(label_admission={"max_cpu_psi_avg60": 100}))
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""))
        r = run(self.write(label_admission={"max_cpu_psi_avg60": 101}))
        self.assertEqual(r.returncode, 2)
        self.assertIn("wf-gate", r.stderr)
        self.assertIn("max_cpu_psi_avg60", r.stderr)
        r = run(os.path.join(HERE, "no-such-file.json"))
        self.assertEqual(r.returncode, 2)
        self.assertIn("ci-pool:", r.stderr)

    def test_check_config_refuses_a_malformed_labels_block_or_cap_with_exit_2_and_no_traceback(self):
        good = {"profile": "p", "image": "i", "cap": 1, "memory": "1GiB"}
        cases = {
            "labels is a list": ["x"],
            "a label value is not a dict": {"wf-gate": "x"},
            "cap is a string": {"wf-gate": {**good, "cap": "1"}},
            "cap is a bool": {"wf-gate": {**good, "cap": True}},
            "cap is negative": {"wf-gate": {**good, "cap": -1}},
        }
        for why, labels in cases.items():
            with self.subTest(why):
                d = tempfile.TemporaryDirectory()
                self.addCleanup(d.cleanup)
                path = os.path.join(d.name, "c.json")
                with open(path, "w") as f:
                    json.dump({"version": 1, "labels": labels, "source_cmd": ["a"], "jit_cmd": ["b"]}, f)
                r = subprocess.run([sys.executable, os.path.join(HERE, "ci-pool"), "check-config", "--config", path], capture_output=True, text=True)
                self.assertEqual(r.returncode, 2, r.stderr)
                self.assertNotIn("Traceback", r.stderr)
                self.assertIn("ci-pool:", r.stderr)
        r = subprocess.run([sys.executable, os.path.join(HERE, "ci-pool"), "check-config", "--config", os.path.join(HERE, "ci-pool.config.example.json")], capture_output=True, text=True)
        self.assertEqual((r.returncode, r.stderr), (0, ""))

    def test_the_example_gives_the_gate_label_no_cpu_limit(self):
        cfg = pool.load_config(os.path.join(HERE, "ci-pool.config.example.json"))
        self.assertEqual(pool.label_limits(cfg, "wf-gate")["max_cpu_psi_avg60"], 100)
        self.assertEqual(pool.label_limits(cfg, "wf-build")["max_cpu_psi_avg60"], 40)


class GithubSourceTests(unittest.TestCase):
    """ci-pool-github against a loopback stub of the GitHub API."""

    @classmethod
    def setUpClass(cls):
        calls = cls.calls = []

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def reply(self, doc, code=200):
                body = json.dumps(doc).encode()
                self.send_response(code)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                calls.append(("GET", self.path, self.headers.get("Authorization")))
                if self.path == "/repos/o/r":
                    return self.reply({"private": True})
                if self.path.startswith("/repos/o/r/actions/runs?status=queued"):
                    return self.reply({"workflow_runs": [{"id": 5}]})
                if self.path.startswith("/repos/o/r/actions/runs?status=in_progress"):
                    return self.reply({"workflow_runs": [{"id": 6}]})
                if self.path.startswith("/repos/o/r/actions/runs?status=waiting"):
                    return self.reply({"workflow_runs": [{"id": 7}]})
                if self.path.startswith("/repos/o/r/actions/runs?status=pending"):
                    return self.reply({"workflow_runs": [{"id": 8}]})  # held by a concurrency group, its job queued
                if self.path == "/repos/o/p":
                    return self.reply({"private": True})
                if self.path.startswith("/repos/o/p/actions/runs?status=queued"):
                    page = int(self.path.rsplit("&page=", 1)[1])  # 100 runs on page 1, one on page 2
                    return self.reply({"workflow_runs": [{"id": 1000 + i} for i in range(100)] if page == 1 else [{"id": 5000}]})
                if self.path.startswith("/repos/o/p/actions/runs?"):
                    return self.reply({"workflow_runs": []})
                if "/o/p/actions/runs/5000/jobs" in self.path:
                    return self.reply({"jobs": [{"id": 99, "status": "queued", "labels": ["wf-gate"], "created_at": "t3"}]})
                if "/o/p/actions/runs/" in self.path:
                    return self.reply({"jobs": []})
                if "/runs/5/jobs" in self.path:
                    return self.reply({"jobs": [{"id": 11, "status": "queued", "labels": ["wf-build"], "created_at": "t"},
                                                {"id": 12, "status": "in_progress", "labels": ["wf-gate"]}]})
                if "/runs/6/jobs" in self.path:
                    return self.reply({"jobs": [{"id": 13, "status": "in_progress", "runner_name": "ci-pool-wf-gate-1"},
                                                {"id": 14, "status": "queued", "labels": ["wf-build"], "created_at": "t2"}]})
                if "/runs/8/jobs" in self.path:
                    return self.reply({"jobs": [{"id": 17, "status": "queued", "labels": ["wf-gate"], "created_at": "t5"},
                                                {"id": 18, "status": "pending", "labels": ["wf-gate"]}]})
                if "/runs/7/jobs" in self.path:
                    return self.reply({"jobs": [{"id": 15, "status": "queued", "labels": ["wf-gate"], "created_at": "t4"},
                                                {"id": 16, "status": "waiting", "labels": ["wf-gate"]}]})
                self.reply({}, 404)

            def do_POST(self):
                n = int(self.headers.get("Content-Length", 0))
                calls.append(("POST", self.path, json.loads(self.rfile.read(n))))
                self.reply({"runner": {"id": 42}, "encoded_jit_config": "ENC"}, 201)

            def do_DELETE(self):
                calls.append(("DELETE", self.path, None))
                self.reply({}, 404 if self.path.endswith("/9") else 204)

        cls.srv = http.server.HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.token = os.path.join(cls.tmp.name, "token")
        with open(cls.token, "w") as f:
            f.write("tok123\n")
        os.chmod(cls.token, 0o600)

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.tmp.cleanup()

    def run_cli(self, *args, token=None):
        env = {**os.environ, "CI_POOL_GITHUB_API": f"http://127.0.0.1:{self.srv.server_port}",
               "CI_POOL_GITHUB_TOKEN_FILE": token or self.token}
        return subprocess.run([sys.executable, os.path.join(HERE, "ci-pool-github"), *args], capture_output=True, text=True, env=env)

    def test_queued_lists_only_queued_jobs_and_says_private(self):
        r = self.run_cli("source", "queued", "o/r")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout), {"version": 1, "repo": "o/r", "private": True,
                                                "jobs": [{"id": "11", "labels": ["wf-build"], "created_at": "t"},
                                                         {"id": "14", "labels": ["wf-build"], "created_at": "t2"},
                                                         {"id": "15", "labels": ["wf-gate"], "created_at": "t4"},
                                                         {"id": "17", "labels": ["wf-gate"], "created_at": "t5"}],
                                                "api_calls": 9})  # the repository, 4 run listings, 4 jobs listings
        self.assertTrue(all(c[2] == "Bearer tok123" for c in self.calls if c[0] == "GET"))

    def test_queued_includes_queued_jobs_of_runs_already_in_progress_or_waiting(self):  # F1
        r = self.run_cli("source", "queued", "o/r")
        ids = [j["id"] for j in json.loads(r.stdout)["jobs"]]
        self.assertIn("14", ids)
        self.assertIn("15", ids)
        self.assertNotIn("16", ids, "a job that is itself waiting is not queued")

    def test_queued_includes_a_queued_job_of_a_pending_run(self):  # B41 item 25
        r = self.run_cli("source", "queued", "o/r")
        ids = [j["id"] for j in json.loads(r.stdout)["jobs"]]
        self.assertIn("17", ids)
        self.assertNotIn("18", ids, "a job that is itself pending is not queued")

    def test_the_listings_are_paged(self):  # F1
        r = self.run_cli("source", "queued", "o/p")
        self.assertEqual([j["id"] for j in json.loads(r.stdout)["jobs"]], ["99"], "the job of the run on page 2 is found")

    def test_running_names_the_runner(self):
        r = self.run_cli("source", "running", "o/r")
        self.assertEqual(json.loads(r.stdout)["jobs"], [{"id": "13", "runner_name": "ci-pool-wf-gate-1"}])
        self.assertEqual(json.loads(r.stdout)["api_calls"], 2)  # B41 item 26: the run listing and its one jobs listing

    def test_jit_create_asks_for_one_label_no_defaults_group_1(self):
        r = self.run_cli("jit", "create", "o/r", "wf-build", "ci-pool-wf-build-123")
        self.assertEqual(json.loads(r.stdout), {"version": 1, "runner_id": "42", "encoded_jit_config": "ENC"})
        post = [c for c in self.calls if c[0] == "POST"][-1]
        self.assertEqual(post[1], "/repos/o/r/actions/runners/generate-jitconfig")
        self.assertEqual(post[2], {"name": "ci-pool-wf-build-123", "runner_group_id": 1, "labels": ["wf-build"], "work_folder": "_work"})
        self.assertNotIn("tok123", r.stdout + r.stderr)

    def test_jit_remove_treats_a_missing_runner_as_done(self):
        self.assertEqual(self.run_cli("jit", "remove", "o/r", "41").returncode, 0)
        self.assertEqual(self.run_cli("jit", "remove", "o/r", "9").returncode, 0)

    def test_bad_arguments_and_a_group_readable_token_stop(self):
        self.assertNotEqual(self.run_cli("jit", "create", "o/r", "Bad Label", "n").returncode, 0)
        self.assertNotEqual(self.run_cli("source", "queued", "not a repo").returncode, 0)
        loose = os.path.join(self.tmp.name, "loose")
        with open(loose, "w") as f:
            f.write("tok")
        os.chmod(loose, 0o644)
        r = self.run_cli("source", "queued", "o/r", token=loose)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("must not be readable", r.stderr)


class ImageAndUnitTests(unittest.TestCase):
    def text(self, name):
        with open(os.path.join(HERE, name)) as f:
            return f.read()

    def test_the_image_makes_the_directory_the_jit_config_is_pushed_into(self):  # F2
        t = self.text("ci-pool-image")
        self.assertIn("install -d -m 0700 /etc/ci-pool", t)
        self.assertIn('"/etc/ci-pool/jit"', self.text("ci-pool"))  # the path the pool pushes to is inside it

    def test_a_failed_provisioning_says_where_and_leaves_no_log_in_the_image(self):
        t = self.text("ci-pool-image")
        body = t[t.index("<<'PROVISION'"):t.index("\nPROVISION\n")]
        for line in ("umask 022", "exec > >(tee -a /var/log/ci-pool-provision.log) 2>&1", "set -x", "chmod 0644 /tmp/runner.tar.gz"):
            self.assertIn(line, body)
        self.assertIn("provisioning failed (exit $rc) at line $LINENO: $BASH_COMMAND", body)
        self.assertLess(body.index("cloud-init clean --logs"), body.index("rm -f /var/log/ci-pool-provision.log"))
        self.assertIn('$LXC exec -T "$work"', t)
        after = t[t.index("\nPROVISION\n"):]
        self.assertLess(after.index("tail -n 200 /var/log/ci-pool-provision.log"), after.index('exit "$rc"'))
        self.assertLess(after.index('exit "$rc"'), after.index("$LXC stop"))

    def test_a_failed_provisioning_prints_its_log_and_publishes_nothing(self):  # #71 review
        t = self.text("ci-pool-image")
        part = t[t.index("\nrc=0\n"):t.index("# Publish under a new alias")]
        with tempfile.TemporaryDirectory() as d:
            fake = os.path.join(d, "lxc")
            log = os.path.join(d, "log")
            with open(fake, "w") as f:
                f.write('''#!/usr/bin/env bash
echo "$*" >> "$LOG"
case "$*" in
  "exec -T w "*" -- bash -s") cat >/dev/null; exit 3 ;;
  "exec -T w -- tail -n 200 /var/log/ci-pool-provision.log") echo "MARKER-LOG" ;;
esac
''')
            os.chmod(fake, 0o755)
            r = subprocess.run(["bash", "-c", 'set -euo pipefail\nkind=gate work=w NODE_MAJOR=22 POSTGRES_IMAGE=p TMP_SIZE=2G accepted_writers=\n' + part],
                               capture_output=True, text=True, env={**os.environ, "LXC": fake, "LOG": log})
            with open(log) as f:
                calls = f.read().splitlines()
        self.assertEqual(r.returncode, 3, r.stderr)
        self.assertIn("MARKER-LOG", r.stderr)
        self.assertFalse([c for c in calls if c.startswith(("stop", "publish"))])
        self.assertTrue(calls[0].startswith("exec -T w --env KIND=gate"), calls)

    def test_the_runner_owns_the_playwright_browsers_directory(self):  # 2026-10-30: EACCES on __dirlock in a job
        t = self.text("ci-pool-image")
        body = t[t.index("<<'PROVISION'"):t.index("\nPROVISION\n")]
        self.assertIn("chown -R runner:runner /opt/ms-playwright", body)
        # after the browsers are installed there, and after the runner user exists
        self.assertLess(body.index("playwright install --with-deps"), body.index("chown -R runner:runner /opt/ms-playwright"))
        self.assertLess(body.index("useradd -m -s /bin/bash runner"), body.index("chown -R runner:runner /opt/ms-playwright"))

    def test_the_build_image_can_compile_native_node_modules(self):  # 2026-11-12: electron-rebuild "not found: make"
        t = self.text("ci-pool-image")
        body = t[t.index("<<'PROVISION'"):t.index("\nPROVISION\n")]
        start = body.index('if [ "$KIND" = build ]; then\n  # Docker')
        build = body[start:body.index("\nfi\n", start)]
        # node-gyp needs make, a C++ compiler and python3; installed after a refresh of the lists
        self.assertIn("apt-get install -y build-essential python3", build)
        self.assertLess(build.index("apt-get update"), build.index("apt-get install -y build-essential python3"))
        # the build kind only: a gate container gets no compiler
        self.assertNotIn("build-essential", body[:start] + body[start + len(build):])

    def test_the_tmpfs_line_is_written_when_the_image_has_no_fstab(self):  # 2026-10-30 build failure
        t = self.text("ci-pool-image")
        part = t[t.index("touch /etc/fstab\n"):t.index("systemctl enable ci-pool-runner.service")]
        with tempfile.TemporaryDirectory() as d:
            fstab = os.path.join(d, "fstab")  # absent, as in the ubuntu:24.04 container image
            script = "set -euo pipefail\nTMP_SIZE=2G\n" + part.replace("/etc/fstab", fstab)
            for _ in range(2):  # a second run keeps one tmpfs line
                r = subprocess.run(["bash", "-c", script], capture_output=True, text=True)
                self.assertEqual(r.returncode, 0, r.stderr)
            with open(fstab) as f:
                lines = f.read().splitlines()
        self.assertEqual(lines, ["tmpfs /tmp tmpfs defaults,noatime,nosuid,nodev,size=2G,mode=1777 0 0"])

    def test_the_unit_sets_nothing_that_stops_snap_lxc(self):  # F4
        unit = [l for l in self.text("ci-pool.service").splitlines() if not l.startswith("#")]
        self.assertFalse([l for l in unit if l.startswith(("NoNewPrivileges", "ProtectHome"))])
        self.assertIn("systemd-run --wait --pipe /snap/bin/lxc list", self.text("README.md"))

    def test_the_unit_makes_snaps_private_tmp_dir_inside_its_private_tmp(self):  # I-103
        for name in ("ci-pool.service", "ci-pool-runner.service"):
            lines = [l for l in self.text(name).splitlines() if not l.startswith("#")]
            if name == "ci-pool.service":  # the only unit that runs /snap/bin/lxc
                self.assertIn("PrivateTmp=true", lines)
                self.assertIn("ExecStartPre=/usr/bin/mkdir -p -m 0700 /tmp/snap-private-tmp", lines)
            else:  # runs inside the container, where there is no snap and no PrivateTmp
                self.assertFalse([l for l in lines if l.startswith("PrivateTmp")])
                self.assertNotIn("/snap/bin/lxc", "\n".join(lines))

    def _purge_run(self, script, installed=True, apt_exit=0):
        """Run `script` with a fake dpkg-query (rsyslog installed or not) and a fake apt-get that exits `apt_exit`;
        returns (exit code, stderr, the fake apt-get's calls with DEBIAN_FRONTEND)."""
        with tempfile.TemporaryDirectory() as d:
            log = os.path.join(d, "log")
            status = "install ok installed" if installed else ""
            for name, body in (("apt-get", f'echo "$DEBIAN_FRONTEND $*" >> "$LOG"\nexit {apt_exit}'),
                               ("dpkg-query", f'[ "${{*: -1}}" = rsyslog ] || exit 2\n'
                                              f'{"printf %s " + repr(status) if installed else "exit 1"}')):
                path = os.path.join(d, name)
                with open(path, "w") as f:
                    f.write("#!/usr/bin/env bash\n" + body + "\n")
                os.chmod(path, 0o755)
            open(log, "w").close()
            r = subprocess.run(["bash", "-c", "set -euo pipefail\n" + script], capture_output=True, text=True,
                               env={**os.environ, "PATH": d + os.pathsep + os.environ["PATH"], "LOG": log,
                                    "DEBIAN_FRONTEND": ""})  # empty, so only the script's own prefix shows
            with open(log) as f:
                return r.returncode, r.stderr, f.read().splitlines()

    def _image_purge(self):
        t = self.text("ci-pool-image")
        body = t[t.index("<<'PROVISION'"):t.index("\nPROVISION\n")]
        return body, body[body.index("if dpkg-query -W -f='${Status}' rsyslog"):body.index("\napt-get update")]

    def test_the_image_purges_rsyslog_before_it_installs_anything(self):  # I-104
        body, part = self._image_purge()
        self.assertEqual(self._purge_run(part)[::2], (0, [" purge -y rsyslog"]))
        self.assertEqual(self._purge_run(part, installed=False)[::2], (0, []))  # absent: no apt call at all
        self.assertNotEqual(self._purge_run(part, apt_exit=100)[0], 0)  # the image build stops on a failed purge
        self.assertLess(body.index("apt-get purge -y rsyslog"), body.index("apt-get install"))

    def _setup_purge(self):
        t = self.text("runner-setup")
        return t, t[t.index("if dpkg-query -W -f='${Status}' rsyslog"):t.index('if [ -f "$dir/.runner" ]')]

    def test_runner_setup_purges_rsyslog_on_every_registration(self):  # I-104
        t, part = self._setup_purge()
        rc, _, calls = self._purge_run(part)
        self.assertEqual((rc, calls), (0, ["noninteractive -o DPkg::Lock::Timeout=300 purge -y rsyslog"]))
        self.assertEqual(self._purge_run(part, installed=False)[::2], (0, []))
        # before the already-registered branch, so an existing runner is patched too
        self.assertLess(t.index("apt-get -o DPkg::Lock::Timeout=300 purge -y rsyslog"), t.index('if [ -f "$dir/.runner" ]'))

    def test_a_failed_purge_does_not_stop_a_registration(self):  # rv1a1042734b30e396 finding 1
        _, part = self._setup_purge()
        rc, err, calls = self._purge_run(part + "echo registered\n", apt_exit=100)
        self.assertEqual(rc, 0)
        self.assertEqual(len(calls), 1)
        self.assertIn("runner-setup: could not purge rsyslog (exit 100); registering anyway", err)

    APT_TIMERS = "apt-daily.timer apt-daily-upgrade.timer"
    APT_MASK = "mask " + APT_TIMERS + (" apt-daily.service apt-daily-upgrade.service"
                                       " packagekit.service packagekit-offline-update.service")
    APT_PURGES = [f"-o DPkg::Lock::Timeout=300 purge -y {p}" for p in ("needrestart", "unattended-upgrades")]

    def _apt_run(self, script, installed=("needrestart", "unattended-upgrades"), apt_exit=0, systemctl_exit=0):
        """Run `script` with a fake dpkg-query (these packages installed), apt-get and systemctl; returns (exit code,
        stderr, the fake systemctl's calls, the fake apt-get's calls)."""
        with tempfile.TemporaryDirectory() as d:
            sys_log, apt_log = os.path.join(d, "systemctl.log"), os.path.join(d, "apt.log")
            status = "|".join(installed) or "none"
            for name, body in (("systemctl", f'echo "$*" >> {sys_log}\nexit {systemctl_exit}'),
                               ("apt-get", f'echo "$*" >> {apt_log}\nexit {apt_exit}'),
                               ("dpkg-query", f'case "${{*: -1}}" in {status}) printf "install ok installed" ;; *) exit 1 ;; esac')):
                path = os.path.join(d, name)
                with open(path, "w") as f:
                    f.write("#!/usr/bin/env bash\n" + body + "\n")
                os.chmod(path, 0o755)
            open(sys_log, "w").close()
            open(apt_log, "w").close()
            r = subprocess.run(["bash", "-c", "set -euo pipefail\n" + script], capture_output=True, text=True,
                               env={**os.environ, "PATH": d + os.pathsep + os.environ["PATH"]})
            with open(sys_log) as f, open(apt_log) as g:
                return r.returncode, r.stderr, f.read().splitlines(), g.read().splitlines()

    def _image_apt(self):
        body = self._image_purge()[0]
        return body, body[body.index("systemctl disable --now apt-daily.timer"):body.index("# No rsyslog:")]

    def test_the_image_turns_apt_activity_off_before_it_uses_apt(self):  # I-121, second cause
        body, part = self._image_apt()
        rc, _, sys_calls, apt_calls = self._apt_run(part)
        self.assertEqual(rc, 0)
        self.assertEqual(sys_calls, [f"disable --now {self.APT_TIMERS}", "stop apt-daily.service apt-daily-upgrade.service",
                                     self.APT_MASK])
        self.assertEqual(apt_calls, self.APT_PURGES)  # needrestart first, so the other purge does not run its hook
        self.assertEqual(self._apt_run(part, installed=())[3], [])  # absent: no apt call at all
        self.assertLess(body.index("systemctl disable --now apt-daily.timer"), body.index("apt-get purge -y rsyslog"))
        self.assertLess(body.index("\npurge_updaters\n"), body.index("apt-get update"))

    def test_a_failed_apt_step_stops_the_image_build(self):  # a container with the timers armed would cancel jobs again
        _, part = self._image_apt()
        self.assertNotEqual(self._apt_run(part, apt_exit=100)[0], 0)
        rc, _, sys_calls, apt_calls = self._apt_run(part, systemctl_exit=1)
        self.assertNotEqual(rc, 0)
        self.assertEqual((len(sys_calls), apt_calls), (1, []))

    def test_the_image_purges_the_updaters_again_after_its_last_install(self):  # ubuntu-server recommends both
        body = self._image_purge()[0]
        again = body.rindex("\npurge_updaters\n")
        self.assertNotEqual(again, body.index("\npurge_updaters\n"))
        for last in ("apt-get install", "playwright install", "installdependencies.sh"):
            self.assertLess(body.rindex(last), again)
        self.assertLess(again, body.index("systemctl enable ci-pool-runner.service"))

    def _image_upgrade(self):
        """The provisioning script, and what runs from the upgrade through the second purge, with the function it calls."""
        body = self._image_purge()[0]
        func = body[body.index("purge_updaters() {"):body.index("\npurge_updaters\n")]
        again = body.rindex("\npurge_updaters\n")
        return body, func + "\n" + body[body.index("apt-get -y -o Dpkg::Options"):again + len("\npurge_updaters\n")]

    def test_the_image_upgrades_everything_after_its_last_update_and_before_the_second_purge(self):  # rv962a55b403ff4301 F1
        body, part = self._image_upgrade()
        upgrade = body.index("apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold full-upgrade </dev/null")
        for earlier in ("apt-get update", "apt-get install", "playwright install", "installdependencies.sh"):
            self.assertLess(body.rindex(earlier), upgrade)
        self.assertLess(body.index("export DEBIAN_FRONTEND=noninteractive"), upgrade)
        self.assertLess(upgrade, body.rindex("\npurge_updaters\n"))
        self.assertLess(upgrade, body.index("rm -rf /var/lib/apt/lists/*"))  # the lists it needs are still there
        full = "-y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold full-upgrade"
        rc, _, _, apt_calls = self._apt_run(part)
        self.assertEqual((rc, apt_calls), (0, [full] + self.APT_PURGES))  # run in this order, an upgrade cannot leave one behind

    def test_a_failed_upgrade_stops_the_image_build(self):
        rc, _, _, apt_calls = self._apt_run(self._image_upgrade()[1], apt_exit=100)
        self.assertEqual(len(apt_calls), 1)  # nothing after it runs
        self.assertNotEqual(rc, 0)

    def test_the_provisioning_trap_reports_a_failure_inside_a_function(self):  # rv962a55b403ff4301 F3
        body, _ = self._image_apt()
        head = body[body.index("set -E"):body.index("umask 022")]
        trap = next(l for l in body.splitlines() if l.startswith("trap ") and l.endswith(" ERR"))
        func = body[body.index("purge_updaters() {"):body.index("\npurge_updaters\n")]
        rc, err, _, _ = self._apt_run("\n".join((head, trap, func, "purge_updaters")), apt_exit=100)
        self.assertEqual(rc, 100)
        self.assertIn("provisioning failed (exit 100) at line", err)

    def _setup_apt(self):
        t = self.text("runner-setup")
        return t, t[t.index("if dpkg-query -W -f='${Status}' needrestart"):t.index("# No rsyslog:")]

    def test_runner_setup_purges_only_needrestart_on_every_registration(self):  # I-121, second cause; rv962a55b403ff4301 F2
        t, part = self._setup_apt()
        rc, err, sys_calls, apt_calls = self._apt_run(part)
        self.assertEqual((rc, err, sys_calls), (0, "", []))
        self.assertEqual(apt_calls, self.APT_PURGES[:1])  # unattended-upgrades is installed here and stays
        self.assertEqual(self._apt_run(part, installed=())[3], [])  # absent: no apt call at all
        self.assertLess(t.index("purge -y needrestart"), t.index('if [ -f "$dir/.runner" ]'))

    def test_a_long_lived_runner_keeps_its_security_updates(self):  # the owner's decision on rv962a55b403ff4301 F2
        code = "\n".join(l for l in self.text("runner-setup").splitlines() if not l.lstrip().startswith("#"))
        for gone in ("apt-daily", "unattended-upgrades", "packagekit", "systemctl mask", "systemctl disable"):
            self.assertNotIn(gone, code)

    def test_a_failed_needrestart_purge_does_not_stop_a_registration(self):  # the rule of the rsyslog step
        _, part = self._setup_apt()
        rc, err, _, apt_calls = self._apt_run(part + "echo registered\n", apt_exit=100)
        self.assertEqual((rc, apt_calls), (0, self.APT_PURGES[:1]))
        self.assertIn("runner-setup: could not purge needrestart (exit 100); registering anyway", err)

    def _rotate(self, aliases, stale="", query_fails=False):
        """Run the publish-and-rotate tail of ci-pool-image against a fake lxc that knows these aliases (and, with
        `stale`, a -new alias left on that fingerprint by an earlier build); returns (exit code, calls)."""
        t = self.text("ci-pool-image")
        tail = t[t.index("# Publish under a new alias"):]
        listing = "\n".join(f"{a},x,CONTAINER,x" for a in aliases)
        with tempfile.TemporaryDirectory() as d:
            fake = os.path.join(d, "lxc")
            log = os.path.join(d, "log")
            with open(fake, "w") as f:
                f.write('''#!/usr/bin/env bash
echo "$*" >> "$LOG"
case "$*" in
  "image alias list --format csv") printf '%s\\n' "$LISTING" ;;
  "image info ci-pool-gate-prev") echo "Fingerprint: prevfp" ;;
  "image info ci-pool-gate") echo "Fingerprint: curfp" ;;
  "image info ci-pool-gate-new")
    if [[ -f "$LOG.published" ]]; then echo "Fingerprint: newfp"
    elif [[ -n "$STALE" ]]; then echo "Fingerprint: $STALE"
    else exit 1; fi ;;
  publish*) touch "$LOG.published" ;;
  query*) [[ -z "$QUERY_FAILS" ]] ;;
esac
''')
            os.chmod(fake, 0o755)
            r = subprocess.run(["bash", "-c", 'set -euo pipefail\nalias=ci-pool-gate kind=gate work=w\n' + tail], capture_output=True,
                               text=True, env={**os.environ, "LXC": fake, "LOG": log, "LISTING": listing, "STALE": stale,
                                               "QUERY_FAILS": "1" if query_fails else ""})
            with open(log) as f:
                return r.returncode, f.read().splitlines()

    def test_rotating_deletes_the_old_prev_image_by_fingerprint_first(self):  # F9
        code, calls = self._rotate(["ci-pool-gate", "ci-pool-gate-prev"])
        self.assertEqual(code, 0)
        self.assertIn("image delete prevfp", calls)
        self.assertLess(calls.index("image delete prevfp"), calls.index("image alias create ci-pool-gate-prev curfp"))
        self.assertNotIn("image delete curfp", calls)

    def test_the_live_alias_is_repointed_in_one_call(self):  # B41 item 21
        code, calls = self._rotate(["ci-pool-gate", "ci-pool-gate-prev"])
        self.assertEqual(code, 0)
        patch = 'query -X PATCH /1.0/images/aliases/ci-pool-gate --data {"target": "newfp"}'
        self.assertIn(patch, calls)
        # the live alias is never deleted or renamed, so a launch between two calls still finds an image
        self.assertFalse([c for c in calls if c.split()[:4] in (["image", "alias", "delete", "ci-pool-gate"],
                                                                ["image", "alias", "rename", "ci-pool-gate"])])
        self.assertLess(calls.index("image alias create ci-pool-gate-prev curfp"), calls.index(patch))
        self.assertEqual(calls[-1], "image alias delete ci-pool-gate-new")  # dropped only after the repoint

    def test_a_first_image_takes_the_alias_by_rename(self):
        code, calls = self._rotate([])
        self.assertEqual(code, 0)
        self.assertIn("image alias rename ci-pool-gate-new ci-pool-gate", calls)
        self.assertFalse([c for c in calls if c.startswith("query")])

    def test_a_stale_new_image_is_deleted_before_the_next_publish(self):  # review of #84, F2
        code, calls = self._rotate(["ci-pool-gate", "ci-pool-gate-prev"], stale="stalefp")
        self.assertEqual(code, 0)
        self.assertLess(calls.index("image delete stalefp"), calls.index(next(c for c in calls if c.startswith("publish"))))
        for kept in ("curfp", "prevfp"):  # a -new that names a kept image loses only its alias
            code, calls = self._rotate(["ci-pool-gate", "ci-pool-gate-prev"], stale=kept)
            before_publish = calls[:calls.index(next(c for c in calls if c.startswith("publish")))]
            self.assertFalse([c for c in before_publish if c.startswith("image delete")], kept)
            self.assertIn("image alias delete ci-pool-gate-new", before_publish)

    def test_a_failed_repoint_leaves_the_live_alias_and_the_next_build_cleans_up(self):  # review of #84, F2
        code, calls = self._rotate(["ci-pool-gate", "ci-pool-gate-prev"], query_fails=True)
        self.assertNotEqual(code, 0)
        self.assertTrue(calls[-1].startswith("query -X PATCH"))  # it stops there: -new stays for the next build to find
        self.assertNotIn("image alias rename ci-pool-gate ci-pool-gate-prev", calls)


BASH = shutil.which("bash")


def pull_request(head, base):
    return {"pull_request": {"head": {"repo": {"full_name": head}}, "base": {"repo": {"full_name": base}}}}


WRITERS_LINE = "writers=/opt/ci-hooks/accepted-writers  #"  # where the check reads the accepted writers


class JobStartedCheckTests(unittest.TestCase):
    """The pool image's job-started check: ci-pool-image writes it into the image, ci-pool-entrypoint points the runner's
    ACTIONS_RUNNER_HOOK_JOB_STARTED at it. Run here as the runner runs it (`bash -e PATH`), with the values the runner
    exports from GitHub's job message."""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(HERE, "ci-pool-image")) as f:
            image = f.read()
        start = "cat > /opt/ci-hooks/job-started.sh <<'JOBHOOK'\n"
        cls.image = image
        cls.text = image[image.index(start) + len(start):image.index("\nJOBHOOK\n")] + "\n"
        cls.dir = tempfile.mkdtemp()
        # The image's list, as the build writes it from the default TRUSTED_ACTORS (lower case, one a line)
        cls.list = os.path.join(cls.dir, "trusted-actors")
        with open(cls.list, "w") as f:
            f.write("cazy00\nmontadev-sys\nworkspace-executor-2eaa[bot]\n")
        # The accepted writers, as the build writes them from its input: one "owner/repo login" a line, in lower case. The
        # last line is one the build would refuse; the check skips it, so it accepts no one.
        cls.writers = os.path.join(cls.dir, "accepted-writers")
        with open(cls.writers, "w") as f:
            f.write("cazy00/shop writer-one\ncazy00/other writer-two\ncazy00/shop-x writer-three\n"
                    "cazy00/shop writer-four extra\ncazy00/shop writer-seven\n")
        assert cls.text.count("list=/opt/ci-hooks/trusted-actors\n") == 1
        assert cls.text.count(WRITERS_LINE) == 1
        cls.text_with_list = cls.text.replace("list=/opt/ci-hooks/trusted-actors\n", "list=%s\n" % cls.list)
        text = cls.text_with_list.replace(WRITERS_LINE, "writers=%s  #" % cls.writers)
        cls.hook = cls.write(text, "job-started.sh")
        # The same check, but it takes a bash script for the runner's Worker executable, so a fake Worker can stand in
        pattern = "worker_exe='/opt/actions-runner/bin*/Runner.Worker'"
        assert text.count(pattern) == 1
        cls.fake_worker_hook = cls.write(text.replace(pattern, "worker_exe='%s'" % os.path.realpath(BASH)),
                                         "job-started-fake-worker.sh")

    @classmethod
    def write(cls, text, name):
        path = os.path.join(cls.dir, name)
        with open(path, "w") as f:
            f.write(text)
        os.chmod(path, 0o755)
        return path

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir)

    def env(self, d, actor="Cazy00", triggering="Cazy00", event="push", payload=None, raw=None):
        path = os.path.join(d, "event.json")
        with open(path, "w") as f:
            f.write(raw if raw is not None else json.dumps({} if payload is None else payload))
        return {"PATH": os.environ["PATH"], "GITHUB_ACTOR": actor, "GITHUB_TRIGGERING_ACTOR": triggering,
                "GITHUB_EVENT_NAME": event, "GITHUB_EVENT_PATH": path, "GITHUB_REPOSITORY": "Cazy00/shop"}

    def run_hook(self, drop=(), **kw):
        with tempfile.TemporaryDirectory() as d:
            env = self.env(d, **kw)
            for name in drop:
                env.pop(name)
            return subprocess.run([BASH, "-e", self.hook], env=env, capture_output=True, text=True, timeout=30)

    def assertAllowed(self, r):
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn(": allowed", r.stdout)
        self.assertNotIn("::error::", r.stdout)

    def assertRefused(self, r, why):
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("::error::ci-pool refused this job: ", r.stdout)
        self.assertIn(why, r.stdout)
        self.assertNotIn(": allowed", r.stdout)

    def test_the_check_parses_as_bash_and_is_written_for_both_kinds(self):
        self.assertEqual(subprocess.run([BASH, "-n", self.hook], capture_output=True).returncode, 0)
        body = self.image[self.image.index("<<'PROVISION'"):self.image.index("\nPROVISION\n")]
        at = body.index("\ncat > /opt/ci-hooks/job-started.sh")  # at the top level, not inside a kind's block
        self.assertLess(at, body.index("# Docker, then the hook that clears it"))  # before the build-only part: gate images too
        self.assertLess(body.index("install -d -m 0755 /opt/ci-hooks"), at)
        self.assertIn("chmod 0755 /opt/ci-hooks/job-started.sh", body)
        self.assertIn("chmod 0644 /opt/ci-hooks/trusted-actors", body)
        self.assertLess(body.index("useradd -m -s /bin/bash runner"), at)
        # The provisioning runs as root (lxc exec), so both files are root's; the runner can read, not write, them.
        self.assertNotIn("chown", body[body.index("install -d -m 0755 /opt/ci-hooks"):body.index("chmod 0755 /opt/ci-hooks/job-started.sh")])

    def test_external_commands_are_called_by_absolute_path(self):
        for command in ("/usr/bin/jq -r", "/usr/bin/readlink", "/usr/bin/sleep 3", "/usr/bin/timeout -s KILL 1",
                        "/usr/bin/bash -c"):
            self.assertIn(command, self.text)
        code = "\n".join(line for line in self.text.splitlines() if not line.lstrip().startswith("#"))
        for bare in ("cat", "jq", "readlink", "sleep", "timeout", "bash"):  # no command found through PATH (#116 review 3)
            self.assertIsNone(re.search(r"(?<![/\w.-])%s\b" % bare, code.replace("/usr/bin/" + bare, "")), bare)

    def build_part(self, start, end, env):
        part = self.image[self.image.index(start):self.image.index(end)]
        return subprocess.run([BASH, "-c", "set -euo pipefail\n" + part], env={"PATH": os.environ["PATH"], **env},
                              capture_output=True, text=True, timeout=30)

    def test_the_build_refuses_a_trusted_list_that_is_empty_or_not_logins(self):
        start, end = 'read -ra actors <<<"$TRUSTED_ACTORS"\n[[', 'alias="ci-pool-$kind"'
        self.assertIn('TRUSTED_ACTORS="${TRUSTED_ACTORS:-Cazy00 MontaDev-sys workspace-executor-2eaa[bot]}"', self.image)
        for good in ("Cazy00 MontaDev-sys workspace-executor-2eaa[bot]", "one", "a-b  c1"):
            with self.subTest(good=good):
                self.assertEqual(self.build_part(start, end, {"TRUSTED_ACTORS": good}).returncode, 0)
        for bad in ("", "   ", "a;b", "-a", "a-", "a[bot", "a/b", "*", "a b\\c", "$(id)"):
            with self.subTest(bad=bad):
                r = self.build_part(start, end, {"TRUSTED_ACTORS": bad})
                self.assertEqual(r.returncode, 2, r.stderr)
                self.assertIn("TRUSTED_ACTORS", r.stderr)

    def test_the_build_writes_the_list_in_lower_case_one_a_line(self):
        with tempfile.TemporaryDirectory() as d:
            start = 'read -ra actors <<<"$TRUSTED_ACTORS"\nprintf'
            part = self.image[self.image.index(start):self.image.index("chmod 0644 /opt/ci-hooks/trusted-actors")]
            part = part.replace("/opt/ci-hooks/trusted-actors", os.path.join(d, "list"))
            open(os.path.join(d, "workspace-executor-2eaab"), "w").close()  # a file the login would match as a glob
            r = subprocess.run([BASH, "-c", "set -euo pipefail\n" + part], cwd=d, capture_output=True, text=True,
                               env={"PATH": os.environ["PATH"], "TRUSTED_ACTORS": "Cazy00 MontaDev-sys workspace-executor-2eaa[bot]"})
            self.assertEqual(r.returncode, 0, r.stderr)
            with open(os.path.join(d, "list")) as f:
                self.assertEqual(f.read(), "cazy00\nmontadev-sys\nworkspace-executor-2eaa[bot]\n")

    def test_the_owners_run_is_allowed(self):
        self.assertAllowed(self.run_hook())
        self.assertAllowed(self.run_hook(event="workflow_dispatch"))
        self.assertIn("a push run of Cazy00, this attempt by Cazy00: allowed", self.run_hook().stdout)

    def test_the_trusted_accounts_are_matched_ignoring_case(self):
        self.assertAllowed(self.run_hook(actor="MONTADEV-SYS", triggering="cazy00"))
        self.assertAllowed(self.run_hook(actor="Workspace-Executor-2eaa[bot]", triggering="MontaDev-sys"))

    def test_the_owners_own_pull_request_is_allowed(self):
        for event in ("pull_request", "pull_request_target"):
            with self.subTest(event=event):
                self.assertAllowed(self.run_hook(event=event, payload=pull_request("Cazy00/shop", "Cazy00/shop")))

    def test_a_foreign_actor_is_refused(self):
        self.assertRefused(self.run_hook(actor="stranger"), "GITHUB_ACTOR is stranger, not a trusted account")

    def test_a_foreign_rerun_of_the_owners_run_is_refused(self):
        self.assertRefused(self.run_hook(triggering="stranger"), "GITHUB_TRIGGERING_ACTOR is stranger, not a trusted account")

    def test_a_login_like_a_trusted_one_is_refused(self):
        for login in ("cazy00-x", "cazy0", "xcazy00", "cazy00 ", "workspace-executor-2eaa", "*", "[c]azy00", "montadev-sys[bot]"):
            with self.subTest(login=login):
                self.assertRefused(self.run_hook(actor=login), "not a trusted account")
                self.assertRefused(self.run_hook(triggering=login), "not a trusted account")

    def test_a_pull_request_from_a_fork_is_refused(self):
        for event in ("pull_request", "pull_request_target", "pull_request_review", "pull_request_review_comment"):
            with self.subTest(event=event):
                r = self.run_hook(event=event, payload=pull_request("stranger/shop", "Cazy00/shop"))
                self.assertRefused(r, "a pull request from stranger/shop into Cazy00/shop, another repository")

    def test_a_fork_of_the_owner_with_the_same_name_is_refused(self):
        r = self.run_hook(event="pull_request", payload=pull_request("MontaDev-sys/shop", "Cazy00/shop"))
        self.assertRefused(r, "another repository")

    def test_a_pull_request_in_any_events_payload_is_checked(self):
        # GitHub's issue_comment payload names its pull request by URL only (below); this pins that a payload which does
        # carry a pull request is checked whatever the event is called.
        r = self.run_hook(event="merge_group", payload=pull_request("stranger/shop", "Cazy00/shop"))
        self.assertRefused(r, "another repository")

    def test_a_trusted_comment_on_a_pull_request_is_checked_by_its_actor(self):
        payload = {"issue": {"number": 7, "pull_request": {"url": "https://api.github.com/repos/Cazy00/shop/pulls/7"}}}
        self.assertAllowed(self.run_hook(event="issue_comment", payload=payload))
        self.assertRefused(self.run_hook(event="issue_comment", payload=payload, actor="stranger"), "not a trusted account")

    def test_a_workflow_run_of_a_fork_is_refused(self):
        payload = {"workflow_run": {"head_repository": {"full_name": "stranger/shop"}, "repository": {"full_name": "Cazy00/shop"}}}
        self.assertRefused(self.run_hook(event="workflow_run", payload=payload), "a workflow run of stranger/shop in Cazy00/shop")
        payload["workflow_run"]["head_repository"]["full_name"] = "Cazy00/shop"
        self.assertAllowed(self.run_hook(event="workflow_run", payload=payload))

    def test_a_missing_or_unreadable_value_refuses(self):
        cases = {
            "no actor": (dict(drop=("GITHUB_ACTOR",)), "GITHUB_ACTOR is not set"),
            "empty actor": (dict(actor=""), "GITHUB_ACTOR is not set"),
            "no triggering actor": (dict(drop=("GITHUB_TRIGGERING_ACTOR",)), "GITHUB_TRIGGERING_ACTOR is not set"),
            "no event name": (dict(drop=("GITHUB_EVENT_NAME",)), "GITHUB_EVENT_NAME is not set"),
            "no payload path": (dict(drop=("GITHUB_EVENT_PATH",)), "missing or unreadable"),
            "payload not JSON": (dict(raw="{not json"), "not one JSON object"),
            "payload empty": (dict(raw=""), "not one JSON object"),
            "payload an array": (dict(raw="[1]"), "not one JSON object"),
            "two payloads": (dict(raw="{} {}"), "not one JSON object"),
            "a pull_request event without one": (dict(event="pull_request"), "whose payload has no pull request"),
            "a pull_request_target event without one": (dict(event="pull_request_target"), "whose payload has no pull request"),
            "a workflow_run event without one": (dict(event="workflow_run"), "whose payload has no workflow run"),
            "a deleted fork": (dict(event="pull_request", payload={"pull_request": {"head": {"repo": None},
                                                                                     "base": {"repo": {"full_name": "Cazy00/shop"}}}}),
                               "head or base repository is missing"),
            "empty names": (dict(event="pull_request", payload=pull_request("", "")), "head or base repository is missing"),
            "a name that is not a string": (dict(event="pull_request", payload=pull_request(["Cazy00/shop"], ["Cazy00/shop"])),
                                            "head or base repository is missing"),
            "a pull request that is not an object": (dict(event="pull_request", payload={"pull_request": "Cazy00/shop"}),
                                                     "head or base repository is missing"),
        }
        for name, (kw, why) in cases.items():
            with self.subTest(name):
                self.assertRefused(self.run_hook(**kw), why)

    def test_a_missing_or_empty_trusted_list_refuses(self):
        with tempfile.TemporaryDirectory() as d:
            for name, content in (("absent", None), ("empty", ""), ("blank lines", "\n\n")):
                with self.subTest(name):
                    path = os.path.join(d, name.replace(" ", "-"))
                    if content is not None:
                        with open(path, "w") as f:
                            f.write(content)
                    text = self.text.replace(WRITERS_LINE, "writers=%s  #" % self.writers)
                    hook = self.write(text.replace("list=/opt/ci-hooks/trusted-actors\n", "list=%s\n" % path),
                                      "job-started-%s.sh" % name.replace(" ", "-"))
                    r = subprocess.run([BASH, "-e", hook], env=self.env(d), capture_output=True, text=True, timeout=30)
                    self.assertRefused(r, "cannot be read" if content is None else "not a trusted account")

    def test_a_payload_path_that_is_not_a_readable_file_refuses(self):
        with tempfile.TemporaryDirectory() as d:
            env = self.env(d)
            for path in (os.path.join(d, "absent.json"), d):
                with self.subTest(path=path):
                    r = subprocess.run([BASH, "-e", self.hook], env={**env, "GITHUB_EVENT_PATH": path},
                                       capture_output=True, text=True, timeout=30)
                    self.assertRefused(r, "missing or unreadable")
            if os.geteuid() != 0:  # root reads a file whatever its mode
                os.chmod(env["GITHUB_EVENT_PATH"], 0)
                r = subprocess.run([BASH, "-e", self.hook], env=env, capture_output=True, text=True, timeout=30)
                self.assertRefused(r, "missing or unreadable")

    def test_an_error_inside_the_check_refuses(self):
        with tempfile.TemporaryDirectory() as d:
            with open(self.hook) as f:
                text = f.read()
            hook = self.write(text.replace("/usr/bin/jq", os.path.join(d, "no-jq")), "job-started-no-jq.sh")
            r = subprocess.run([BASH, "-e", hook], env=self.env(d), capture_output=True, text=True, timeout=30)
        self.assertRefused(r, "not one JSON object")  # the reader is missing: no payload was read, so no run is allowed

    def fake_worker(self, d, start_hook, before=""):
        """A process named Runner.Worker (the name the check looks for) that runs `before`, starts the check, then 'a
        step'. The check's own stderr goes to $HOOK_ERR (start_hook says so), so what reaches the Worker's stderr is what
        the check wrote there itself."""
        worker = os.path.join(d, "Runner.Worker")
        with open(worker, "w") as f:
            f.write('#!%s\n%s\n%s\necho "a step ran"\n' % (BASH, before, start_hook))
        os.chmod(worker, 0o755)
        return worker

    def test_a_refusal_kills_the_runner_worker_so_no_step_runs(self):
        for how, start_hook in (("as its child", '%s -e "$HOOK" 2>"$HOOK_ERR"' % BASH),
                                ("through a shell", "/bin/sh -c '%s -e \"$HOOK\" 2>\"$HOOK_ERR\"; true'" % BASH)):  # review F2
            with self.subTest(how), tempfile.TemporaryDirectory() as d:
                worker = self.fake_worker(d, start_hook)
                hook_env = {"HOOK": self.fake_worker_hook, "HOOK_ERR": os.path.join(d, "hook.err")}
                refused = subprocess.run([worker], env={**self.env(d, actor="stranger"), **hook_env},
                                         capture_output=True, text=True, timeout=60)
                allowed = subprocess.run([worker], env={**self.env(d), **hook_env},
                                         capture_output=True, text=True, timeout=60)
                self.assertEqual(refused.returncode, -9, refused.stdout + refused.stderr)  # SIGKILL
                self.assertIn("GITHUB_ACTOR is stranger", refused.stdout)
                # The Worker's own stderr carries the refusal too: the runner's Listener puts it on the failed job.
                self.assertIn("::error::ci-pool refused this job: GITHUB_ACTOR is stranger, not a trusted account or an accepted writer of cazy00/shop\n"
                              "::error::ci-pool: event push, actor stranger, triggering actor Cazy00, repository Cazy00/shop",
                              refused.stderr)
                self.assertNotIn("a step ran", refused.stdout)
                self.assertNotIn("cannot stop the job", refused.stdout)
                self.assertEqual(allowed.returncode, 0, allowed.stdout + allowed.stderr)
                self.assertIn("a step ran", allowed.stdout)
                self.assertNotIn("::error::", allowed.stderr)  # an allowed run writes nothing to the Worker (#115 N4)

    def test_a_worker_whose_stderr_is_full_is_still_killed(self):  # #115 review N2, #774 review F2
        # The Worker's stderr is a pipe nobody reads, filled by a writer left blocked on it: the check's write to it
        # blocks, and is given 1 s in the background; the kill does not wait for it.
        with tempfile.TemporaryDirectory() as d:
            worker = self.fake_worker(d, '%s -e "$HOOK" 2>"$HOOK_ERR"' % BASH,
                                      before="head -c 1048576 /dev/zero >&2 &\nsleep 1")
            env = {**self.env(d, actor="stranger"), "HOOK": self.fake_worker_hook, "HOOK_ERR": os.path.join(d, "hook.err")}
            # Its own session, so that whatever happens the Worker's whole group (the check, the filler) is ended below
            # and the test fails rather than hangs (#116 review 1).
            p = subprocess.Popen([worker], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            try:
                code = p.wait(timeout=30)  # never reads the Worker's stderr while it runs
            finally:
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                p.stderr.close()  # a writer still blocked on the full pipe gets SIGPIPE
                out = p.stdout.read().decode()
                p.stdout.close()
                p.wait()
            with open(env["HOOK_ERR"]) as f:
                hook_err = f.read()
        self.assertEqual(code, -9, out)
        self.assertNotIn("a step ran", out)
        self.assertIn("GITHUB_ACTOR is stranger", out)
        # The write that was killed after 1 s says so in the job's log (#116 review 2). The status is timeout's: GNU's
        # sends the KILL to its own group too and ends 137, uutils' ends 124.
        self.assertRegex(hook_err, r"ci-pool: the refusal could not be written to the Worker's stderr \(exit (124|137)\)")

    def test_the_write_to_the_worker_appends(self):  # #115 review N1: what fd 2 points at is never truncated
        with tempfile.TemporaryDirectory() as d:
            log = os.path.join(d, "worker.log")
            with open(log, "w") as f:
                f.write("earlier worker output\n")
            worker = self.fake_worker(d, '%s -e "$HOOK" 2>"$HOOK_ERR"' % BASH, before='exec 2>>"$WORKER_LOG"')
            env = {**self.env(d, actor="stranger"), "HOOK": self.fake_worker_hook, "HOOK_ERR": os.path.join(d, "hook.err"),
                   "WORKER_LOG": log}
            r = subprocess.run([worker], env=env, capture_output=True, text=True, timeout=60)
            with open(log) as f:
                written = f.read()
        self.assertEqual(r.returncode, -9, r.stdout + r.stderr)
        self.assertTrue(written.startswith("earlier worker output\n::error::ci-pool refused this job: "), written)

    def test_the_write_to_the_worker_is_bounded_and_in_the_background(self):
        # The behaviour is in the full-pipe and append tests above; this pins only that the write is the bounded one
        # and is started before the kill (#116 review 4: no line shape beyond that).
        stop = self.text[self.text.index("stop_job() {"):self.text.index("\n}\n", self.text.index("stop_job() {"))]
        at = stop.index('/usr/bin/timeout -s KILL 1 /usr/bin/bash -c \'printf "%s\\n" "$1" >> "$2"\'')
        self.assertLess(at, stop.index('kill -KILL "$worker"'))

    def test_only_the_runners_own_executable_counts_as_its_worker(self):
        # The same fake, but the check now wants the runner's executable (/opt/actions-runner/bin*/Runner.Worker): a
        # process that only has the name is not killed, and outside the pool image the check says it cannot stop the job.
        with tempfile.TemporaryDirectory() as d:
            worker = self.fake_worker(d, '%s -e "$HOOK" 2>"$HOOK_ERR"' % BASH)
            r = subprocess.run([worker], env={**self.env(d, actor="stranger"), "HOOK": self.hook,
                                              "HOOK_ERR": os.path.join(d, "hook.err")},
                               capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("a step ran", r.stdout)
        self.assertIn("found no Runner.Worker and is not the pool image's own, so it cannot stop the job", r.stdout)

    def test_without_its_worker_the_pool_images_own_check_ends_every_process_of_its_user(self):
        # Not run (it would end every process of the user running the tests): the fallback is only the installed
        # check's, never root's, and comes after the Worker was looked for.
        stop = self.text[self.text.index("stop_job() {"):self.text.index("\n}\n", self.text.index("stop_job() {"))]
        self.assertLess(stop.index('if worker="$(find_worker)"; then'), stop.index("kill -KILL -1"))
        self.assertIn('elif [[ "${BASH_SOURCE[0]}" == /opt/ci-hooks/job-started.sh && $EUID -ne 0 ]]; then', stop)
        self.assertEqual(self.text.count("kill -KILL -1"), 1)
        self.assertLess(stop.index("$EUID -ne 0 ]]; then"), stop.index("kill -KILL -1"))
        self.assertLess(stop.index("kill -KILL -1"), stop.index("else"))
        find = self.text[self.text.index("find_worker() {"):self.text.index("stop_job() {")]
        self.assertIn("for depth in 1 2; do", find)  # the parent or its parent, never further up

    def test_a_refusal_says_which_check_failed_and_the_values_it_read(self):
        r = self.run_hook(event="pull_request", payload=pull_request("stranger/shop", "Cazy00/shop"))
        self.assertRefused(r, "a pull request from stranger/shop into Cazy00/shop, another repository")
        self.assertIn("::error::ci-pool: event pull_request, actor Cazy00, triggering actor Cazy00, repository Cazy00/shop, "
                      "pull request stranger/shop into Cazy00/shop, workflow run none\n", r.stdout)
        payload = {"workflow_run": {"head_repository": {"full_name": "stranger/shop"}, "repository": {"full_name": "Cazy00/shop"}}}
        r = self.run_hook(event="workflow_run", payload=payload, triggering="MontaDev-sys")
        self.assertIn("triggering actor MontaDev-sys, repository Cazy00/shop, pull request none, "
                      "workflow run stranger/shop in Cazy00/shop\n", r.stdout)
        r = self.run_hook(actor="", drop=("GITHUB_REPOSITORY",))  # refused before the payload is read
        self.assertIn("::error::ci-pool: event push, actor not set, triggering actor Cazy00, repository not set, "
                      "pull request none, workflow run none\n", r.stdout)
        r = self.run_hook(actor="evil\n::warning::x")  # a value is shown with anything outside a login's characters replaced
        self.assertIn("actor evil???warning??x,", r.stdout)
        self.assertNotIn("\n::warning::", r.stdout)

    def test_what_went_wrong_reaches_the_job_log(self):
        # Nothing the check reads is sent to /dev/null: the reader's own error is in the log beside the refusal.
        r = self.run_hook(raw="{not json")
        self.assertRefused(r, "not one JSON object (the reader's error is above)")
        self.assertIn("jq: parse error", r.stderr)
        with tempfile.TemporaryDirectory() as d:
            hook = self.write(self.text.replace("list=/opt/ci-hooks/trusted-actors\n", "list=%s\n" % os.path.join(d, "absent")),
                              "job-started-absent-list.sh")
            r = subprocess.run([BASH, "-e", hook], env=self.env(d), capture_output=True, text=True, timeout=30)
        self.assertRefused(r, "cannot be read")
        self.assertIn("No such file or directory", r.stderr)
        self.assertNotIn("2>/dev/null", self.text)

    def test_a_refusal_outside_the_runner_says_it_cannot_stop_the_job(self):
        r = self.run_hook(actor="stranger")
        self.assertIn("so it cannot stop the job", r.stdout)

    # ── accepted writers, per repository (plan 2026-11-12-ci-pool-accepted-writers §3) ──────────────────────────────
    def run_hook_in(self, repository, **kw):
        """The check with GITHUB_REPOSITORY set to `repository` (None: unset)."""
        with tempfile.TemporaryDirectory() as d:
            env = self.env(d, **kw)
            if repository is None:
                env.pop("GITHUB_REPOSITORY")
            else:
                env["GITHUB_REPOSITORY"] = repository
            return subprocess.run([BASH, "-e", self.hook], env=env, capture_output=True, text=True, timeout=30)

    def test_an_accepted_writer_passes_on_its_repository(self):
        r = self.run_hook_in("Cazy00/shop", actor="writer-one", triggering="writer-one")
        self.assertAllowed(r)
        self.assertIn("ci-pool: a push run of writer-one, this attempt by writer-one: allowed; writer-one passed as an "
                      "accepted writer of cazy00/shop\n", r.stdout)
        # the login and the repository are matched ignoring case, as GitHub names them
        r = self.run_hook_in("CAZY00/Shop", actor="Writer-One", triggering="WRITER-ONE")
        self.assertAllowed(r)
        self.assertIn("allowed; writer-one passed as an accepted writer of cazy00/shop\n", r.stdout)
        for event in ("workflow_dispatch", "schedule"):
            with self.subTest(event=event):
                self.assertAllowed(self.run_hook_in("Cazy00/shop", actor="writer-one", triggering="writer-one", event=event))

    def test_an_accepted_writer_and_a_trusted_account_pass_together(self):
        # his re-run of the owner's run, and the owner's re-run of his
        r = self.run_hook_in("Cazy00/shop", actor="Cazy00", triggering="writer-one")
        self.assertAllowed(r)
        self.assertIn("this attempt by writer-one: allowed; writer-one passed as an accepted writer of cazy00/shop\n", r.stdout)
        r = self.run_hook_in("Cazy00/shop", actor="writer-one", triggering="MontaDev-sys")
        self.assertAllowed(r)
        self.assertIn("allowed; writer-one passed as an accepted writer of cazy00/shop\n", r.stdout)
        # a trusted account's own run says nothing of accepted writers
        self.assertIn("this attempt by Cazy00: allowed\n", self.run_hook_in("Cazy00/shop").stdout)

    def test_two_accepted_writers_of_the_repository_pass_and_are_both_named(self):  # review rvf19836f41b99ad88 F6
        r = self.run_hook_in("Cazy00/shop", actor="writer-one", triggering="Writer-Seven")
        self.assertAllowed(r)
        self.assertIn("allowed; writer-one and writer-seven passed as accepted writers of cazy00/shop\n", r.stdout)

    def test_an_accepted_writer_is_refused_on_another_repository(self):
        cases = (("Cazy00/other", "writer-one"), ("Cazy00/shop", "writer-two"), ("Cazy00/shop", "writer-three"),
                 ("Cazy00/shop-x", "writer-one"), ("Cazy00/sho", "writer-one"), ("other/shop", "writer-one"),
                 ("cazy00/shop writer-one", "writer-one"), ("Cazy00/shop/x", "writer-one"))
        for repository, login in cases:
            for who in ("actor", "triggering"):
                with self.subTest(repository=repository, login=login, who=who):
                    r = self.run_hook_in(repository, **{who: login})
                    name = "GITHUB_ACTOR" if who == "actor" else "GITHUB_TRIGGERING_ACTOR"
                    self.assertRefused(r, "%s is %s, not a trusted account or an accepted writer of " % (name, login))

    def test_an_accepted_writer_is_refused_when_github_repository_is_unset_or_empty(self):
        for repository in (None, ""):
            with self.subTest(repository=repository):
                r = self.run_hook_in(repository, actor="writer-one", triggering="writer-one")
                self.assertRefused(r, "GITHUB_ACTOR is writer-one, not a trusted account (GITHUB_REPOSITORY is not set")
                self.assertAllowed(self.run_hook_in(repository))  # the trusted accounts need no repository

    def test_an_accepted_writers_fork_is_refused(self):
        for event in ("pull_request", "pull_request_target", "pull_request_review", "pull_request_review_comment"):
            with self.subTest(event=event):
                r = self.run_hook_in("Cazy00/shop", actor="writer-one", triggering="writer-one", event=event,
                                     payload=pull_request("writer-one/shop", "Cazy00/shop"))
                self.assertRefused(r, "a pull request from writer-one/shop into Cazy00/shop, another repository")
        payload = {"workflow_run": {"head_repository": {"full_name": "writer-one/shop"}, "repository": {"full_name": "Cazy00/shop"}}}
        r = self.run_hook_in("Cazy00/shop", actor="writer-one", triggering="writer-one", event="workflow_run", payload=payload)
        self.assertRefused(r, "a workflow run of writer-one/shop in Cazy00/shop, another repository")
        # his pull request from a branch of the repository itself passes
        r = self.run_hook_in("Cazy00/shop", actor="writer-one", triggering="writer-one", event="pull_request",
                             payload=pull_request("Cazy00/shop", "Cazy00/shop"))
        self.assertAllowed(r)

    def test_a_second_unlisted_writer_or_a_login_like_an_accepted_one_is_refused(self):
        r = self.run_hook_in("Cazy00/shop", actor="writer-one", triggering="stranger")
        self.assertRefused(r, "GITHUB_TRIGGERING_ACTOR is stranger, not a trusted account or an accepted writer of cazy00/shop")
        for login in ("writer-on", "writer-one-x", "xwriter-one", "writer-one[bot]", "*", "writer-*", "[w]riter-one",
                      "writer-one ", " writer-one", "cazy00/shop writer-one", "writer-four", "extra", "writer-four extra"):
            with self.subTest(login=login):
                self.assertRefused(self.run_hook_in("Cazy00/shop", actor=login), "not a trusted account")
                self.assertRefused(self.run_hook_in("Cazy00/shop", triggering=login), "not a trusted account")

    def test_the_accepted_writers_are_read_only_for_an_actor_who_is_not_trusted(self):
        cases = [("absent", None, "cannot be read: not a file"), ("a directory", "/", "cannot be read: not a file"),
                 ("empty", "", None)]
        if os.geteuid() != 0:  # root reads a file whatever its mode
            cases.append(("unreadable", "cazy00/shop writer-one\n", "cannot be read"))
        with tempfile.TemporaryDirectory() as d:
            for name, content, why in cases:
                with self.subTest(name):
                    path = os.path.join(d, name.replace(" ", "-"))
                    if content == "/":
                        os.mkdir(path)
                    elif content is not None:
                        with open(path, "w") as f:
                            f.write(content)
                        if name == "unreadable":
                            os.chmod(path, 0)
                    hook = self.write(self.text_with_list.replace(WRITERS_LINE, "writers=%s  #" % path),
                                      "job-started-writers-%s.sh" % name.replace(" ", "-"))
                    env = {**self.env(d), "GITHUB_ACTOR": "writer-one", "GITHUB_TRIGGERING_ACTOR": "writer-one"}
                    r = subprocess.run([BASH, "-e", hook], env=env, capture_output=True, text=True, timeout=30)
                    if why is None:
                        self.assertRefused(r, "GITHUB_ACTOR is writer-one, not a trusted account or an accepted writer of cazy00/shop")
                    else:
                        self.assertRefused(r, "the accepted writers (%s) %s" % (path, why))
                    if name == "unreadable":
                        self.assertIn("Permission denied", r.stderr)  # the reader's own error reaches the log
                    r = subprocess.run([BASH, "-e", hook], env=self.env(d), capture_output=True, text=True, timeout=30)
                    self.assertAllowed(r)  # the owner's run never reads it

    def run_host_part(self, d, path, isolation="true", tail="", part=None):
        """The build's host half that reads the input (to the line before its traps), as root runs it, with a fake `lxc`
        whose `profile device get` prints `isolation` (None: the call fails). Returns the run and the lxc calls."""
        if part is None:
            part = self.image[self.image.index("writers=()\nif [[ -e"):self.image.index("trap 'rc=$?; echo \"ci-pool-image: failed")]
        lxc, log = os.path.join(d, "fake-lxc"), os.path.join(d, "lxc-calls")
        with open(lxc, "w") as f:
            f.write('#!%s\necho "$*" >> "$LXC_LOG"\n[ "$1 $2 $3" = "profile device get" ] || exit 9\n'
                    '[ -n "${ISOLATION+x}" ] || exit 1\nprintf "%%s\\n" "$ISOLATION"\n' % BASH)
        os.chmod(lxc, 0o755)
        if os.path.exists(log):
            os.remove(log)
        env = {"PATH": os.environ["PATH"], "ACCEPTED_WRITERS_FILE": path, "LXC": lxc, "LXC_LOG": log}
        if isolation is not None:
            env["ISOLATION"] = isolation
        r = subprocess.run([BASH, "-c", "set -euo pipefail\nkind=build\n" + part + tail], capture_output=True, text=True,
                           timeout=30, env=env)
        calls = open(log).read().splitlines() if os.path.exists(log) else []
        return r, calls

    @staticmethod
    def put(path, content, mode=0o644):
        with open(path, "w") as f:
            f.write(content)
        os.chmod(path, mode)

    def test_the_build_reads_the_accepted_writers_input(self):
        self.assertEqual(self.image.count('ACCEPTED_WRITERS_FILE="$SHARE/ci-pool-accepted-writers"\n'), 1)  # what the host checks
        self.assertIn('--env ACCEPTED_WRITERS="$accepted_writers"', self.image)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "ci-pool-accepted-writers")
            for name, content, want in (
                    ("missing", None, ""), ("empty", "", ""), ("one", "cazy00/shop writer-one\n", "cazy00/shop writer-one"),
                    ("no final newline", "cazy00/shop writer-one", "cazy00/shop writer-one"),
                    ("two", "cazy00/shop writer-one\ncazy00/.github a1\n", "cazy00/shop writer-one,cazy00/.github a1"),
                    ("names GitHub allows", "a/b.c_d-e x-y\n0/9 z\n", "a/b.c_d-e x-y,0/9 z")):
                with self.subTest(name):
                    if os.path.exists(path):
                        os.remove(path)
                    if content is not None:
                        self.put(path, content)
                    r, calls = self.run_host_part(d, path, tail='printf "<%s>" "$accepted_writers"\n')
                    self.assertEqual((r.returncode, r.stdout), (0, "<%s>" % want), r.stderr)
                    # the profile is asked about only when there is a writer
                    self.assertEqual(calls, ["profile device get ci-pool-build eth0 security.port_isolation"] if want else [])

    def test_the_build_refuses_writers_on_a_profile_without_port_isolation(self):  # review rvf19836f41b99ad88 F1
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "ci-pool-accepted-writers")
            self.put(path, "cazy00/shop writer-one\n")
            for isolation in ("", "false", "1", "yes", "TRUE", "true ", None):
                with self.subTest(isolation=isolation):
                    r, calls = self.run_host_part(d, path, isolation=isolation, tail='echo "went on"\n')
                    self.assertEqual(r.returncode, 2, r.stderr)
                    self.assertIn("the profile ci-pool-build's eth0 does not set security.port_isolation=true", r.stderr)
                    self.assertNotIn("went on", r.stdout)
            self.put(path, "")
            for isolation in ("", None):  # no writer: the profile is not asked, and the build goes on as before
                with self.subTest(isolation=isolation, writers="none"):
                    r, calls = self.run_host_part(d, path, isolation=isolation, tail='echo "went on"\n')
                    self.assertEqual((r.returncode, calls), (0, []), r.stderr)
                    self.assertIn("went on", r.stdout)
        # before anything is launched or pushed
        self.assertLess(self.image.index("profile device get"), self.image.index('$LXC launch ubuntu:24.04'))

    def test_the_build_refuses_a_malformed_accepted_writers_input(self):
        bad_lines = ("Cazy00/shop writer-one", "cazy00/shop Writer-One", "cazy00/shop", "cazy00 writer-one", "/shop writer-one",
                     "cazy00/ writer-one", "cazy00/shop writer-one[bot]", "cazy00/shop  writer-one", " cazy00/shop writer-one",
                     "cazy00/shop writer-one ", "cazy00/shop\twriter-one", "cazy00/shop writer-one\r", "", "# a comment",
                     "cazy00/shop writer-one,cazy00/x y", "cazy00/. writer-one", "cazy00/.. writer-one", "-a/shop writer-one",
                     "a-/shop writer-one", "cazy00/shop -writer", "cazy00/shop writer-", "cazy00/sh op writer-one",
                     "cazy00/shop wri;ter", "$(id)/x y", "a/b/c d", "cazy00/shop writer-one extra", "cazy00/sh*p writer-one",
                     "cazy00/shop writer_one", "cazy00/shöp writer-one")
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "ci-pool-accepted-writers")
            for line in bad_lines:
                for content, n in ((line + "\n", 1), ("cazy00/shop writer-one\n" + line + "\n", 2)):
                    with self.subTest(line=line, n=n):
                        self.put(path, content)
                        r, calls = self.run_host_part(d, path)
                        self.assertEqual(r.returncode, 2, r.stderr)
                        self.assertIn("line %d is not one \"owner/repo login\" pair in lower case" % n, r.stderr)
                        self.assertEqual(calls, [])
            os.remove(path)
            good = os.path.join(d, "good")
            self.put(good, "cazy00/shop writer-one\n")
            for name, make, why in (("a directory", lambda: os.mkdir(path), "is not a readable file"),
                                    ("a dangling link", lambda: os.symlink("absent", path), "is not a readable file"),
                                    ("a link to a good file", lambda: os.symlink(good, path), "(a link is refused)"),
                                    ("group-writable", lambda: self.put(path, "cazy00/shop writer-one\n", 0o664), "writable by no one else"),
                                    ("world-writable", lambda: self.put(path, "cazy00/shop writer-one\n", 0o646), "writable by no one else")):
                with self.subTest(name):
                    make()
                    r, calls = self.run_host_part(d, path)
                    self.assertEqual(r.returncode, 2, r.stderr)
                    self.assertIn(why, r.stderr)
                    os.rmdir(path) if os.path.isdir(path) and not os.path.islink(path) else os.remove(path)
            # another account's file (as root the build refuses any file root does not own)
            self.put(path, "cazy00/shop writer-one\n")
            host = self.image[self.image.index("writers=()\nif [[ -e"):self.image.index("trap 'rc=$?; echo \"ci-pool-image: failed")]
            self.assertEqual(host.count('"$owner" == "$EUID"'), 1)
            r, calls = self.run_host_part(d, path, part=host.replace('"$owner" == "$EUID"', '"$owner" == "%d"' % (os.geteuid() + 1)))
            self.assertEqual(r.returncode, 2, r.stderr)
            self.assertIn("must be owned by uid", r.stderr)
            if os.geteuid() != 0:  # root reads a file whatever its mode
                os.chmod(path, 0)
                r, calls = self.run_host_part(d, path)
                self.assertEqual(r.returncode, 2, r.stderr)
                self.assertIn("is not a readable file", r.stderr)

    def test_the_build_writes_the_accepted_writers_one_a_line_for_both_kinds(self):
        body = self.image[self.image.index("<<'PROVISION'"):self.image.index("\nPROVISION\n")]
        start = 'IFS=, read -ra writers <<<"${ACCEPTED_WRITERS-}"\n'
        end = "chmod 0644 /opt/ci-hooks/accepted-writers\n"
        at = body.index(start)
        self.assertLess(body.index("install -d -m 0755 /opt/ci-hooks"), at)
        self.assertLess(at, body.index("# Docker, then the hook that clears it"))  # gate images too
        part = body[at:body.index(end) + len(end)]
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "accepted-writers")
            open(os.path.join(d, "cazy00"), "w").close()  # a file a glob would match
            for given, want in ((None, ""), ("", ""), ("cazy00/shop writer-one", "cazy00/shop writer-one\n"),
                                ("cazy00/shop writer-one,cazy00/other writer-two",
                                 "cazy00/shop writer-one\ncazy00/other writer-two\n")):
                with self.subTest(given=given):
                    env = {"PATH": os.environ["PATH"]}
                    if given is not None:
                        env["ACCEPTED_WRITERS"] = given
                    r = subprocess.run([BASH, "-c", "set -Eeuo pipefail\n" + part.replace("/opt/ci-hooks/accepted-writers", out)],
                                       cwd=d, env=env, capture_output=True, text=True, timeout=30)
                    self.assertEqual(r.returncode, 0, r.stderr)
                    with open(out) as f:
                        self.assertEqual(f.read(), want)
                    self.assertEqual(os.stat(out).st_mode & 0o777, 0o644)

    def test_what_the_build_writes_is_what_the_check_reads(self):
        """The input, through the build's two halves, to the check: the listed login passes on its repository alone."""
        host = self.image[self.image.index("writers=()\nif [[ -e"):self.image.index("trap 'rc=$?; echo \"ci-pool-image: failed")]
        body = self.image[self.image.index("<<'PROVISION'"):self.image.index("\nPROVISION\n")]
        guest = body[body.index('IFS=, read -ra writers'):body.index("chmod 0644 /opt/ci-hooks/accepted-writers\n")]
        with tempfile.TemporaryDirectory() as d:
            given, out = os.path.join(d, "input"), os.path.join(d, "accepted-writers")
            self.put(given, "cazy00/mateen writer-five\ncazy00/shop writer-six\n")
            r, calls = self.run_host_part(d, given, part=host + 'ACCEPTED_WRITERS="$accepted_writers"\n'
                                          + guest.replace("/opt/ci-hooks/accepted-writers", out))
            self.assertEqual(r.returncode, 0, r.stderr)
            hook = self.write(self.text_with_list.replace(WRITERS_LINE, "writers=%s  #" % out), "job-started-built.sh")
            for repository, login, ok in (("Cazy00/mateen", "writer-five", True), ("Cazy00/shop", "writer-six", True),
                                          ("Cazy00/shop", "writer-five", False), ("Cazy00/mateen", "writer-six", False)):
                with self.subTest(repository=repository, login=login):
                    env = {**self.env(d), "GITHUB_REPOSITORY": repository, "GITHUB_ACTOR": login, "GITHUB_TRIGGERING_ACTOR": login}
                    r = subprocess.run([BASH, "-e", hook], env=env, capture_output=True, text=True, timeout=30)
                    if ok:
                        self.assertAllowed(r)
                        self.assertIn("passed as an accepted writer of %s" % repository.lower(), r.stdout)
                    else:
                        self.assertRefused(r, "not a trusted account or an accepted writer of %s" % repository.lower())


class EntrypointTests(unittest.TestCase):
    """ci-pool-entrypoint, run with its paths moved into a scratch directory and sudo and systemctl faked."""

    def run_entrypoint(self, d, hook_present=True):
        with open(os.path.join(HERE, "ci-pool-entrypoint")) as f:
            body = f.read()
        for old, new in (("/etc/ci-pool/jit", "jit"), ("/opt/ci-hooks/", "hooks/"), ("/opt/actions-runner", "runner")):
            self.assertIn(old, body)
            body = body.replace(old, os.path.join(d, new))
        os.makedirs(os.path.join(d, "hooks"))
        os.makedirs(os.path.join(d, "runner"))
        with open(os.path.join(d, "jit"), "w") as f:
            f.write("CONFIG")
        if hook_present:
            hook = os.path.join(d, "hooks", "job-started.sh")
            with open(hook, "w") as f:
                f.write("#!/bin/bash\n")
            os.chmod(hook, 0o755)
        prelude = ('sudo() { printf "%s\\n" "$@" > "$D/sudo-args"; env > "$D/sudo-env"; }\n'
                   'systemctl() { echo "$*" >> "$D/systemctl"; }\n')
        return subprocess.run([BASH, "-c", prelude + body], env={"PATH": os.environ["PATH"], "D": d},
                              capture_output=True, text=True, timeout=30)

    def read(self, d, name):
        with open(os.path.join(d, name)) as f:
            return f.read()

    def test_the_runner_runs_with_the_job_started_check(self):
        with tempfile.TemporaryDirectory() as d:
            r = self.run_entrypoint(d)
            self.assertEqual(r.returncode, 0, r.stderr)
            args = self.read(d, "sudo-args").splitlines()
            self.assertIn("--preserve-env=ACTIONS_RUNNER_HOOK_JOB_STARTED,ACTIONS_RUNNER_HOOK_JOB_COMPLETED", args)
            self.assertEqual(args[-3:], ["./run.sh", "--jitconfig", "CONFIG"])
            self.assertIn("ACTIONS_RUNNER_HOOK_JOB_STARTED=%s\n" % os.path.join(d, "hooks", "job-started.sh"),
                          self.read(d, "sudo-env"))
            self.assertEqual(self.read(d, "systemctl"), "poweroff\n")
            self.assertFalse(os.path.exists(os.path.join(d, "jit")))

    def test_an_image_without_the_check_starts_no_runner(self):
        with tempfile.TemporaryDirectory() as d:
            r = self.run_entrypoint(d, hook_present=False)
            self.assertEqual(r.returncode, 1)
            self.assertIn("no runner is started", r.stderr)
            self.assertFalse(os.path.exists(os.path.join(d, "sudo-args")))
            self.assertEqual(self.read(d, "systemctl"), "poweroff\n")
            self.assertFalse(os.path.exists(os.path.join(d, "jit")))  # the config is gone either way


if __name__ == "__main__":
    unittest.main()
