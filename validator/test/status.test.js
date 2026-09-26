import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource, gitSource } from '../lib/index.js';
import { evaluateStatus, readPullRequests, renderStatus } from '../lib/status.js';

// `wf status` is a derived, read-only owner view (IDEA-08). It never checks approval and grants nothing.
const fx = name => fileURLToPath(new URL(`../../fixtures/${name}/baseline`, import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
function copy(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-status-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(fx(name), dir, { recursive: true });
  return dir;
}

test('status lists an open reserved decision as waiting on the owner and previews the task it blocks', () => {
  const s = evaluateStatus({ baseline: dirSource(fx('01-unresolved-decision-blocks')) });
  const d = s.waiting.find(w => w.kind === 'decision' && w.item === 'D-0001');
  assert.ok(d, JSON.stringify(s.waiting));
  assert.equal(d.owner, 'owner');
  const task = s.milestones.find(m => m.id === 'M-0001').tasks.find(t => t.id === 'T-0001');
  assert.equal(task.readiness, 'Needs discovery or resolution');
  assert.match(task.reasons.join(' '), /D-0001/);
  assert.doesNotMatch(task.reasons.join(' '), /approval evidence/, 'the preview does not report approval');
  const text = renderStatus(s);
  assert.match(text, /^## Waiting on the owner\n- D-0001 \(owner\)/m);
  assert.match(text, /grants no authority/);
});

test('status shows a ready task as Ready and a resolved decision as nothing to wait for', () => {
  const s = evaluateStatus({ baseline: dirSource(fx('04a-accepted-decision-permits')) });
  assert.deepEqual(s.waiting.filter(w => w.kind === 'decision'), []);
  assert.equal(s.milestones[0].tasks[0].readiness, 'Ready');
});

test('status reports blocked tasks, inbox items, setup steps and agent questions without failing', t => {
  const dir = copy(t, '07-planning-while-blocked');
  const taskPath = path.join(dir, 'docs/workflow/tasks/T-0001.md');
  fs.writeFileSync(taskPath, fs.readFileSync(taskPath, 'utf8').replace('status: Ready', 'status: Blocked\nresume_condition: owner answers D-0001'));
  fs.mkdirSync(path.join(dir, 'docs/workflow/inbox/done'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/workflow/inbox/README.md'), '# Inbox\n');
  fs.writeFileSync(path.join(dir, 'docs/workflow/inbox/voice-note.md'), 'raw owner note\n');
  fs.writeFileSync(path.join(dir, 'docs/workflow/inbox/screen.png'), 'not really a png');
  fs.writeFileSync(path.join(dir, 'docs/workflow/inbox/links.txt'), 'https://example.invalid\n');
  const profilePath = path.join(dir, 'docs/workflow/profile.md');
  fs.writeFileSync(profilePath, fs.readFileSync(profilePath, 'utf8').replace('approval_label: enforced', 'approval_label: manual'));
  fs.writeFileSync(path.join(dir, 'docs/workflow/setup.md'), '# Setup\n\n## Owner steps\n\n- [ ] 2. accounts\n- [x] 5. protections\n\n## Agent steps\n\n- [ ] 1. profile\n');
  fs.writeFileSync(path.join(dir, 'docs/workflow/decisions/D-0002.md'), '---\nrecord: decision\nid: D-0002\nquestion: Which library version is current?\ntype: fact\nowner: agent\nrequired_before: verify\nstatus: Open\n---\n');
  const s = evaluateStatus({ baseline: dirSource(dir) });
  assert.deepEqual(s.blocked.map(b => [b.task, b.resume_condition]), [['T-0001', 'owner answers D-0001']]);
  assert.equal(s.inbox.count, 3, 'every inbox file counts, not only Markdown');
  assert.ok(s.record_errors.some(e => /approval label differs/.test(e)), s.record_errors.join(' | '));
  assert.deepEqual(s.setup_open, { owner: 1, agent: 1 });
  assert.ok(s.waiting.some(w => w.kind === 'setup' && w.owner === 'owner'));
  assert.ok(s.waiting.some(w => w.kind === 'inbox' && w.owner === 'agent'));
  assert.deepEqual(s.open_for_agent.map(d => d.id), ['D-0002']);
  const text = renderStatus(s);
  assert.match(text, /## Blocked\n- T-0001: resume when owner answers D-0001/);
  assert.match(text, /## Next for the agent\n- docs\/workflow\/inbox/);
});

test('status via the CLI needs no baseline, prints Markdown by default and JSON on request, and exits 0', () => {
  const md = spawnSync(process.execPath, [cli, 'status', '--repo', fx('01-unresolved-decision-blocks')], { encoding: 'utf8' });
  assert.equal(md.status, 0, md.stdout + md.stderr);
  assert.match(md.stdout, /^# Status: .* @ working tree/);
  const json = spawnSync(process.execPath, [cli, 'status', '--repo', fx('01-unresolved-decision-blocks'), '--json'], { encoding: 'utf8' });
  assert.equal(json.status, 0, json.stdout + json.stderr);
  assert.equal(JSON.parse(json.stdout).ok, true);
});

// Two people who share the owner role (IDEA-13): what waits on each, and each task's claim from the open pull requests.
function twoOwners(t) {
  const dir = copy(t, '02-unrelated-task-ready');
  const edit = (p, fn) => fs.writeFileSync(path.join(dir, p), fn(fs.readFileSync(path.join(dir, p), 'utf8')));
  edit('docs/workflow/profile.md', x => x.replace('coordinator: owner', 'coordinator: alice\nowners: [alice, bob]'));
  edit('docs/workflow/milestones/M-0001.md', x => x.replace('coordinator: coordinator', 'coordinator: coordinator\nowner: alice'));
  edit('docs/workflow/tasks/T-0001.md', x => x.replace('owner: agent', 'owner: alice'));
  edit('docs/workflow/tasks/T-0002.md', x => x.replace('owner: agent', 'owner: bob'));
  edit('docs/workflow/decisions/D-0001.md', x => x.replace('owner: owner', 'owner: bob'));
  return { dir, edit };
}
const pr = (number, headRefName, title, login, extra = {}) => ({ number, headRefName, title, author: { login, is_bot: false }, isDraft: false, isCrossRepository: false, reviewDecision: 'REVIEW_REQUIRED', ...extra });
const openPullRequests = [
  pr(14, 'T-0002', 'T-0002: do the work', 'bob-worker'),
  pr(15, 'codex/T-0002-second', 'Second attempt', 'alice-worker', { isDraft: true, reviewDecision: '' }),
  pr(16, 'feature-x', 'T-0001: from a fork', 'stranger', { isCrossRepository: true }),
  pr(17, 'plan-m2', 'Plan M-0002\nwith a second line', 'alice-worker', { reviewDecision: '' }),
  pr(18, 'T-0001', 'T-0001: the work', 'alice-worker', { reviewDecision: 'CHANGES_REQUESTED' }),
];

test('with two owners, status shows what waits on each person and each task\'s claim, and flags a task claimed twice', t => {
  const { dir } = twoOwners(t);
  const s = evaluateStatus({ baseline: dirSource(dir), pullRequests: openPullRequests });
  assert.deepEqual(s.owners, ['alice', 'bob']);
  assert.deepEqual(s.record_errors, []);
  assert.deepEqual(s.pull_requests.duplicates, [{ task: 'T-0002', holder: 14, claim_branch: false, others: [15] }]);
  const tasks = Object.fromEntries(s.milestones[0].tasks.map(x => [x.id, x.pull_requests]));
  assert.deepEqual(tasks, { 'T-0001': [18], 'T-0002': [14, 15] }, 'a fork pull request is never a claim');
  const text = renderStatus(s);
  assert.match(text, /^## Waiting on alice\n- #14 T-0002: ready for review · `T-0002: do the work` by bob-worker\n\n/m);
  assert.match(text, /^## Waiting on bob\n- D-0001: Open: /m);
  assert.match(text, /^## Waiting on either owner\n- #17: ready for review · `Plan M-0002 with a second line` by alice-worker\n\n/m, 'a fork pull request is in nobody\'s list of actions');
  assert.match(text, /^- T-0002 \(bob's agents\): #14, on the claim branch, holds the claim; close #15 or move its work there$/m);
  assert.match(text, /^- #18 T-0001 \(alice's agents\): changes requested · `T-0001: the work` by alice-worker$/m);
  assert.match(text, /^### M-0001 — Authorised — .* \(owner alice\)$/m);
  assert.match(text, /^- T-0002 Ready · bob · Task T-0002 · readiness preview: Ready · #14, #15$/m);
  assert.match(text, /^## Open pull requests\n- #14 T-0002 · `T-0002: do the work` · bob-worker\n- #15 T-0002 · `Second attempt` · alice-worker \(draft\)\n- #16 T-0001 · `T-0001: from a fork` · stranger \(fork: an outside contribution\)\n/m);
});

test('the claim branch holds a task even when another pull request naming it has a lower number', t => {
  const { dir } = twoOwners(t);
  const s = evaluateStatus({ baseline: dirSource(dir), pullRequests: [pr(13, 'codex/T-0002-login', 'T-0002: login', 'alice-worker'), pr(14, 'T-0002', 'T-0002: the claim', 'bob-worker')] });
  assert.deepEqual(s.pull_requests.duplicates, [{ task: 'T-0002', holder: 14, claim_branch: false, others: [13] }]);
  assert.match(renderStatus(s), /^- T-0002 \(bob's agents\): #14, on the claim branch, holds the claim; close #13 or move its work there$/m);
});

test('status shows claim branches it can see, with or without their pull request', t => {
  const { dir } = twoOwners(t);
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  git('init', '-q'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'records');
  git('update-ref', 'refs/remotes/origin/T-0001', 'HEAD'); git('update-ref', 'refs/remotes/origin/T-0002', 'HEAD'); git('update-ref', 'refs/remotes/origin/T-0002-notes', 'HEAD');
  const s = evaluateStatus({ baseline: gitSource(dir, 'HEAD'), pullRequests: [pr(13, 'codex/T-0001-x', 'Other work on T-0001', 'bob-worker', { isDraft: true }), pr(14, 'T-0002', 'T-0002: the work', 'bob-worker', { isDraft: true })] });
  assert.deepEqual(s.pull_requests.claim_branches, ['T-0001', 'T-0002'], 'only branches named exactly a task ID are claims');
  assert.deepEqual(s.pull_requests.duplicates, [{ task: 'T-0001', holder: null, claim_branch: true, others: [13] }]);
  const text = renderStatus(s);
  assert.match(text, /^- T-0001 \(alice's agents\): the claim branch T-0001 holds the claim; close #13 or move its work there$/m);
  assert.match(text, /^- T-0001 \(alice's agents\): claim branch T-0001 has no open pull request from it: its holder opens one, or releases the claim by deleting the branch$/m);
  assert.doesNotMatch(text, /claim branch T-0002 has no open pull request/);
  const none = renderStatus(evaluateStatus({ baseline: gitSource(dir, 'HEAD'), pullRequests: [] }));
  assert.match(none, /^- T-0001 Ready · alice · Task T-0001 · readiness preview: .* · claim branch, no pull request$/m);
  // A one-owner project claims through its private run record, so a leftover branch named T-NNNN is no claim.
  fs.writeFileSync(path.join(dir, 'docs/workflow/profile.md'), fs.readFileSync(path.join(dir, 'docs/workflow/profile.md'), 'utf8').replace('owners: [alice, bob]\n', ''));
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qam', 'one owner');
  const solo = evaluateStatus({ baseline: gitSource(dir, 'HEAD'), pullRequests: [] });
  assert.deepEqual(solo.pull_requests.claim_branches, []);
  assert.doesNotMatch(renderStatus(solo), /claim branch/);
});

test('status marks a Ready task with no claim, and flags an Active one, only when the pull requests are supplied', t => {
  const { dir, edit } = twoOwners(t);
  edit('docs/workflow/tasks/T-0001.md', x => x.replace('status: Ready', 'status: Active'));
  const without = renderStatus(evaluateStatus({ baseline: dirSource(dir) }));
  assert.doesNotMatch(without, /no pull request|## Open pull requests/);
  const none = renderStatus(evaluateStatus({ baseline: dirSource(dir), pullRequests: [pr(20, 'T-0002', 'T-0003: mixed up', 'bob-worker', { isDraft: true })] }));
  assert.match(none, /^- T-0002 Ready · bob · Task T-0002 · readiness preview: Ready · no pull request$/m);
  assert.match(none, /^- T-0001 \(alice's agents\): Active on the trusted branch with no claim branch or open pull request: inspect its last handoff, then resume or release the claim$/m);
  assert.match(none, /^- #20: its branch names T-0002 and its title T-0003; rename one so the claim is clear$/m);
  assert.match(none, /^## Open pull requests\n- #20 · `T-0003: mixed up` · bob-worker \(draft\)$/m);
});

test('pull request titles reach the view as plain text, never as links, mentions or HTML', t => {
  const { dir } = twoOwners(t);
  const text = renderStatus(evaluateStatus({ baseline: dirSource(dir), pullRequests: [
    pr(21, 'plan-x', 'T-0009: [approve here](https://evil.example/login) @bob <img src=x> `tick`', 'alice-worker'),
    pr(22, 'fork-x', '[click](https://evil.example) @alice', 'stranger', { isCrossRepository: true }),
  ] }));
  assert.match(text, /^- #21 T-0009: ready for review · `T-0009: \[approve here\]\(https:\/\/evil\.example\/login\) @bob <img src=x> 'tick'` by alice-worker$/m);
  assert.match(text, /^- #22 · `\[click\]\(https:\/\/evil\.example\) @alice` · stranger \(fork: an outside contribution\)$/m);
  assert.doesNotMatch(text.replace(/`[^`\n]*`/g, ''), /evil\.example|@bob|@alice|<img/, 'outside code spans no title text remains');
});

test('with two owners, a task or milestone owner outside the list is a record error', t => {
  const { dir, edit } = twoOwners(t);
  edit('docs/workflow/tasks/T-0002.md', x => x.replace('owner: bob', 'owner: bobb'));
  edit('docs/workflow/milestones/M-0001.md', x => x.replace('owner: alice\n', ''));
  const errors = evaluateStatus({ baseline: dirSource(dir) }).record_errors.join('\n');
  assert.match(errors, /T-0002\.md: owner bobb is not one of the profile's owners \(alice, bob\)/);
  assert.match(errors, /M-0001\.md: missing owner/);
  const records = spawnSync(process.execPath, [cli, 'records', '--repo', dir], { encoding: 'utf8' });
  assert.equal(records.status, 1, records.stdout + records.stderr);
  assert.match(records.stdout, /owner bobb is not one of/);
});

test('an owners field that is not a list of two or more distinct usernames is a record error, not a silent one-owner view', t => {
  for (const bad of ['owners: alice, bob', 'owners: [alice]', 'owners: [alice, alice]', 'owners: [alice, not a name]']) {
    const { dir, edit } = twoOwners(t);
    edit('docs/workflow/profile.md', x => x.replace('owners: [alice, bob]', bad));
    const s = evaluateStatus({ baseline: dirSource(dir) });
    assert.match(s.record_errors.join('\n'), /profile\.md: owners must list two or more distinct GitHub usernames/, bad);
    assert.deepEqual(s.owners, [], bad);
    assert.match(renderStatus(s), /^## Waiting on the owner$/m, bad);
  }
});

test('status reads a pull request file from the CLI and refuses one that is not a JSON array', t => {
  const { dir } = twoOwners(t);
  const file = path.join(dir, '..', `${path.basename(dir)}-prs.json`);
  t.after(() => fs.rmSync(file, { force: true }));
  fs.writeFileSync(file, JSON.stringify(openPullRequests));
  const ok = spawnSync(process.execPath, [cli, 'status', '--repo', dir, '--pull-requests', file], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^## Waiting on alice$/m);
  fs.writeFileSync(file, '{"number": 1}');
  const bad = spawnSync(process.execPath, [cli, 'status', '--repo', dir, '--pull-requests', file], { encoding: 'utf8' });
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /--pull-requests: pull requests must be a JSON array/);
});

test('pull request text is kept to plain single-line fields', () => {
  const [p] = readPullRequests([{ number: 3, title: 'a\u0000b\n\tc', headRefName: 'T-0009-x', author: { login: 'bad login' } }, { number: '4' }, { number: -1 }]);
  assert.deepEqual(p, { number: 3, title: 'a b c', branch: 'T-0009-x', author: null, draft: false, fork: false, review: null, task: 'T-0009', mismatch: null });
  assert.throws(() => readPullRequests({}), /JSON array/);
  const [q] = readPullRequests([{ number: 5, title: 'T-0003: other work', headRefName: 'T-0002' }]);
  assert.deepEqual([q.task, q.mismatch], [null, ['T-0002', 'T-0003']], 'a pull request naming two tasks claims neither');
});
