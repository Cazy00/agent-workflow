import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { audit, render, readRecord, AuditError } from '../../adapters/audit.mjs';

// bin/wf-channel-audit (channel-audit v1): merged pull requests judged at a revision, from `wf resolved` check runs.
const root = fileURLToPath(new URL('../..', import.meta.url));
const BAD = 'b'.repeat(40), GOOD = 'a'.repeat(40);
const run = (revision, app = 'github-actions', name = 'wf resolved') => ({ name, app: { slug: app }, output: { summary: '```json\n' + JSON.stringify({ channel: 'stable', revision, version: 'v2.19.1', resolved_at: '2026-11-08T10:00:00Z' }) + '\n```' } });
const pr = (number, sha, merged_at = '2026-11-08T11:00:00Z') => ({ number, title: `pr ${number}`, merged_at, updated_at: merged_at, head: { sha } });
function fakeApi(world) {
  const calls = [];
  const api = async route => {
    calls.push(route);
    const m = route.match(/^repos\/([^/]+\/[^/]+)\/(pulls|commits\/(\w+)\/check-runs)/);
    const repo = world[m[1]];
    if (!repo) throw new Error('HTTP 404');
    if (m[2] === 'pulls') return Number(new URL(`https://x/${route}`).searchParams.get('page')) === 1 ? repo.pulls : [];
    return { check_runs: repo.checks[m[3]] ?? [] };
  };
  return { api, calls };
}

test('lists the merged pull requests judged at the revision, per project', async () => {
  const { api } = fakeApi({
    'acme/one': { pulls: [pr(3, 's3'), pr(4, 's4'), { ...pr(5, 's5'), merged_at: null }, pr(6, 's6')], checks: { s3: [run(BAD)], s4: [run(GOOD)], s5: [run(BAD)], s6: [run(GOOD), run(BAD)] } },
    'acme/two': { pulls: [pr(9, 's9')], checks: { s9: [run(BAD, 'someone-else'), run(BAD, 'github-actions', 'wf ci')] } },
  });
  const out = await audit({ revision: BAD.slice(0, 7), repos: ['acme/one', 'acme/two', 'acme/gone'], api });
  assert.deepEqual(out.projects[0].pull_requests.map(p => p.number), [3, 6]); // 4 judged elsewhere, 5 not merged
  assert.deepEqual(out.projects[0].pull_requests[1].judged_by, [GOOD, BAD]);
  assert.deepEqual(out.projects[1].pull_requests, []); // a check run not made by GitHub Actions, or not named wf resolved, is not a record
  assert.match(out.projects[2].error, /404/);
  const text = render(out);
  assert.match(text, /acme\/one:\n  - #3 pr 3/); assert.match(text, /also judged at aaaaaaaaaaaa/); assert.match(text, /acme\/two: none/); assert.match(text, /acme\/gone: could not read/);
});

test('--since keeps later merges and stops paging early', async () => {
  const { api, calls } = fakeApi({ 'acme/one': { pulls: [pr(1, 's1', '2026-11-01T00:00:00Z'), pr(2, 's2', '2026-11-08T00:00:00Z')], checks: { s1: [run(BAD)], s2: [run(BAD)] } } });
  const out = await audit({ revision: BAD, repos: ['acme/one'], since: '2026-11-05', api });
  assert.deepEqual(out.projects[0].pull_requests.map(p => p.number), [2]);
  assert.equal(calls.filter(c => c.includes('check-runs')).length, 1); // the older merge is not even read
});

test('bad input is refused; a record that does not parse is skipped', async () => {
  const api = async () => [];
  await assert.rejects(audit({ revision: 'xyz', repos: ['a/b'], api }), AuditError);
  await assert.rejects(audit({ revision: BAD, repos: [], api }), /at least one/);
  await assert.rejects(audit({ revision: BAD, repos: ['nope'], api }), /owner\/name/);
  await assert.rejects(audit({ revision: BAD, repos: ['a/b'], since: 'soon', api }), /not a date/);
  assert.equal(readRecord({ name: 'wf resolved', app: { slug: 'github-actions' }, output: { summary: '```json\nnot json\n```' } }), null);
  const cli = spawnSync(process.execPath, [path.join(root, 'bin/wf-channel-audit'), '--repo', 'a/b'], { encoding: 'utf8' });
  assert.equal(cli.status, 2); assert.match(cli.stderr, /--revision is required/);
});

test('a listing cut off at the page limit is reported, not passed off as complete', async () => {
  const many = n => Array.from({ length: 100 }, (_, i) => pr(n * 100 + i, `s${n}-${i}`));
  const api = async route => route.includes('/pulls?') ? many(Number(new URL(`https://x/${route}`).searchParams.get('page'))) : { check_runs: [] };
  const out = await audit({ revision: BAD, repos: ['acme/one'], api });
  assert.match(out.projects[0].error, /stopped after 2000 closed pull requests/);
});

test('the check-run read asks for every run, not only the latest, and follows its pages', async () => {
  const calls = [];
  const api = async route => {
    calls.push(route);
    if (route.includes('/pulls?')) return [pr(1, 's1')];
    const page = Number(new URL(`https://x/${route}`).searchParams.get('page'));
    return { check_runs: page === 1 ? Array.from({ length: 100 }, () => run(GOOD)) : [run(BAD)] };
  };
  const out = await audit({ revision: BAD, repos: ['acme/one'], api });
  assert.ok(calls.filter(c => c.includes('check-runs')).every(c => c.includes('filter=all')));
  assert.deepEqual(out.projects[0].pull_requests[0].judged_by, [GOOD, BAD]);
});
