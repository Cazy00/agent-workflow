"""Tests for ci-pool and ci-pool-github (MAINT-0017 D1). Run: python3 -m unittest discover -s server/ci-runner
No lxc, no network beyond a loopback stub: the lxc wrapper and the source/JIT commands are faked."""
import contextlib
import http.server
import importlib.machinery
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest

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
        self.list_budget = None  # a number: that many more list() calls work, the next one raises

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

    def names(self, op):
        return [c[1] for c in self.calls if c[0] == op]


class Env:
    """A pool on a fake lxc, a fake source and JIT command, a settable clock and host reading."""

    def __init__(self, tc, **over):
        self.tmp = tempfile.TemporaryDirectory()
        tc.addCleanup(self.tmp.cleanup)
        self.cfg = {**pool.DEFAULTS, "version": 1, "repos": ["o/r"], "source_cmd": ["src"], "jit_cmd": ["jit"],
                    "state_file": os.path.join(self.tmp.name, "state.json"),
                    "labels": {"wf-build": {"profile": "ci-pool-build", "image": "ci-pool-build", "cap": 1, "memory": "5GiB"},
                               "wf-gate": {"profile": "ci-pool-gate", "image": "ci-pool-gate", "cap": 2, "memory": "2GiB"}}}
        self.cfg.update(over)
        self.lxc, self.now, self.host = FakeLxc(), 1000.0, dict(GOOD)
        self.queued, self.running, self.private, self.source_fails = [], set(), True, False
        self.commands, self.removed, self.remove_fails = [], [], False
        self.pool = pool.Pool(self.cfg, self.lxc, pool.State(self.cfg["state_file"]), run_cmd=self.cmd,
                              host=lambda: self.host, clock=lambda: self.now)

    def cmd(self, argv):
        self.commands.append(argv)
        if argv[0] == "src":
            if self.source_fails:
                raise pool.PoolError("source down")
            if argv[1] == "queued":
                return json.dumps({"version": 1, "repo": argv[2], "private": self.private, "jobs": self.queued})
            return json.dumps({"version": 1, "repo": argv[2], "jobs": [{"id": "1", "runner_name": n} for n in self.running]})
        if argv[1] == "create":
            return json.dumps({"version": 1, "runner_id": "77", "encoded_jit_config": "SECRET-JIT"})
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
        e.running = {"ci-pool-wf-gate-201"}  # runner 201 holds a job; the runner named for 200 is unassigned
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
        e.running = {"ci-pool-wf-build-100"}
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
        e.running = {"ci-pool-wf-build-100"}
        e.now += 7199
        e.tick()
        self.assertIn("pool-wf-build-100", e.lxc.instances)
        e.now += 2
        e.tick()
        self.assertNotIn("pool-wf-build-100", e.lxc.instances)

    def test_a_stopped_container_is_deleted_and_a_running_one_is_never_killed_for_room(self):
        e = self.started()
        e.running = {"ci-pool-wf-build-100"}
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
        e.running = {"ci-pool-wf-build-100"}
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
                                                         {"id": "15", "labels": ["wf-gate"], "created_at": "t4"}]})
        self.assertTrue(all(c[2] == "Bearer tok123" for c in self.calls if c[0] == "GET"))

    def test_queued_includes_queued_jobs_of_runs_already_in_progress_or_waiting(self):  # F1
        r = self.run_cli("source", "queued", "o/r")
        ids = [j["id"] for j in json.loads(r.stdout)["jobs"]]
        self.assertIn("14", ids)
        self.assertIn("15", ids)
        self.assertNotIn("16", ids, "a job that is itself waiting is not queued")

    def test_the_listings_are_paged(self):  # F1
        r = self.run_cli("source", "queued", "o/p")
        self.assertEqual([j["id"] for j in json.loads(r.stdout)["jobs"]], ["99"], "the job of the run on page 2 is found")

    def test_running_names_the_runner(self):
        r = self.run_cli("source", "running", "o/r")
        self.assertEqual(json.loads(r.stdout)["jobs"], [{"id": "13", "runner_name": "ci-pool-wf-gate-1"}])

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

    def test_the_unit_sets_nothing_that_stops_snap_lxc(self):  # F4
        unit = [l for l in self.text("ci-pool.service").splitlines() if not l.startswith("#")]
        self.assertFalse([l for l in unit if l.startswith(("NoNewPrivileges", "ProtectHome"))])
        self.assertIn("systemd-run --wait --pipe /snap/bin/lxc list", self.text("README.md"))

    def test_rotating_deletes_the_old_prev_image_by_fingerprint_first(self):  # F9
        t = self.text("ci-pool-image")
        tail = t[t.index("# Publish under a new alias"):]
        with tempfile.TemporaryDirectory() as d:
            fake = os.path.join(d, "lxc")
            log = os.path.join(d, "log")
            with open(fake, "w") as f:
                f.write('''#!/usr/bin/env bash
echo "$*" >> "$LOG"
case "$*" in
  "image alias list --format csv") echo "ci-pool-gate,aaaaaaaaaaaa,CONTAINER,x" ;;
  "image info ci-pool-gate-prev") echo "Fingerprint: prevfp" ;;
  "image info ci-pool-gate") echo "Fingerprint: curfp" ;;
esac
''')
            os.chmod(fake, 0o755)
            r = subprocess.run(["bash", "-c", 'set -euo pipefail\nalias=ci-pool-gate kind=gate work=w\n' + tail], capture_output=True,
                               text=True, env={**os.environ, "LXC": fake, "LOG": log})
            self.assertEqual(r.returncode, 0, r.stderr)
            with open(log) as f:
                calls = f.read().splitlines()
        self.assertIn("image delete prevfp", calls)
        self.assertLess(calls.index("image delete prevfp"), calls.index("image alias rename ci-pool-gate ci-pool-gate-prev"))
        self.assertNotIn("image delete curfp", calls)


if __name__ == "__main__":
    unittest.main()
