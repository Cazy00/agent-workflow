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
GOOD = {"mem_available_mib": 8000, "cpu_psi": 5.0, "mem_psi": 0.5}


class FakeLxc:
    """Stands in for pool.Lxc: instances as {name: {status, created_at, base_image}}, and a log of calls."""

    def __init__(self, fingerprint="fp1"):
        self.instances, self.calls, self.fingerprint, self.fail = {}, [], fingerprint, set()

    def _do(self, what):
        self.calls.append(what)
        if what[0] in self.fail:
            raise pool.PoolError(f"{what[0]} refused")

    def list(self):
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
        self.commands, self.removed = [], []
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
        self.removed.append(argv[2:])
        return json.dumps({"version": 1})

    def tick(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.pool.tick()

    def job(self, jid, label="wf-build", created="2026-10-29T19:00:00Z"):
        self.queued.append({"id": jid, "labels": [label], "created_at": created})


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

    def test_a_job_that_was_recorded_before_a_crash_is_not_launched_again(self):
        e = Env(self)
        e.pool.state.jobs["100"] = {"container": "pool-wf-build-100", "repo": "o/r", "label": "wf-build", "runner_id": "1",
                                    "runner_name": "x", "started": e.now, "status": "launching", "assigned": False}
        e.pool.state.save()
        e.job("100")
        e.tick()
        self.assertEqual(e.lxc.names("start"), [])

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
        e.running = set()  # remembered: later passes do not ask again
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
        for key in ("raw.lxc", "raw.idmap", "security.devlxd", "boot.autostart", "security.idmap.isolated"):
            self.refused("build", base.replace("config:\n", f'config:\n  {key}: "x"\n'), f"config key {key} is not allowed")
        self.refused("build", base.replace("config:\n", "config:\n  raw.lxc: |\n    lxc.mount.entry = /dev dev none bind\n"), "raw.lxc")

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
                if "/runs/5/jobs" in self.path:
                    return self.reply({"jobs": [{"id": 11, "status": "queued", "labels": ["wf-build"], "created_at": "t"},
                                                {"id": 12, "status": "in_progress", "labels": ["wf-gate"]}]})
                if "/runs/6/jobs" in self.path:
                    return self.reply({"jobs": [{"id": 13, "status": "in_progress", "runner_name": "ci-pool-wf-gate-1"}]})
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
                                                "jobs": [{"id": "11", "labels": ["wf-build"], "created_at": "t"}]})
        self.assertTrue(all(c[2] == "Bearer tok123" for c in self.calls if c[0] == "GET"))

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


if __name__ == "__main__":
    unittest.main()
