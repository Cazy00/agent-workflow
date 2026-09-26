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
  assert.match(text, /^## 👤 Waiting on you\n\n\*\*Decisions\*\*\n/m);
  assert.match(text, /^\| 🔴 \| \*\*D-0001\*\*<br><sub>Open: decide · before implement<\/sub> \| .* \| owner \| \*\*T-0001 now\*\* \|$/m, 'the decision says what is asked, by when, who decides and which task it blocks now');
  assert.match(text, /<summary>What each decision affects<\/summary>\n\n- \*\*D-0001\*\*: /);
  assert.match(text, /^\| 🔴 \| \*\*T-0001\*\* \| .* \| Waiting on decision D-0001 \| /m, 'the task row names the decision it waits on');
  assert.match(text, /^\| 👤 Waiting on you \| 🔴 Blocked \|\n\|:-:\|:-:\|\n\| \*\*1\*\* \| 1 \|$/m, 'the count strip shows only the states some task is in');
  assert.match(text, /^```mermaid\nflowchart LR\n  D0001\["👤 D-0001"\] -->\|blocks\| T0001\["T-0001"\]$/m, 'the diagram draws the block');
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
  assert.match(text, /## ⛔ Blocked\n\n- \*\*T-0001\*\*: resume when owner answers D-0001/);
  assert.match(text, /## 🤖 Next for the agent\n\n- \*\*docs\/workflow\/inbox\*\*: 3 item/);
  assert.match(text, /^\*\*Also\*\*\n\n- \*\*docs\/workflow\/setup\.md\*\*: 1 owner setup step/m, 'an owner setup step waits on the owner');
  assert.match(text, /^## ⚠️ Record errors\n\n- .*approval label differs/m, 'record errors stay visible');
  assert.match(text, /<summary>❓ Open questions for the agent: 1<\/summary>\n\n- \*\*D-0002\*\* \(fact\): Which library version is current\?/);
});

test('status via the CLI needs no baseline, prints Markdown by default and JSON on request, and exits 0', () => {
  const md = spawnSync(process.execPath, [cli, 'status', '--repo', fx('01-unresolved-decision-blocks')], { encoding: 'utf8' });
  assert.equal(md.status, 0, md.stdout + md.stderr);
  assert.match(md.stdout, /^# 📋 .*: project status\n\n<sub>At `working tree`/);
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
  const reviewHead = '\\*\\*Pull requests\\*\\*\\n\\n\\| Pull request \\| Task \\| Title \\| Author \\| Action \\|\\n\\|---\\|---\\|---\\|---\\|---\\|\\n';
  assert.match(text, new RegExp(`^## 👤 Waiting on alice\\n\\n${reviewHead}\\| #14 \\| T-0002 \\| \`T-0002: do the work\` \\| bob-worker \\| 👀 ready for review \\|\\n\\n## `, 'm'));
  assert.match(text, /^## 👤 Waiting on bob\n\n\*\*Decisions\*\*\n\n.*\n.*\n\| .* \| \*\*D-0001\*\*<br><sub>Open: decide · before \w+<\/sub> \| /m);
  assert.match(text, new RegExp(`^## 👤 Waiting on either owner\\n\\n${reviewHead}\\| #17 \\| — \\| \`Plan M-0002 with a second line\` \\| alice-worker \\| 👀 ready for review \\|\\n\\n## `, 'm'), 'a fork pull request is in nobody\'s list of actions');
  assert.match(text, /^- \*\*T-0002\*\* \(bob's agents\): #14, on the claim branch, holds the claim; close #15 or move its work there$/m);
  assert.match(text, /^- \*\*#18 T-0001\*\* \(alice's agents\): changes requested · `T-0001: the work` by alice-worker$/m);
  assert.match(text, /^## 🎯 M-0001 · Authorised · owner alice$/m);
  assert.match(text, /^\| 🔵 \| \*\*T-0002\*\* \| bob \| Task T-0002 \| In review: #14, #15 \| #14, #15 \|$/m);
  assert.match(text, /^## 🔀 Open pull requests\n\n\| Pull request \| Task \| Title \| Author \| Note \|\n\|---\|---\|---\|---\|---\|\n\| #14 \| T-0002 \| `T-0002: do the work` \| bob-worker \| — \|\n\| #15 \| T-0002 \| `Second attempt` \| alice-worker \| draft \|\n\| #16 \| T-0001 \| `T-0001: from a fork` \| stranger \| fork: an outside contribution \|\n/m);
});

test('the claim branch holds a task even when another pull request naming it has a lower number', t => {
  const { dir } = twoOwners(t);
  const s = evaluateStatus({ baseline: dirSource(dir), pullRequests: [pr(13, 'codex/T-0002-login', 'T-0002: login', 'alice-worker'), pr(14, 'T-0002', 'T-0002: the claim', 'bob-worker')] });
  assert.deepEqual(s.pull_requests.duplicates, [{ task: 'T-0002', holder: 14, claim_branch: false, others: [13] }]);
  assert.match(renderStatus(s), /^- \*\*T-0002\*\* \(bob's agents\): #14, on the claim branch, holds the claim; close #13 or move its work there$/m);
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
  assert.match(text, /^- \*\*T-0001\*\* \(alice's agents\): the claim branch T-0001 holds the claim; close #13 or move its work there$/m);
  assert.match(text, /^- \*\*T-0001\*\* \(alice's agents\): claim branch T-0001 has no open pull request from it: its holder opens one, or releases the claim by deleting the branch$/m);
  assert.doesNotMatch(text, /claim branch T-0002 has no open pull request/);
  const none = renderStatus(evaluateStatus({ baseline: gitSource(dir, 'HEAD'), pullRequests: [] }));
  assert.match(none, /^\| .+ \| \*\*T-0001\*\* \| alice \| Task T-0001 \| .* \| claim branch, no pull request \|$/m);
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
  assert.match(none, /^\| 🟢 \| \*\*T-0002\*\* \| bob \| Task T-0002 \| Ready to start \| none yet \|$/m);
  assert.match(none, /^- \*\*T-0001\*\* \(alice's agents\): Active on the trusted branch with no claim branch or open pull request: if its pull request merged, the coordinator marks it Done; otherwise inspect its last handoff, then resume or release the claim$/m);
  assert.match(none, /^- \*\*#20\*\*: its branch names T-0002 and its title T-0003; rename one so the claim is clear$/m);
  assert.match(none, /^## 🔀 Open pull requests\n\n.*\n.*\n\| #20 \| — \| `T-0003: mixed up` \| bob-worker \| draft \|$/m);
});

test('pull request titles reach the view as plain text, never as links, mentions or HTML', t => {
  const { dir } = twoOwners(t);
  const text = renderStatus(evaluateStatus({ baseline: dirSource(dir), pullRequests: [
    pr(21, 'plan-x', 'T-0009: [approve here](https://evil.example/login) @bob <img src=x> `tick`', 'alice-worker'),
    pr(22, 'fork-x', '[click](https://evil.example) @alice', 'stranger', { isCrossRepository: true }),
    pr(23, 'plan-y', 'a | b', 'alice-worker', { isCrossRepository: true }),
  ] }));
  assert.match(text, /^\| #23 \| — \| `a \\\| b` \| alice-worker \| fork: an outside contribution \|$/m, 'a pipe in a title cannot split the table');
  assert.match(text, /^\| #21 \| T-0009 \| `T-0009: \[approve here\]\(https:\/\/evil\.example\/login\) @bob <img src=x> 'tick'` \| alice-worker \| 👀 ready for review \|$/m);
  assert.match(text, /^\| #22 \| — \| `\[click\]\(https:\/\/evil\.example\) @alice` \| stranger \| fork: an outside contribution \|$/m);
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
    assert.match(renderStatus(s), /^## 👤 Waiting on you$/m, bad);
  }
});

test('status reads a pull request file from the CLI and refuses one that is not a JSON array', t => {
  const { dir } = twoOwners(t);
  const file = path.join(dir, '..', `${path.basename(dir)}-prs.json`);
  t.after(() => fs.rmSync(file, { force: true }));
  fs.writeFileSync(file, JSON.stringify(openPullRequests));
  const ok = spawnSync(process.execPath, [cli, 'status', '--repo', dir, '--pull-requests', file], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^## 👤 Waiting on alice$/m);
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

// The milestone plan (IDEA-14): `tasks` is the plan as authorised; task records stay until acceptance.
function planned(t) {
  const dir = copy(t, '02-unrelated-task-ready');
  const edit = (p, fn) => fs.writeFileSync(path.join(dir, p), fn(fs.readFileSync(path.join(dir, p), 'utf8')));
  edit('docs/workflow/milestones/M-0001.md', x => x.replace('acceptance: [AC-001-1]', 'acceptance: [AC-001-1, AC-001-2]\ntasks: [T-0001, T-0009]'));
  return { dir, edit };
}

test('status shows the milestone plan: an unserved acceptance ID, a planned task with no record, a discovered task', t => {
  const { dir } = planned(t);
  const s = evaluateStatus({ baseline: dirSource(dir) });
  const m = s.milestones.find(x => x.id === 'M-0001');
  assert.deepEqual(m.plan, { planned: ['T-0001', 'T-0009'], discovered: ['T-0002'], uncovered: ['AC-001-2'], missing: ['T-0009'] });
  assert.deepEqual(m.tasks.map(x => [x.id, x.discovered]), [['T-0001', false], ['T-0002', true]]);
  const items = s.waiting.filter(w => w.kind === 'plan').map(w => [w.item, w.owner, w.detail]);
  assert.equal(items.length, 2, JSON.stringify(items));
  assert.ok(items.every(([item, owner]) => item === 'M-0001' && owner === 'agent'));
  const text = renderStatus(s);
  assert.match(text, /^## 🎯 M-0001 · Authorised\n\n> .*\n\n\*\*Progress\*\* ⬜{10} \*\*0 of 2 done\*\* · planned 2 · discovered 1$/m);
  assert.match(text, /^\| 🟢 \| \*\*T-0002\*\* <sub>discovered<\/sub> \| Task T-0002 \| Ready to start \| /m);
  assert.doesNotMatch(text, /\*\*T-0001\*\* <sub>discovered/);
  assert.match(text, /^- \*\*M-0001\*\*: acceptance AC-001-2 is served by no task/m);
  assert.match(text, /^- \*\*M-0001\*\*: planned T-0009 is not among this milestone's task records/m);
});

test('an accepted or released milestone raises no plan items, and a milestone without a plan marks nothing discovered', t => {
  const { dir, edit } = planned(t);
  for (const [from, to] of [['Authorised', 'Accepted'], ['Accepted', 'Released']]) {
    edit('docs/workflow/milestones/M-0001.md', x => x.replace(`status: ${from}`, `status: ${to}`));
    const s = evaluateStatus({ baseline: dirSource(dir) });
    assert.deepEqual(s.waiting.filter(w => w.kind === 'plan'), [], to);
  }
  const plain = evaluateStatus({ baseline: dirSource(fx('02-unrelated-task-ready')) });
  assert.deepEqual(plain.milestones[0].plan.discovered, []);
  assert.deepEqual(plain.waiting.filter(w => w.kind === 'plan'), []);
  assert.doesNotMatch(renderStatus(plain), /discovered/);
});

test('a Draft task folds its unrecorded start facts into one line and keeps them in missing_fields', t => {
  const { dir, edit } = planned(t);
  edit('docs/workflow/tasks/T-0002.md', x => x.replace('status: Ready', 'status: Draft').replace(/^(branch|start_revision|baseline_result): .*\n/gm, ''));
  edit('docs/workflow/tasks/T-0001.md', x => x.replace(/^branch: .*\n/m, ''));
  const s = evaluateStatus({ baseline: dirSource(dir) });
  const task = s.milestones[0].tasks.find(x => x.id === 'T-0002');
  assert.deepEqual(task.missing_fields, ['branch', 'start_revision', 'baseline_result']);
  assert.equal(task.reasons.filter(r => /is not recorded/.test(r)).length, 0, task.reasons.join(' | '));
  assert.equal(task.reasons[0], 'not yet recorded: branch, start_revision, baseline_result');
  const ready = s.milestones[0].tasks.find(x => x.id === 'T-0001');
  assert.equal(ready.missing_fields, undefined, 'only Draft tasks are folded');
  assert.ok(ready.reasons.includes('branch is not recorded'), ready.reasons.join(' | '));
});

test('a Draft task parked for a milestone not yet recorded, or with no milestone, is listed without a milestone record', t => {
  const { dir } = planned(t);
  const body = fs.readFileSync(path.join(dir, 'docs/workflow/tasks/T-0002.md'), 'utf8').replace('id: T-0002', 'id: T-0010').replace('status: Ready', 'status: Draft');
  fs.writeFileSync(path.join(dir, 'docs/workflow/tasks/T-0010.md'), body.replace('milestone: M-0001', 'milestone: M-0002'));
  fs.writeFileSync(path.join(dir, 'docs/workflow/tasks/T-0011.md'), body.replace('id: T-0010', 'id: T-0011').replace(/^milestone: .*\n/m, ''));
  const text = renderStatus(evaluateStatus({ baseline: dirSource(dir) }));
  assert.match(text, /^## 📂 Tasks outside a milestone record\n\n\| \| Task \| Where \| What \|\n\|:-:\|---\|---\|---\|\n\| 📝 \| \*\*T-0010\*\* Draft \| milestone M-0002, which has no record \| .* \|\n\| 📝 \| \*\*T-0011\*\* Draft \| no milestone \| .* \|$/m);
});

test('a Done task still serves its acceptance IDs and counts as planned, a Draft milestone raises plan items, and duplicates count once', t => {
  const { dir, edit } = planned(t);
  edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised', 'status: Draft').replace('acceptance: [AC-001-1, AC-001-2]', 'acceptance: [AC-001-1, AC-001-2, AC-001-3]').replace('tasks: [T-0001, T-0009]', 'tasks: [T-0001, T-0001, T-0009]'));
  edit('docs/workflow/tasks/T-0001.md', x => x.replace('status: Ready', 'status: Done'));
  edit('docs/workflow/tasks/T-0002.md', x => x.replace('acceptance: [AC-001-1]', 'acceptance: [AC-001-2]'));
  const s = evaluateStatus({ baseline: dirSource(dir) });
  assert.deepEqual(s.milestones[0].plan, { planned: ['T-0001', 'T-0009'], discovered: ['T-0002'], uncovered: ['AC-001-3'], missing: ['T-0009'] });
  assert.equal(s.waiting.filter(w => w.kind === 'plan').length, 2);
  assert.match(renderStatus(s), /^## 🎯 M-0001 · Draft\n\n> .*\n\n\*\*Progress\*\* 🟩{5}⬜{5} \*\*1 of 2 done\*\* · planned 2 · discovered 1$/mu);
  for (const [from, to] of [['Draft', 'Blocked'], ['Blocked', 'Verified']]) {
    edit('docs/workflow/milestones/M-0001.md', x => x.replace(`status: ${from}`, `status: ${to}`));
    assert.equal(evaluateStatus({ baseline: dirSource(dir) }).waiting.filter(w => w.kind === 'plan').length, 2, to);
  }
});

test('with two owners, plan items wait on the milestone owner\'s agents', t => {
  const { dir, edit } = twoOwners(t);
  edit('docs/workflow/milestones/M-0001.md', x => x.replace('acceptance: [AC-001-1]', 'acceptance: [AC-001-1, AC-001-2]\ntasks: [T-0001]'));
  const s = evaluateStatus({ baseline: dirSource(dir) });
  assert.deepEqual(s.waiting.filter(w => w.kind === 'plan').map(w => [w.item, w.owner, w.person]), [['M-0001', 'agent', 'alice']]);
  const text = renderStatus(s);
  assert.match(text, /^- \*\*M-0001\*\* \(alice's agents\): acceptance AC-001-2 is served by no task/m);
  assert.match(text, /^\| .+ \| \*\*T-0002\*\* <sub>discovered<\/sub> \| bob \| Task T-0002 \| /m);
});

// The layout's own rules (IDEA-17), on a hand-made view: every field below is what evaluateStatus produces.
const view = (over = {}) => ({ revision: null, project: 'P', measure: null, profile_readiness: 'Ready', owners: [], waiting: [], milestones: [], unassigned_tasks: [], blocked: [], decisions: { open: [], proposed: [] }, open_for_agent: [], pull_requests: null, feedback_open: [], record_errors: [], limitation: 'L', ...over });
const task = (id, over = {}) => ({ id, title: `Task ${id}`, status: 'Ready', readiness: 'Ready', reasons: [], pending: [], pull_requests: [], claim_branch: false, discovered: false, ...over });
test('a task whose only pull requests are drafts is in progress, not in review', () => {
  const text = renderStatus(view({
    milestones: [{ id: 'M-0001', status: 'Active', outcome: 'o', tasks: [task('T-0001', { status: 'Active', pull_requests: [5] }), task('T-0002', { status: 'Active', pull_requests: [6, 7] })], plan: { planned: [], discovered: [] } }],
    pull_requests: { open: [{ number: 5, title: 'T-0001: wip', task: 'T-0001', author: 'a', draft: true, fork: false, review: null }, { number: 6, title: 'T-0002', task: 'T-0002', author: 'a', draft: true, fork: false, review: null }, { number: 7, title: 'T-0002 b', task: 'T-0002', author: 'a', draft: false, fork: false, review: 'REVIEW_REQUIRED' }], duplicates: [], claim_branches: [] },
  }));
  assert.match(text, /^\| 🟠 \| \*\*T-0001\*\* \| Task T-0001 \| In progress: draft #5 \| #5 \|$/m);
  assert.match(text, /^\| 🔵 \| \*\*T-0002\*\* \| Task T-0002 \| In review: #6, #7 \| #6, #7 \|$/m);
  assert.match(text, /^\| 👤 Waiting on you \| 🟠 In progress \| 🔵 In review \|\n\|:-:\|:-:\|:-:\|\n\| \*\*0\*\* \| 1 \| 1 \|$/m);
});
test('a deferred input blocks like a decision, a later-stage decision ranks amber, and reasons stay capped', () => {
  const reasons = ['deferred input D-0003 is required before implement; task stage is implement and it is Open on the trusted baseline'];
  const many = Array.from({ length: 8 }, (_, i) => `reason ${i}`);
  const text = renderStatus(view({
    waiting: ['D-0003', 'D-0004', 'D-0005'].map(item => ({ kind: 'decision', item, owner: 'owner', detail: 'Open: q?' })),
    decisions: { open: ['D-0003', 'D-0004', 'D-0005'].map(id => ({ id, question: `Question ${id} <b>|</b>?`, type: 'decision', owner: 'owner', required_before: 'accept', affects: ['paths:src/(x)'], status: 'Open' })), proposed: [] },
    milestones: [{ id: 'M-0001', status: 'Active', outcome: 'o', plan: { planned: [], discovered: [] }, tasks: [
      task('T-0001', { readiness: 'Needs discovery or resolution', reasons }),
      task('T-0002', { pending: ['decision D-0004 is Open; required before accept (task stage: implement)'] }),
      task('T-0003', { readiness: 'Needs discovery or resolution', reasons: many }),
    ] }],
  }));
  assert.match(text, /^\| 🔴 \| \*\*T-0001\*\* \| Task T-0001 \| Waiting on decision D-0003 \| /m);
  assert.match(text, /^\| 🔴 \| \*\*D-0003\*\*.*\| \*\*T-0001 now\*\* \|\n\| 🟠 \| \*\*D-0004\*\*.*\| T-0002 later \|\n\| ⚪ \| \*\*D-0005\*\*.*\| no open task \|$/m);
  assert.match(text, /Question D-0003 &lt;b>\\\|&lt;\/b>\?/, 'record text cannot split a cell or open HTML');
  assert.match(text, /- reason 4\n- … 3 more: `wf readiness --task T-0003`/);
  assert.doesNotMatch(text, /reason 5/);
});
test('the progress bar has a fixed width and visible sections come before the milestones', () => {
  const tasks = Array.from({ length: 40 }, (_, i) => task(`T-${String(i + 1).padStart(4, '0')}`, { status: i < 10 ? 'Done' : 'Ready' }));
  const text = renderStatus(view({ milestones: [{ id: 'M-0001', status: 'Active', outcome: 'o', tasks, plan: { planned: [], discovered: [] } }], record_errors: ['x.md: bad'], blocked: [{ task: 'T-0011', resume_condition: 'later' }] }));
  assert.match(text, /^\*\*Progress\*\* 🟩{3}⬜{7} \*\*10 of 40 done\*\*$/mu);
  assert.ok(text.indexOf('## ⚠️ Record errors') < text.indexOf('## 🎯 M-0001') && text.indexOf('## ⛔ Blocked') < text.indexOf('## 🎯 M-0001'));
});
