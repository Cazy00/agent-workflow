import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fakeExecutable } from './helpers.js';

// templates/github/wf-status.yml holds a token that can write issues, so its triggers, branch guard and
// permissions are part of the workflow's safety: this workflow must never run candidate code.
const text = fs.readFileSync(fileURLToPath(new URL('../../templates/github/wf-status.yml', import.meta.url)), 'utf8');
const block = key => text.match(new RegExp(`^${key}:\\n((?:[ \\t]+.*\\n)+)`, 'm'))?.[1] ?? '';
const steps = text.split(/^ {6}- /m).slice(1);

test('the status workflow never runs on pull requests and acts only on the trusted branch', () => {
  assert.deepEqual([...block('on').matchAll(/^ {2}(\w+):/gm)].map(m => m[1]), ['push', 'schedule', 'workflow_dispatch']);
  assert.doesNotMatch(text.replace('select(.pull_request == null)', ''), /pull_request/, 'no pull_request trigger; only the publish step\'s filter names it');
  assert.match(block('on'), /^ {4}branches: \[__TRUSTED_BRANCH__\]$/m);
  // The scheduled refresh runs only on a gate runner: on GitHub's runner a skipped job uses no minutes (MAINT-0023 P2).
  assert.match(text, /^ {4}if: github\.ref == 'refs\/heads\/__TRUSTED_BRANCH__' && \(github\.event_name != 'schedule' \|\| vars\.WF_GATE == 'on'\)$/m);
  assert.match(text, /^# .*schedule.*WF_GATE/m, 'the header says the schedule needs the gate runner');
});

test('the status workflow may write issues and nothing else, with pinned actions', () => {
  assert.deepEqual(block('permissions').trim().split('\n').map(l => l.trim()).sort(), ['contents: read', 'issues: write', 'pull-requests: read']);
  assert.equal(text.match(/^\s*permissions:/gm).length, 1, 'no job-level permissions');
  const uses = [...text.matchAll(/uses: ([^@\s]+)@(\S+)/g)];
  assert.ok(uses.length > 0);
  for (const [, action, ref] of uses) assert.match(ref, /^[0-9a-f]{40}$/, `${action} is pinned to a full commit hash`);
  assert.equal(text.match(/persist-credentials: false/g)?.length, text.match(/actions\/checkout@/g).length);
});

test('the status workflow keeps expressions out of its scripts and the token away from the validator', () => {
  for (const line of text.split('\n').filter(l => l.includes('${{'))) assert.match(line, /^ {10}(GH_TOKEN|GH_REPO): \$\{\{ github\.(token|repository) \}\}$|^ {4}runs-on: \$\{\{ vars\.WF_GATE == 'on' && 'wf-gate' \|\| 'ubuntu-latest' \}\}$|^ {10}WF_READ_TOKEN: \$\{\{ secrets\.WF_READ_TOKEN \}\}$/);
  const render = steps.filter(s => s.includes('scripts/wf status --baseline'));
  assert.equal(render.length, 1);
  assert.doesNotMatch(render[0], /GH_TOKEN|env:/);
  // The token reaches only the step that lists pull requests and the step that publishes, never the renderer.
  const names = steps.map(s => s.match(/^name: (.*)$/m)?.[1] ?? null);
  assert.deepEqual(steps.filter(s => s.includes('GH_TOKEN')).map(s => s.match(/^name: (.*)$/m)?.[1]), ['List the open pull requests', 'Publish the status issue']);
  assert.equal(text.match(/GH_TOKEN/g).length, 2);
  assert.ok(names.indexOf('List the open pull requests') < names.indexOf('Render the status view'), 'the list is written before rendering');
  const listStep = steps.find(s => s.startsWith('name: List the open pull requests'));
  assert.match(listStep, /^ {8}run: gh pr list --state open --limit \d+ --json number,title,headRefName,author,isDraft,isCrossRepository,reviewDecision > "\$RUNNER_TEMP\/pull-requests\.json"$/m, 'the list step only reads');
  assert.match(render[0], /--pull-requests "\$RUNNER_TEMP\/pull-requests\.json"/);
});

test('the status workflow fetches the full history that readiness previews check revisions against', () => {
  assert.equal(text.match(/^ {10}fetch-depth: 0\b/gm)?.length, text.match(/actions\/checkout@/g).length);
});

// The release tag workflow (IDEA-18): main only, one permission, pinned actions, and it never moves an existing tag.
test('the release tag workflow tags only an untagged release version, on main, and moves no tag', () => {
  const text = fs.readFileSync(new URL('../../.github/workflows/release-tag.yml', import.meta.url), 'utf8');
  assert.match(text, /^on:\n  push:\n    branches: \[main\]\n/m);
  assert.doesNotMatch(text.replace('select(.pull_request == null)', ''), /pull_request/, 'no pull_request trigger; only the publish step\'s filter names it');
  assert.match(text, /^permissions:\n  contents: write\n(?!  )/m);
  for (const use of text.match(/uses: .*/g)) assert.match(use, /@[0-9a-f]{40} /, use);
  assert.match(text, /ls-remote --exit-code --tags origin "refs\/tags\/\$tag"[^\n]*exit 0/);
  assert.doesNotMatch(text, /--force|-f /);
});

// MAINT-0023 P1: the publish step keeps exactly one open status issue. It runs here against a fake `gh` and `sleep`.
const publish = steps.find(s => s.startsWith('name: Publish the status issue')).match(/^ {8}run: \|\n((?: {10}.*\n|\n)+)/m)[1].replace(/^ {10}/gm, '');

function runPublish(open) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-publish-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(dir, 'calls.jsonl');
    fs.writeFileSync(path.join(dir, 'view.md'), '## Status\n');
    fs.writeFileSync(path.join(dir, 'open.json'), JSON.stringify(open));
    fakeExecutable(path.join(bin, 'sleep'), `require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(['sleep', ...process.argv.slice(2)]) + '\\n');`);
    // `gh api` returns the pages as a stream of JSON arrays and lists pull requests too, as GitHub's issues endpoint does.
    fakeExecutable(path.join(bin, 'gh'), `
      const fs = require('fs'), a = process.argv.slice(2);
      fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(['gh', ...a]) + '\\n');
      if (a[0] === 'api') {
        const items = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dir, 'open.json'))}, 'utf8'));
        const jq = a[a.indexOf('--jq') + 1];
        if (!a.includes('--paginate') || !jq) process.exit(2);
        process.stdout.write(items.filter(i => !i.pull_request).map(i => i.number + '\\n').join(''));
      }
    `);
    const result = spawnSync('bash', ['-c', publish], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: dir, GITHUB_REF_NAME: 'main', GITHUB_REF: 'refs/heads/main', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't', GH_REPO: 'o/r' },
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
    return { result, calls, body: fs.readFileSync(path.join(dir, 'status.md'), 'utf8') };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const writes = calls => calls.filter(c => c[0] === 'gh' && c[1] !== 'api' && !(c[1] === 'label')).map(c => c.slice(1, 4).join(' '));

test('the publish step lists every open status issue with pagination and ignores pull requests', () => {
  assert.match(publish, /gh api --paginate\b[^\n]*labels=wf-status/);
  assert.match(publish, /sort=created&direction=asc/, 'oldest first');
  assert.match(publish, /pull_request/, 'pull requests are skipped');
  assert.doesNotMatch(publish, /gh issue list/);
});

test('with one open status issue the publish step edits it and closes nothing', () => {
  const { result, calls, body } = runPublish([{ number: 7 }]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(writes(calls), ['issue edit 7']);
  assert.ok(!calls.some(c => c[0] === 'sleep'), 'no retry when an issue was found');
  assert.match(body, /Status/);
});

test('with two open status issues the publish step edits the oldest and closes the other, naming the one kept', () => {
  const { result, calls } = runPublish([{ number: 7 }, { number: 9 }, { number: 8, pull_request: {} }]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(writes(calls), ['issue edit 7', 'issue close 9']);
  const close = calls.find(c => c[1] === 'issue' && c[2] === 'close');
  assert.match(close[close.indexOf('--comment') + 1], /#7/);
  assert.ok(!calls.some(c => c[2] === 'create'));
});

test('with no open status issue the publish step looks twice, a few seconds apart, before it creates one', () => {
  const { result, calls } = runPublish([{ number: 3, pull_request: {} }]);
  assert.equal(result.status, 0, result.stderr);
  const kinds = calls.map(c => c[0] === 'sleep' ? 'sleep' : c[1] === 'api' ? 'lookup' : c.slice(1, 3).join(' '));
  assert.deepEqual(kinds.filter(k => k !== 'label create'), ['lookup', 'sleep', 'lookup', 'issue create']);
  assert.ok(Number(calls.find(c => c[0] === 'sleep')[1]) >= 3);
});

test('the publish step stops without writing when the lookup fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-publish-'));
  try {
    fs.mkdirSync(path.join(dir, 'bin'));
    fakeExecutable(path.join(dir, 'bin', 'gh'), `process.exit(process.argv[2] === 'api' ? 1 : 0);`);
    fakeExecutable(path.join(dir, 'bin', 'sleep'), '');
    fs.writeFileSync(path.join(dir, 'view.md'), 'x');
    const result = spawnSync('bash', ['-c', publish], { encoding: 'utf8', env: { PATH: `${dir}/bin:${process.env.PATH}`, RUNNER_TEMP: dir, GITHUB_REF_NAME: 'main', GITHUB_SERVER_URL: 'u', GITHUB_REPOSITORY: 'o/r' } });
    assert.notEqual(result.status, 0, 'a failed lookup must not look like "no issue" and create a duplicate');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
