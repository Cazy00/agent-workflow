import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// MAINT-0017 A2: the owner's CI runners. A build container runs product code with Docker; a gate container runs only
// the workflow's own jobs, with no Docker and no sudo, so product code and its packages never reach the merge check.
const dir = new URL('../../server/ci-runner/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, dir), 'utf8');

test('the runner scripts parse as Bash', () => {
  for (const f of ['ci-runner', 'runner-setup', 'install-host.sh']) {
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
