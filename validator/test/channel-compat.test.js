import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as candidateLib from '../lib/index.js';
import { fixtureTrust, integrationClaims } from './helpers.js';

// The channel's compatibility rules (docs/proposals/2026-11-07-central-release-channel.md, *Releases that need a
// per-project change*), both directions, against the previous release in this checkout's history:
//   1. the candidate validator over the previous release's fixtures: no new failure, except a fixture whose case.json
//      this release changes (a declared tightening, listed by name);
//   2. the previous release's validator over the candidate's new fixtures: what the candidate passes, it passes too
//      (forward tolerance, so a rollback accepts what the new release wrote);
//   3. upgrades.json: a release after v2.19.0 within major 2 carries automated cleanup only, never a step for a person.
// The previous release is the newest release tag merged into HEAD that does not point at HEAD itself. A shallow checkout
// is deepened first (tags included); when there is still no such tag the test is skipped locally, but fails in CI
// (GITHUB_ACTIONS set), so the release's compatibility guard never passes there without running.
const root = fileURLToPath(new URL('../..', import.meta.url));
const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
const FIRST_CHANNEL_RELEASE = [2, 19, 0];
const parse = v => (String(v).match(/^v?(\d+)\.(\d+)\.(\d+)$/) ?? []).slice(1).map(Number);
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const IN_CI = Boolean(process.env.GITHUB_ACTIONS);

function previousRelease() {
  if (git('rev-parse', 'HEAD').status !== 0) return null;
  if (git('rev-parse', '--is-shallow-repository').stdout.trim() === 'true') {
    git('fetch', '--quiet', '--unshallow', '--tags', 'origin'); // a failure leaves it shallow; the lookup below decides
  }
  const here = new Set(git('tag', '--points-at', 'HEAD').stdout.split('\n'));
  const tags = git('tag', '--list', 'v[0-9]*', '--merged', 'HEAD').stdout.split('\n').filter(t => parse(t).length === 3 && !here.has(t));
  return tags.sort((a, b) => cmp(parse(b), parse(a)))[0] ?? null;
}

function run(lib, dir, c) {
  const baseline = lib.dirSource(path.join(dir, 'baseline'));
  const candDir = path.join(dir, 'candidate');
  const candidate = fs.existsSync(candDir) ? lib.dirSource(candDir) : baseline;
  return c.runs.map(r => {
    const trust = fixtureTrust(baseline, candidate, integrationClaims(candidate));
    try {
      if (r.command === 'readiness') return lib.evaluateReadiness({ baseline, candidate, trust, task: r.task }).outcome;
      if (r.command === 'ci') return lib.evaluateCi({ baseline, candidate, trust, task: r.task, changed: r.changed }).verdict;
    } catch (e) { return `threw: ${e.message}`; }
    return `unknown command ${r.command}`;
  });
}
const expected = c => c.runs.map(r => r.expect.outcome ?? r.expect.verdict);
const PASSING = new Set(['ready', 'pass']);
const cases = dir => Object.fromEntries(fs.readdirSync(dir).filter(n => fs.existsSync(path.join(dir, n, 'case.json'))).map(n => [n, fs.readFileSync(path.join(dir, n, 'case.json'), 'utf8')]));

test('the candidate and the previous release judge each other\'s fixtures compatibly', async t => {
  const prev = previousRelease();
  if (!prev && IN_CI) assert.fail('no earlier release tag in the history: the CI checkout must fetch tags and full history (fetch-depth: 0)');
  if (!prev) return t.skip('no earlier release tag in the history (a shallow checkout that could not be deepened)');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-channel-compat-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const tar = spawnSync('bash', ['-c', 'git -C "$1" archive "$2" validator/lib fixtures | tar -x -C "$3"', '_', root, prev, temp], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  const prevLib = await import(pathToFileURL(path.join(temp, 'validator/lib/index.js')).href);
  const prevCases = cases(path.join(temp, 'fixtures')), ownCases = cases(path.join(root, 'fixtures'));
  const failures = [], declared = [];
  for (const [name, text] of Object.entries(prevCases)) {
    if (ownCases[name] !== undefined && ownCases[name] !== text) { declared.push(name); continue; }
    const c = JSON.parse(text);
    const got = run(candidateLib, path.join(temp, 'fixtures', name), c);
    got.forEach((g, i) => { if (g !== expected(c)[i]) failures.push(`${prev}'s ${name} #${i + 1}: expected ${expected(c)[i]}, the candidate says ${g}`); });
  }
  for (const [name, text] of Object.entries(ownCases)) {
    if (prevCases[name] !== undefined) continue;
    const c = JSON.parse(text);
    const got = run(prevLib, path.join(root, 'fixtures', name), c);
    expected(c).forEach((e, i) => { if (PASSING.has(e) && got[i] !== e) failures.push(`new fixture ${name} #${i + 1}: the candidate passes it, ${prev} says ${got[i]} (not forward-tolerant)`); });
  }
  const checked = Object.keys(prevCases).length - declared.length, added = Object.keys(ownCases).filter(n => prevCases[n] === undefined).length;
  assert.ok(Object.keys(prevCases).length > 0, `${prev} has no fixtures to compare`);
  t.diagnostic(`${prev}: ${checked} of its fixtures judged by the candidate; ${added} new fixtures judged by ${prev}`);
  if (declared.length) t.diagnostic(`fixtures this release changes (declared tightenings): ${declared.join(', ')}`);
  assert.deepEqual(failures, []);
});

test('upgrades.json: a release on a channel carries automated cleanup only', () => {
  const upgrades = JSON.parse(fs.readFileSync(path.join(root, 'upgrades.json'), 'utf8'));
  for (const [tag, entry] of Object.entries(upgrades)) {
    const v = parse(tag);
    assert.equal(v.length, 3, `${tag} is not vX.Y.Z`);
    if (v[0] !== FIRST_CHANNEL_RELEASE[0] || cmp(v, FIRST_CHANNEL_RELEASE) <= 0) continue;
    const steps = Object.keys(entry).filter(k => !['remove_config', 'add_files'].includes(k));
    assert.deepEqual(steps, [], `${tag} is a release within major ${v[0]} after the channel began: a step a person must do (${steps.join(', ')}) makes it a major`);
  }
});
