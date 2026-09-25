import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource } from '../lib/index.js';
import { evaluateStatus, renderStatus } from '../lib/status.js';

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
