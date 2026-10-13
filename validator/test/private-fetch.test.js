import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// MAINT-0017 A5: a private workflow repository is fetched with a read-only token in the secret WF_READ_TOKEN. Only the
// step that fetches sees it; git gets it through GIT_CONFIG_* values (never argv); nothing prints it.
const read = f => fs.readFileSync(new URL(`../../templates/github/${f}`, import.meta.url), 'utf8');
const ENV = '          WF_READ_TOKEN: ${{ secrets.WF_READ_TOKEN }}';
const FETCH = { 'wf-ci.yml': 'Fetch the validator pinned by the base branch', 'wf-status.yml': 'Fetch the pinned workflow', 'wf-client-page.yml': 'Fetch the pinned workflow' };

for (const [file, name] of Object.entries(FETCH)) {
  test(`${file}: only "${name}" sees WF_READ_TOKEN, and never prints it`, () => {
    const steps = read(file).split(/^ {6}- /m).slice(1);
    const holders = steps.filter(s => /WF_READ_TOKEN|GIT_CONFIG_/.test(s));
    assert.deepEqual(holders.map(s => s.match(/^name: (.*)$/m)?.[1]), [name]);
    assert.equal(holders[0].split('\n').filter(l => l.includes('secrets.')).join('\n'), ENV);
    assert.doesNotMatch(holders[0], /echo[^\n]*WF_READ_TOKEN|set -x|GIT_TRACE/);
    assert.doesNotMatch(holders[0], /git [^\n]*-c http/, 'no token in argv');
  });
}

test('the token becomes a basic authorization header, and an unset secret changes nothing', () => {
  const block = read('wf-ci.yml').match(/( *if \[ -n "\$WF_READ_TOKEN" \]; then\n[\s\S]*?\n *fi\n)/)[1];
  for (const f of ['wf-status.yml', 'wf-client-page.yml']) assert.ok(read(f).includes(block), `${f} has the same block`);
  const run = token => spawnSync('bash', ['-c', `set -euo pipefail\n${block}\nenv | grep '^GIT_CONFIG_' | sort || true`], { encoding: 'utf8', env: { PATH: process.env.PATH, WF_READ_TOKEN: token } });
  const set = run('ghp_abc-DEF_123');
  assert.equal(set.status, 0, set.stderr);
  assert.equal(set.stdout, `GIT_CONFIG_COUNT=1\nGIT_CONFIG_KEY_0=http.https://github.com/.extraheader\nGIT_CONFIG_VALUE_0=AUTHORIZATION: basic ${Buffer.from('x-access-token:ghp_abc-DEF_123').toString('base64')}\n`);
  const unset = run('');
  assert.equal(unset.status, 0, unset.stderr);
  assert.equal(unset.stdout, '');
});

test('the status and client page workflows fetch the pin into the cache scripts/wf reads, before rendering', () => {
  for (const f of ['wf-status.yml', 'wf-client-page.yml']) {
    const steps = read(f).split(/^ {6}- /m).slice(1).map(s => s.match(/^name: (.*)$/m)?.[1] ?? s.split('\n')[0]);
    assert.ok(steps.indexOf('Fetch the pinned workflow') >= 0 && steps.indexOf('Fetch the pinned workflow') < steps.findIndex(n => /^Render/.test(n)), f);
    assert.match(read(f), /git init -q \.cache\/agent-workflow\n\s+git -C \.cache\/agent-workflow fetch -q --depth 1 "https:\/\/github\.com\/\$REPO\.git" "\$REV"\n\s+git -C \.cache\/agent-workflow checkout -q --detach FETCH_HEAD/);
  }
});
