import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitSource, loadAll } from '../lib/index.js';
import { acceptanceEvidenceErrors, reviewPartsErrors } from '../lib/acceptance-evidence.js';
import { evaluateUsage } from '../lib/usage.js';
import { evaluateNext, MILESTONE_DIFF_WARNING } from '../lib/next.js';

// MAINT-0023 P6: the milestone review in contiguous parts (the owner approved it, 27 October 2026). A milestone diff larger than
// any reviewer model takes is reviewed in parts that together cover it; the parts count as the one review, the fix check stays
// the second run. The deep paths and the no-code-after-review rule are read over the union of the parts.
const RD = 'docs/workflow';
const taskRecord = (id, status, more = '') => `---\nrecord: task\nid: ${id}\nmilestone: M-0001\nstatus: ${status}\n${more}---\n# ${id}\n`;
const milestoneRecord = status => `---\nrecord: milestone\nid: M-0001\nstatus: ${status}\n---\n# M-0001\n`;
function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-maint-0023-parts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  const commit = m => { git('add', '-A'); git('commit', '-qm', m); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  write('src/a.js', 'a\n'); write(`${RD}/milestones/M-0001.md`, milestoneRecord('Draft'));
  for (const id of ['T-0001', 'T-0002', 'T-0003']) write(`${RD}/tasks/${id}.md`, taskRecord(id, 'Draft'));
  const before = commit('M-0001 planned');
  write(`${RD}/milestones/M-0001.md`, milestoneRecord('Authorised'));
  const authorised = commit('M-0001 authorised');
  write('src/a.js', 'a, T-0001\n'); write(`${RD}/tasks/T-0001.md`, taskRecord('T-0001', 'Done')); const s1 = commit('T-0001 merged');
  write('src/auth/session.js', 'T-0002\n'); write(`${RD}/tasks/T-0002.md`, taskRecord('T-0002', 'Done')); const s2 = commit('T-0002 merged');
  write('src/b.js', 'T-0003\n'); write(`${RD}/tasks/T-0003.md`, taskRecord('T-0003', 'Done')); const reviewed = commit('T-0003 merged');
  return { dir, git, write, commit, before, authorised, s1, s2, reviewed, at: rev => gitSource(dir, rev) };
}
const accept = (r, note = '') => { r.write(`${RD}/milestones/M-0001.md`, `${milestoneRecord('Accepted')}${note}`); return r.commit('Accept M-0001'); };
const config = (review = { cadence: 'milestone', deep_paths: ['src/auth/**', 'src/billing/**'] }) => ({ paths: { production: ['src/**'], governing: [`${RD}/milestones/**`], planning: ['docs/**'] }, review });
const evidenceOf = (revision, review = {}, candidate = revision) => ({
  schema: 'agent-workflow/acceptance-evidence@1', milestone: 'M-0001', candidate,
  review: { reviewer: 'codereview milestone', model: 'claude:opus', revision, report: 'https://github.com/o/r/pull/9#issuecomment-1', deep_paths: ['src/auth/**'], ...review },
  walkthrough: { not_applicable: 'the fixture has no user interface' }, deferred: [], tests_changed: [],
});
const errorsOf = (r, head, e, cfg = config()) => acceptanceEvidenceErrors({ evidence: e, milestone: 'M-0001', config: cfg, candidate: r.at(head), baseline: r.at(head), records: [loadAll(r.at(head), RD)] }).join(' | ');
const parts = (...pairs) => pairs.map(([base, revision]) => ({ base, revision }));

test('MAINT-0023 P6: contiguous parts from the authorisation to the end of the milestone are one review', t => {
  const r = repo(t); const head = accept(r);
  assert.equal(errorsOf(r, head, evidenceOf(r.reviewed, { parts: parts([r.authorised, r.s2], [r.s2, r.reviewed]) })), '');
  assert.equal(errorsOf(r, head, evidenceOf(r.reviewed, { parts: parts([r.authorised, r.s1], [r.s1, r.s2], [r.s2, r.reviewed]) })), '', 'three parts');
  assert.equal(errorsOf(r, head, evidenceOf(r.reviewed, { parts: parts([r.before, r.s2], [r.s2, r.reviewed]) })), '', 'the first base may come before the authorisation, as a single review\'s may');
  assert.equal(errorsOf(r, head, evidenceOf(r.reviewed, { parts: parts([r.authorised, r.reviewed]) })), '', 'one part is the whole diff');
});

