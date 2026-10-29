import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// MAINT-0017 A2: the owner's CI runners. A build container runs product code with Docker; a gate container runs only
// the workflow's own jobs, with no Docker and no sudo, so product code and its packages never reach the merge check.
const dir = new URL('../../server/ci-runner/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, dir), 'utf8');

test('the runner scripts parse as Bash', () => {
  for (const f of ['ci-runner', 'runner-setup', 'install-host.sh', 'ci-pool-image', 'ci-pool-entrypoint']) {
    const r = spawnSync('bash', ['-n', fileURLToPath(new URL(f, dir))], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test('the gate container has no Docker and no sudo for the runner, and has gh for the status jobs', () => {
  const gate = read('ci-gate.yaml');
  assert.match(gate, /^#cloud-config\n/);
  const config = gate.split('\n').filter(l => !l.trim().startsWith('#')).join('\n'); // the comments say "no Docker"
  assert.doesNotMatch(config, /docker/i);
  assert.doesNotMatch(config, /^\s+sudo:/m);
  assert.match(gate, /apt-get install -y git gh/);
});

test('the build container clears Docker after every job and at boot', () => {
  const build = read('ci-build.yaml');
  assert.match(build, /^#cloud-config\n/);
  assert.match(build, /path: \/opt\/ci-hooks\/clean-docker\.sh/);
  assert.match(build, /@reboot root sleep 30 && \/opt\/ci-hooks\/clean-docker\.sh/);
  assert.match(read('runner-setup'), /ACTIONS_RUNNER_HOOK_JOB_COMPLETED=\/opt\/ci-hooks\/clean-docker\.sh/);
});

test('the runner download is checked against its release checksum before it is unpacked', () => {
  const s = read('runner-setup');
  assert.ok(s.indexOf('sha256sum -c -') > 0 && s.indexOf('sha256sum -c -') < s.indexOf('tar xzf'), 'checksum before unpacking');
  assert.match(s, /BEGIN SHA linux-\$\{arch\}/);
});

test('the registration token is read hidden, passed on stdin, and never printed', () => {
  const c = read('ci-runner');
  assert.match(c, /read -rsp /);
  assert.match(c, /printf '%s\\n' "\$token" \| \$LXC exec/);
  assert.doesNotMatch(c, /echo[^\n]*\$token/);
  assert.match(read('runner-setup'), /^read -r token$/m);
});

test('install-host opens nothing towards the LAN or the internet', () => {
  const h = read('install-host.sh');
  for (const rule of h.match(/^sudo ufw .*$/gm)) assert.match(rule, / on lxdbr0 /, rule);
  assert.ok(h.indexOf('route insert 1 deny in on lxdbr0') > 0 && h.indexOf('route insert 1 deny in on lxdbr0') < h.indexOf('route allow in on lxdbr0'), 'the LAN deny comes first');
});

// v2.5.1: init creates a missing profile and sets each default key the profile lacks (a half-made profile is repaired, and
// a later release can add a key), but never changes a key the host set with `lxc profile set`.
test('ci-runner init sets only the keys a profile lacks, and leaves the host\'s own values alone', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-runner-init-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const fake = path.join(tmp, 'lxc'), log = path.join(tmp, 'calls'), state = path.join(tmp, 'state');
  fs.writeFileSync(fake, `#!/usr/bin/env bash
echo "$*" >> "${log}"
case "$1 $2" in
  "profile show") grep -q "^$3 " "${state}"; exit ;;
  "profile create") echo "$3 " >> "${state}" ;;
  "profile get") [ -n "$FAIL_GET" ] && exit 1; sed -n "s/^$3 $4=//p" "${state}" ;;
  "profile set") echo "$3 $4" >> "${state}" ;;
esac
exit 0
`, { mode: 0o755 });
  const fn = read('ci-runner').match(/^profile\(\) \{[\s\S]*?^\}$/m)[0];
  const run = () => spawnSync('bash', ['-c', `set -euo pipefail\nLXC=${fake}\n${fn}\nprofile ci-build limits.memory=6GiB limits.cpu=4`], { encoding: 'utf8' });
  const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n').filter(c => !c.startsWith('profile get') && c !== 'profile show ci-build');
  const go = (initial, expected, why) => { fs.writeFileSync(state, initial); fs.writeFileSync(log, ''); const r = run(); assert.equal(r.status, 0, r.stderr); assert.deepEqual(calls(), expected, why); };
  go('', ['profile create ci-build', 'profile set ci-build limits.memory=6GiB', 'profile set ci-build limits.cpu=4'], 'a missing profile gets every default');
  go('ci-build \nci-build limits.memory=5GiB\nci-build limits.cpu=2\n', [], 'the host\'s own values stay');
  go('ci-build \nci-build limits.memory=5GiB\n', ['profile set ci-build limits.cpu=4'], 'a half-made profile gets the key it lacks');
  // v2.5.1 second review: a failed read must stop init, not overwrite the host's value.
  fs.writeFileSync(state, 'ci-build \nci-build limits.memory=5GiB\n'); fs.writeFileSync(log, '');
  fs.writeFileSync(path.join(tmp, 'fail-get'), '');
  const failing = spawnSync('bash', ['-c', `set -euo pipefail\nLXC=${fake}\n${fn}\nprofile ci-build limits.memory=6GiB`], { encoding: 'utf8', env: { ...process.env, FAIL_GET: '1' } });
  assert.notEqual(failing.status, 0, 'a failed read stops init');
  assert.ok(!fs.readFileSync(log, 'utf8').includes('profile set'), 'and sets nothing');
});

// v2.5.1: what each runner trusts. The gate runs only workflow files and the trusted branch's scripts/wf, so a token
// without the Workflows permission can't put code on it; the build runner runs whatever any push sends it.
test('the docs say what each runner trusts, how to size them, and what LXD updates do', () => {
  const readme = read('README.md');
  assert.match(readme, /only for pull requests into the trusted branch/);
  assert.match(readme, /validator pinned by the trusted branch/);
  assert.match(readme, /every account with write access/);
  assert.match(readme, /Contents and Pull requests/);
  assert.match(readme, /Run workflows from fork pull requests/);
  assert.match(readme, /lxc profile set ci-build limits\.memory=/);
  assert.match(readme, /refresh\.timer|refresh --hold lxd/);
  assert.doesNotMatch(readme, /LXD updates restart the containers/);
  const root = new URL('../../', import.meta.url);
  assert.match(fs.readFileSync(new URL('procedures/operate.md', root), 'utf8'), /every account with write access/);
  assert.match(fs.readFileSync(new URL('templates/github/wf-ci.yml', root), 'utf8'), /pull requests? into the trusted branch|pull request is into __TRUSTED_BRANCH__/);
});

// v2.5.1: labels are fixed by role (wf-build, wf-gate) and live in the workflow files, so `register` derives each
// runner's label from its container's profile and refuses any other.
test('ci-runner derives a runner\'s label from its container\'s profile, and refuses a container that is neither', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-runner-label-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const fake = path.join(tmp, 'lxc');
  fs.writeFileSync(fake, `#!/usr/bin/env bash
case "$1 $2 $3" in
  "config show shop-ci") printf 'architecture: x86_64\\nprofiles:\\n- default\\n- ci-build\\n' ;;
  "config show shop-gate") printf 'profiles:\\n- default\\n- ci-gate\\n' ;;
  "config show other") printf 'profiles:\\n- default\\n' ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  const fn = read('ci-runner').match(/^role_label\(\) \{[\s\S]*?^\}$/m)[0];
  const label = name => spawnSync('bash', ['-c', `set -euo pipefail\nLXC=${fake}\n${fn}\nrole_label ${name}`], { encoding: 'utf8' });
  assert.equal(label('shop-ci').stdout.trim(), 'wf-build');
  assert.equal(label('shop-gate').stdout.trim(), 'wf-gate');
  assert.notEqual(label('other').status, 0);
  const register = read('ci-runner').match(/^register\(\) \{[\s\S]*?^\}$/m)[0];
  assert.match(register, /role_label/, 'register uses the derived label');
  assert.match(register, /does not match/, 'and refuses a different one');
});

// v2.5.1 (the owner's home server, after a power cut): LXD's snap starts its daemon at boot only when an instance itself
// has boot.autostart set, so a profile's setting left both containers stopped for two hours. `create` sets it on the
// instance, also for one that already exists, so running it again repairs a container made by an older release.
test('ci-runner create sets boot.autostart on the container itself, new or existing', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-runner-create-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const fake = path.join(tmp, 'lxc'), log = path.join(tmp, 'calls');
  fs.writeFileSync(path.join(tmp, 'ci-build.yaml'), '#cloud-config\n');
  fs.writeFileSync(fake, `#!/usr/bin/env bash\necho "$*" >> "${log}"\nif [ "$1" = info ] && [ -n "$NEW" ]; then exit 1; fi\nexit 0\n`, { mode: 0o755 });
  const fn = read('ci-runner').match(/^create\(\) \{[\s\S]*?^\}$/m)[0];
  const run = env => spawnSync('bash', ['-c', `set -euo pipefail\nLXC=${fake}\nSHARE=${tmp}\nusage() { exit 2; }\n${fn}\ncreate shop-ci build`], { encoding: 'utf8', env: { ...process.env, ...env } });
  const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n');
  for (const [why, env] of [['a new container', { NEW: '1' }], ['an existing one', {}]]) {
    fs.writeFileSync(log, '');
    const r = run(env);
    assert.equal(r.status, 0, `${why}: ${r.stderr}`);
    assert.ok(calls().includes('config set shop-ci boot.autostart true'), `${why}: ${calls().join(' | ')}`);
  }
});

test('install-host makes LXD\'s daemon start at boot', () => {
  const h = read('install-host.sh');
  assert.match(h, /systemctl start snap\.lxd\.daemon/);
  assert.match(h, /systemctl enable [^\n]*ci-runner-lxd\.service/);
});

// MAINT-0017 D1: the pool. Its behaviour is tested in server/ci-runner/test_ci_pool.py (CI runs it beside this file).
test('the pool host rules: DHCP and DNS allowed in front of a deny of everything else into the host, on the bridge only', () => {
  const lines = read('install-host.sh').match(/^sudo ufw insert 1 .*$/gm);
  const at = re => lines.findIndex(l => re.test(l));
  assert.ok(at(/deny in on lxdbr0 comment/) >= 0 && at(/allow in on lxdbr0 to any port 53/) > at(/deny in on lxdbr0 comment/), 'each insert at 1 goes in front of the one before it');
  assert.ok(at(/port 67 proto udp/) > at(/deny in on lxdbr0 comment/));
});

test('a pool container is unprivileged and registers itself with a just-in-time config, not a stored token', () => {
  for (const f of ['ci-pool-build.yaml', 'ci-pool-gate.yaml']) {
    const y = read(f);
    assert.match(y, /security\.privileged: "false"/);
    assert.doesNotMatch(y.split('\n').filter(l => !l.startsWith('#')).join('\n'), /raw\.(lxc|idmap)/);
  }
  assert.match(read('ci-pool-entrypoint'), /--jitconfig/);
  assert.match(read('ci-pool-entrypoint'), /rm -f "\$jit"/);
  assert.ok(read('ci-pool-image').indexOf('sha256sum -c -') > 0, 'the runner download is checked');
});
