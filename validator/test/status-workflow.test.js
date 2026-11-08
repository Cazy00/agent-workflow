import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fakeExecutable } from './helpers.js';
import { parseYaml } from '../lib/ci-lint.js';

// templates/github/wf-status.yml holds a token that can write issues, so its triggers, branch guard and
// permissions are part of the workflow's safety: this workflow must never run candidate code.
const text = fs.readFileSync(fileURLToPath(new URL('../../templates/github/wf-status.yml', import.meta.url)), 'utf8');
const block = key => text.match(new RegExp(`^${key}:\\n((?:[ \\t]+.*\\n)+)`, 'm'))?.[1] ?? '';
const steps = text.split(/^ {6}- /m).slice(1);

test('the status workflow never runs on pull requests and acts only on the trusted branch', () => {
  assert.deepEqual([...block('on').matchAll(/^ {2}(\w+):/gm)].map(m => m[1]), ['push', 'schedule', 'workflow_dispatch']);
  assert.doesNotMatch(text.replace('select(.pull_request == null and .user.login == "github-actions[bot]")', ''), /pull_request/, 'no pull_request trigger; only the publish step\'s filter names it');
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

// Releases are tagged by the host's release broker (wf-release, v2.19.0), which does not run while release-tag.yml exists.
// No workflow here may tag a release or push a ref.
// The guard checks capability, not one spelling: a workflow is parsed, and any job or workflow that can write contents, and any
// step that can create or move a ref or a release, is a finding. No current workflow needs an exception, so there is no allow-list.
const REF_WRITERS = [
  /\bgit\b[^\n]*\b(tag|push|update-ref|send-pack)\b/,
  /\bgh\s+release\s+(create|upload|edit)\b/,
  /\bgh\s+api\b[^\n]*(git\/(refs|tags)|\/releases|\/tags|\/refs)/,
  /\bgh\s+api\b[^\n]*(-X|--method)\s*(POST|PUT|PATCH|DELETE)\b[^\n]*\b(refs|releases|tags|contents)\b/i,
  /\b(createRef|updateRef|createRelease|createTag|createCommit|createOrUpdateFileContents)\b/,
];
const REF_WRITING_ACTIONS = /^(actions\/create-release|actions\/upload-release-asset|actions\/github-script|softprops\/action-gh-release|ncipollo\/release-action|ad-m\/github-push-action|stefanzweifel\/git-auto-commit-action|peter-evans\/create-pull-request|mathieudutour\/github-tag-action|anothrNick\/github-tag-action|marvinpinto\/action-automatic-releases|svenstaro\/upload-release-action|EndBug\/add-and-commit|rickstaa\/action-create-tag|jacopocarlini\/action-tag)\b/i;

function refWriters(source) {
  const found = [];
  const doc = parseYaml(source);
  const grants = (perm, where) => {
    if (perm === undefined || perm === null) return;
    if (typeof perm === 'string') { if (/^write-all$/i.test(perm.trim())) found.push(`${where} permissions: write-all`); return; }
    if (String(perm.contents ?? '').trim().toLowerCase() === 'write') found.push(`${where} grants contents: write`);
  };
  grants(doc.permissions, 'the workflow');
  for (const [id, job] of Object.entries(doc.jobs ?? {})) {
    grants(job.permissions, `job ${id}`);
    for (const [i, step] of (job.steps ?? []).entries()) {
      const where = `job ${id} step ${i + 1}`;
      // Backslash continuations are joined first, so `git \` then `push` on the next line is one command; comments stay in the text.
      const run = String(step.run ?? '').replace(/\\\r?\n\s*/g, ' ');
      for (const re of REF_WRITERS) if (re.test(run)) found.push(`${where} runs ${re}`);
      if (REF_WRITING_ACTIONS.test(String(step.uses ?? '').trim())) found.push(`${where} uses ${step.uses}`);
    }
    if (job.uses && REF_WRITING_ACTIONS.test(String(job.uses))) found.push(`job ${id} uses ${job.uses}`);
  }
  return found;
}

function workflowFiles(dirUrl) {
  return fs.readdirSync(dirUrl, { withFileTypes: true }).filter(e => e.isFile() && /\.ya?ml$/.test(e.name)).map(e => e.name);
}

test('no workflow in this repository tags a release or pushes a ref, and release-tag.yml is gone', () => {
  const dirs = [new URL('../../.github/workflows/', import.meta.url), new URL('../../templates/github/', import.meta.url), new URL('../../templates/github/channel/', import.meta.url)];
  assert.ok(!fs.existsSync(new URL('release-tag.yml', dirs[0])), 'release-tag.yml must not exist');
  let seen = 0;
  for (const dir of dirs) {
    for (const f of workflowFiles(dir)) {
      seen++;
      assert.deepEqual(refWriters(fs.readFileSync(new URL(f, dir), 'utf8')), [], `${f} can create or push a ref`);
    }
  }
  assert.ok(seen >= 8, `the guard read ${seen} workflow files`);
});

test('the capability guard catches the spellings a text match misses', () => {
  const wf = run => `name: x\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n${run.split('\n').map(l => `          ${l}`).join('\n')}\n`;
  for (const run of ['git -C . push origin refs/tags/v9.9.9', "echo '#'; git tag v9.9.9 && git push --tags", 'git \\\n  push origin main', 'gh api -X POST repos/o/r/releases', 'gh api repos/o/r/git/refs -f ref=x', 'gh release create v9']) {
    assert.notEqual(refWriters(wf(run)).length, 0, run);
  }
  const action = 'name: x\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/github-script@abc\n        with:\n          script: github.rest.git.createRef({ref: "refs/tags/v9.9.9"})\n';
  assert.notEqual(refWriters(action).length, 0);
  assert.notEqual(refWriters('name: x\non: push\npermissions:\n  contents: write\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n').length, 0);
  assert.notEqual(refWriters('name: x\non: push\njobs:\n  j:\n    permissions:\n      contents: write\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n').length, 0);
  assert.deepEqual(refWriters(wf('gh api --method POST "repos/$GH_REPO/check-runs" --input x.json\ngh workflow run wf.yml --ref main')), []);
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
        // The real filter runs, so a test sees what the workflow's own jq expression keeps.
        const r = require('child_process').spawnSync('jq', ['-r', jq], { input: JSON.stringify(items), encoding: 'utf8' });
        if (r.status !== 0) { process.stderr.write(r.stderr); process.exit(2); }
        process.stdout.write(r.stdout);
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
const bot = number => ({ number, user: { login: 'github-actions[bot]' } });
const writes = calls => calls.filter(c => c[0] === 'gh' && c[1] !== 'api' && !(c[1] === 'label')).map(c => c.slice(1, 4).join(' '));

test('the publish step lists every open status issue with pagination and ignores pull requests', () => {
  assert.match(publish, /gh api --paginate\b[^\n]*labels=wf-status/);
  assert.match(publish, /sort=created&direction=asc/, 'oldest first');
  assert.match(publish, /pull_request/, 'pull requests are skipped');
  assert.doesNotMatch(publish, /gh issue list/);
});

test('with one open status issue the publish step edits it and closes nothing', () => {
  const { result, calls, body } = runPublish([bot(7)]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(writes(calls), ['issue edit 7']);
  assert.ok(!calls.some(c => c[0] === 'sleep'), 'no retry when an issue was found');
  assert.match(body, /Status/);
});

test('with two open status issues the publish step edits the oldest and closes the other, naming the one kept', () => {
  const { result, calls } = runPublish([bot(7), bot(9), { ...bot(8), pull_request: {} }]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(writes(calls), ['issue edit 7', 'issue close 9']);
  const close = calls.find(c => c[1] === 'issue' && c[2] === 'close');
  assert.match(close[close.indexOf('--comment') + 1], /#7/);
  assert.ok(!calls.some(c => c[2] === 'create'));
});

test('with no open status issue the publish step looks twice, a few seconds apart, before it creates one', () => {
  const { result, calls } = runPublish([{ ...bot(3), pull_request: {} }]);
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

// MAINT-0023 review: only an issue the workflow's own account wrote is the status issue. The labelled issue of anyone else, however
// old, is left alone, and the workflow creates its own.
test('an older issue labelled wf-status by another author is left alone', () => {
  const stranger = { number: 3, user: { login: 'a-contributor' } };
  const { result, calls } = runPublish([stranger, bot(7), bot(9)]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(writes(calls), ['issue edit 7', 'issue close 9'], 'the bug report #3 is neither edited nor closed');
  const only = runPublish([stranger]);
  assert.deepEqual(writes(only.calls), ['issue create --title'], 'with no issue of its own the workflow creates one');
  assert.ok(!only.calls.some(c => c[2] === 'edit' || c[2] === 'close'));
});