test('MAINT-0023 P6: a gap between parts fails', t => {
  const r = repo(t); const head = accept(r);
  const errors = errorsOf(r, head, evidenceOf(r.reviewed, { parts: parts([r.authorised, r.s1], [r.s2, r.reviewed]) }));
  assert.match(errors, new RegExp(`review part 2 starts at ${r.s2.slice(0, 12)}, after part 1 ended at ${r.s1.slice(0, 12)}: a gap of unreviewed code`));
});

test('MAINT-0023 P6: an overlap between parts fails', t => {
  const r = repo(t); const head = accept(r);
  const errors = errorsOf(r, head, evidenceOf(r.reviewed, { parts: parts([r.authorised, r.s2], [r.s1, r.reviewed]) }));
  assert.match(errors, new RegExp(`review part 2 starts at ${r.s1.slice(0, 12)}, before part 1 ended at ${r.s2.slice(0, 12)}: the parts overlap`));
});

test('MAINT-0023 P6: the first part starts at or before the authorisation', t => {
  const r = repo(t); const head = accept(r);
  const errors = errorsOf(r, head, evidenceOf(r.reviewed, { parts: parts([r.s1, r.s2], [r.s2, r.reviewed]) }));
  assert.match(errors, new RegExp(`the milestone review's base ${r.s1.slice(0, 12)} comes after M-0001's authorisation ${r.authorised.slice(0, 12)}`));
});

test('MAINT-0023 P6: the last part ends at the reviewed revision, and code after it needs the fix check', t => {
  const r = repo(t); const head = accept(r);
  // The last part ends before the milestone's end while the review names the end.
  assert.match(errorsOf(r, head, evidenceOf(r.reviewed, { parts: parts([r.authorised, r.s1], [r.s1, r.s2]) })), new RegExp(`the last review part ends at ${r.s2.slice(0, 12)}, not at the milestone review's revision ${r.reviewed.slice(0, 12)}`));
  // The review names the part's end, so the code merged after it is uncovered without a fix check.
  const short = errorsOf(r, head, evidenceOf(r.s2, { parts: parts([r.authorised, r.s1], [r.s1, r.s2]) }));
  assert.match(short, new RegExp(`the milestone review's revision ${r.s2.slice(0, 12)} is followed by changes to src/b\\.js`));
});

test('MAINT-0023 P6: the fix check follows the last part, and nothing follows the fix check', t => {
  const r = repo(t);
  r.write('src/b.js', 'fixed\n'); r.write(`${RD}/tasks/T-0004.md`, taskRecord('T-0004', 'Done', 'found_from: R-0009/F1\n'));
  const fixed = r.commit('T-0004, the fix of the review\'s finding F1'); const head = accept(r);
  const fixCheck = (revision, more = {}) => ({ revision, reviewer: 'codereview fixcheck', model: 'claude:sonnet', report: 'https://github.com/o/r/pull/9#issuecomment-2', ...more });
  const two = parts([r.authorised, r.s2], [r.s2, r.reviewed]);
  assert.equal(errorsOf(r, head, evidenceOf(r.reviewed, { parts: two, fix_check: fixCheck(fixed) }, fixed)), '');
  assert.match(errorsOf(r, head, evidenceOf(r.reviewed, { parts: two }, fixed)), /the milestone review's revision [0-9a-f]{12} is followed by changes to src\/b\.js/, 'a missing fix check');
  assert.match(errorsOf(r, head, evidenceOf(r.reviewed, { parts: two, fix_check: fixCheck(r.s2) }, fixed)), /the milestone review's fix check must come after the review's revision/, 'a fix check inside the parts');
  assert.match(errorsOf(r, head, evidenceOf(r.reviewed, { parts: two, fix_check: fixCheck(fixed, { report: 'none' }) }, fixed)), /the milestone review's fix check needs its reviewer, model and an https report/);
  // No round three: code after the fix check fails as it does for a single review.
  r.write('src/b.js', 'again\n'); const again = r.commit('a change after the fix check'); const later = accept(r, 'again\n');
  assert.match(errorsOf(r, later, evidenceOf(r.reviewed, { parts: two, fix_check: fixCheck(fixed) }, again)), /the milestone review's fix check revision [0-9a-f]{12} is followed by changes to src\/b\.js/);
  assert.ok(again);
});

test('MAINT-0023 P6: extra parts that repeat or leave the chain fail', t => {
  const r = repo(t); const head = accept(r);
  const chain = [[r.authorised, r.s2], [r.s2, r.reviewed]];
  // A part listed twice overlaps itself; one after the end is neither contiguous nor the last.
  assert.match(errorsOf(r, head, evidenceOf(r.reviewed, { parts: parts(...chain, [r.s2, r.reviewed]) })), /review part 3 starts at [0-9a-f]{12}, before part 2 ended at [0-9a-f]{12}: the parts overlap/);
  assert.match(errorsOf(r, head, evidenceOf(r.reviewed, { parts: parts(chain[0], [r.s1, r.s2], chain[1]) })), /the parts overlap/);
  // A part of no commits, or from a side branch, is not a part.
  assert.match(errorsOf(r, head, evidenceOf(r.reviewed, { parts: parts([r.authorised, r.authorised], [r.authorised, r.reviewed]) })), new RegExp(`review part 1 is empty: its base and revision are both ${r.authorised.slice(0, 12)}`));
  r.git('checkout', '-q', '-b', 'side', r.s1); r.write('src/c.js', 'side\n'); const side = r.commit('a side commit'); r.git('checkout', '-q', 'main');
  assert.match(errorsOf(r, head, evidenceOf(r.reviewed, { parts: parts([r.authorised, side], [side, r.reviewed]) })), /review part 1's revision [0-9a-f]{12} is not in this pull request's history|review part 2's base [0-9a-f]{12} is not an earlier revision of its revision/);
});

test('MAINT-0023 P6: a malformed parts list fails', t => {
  const r = repo(t); const head = accept(r);
  assert.match(errorsOf(r, head, evidenceOf(r.reviewed, { parts: [] })), /the milestone review's parts must be a non-empty list of \{ base, revision \} full commit hashes/);
  assert.match(errorsOf(r, head, evidenceOf(r.reviewed, { parts: 'all of it' })), /the milestone review's parts must be a non-empty list/);
  assert.match(errorsOf(r, head, evidenceOf(r.reviewed, { parts: [{ base: r.authorised, revision: 'HEAD' }] })), /the milestone review's parts must be a non-empty list/);
  assert.match(errorsOf(r, head, evidenceOf(r.reviewed, { parts: [{ base: r.authorised, revision: r.reviewed, report: 'https://x.example/1' }] })), /the milestone review's parts must be a non-empty list/, 'a part carries no field but base and revision');
  assert.match(errorsOf(r, head, evidenceOf(r.reviewed, { base: r.authorised, parts: parts([r.authorised, r.reviewed]) })), /name the milestone review's base or its parts, not both/);
});

test('MAINT-0023 P6: the deep paths are read over the union of the parts', t => {
  const r = repo(t); const head = accept(r);
  const two = parts([r.authorised, r.s2], [r.s2, r.reviewed]);
  assert.match(errorsOf(r, head, evidenceOf(r.reviewed, { parts: two, deep_paths: ['src/billing/**'] })), /the milestone review's deep_paths must list the review\.deep_paths the milestone changed, its security focus: src\/auth\/\*\*/);
  // A deep path changed in the first part and changed back in the second still belongs to what the reviewer must focus on.
  const q = repo(t);
  q.write('src/auth/session.js', 'reverted\n'); const touched = q.commit('touch the deep path again');
  q.git('rm', '-q', '-f', 'src/auth/session.js'); const gone = q.commit('remove the deep path file');
  const qhead = accept(q);
  assert.equal(q.git('diff', '--name-only', q.authorised, gone).includes('src/auth'), false, 'the whole diff no longer shows the deep path');
  assert.match(errorsOf(q, qhead, evidenceOf(gone, { parts: parts([q.authorised, touched], [touched, gone]), deep_paths: [] })), /its security focus: src\/auth\/\*\*/);
});

test('MAINT-0023 P6: parts are read only under the milestone cadence', t => {
  const r = repo(t); const head = accept(r);
  const e = evidenceOf(r.reviewed, { parts: parts([r.s1, r.s1]) });
  assert.equal(errorsOf(r, head, e, config({ deep_paths: ['src/auth/**'] })), '', 'the task cadence reads revision alone, as before');
});

// The same function judges the parts for the acceptance evidence and for `wf usage` (review finding 6).
test('MAINT-0023 P6: reviewPartsErrors is the one judge of a contiguous set', t => {
  const r = repo(t); const head = accept(r);
  const judge = p => reviewPartsErrors({ parts: p, revision: r.reviewed, milestone: 'M-0001', recordsDir: RD, candidate: r.at(head), baseline: r.at(head) });
  assert.deepEqual(judge(parts([r.authorised, r.s2], [r.s2, r.reviewed])), []);
  assert.equal(judge(parts([r.authorised, r.s1], [r.s2, r.reviewed])).length, 1);
  assert.equal(judge(parts([r.s1, r.s2], [r.s2, r.reviewed])).length, 1, 'the first base after the authorisation');
  assert.deepEqual(judge(undefined).length > 0, true);
});

// usage.js: several second-model runs of the milestone's review are one review only when the evidence's parts form a valid set.
const NOW = Date.parse('2026-10-27T10:00:00Z');
const at = m => new Date(NOW + m * 60000).toISOString();
const zero = { input: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, output: 0 };
const runOf = (n, id = 'M-0001') => ({ id: `r${n}`, session: `r${n}`, parent: null, kind: 'run', description: null, cwd: `/work/.review-${id}`, prompt_names: [], ids: { cwd: [id], prompt: [] }, model: 'gpt-6.1-sol', effort: 'high', refused: false, started: at(n), total: { ...zero, input: 100 }, calls: [] });
const usageOf = (runs, reviewParts) => {
  const readings = [{ schema: 'agent-workflow/usage-reader@1', harness: 'codex', agents: runs.map((x, i) => runOf(i + 1, x)), notes: [] }];
  const project = { ids: new Set(['M-0001', 'T-0001']), tasksOf: new Set(['T-0001']), reviews: new Map(), folders: ['/work'], folder_names: [], names: [] };
  return evaluateUsage({ readings, since: at(0), until: at(60), milestone: 'M-0001', project, budget: { runs: 2 }, reviewParts }).second_model.milestone;
};

test('MAINT-0023 P6: usage counts the runs of a valid set of parts as one review', t => {
  const r = repo(t); const head = accept(r);
  const set = (p, revision = r.reviewed) => ({ parts: p, revision, milestone: 'M-0001', recordsDir: RD, candidate: r.at(head), baseline: r.at(head) });
  const valid = set(parts([r.authorised, r.s2], [r.s2, r.reviewed]));
  // Two review runs and one fix check: three runs, two reviews against a budget of two.
  const plain = usageOf(['M-0001', 'M-0001', 'M-0001'], undefined);
  assert.deepEqual([plain.used, plain.review_runs], [3, 3], 'without parts every run counts');
  const counted = usageOf(['M-0001', 'M-0001', 'M-0001'], valid);
  assert.deepEqual([counted.used, counted.review_runs, counted.warning], [2, 2, 'the budget is spent: 2 of 2 runs used']);
  // The parts forgive as many runs as they have parts, no more: a third review run beyond two parts counts by itself.
  const extra = usageOf(['M-0001', 'M-0001', 'M-0001', 'M-0001'], valid);
  assert.deepEqual([extra.used, extra.review_runs], [3, 3], 'two parts account for two runs; the other two count');
  // Fewer runs than parts count as what they are.
  assert.deepEqual([usageOf(['M-0001'], valid).used, usageOf([], valid).used], [1, 0]);
  // A set that is not contiguous forgives nothing: its runs merely claim to be parts.
  for (const bad of [parts([r.authorised, r.s1], [r.s2, r.reviewed]), parts([r.authorised, r.s2], [r.s1, r.reviewed]), parts([r.s1, r.s2], [r.s2, r.reviewed]), parts([r.authorised, r.s1], [r.s1, r.s2])]) {
    const u = usageOf(['M-0001', 'M-0001', 'M-0001'], set(bad));
    assert.deepEqual([u.used, u.review_runs], [3, 3]);
  }
  // Runs of a task are not the milestone review's: they are never merged into it.
  const mixed = usageOf(['T-0001', 'M-0001', 'M-0001'], valid);
  assert.deepEqual([mixed.task_runs, mixed.review_runs, mixed.used], [1, 1, 2]);
});

// wf next: the milestone's diff from its authorisation to HEAD, measured during the milestone.
test('MAINT-0023 P6: wf next warns once the milestone diff passes 700 KiB', t => {
  const r = repo(t);
  const cfg = JSON.stringify({ ...config(), approval: { label: 'owner-merge' }, acceptance_evidence: true });
  r.write(`${RD}/config.json`, cfg);
  const baseline = r.commit('config');
  const next = rev => evaluateNext({ baseline: r.at(rev), candidate: r.at(rev) });
  assert.equal(MILESTONE_DIFF_WARNING, 700 * 1024);
  assert.deepEqual(next(baseline).warnings ?? [], [], 'a small diff warns nothing');
  r.write('src/big.js', `${'x'.repeat(79)}\n`.repeat(Math.ceil(MILESTONE_DIFF_WARNING / 80) + 10));
  const big = r.commit('a large change');
  const w = next(big).warnings;
  assert.equal(w.length, 1);
  assert.equal(w[0].milestone, 'M-0001');
  assert.ok(w[0].bytes > MILESTONE_DIFF_WARNING);
  assert.match(w[0].text, /M-0001's diff from its authorisation [0-9a-f]{12} to this revision is \d+ KiB, past 700 KiB/);
  assert.match(w[0].text, /review\.parts/);
});

test('MAINT-0023 P6: wf next measures only a live milestone under the milestone cadence, and not at planning', t => {
  const r = repo(t);
  r.write('src/big.js', `${'x'.repeat(79)}\n`.repeat(Math.ceil(MILESTONE_DIFF_WARNING / 80) + 10));
  const big = r.commit('a large change');
  const task = { ...config(), approval: { label: 'owner-merge' }, acceptance_evidence: true };
  const cadence = c => { r.write(`${RD}/config.json`, JSON.stringify(c)); return r.commit('config'); };
  const noCadence = cadence({ ...task, review: { deep_paths: ['src/auth/**'] } });
  assert.deepEqual(evaluateNext({ baseline: r.at(noCadence), candidate: r.at(noCadence) }).warnings ?? [], [], 'the task cadence has no milestone review to outgrow');
  const withCadence = cadence(task);
  assert.equal(evaluateNext({ baseline: r.at(withCadence), candidate: r.at(withCadence) }).warnings.length, 1);
  // A Draft milestone has no authorisation and no diff to measure.
  const draft = repo(t); draft.write(`${RD}/config.json`, JSON.stringify(task));
  draft.git('checkout', '-q', draft.before); draft.write(`${RD}/config.json`, JSON.stringify(task)); draft.write('src/big.js', `${'x'.repeat(79)}\n`.repeat(Math.ceil(MILESTONE_DIFF_WARNING / 80) + 10));
  const planned = draft.commit('planning, large code');
  assert.deepEqual(evaluateNext({ baseline: draft.at(planned), candidate: draft.at(planned) }).warnings ?? [], []);
  assert.ok(big);
});

// `wf usage --milestone M-0001 --acceptance-evidence FILE`: the same judge, against this repository's history.
test('MAINT-0023 P6: wf usage reads review.parts from the acceptance evidence', t => {
  const r = repo(t);
  r.write(`${RD}/config.json`, JSON.stringify({ ...config(), approval: { label: 'owner-merge' }, acceptance_evidence: true, usage: { folders: ['.review-*'] } }));
  r.commit('config'); const head = accept(r);
  const sessions = path.join(r.dir, '..', `${path.basename(r.dir)}-codex`);
  t.after(() => fs.rmSync(sessions, { recursive: true, force: true }));
  for (let i = 0; i < 3; i++) {
    const started = new Date(Date.now() - (30 - i) * 60000).toISOString(), cwd = '/work/.review-M-0001', day = started.slice(0, 10).split('-').join('/');
    fs.mkdirSync(path.join(sessions, day), { recursive: true });
    fs.writeFileSync(path.join(sessions, day, `rollout-${i}.jsonl`), [
      { type: 'session_meta', timestamp: started, payload: { id: `run-${i}`, timestamp: started, cwd, originator: 'codex_exec' } },
      { type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'high', cwd } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'The milestone review' }] } },
      { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 } } } },
      { type: 'event_msg', payload: { type: 'task_complete', last_agent_message: null } },
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
  }
  const evidenceFile = (name, review) => { const f = path.join(sessions, name); fs.writeFileSync(f, JSON.stringify(evidenceOf(r.reviewed, review))); return f; };
  const since = new Date(Date.now() - 3600000).toISOString();
  const run = (...more) => spawnSync(process.execPath, [fileURLToPath(new URL('../cli.js', import.meta.url)), 'usage', '--repo', r.dir, '--candidate', head, '--since', since, '--codex-dir', sessions, '--milestone', 'M-0001', '--json', ...more], { encoding: 'utf8' });
  const used = (...more) => { const x = run(...more); assert.equal(x.status, 0, x.stderr); return JSON.parse(x.stdout).second_model.milestone; };
  assert.equal(used().used, 3, 'without the evidence every run counts');
  const good = evidenceFile('good.json', { parts: parts([r.authorised, r.s2], [r.s2, r.reviewed]) });
  assert.deepEqual([used('--acceptance-evidence', good).used, used('--acceptance-evidence', good).review_parts], [2, 2]);
  const gap = evidenceFile('gap.json', { parts: parts([r.authorised, r.s1], [r.s2, r.reviewed]) });
  const bad = used('--acceptance-evidence', gap);
  assert.equal(bad.used, 3);
  assert.match(bad.review_parts_refused.join(' | '), /a gap of unreviewed code/);
  const plain = evidenceFile('plain.json', {});
  assert.match(run('--acceptance-evidence', plain).stderr, /has no review\.parts to count/);
  assert.match(run('--acceptance-evidence', path.join(sessions, 'missing.json')).stderr, /cannot read the acceptance evidence/);
  const elsewhere = spawnSync(process.execPath, [fileURLToPath(new URL('../cli.js', import.meta.url)), 'status', '--acceptance-evidence', good], { encoding: 'utf8' });
  assert.match(elsewhere.stderr, /--acceptance-evidence is only for usage, with --milestone/);
});

test('MAINT-0023 P6: the acceptance evidence template documents base, parts, deep_paths and the fix check', () => {
  const template = JSON.parse(fs.readFileSync(new URL('../../templates/acceptance-evidence.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(template.review), ['reviewer', 'model', 'fallback', 'revision', 'base', 'parts', 'deep_paths', 'fix_check', 'report']);
  assert.deepEqual(Object.keys(template.review.parts[0]), ['base', 'revision']);
  assert.deepEqual(Object.keys(template.review.fix_check), ['revision', 'reviewer', 'model', 'report']);
});
