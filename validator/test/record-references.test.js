import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Readiness reads a task's prerequisites and governing task records from the baseline, so a record that another
// task names stays, Done, until the last record naming it is removed. `wf ci` fails the change that would leave
// a dangling name, whichever of a removal and a planning branch merges second.
const fixture = fileURLToPath(new URL('../../fixtures/06d-removed-prerequisite-record/baseline', import.meta.url));
const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
const task = (id, field, names) => `---\nrecord: task\nid: ${id}\ntitle: Task ${id}\nstatus: Draft\nowner: agent\nobjective: Do ${id}\ngoverning: [PROFILE${field === 'governing' ? `, ${names}` : ''}]\nprerequisites: [${field === 'prerequisites' ? names : ''}]\n---\n# ${id}\n`;

function setup(t, { rd = 'docs/workflow' } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-refs-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'project');
  fs.cpSync(fixture, repo, { recursive: true });
  const tasks = `${rd}/tasks`;
  if (rd !== 'docs/workflow') {
    fs.mkdirSync(path.join(repo, rd), { recursive: true });
    for (const f of ['profile.md', 'milestones', 'tasks']) fs.renameSync(path.join(repo, 'docs/workflow', f), path.join(repo, rd, f));
    const config = path.join(repo, 'docs/workflow/config.json');
    fs.writeFileSync(config, JSON.stringify({ ...JSON.parse(fs.readFileSync(config, 'utf8')), records_dir: rd }));
  }
  const git = (...args) => { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Test Worker'); git('config', 'user.email', 'worker@example.invalid');
  git('add', '.'); git('commit', '-qm', 'initial: T-0003 names T-0001, which is Done');
  // A branch from `from` that removes and adds task records, then (optionally) brought up to date with main.
  const branch = (name, from, { remove = [], add = {} }) => {
    git('checkout', '-q', '-B', name, from);
    for (const id of remove) git('rm', '-q', `${tasks}/${id}.md`);
    for (const [id, text] of Object.entries(add)) fs.writeFileSync(path.join(repo, tasks, `${id}.md`), text);
    git('add', '.'); git('commit', '-qm', `${name}`);
    return git('rev-parse', 'HEAD');
  };
  const upToDate = name => { git('checkout', '-q', name); git('merge', '-q', '--no-edit', 'main'); return git('rev-parse', 'HEAD'); };
  const merge = name => { git('checkout', '-q', 'main'); git('merge', '-q', '--no-ff', '--no-edit', name); return git('rev-parse', 'HEAD'); };
  const ci = (base, rev) => {
    const r = spawnSync(process.execPath, [cli, 'ci', '--repo', repo, '--baseline', base, '--candidate', rev, '--json'], { encoding: 'utf8' });
    return { status: r.status, text: r.stdout + r.stderr };
  };
  return { repo, tasks, git, branch, upToDate, merge, ci, main: git('rev-parse', 'HEAD') };
}

test('ci keeps a named record until the last record naming it goes, in prerequisites or governing', t => {
  const p = setup(t);
  const alone = p.ci(p.main, p.branch('remove-prerequisite', p.main, { remove: ['T-0001'] }));
  assert.equal(alone.status, 1, alone.text);
  assert.match(alone.text, /T-0001\.md is removed, but T-0003 \(prerequisites\) names T-0001; keep the record, set it Done when its work merges, and remove it with the last record that names it/);
  const chain = p.ci(p.main, p.branch('remove-chain', p.main, { remove: ['T-0003', 'T-0001'] }));
  assert.equal(chain.status, 0, chain.text);
  const governing = p.ci(p.main, p.branch('name-missing', p.main, { add: { 'T-0005': task('T-0005', 'governing', 'T-0008') } }));
  assert.equal(governing.status, 1, governing.text);
  assert.match(governing.text, /T-0005 names T-0008 in governing, but docs\/workflow\/tasks\/T-0008\.md is not in the candidate/);
  const present = p.ci(p.main, p.branch('name-present', p.main, { add: { 'T-0005': task('T-0005', 'governing', 'T-0001') } }));
  assert.equal(present.status, 0, present.text);
  const base = p.merge('name-present');
  const both = p.ci(base, p.branch('remove-named-twice', base, { remove: ['T-0001'] }));
  assert.equal(both.status, 1, both.text);
  assert.match(both.text, /T-0001\.md is removed, but T-0003 \(prerequisites\), T-0005 \(governing\) name T-0001;/);
});

test('ci catches a removal and a planning branch that names the removed record, whichever merges first', t => {
  const p = setup(t);
  const removal = p.branch('remove-T-0002', p.main, { remove: ['T-0002'] });
  const planning = p.branch('plan-T-0005', p.main, { add: { 'T-0005': task('T-0005', 'prerequisites', 'T-0002') } });
  assert.equal(p.ci(p.main, removal).status, 0, 'nothing names T-0002 yet');
  assert.equal(p.ci(p.main, planning).status, 0, 'T-0002 is still present');

  // The removal merges first: the planning branch, brought up to date, names a record that is gone.
  p.merge('remove-T-0002');
  const late = p.ci(p.git('rev-parse', 'main'), p.upToDate('plan-T-0005'));
  assert.equal(late.status, 1, late.text);
  assert.match(late.text, /T-0005 names T-0002 in prerequisites, but docs\/workflow\/tasks\/T-0002\.md is not in the candidate; add that record first, or, if its work is merged and its record removed, leave the reference out/);

  // The other order: the planning branch merges first, and the removal, brought up to date, would leave it dangling.
  p.git('checkout', '-q', '-B', 'main', p.main);
  p.branch('remove-T-0002', p.main, { remove: ['T-0002'] });
  p.branch('plan-T-0005', p.main, { add: { 'T-0005': task('T-0005', 'prerequisites', 'T-0002') } });
  p.merge('plan-T-0005');
  const early = p.ci(p.git('rev-parse', 'main'), p.upToDate('remove-T-0002'));
  assert.equal(early.status, 1, early.text);
  assert.match(early.text, /T-0002\.md is removed, but T-0005 \(prerequisites\) names T-0002;/);
});

test('ci does not fail an edit of a record whose older name already dangles', t => {
  const p = setup(t);
  // T-0001 was removed before this check existed; T-0003 still names it. Readiness blocks T-0003 as before, but an
  // unrelated edit of T-0003 does not fail on a name it did not add.
  p.git('rm', '-q', `${p.tasks}/T-0001.md`); p.git('commit', '-qm', 'T-0001 removed while named');
  const base = p.git('rev-parse', 'HEAD');
  const file = path.join(p.repo, p.tasks, 'T-0003.md');
  const edit = p.branch('edit-T-0003', base, { add: { 'T-0003': fs.readFileSync(file, 'utf8').replace('objective: Do the work of T-0003', 'objective: Do the work of T-0003, clarified') } });
  const r = p.ci(base, edit);
  assert.equal(r.status, 0, r.text);
  const added = p.ci(base, p.branch('name-more', base, { add: { 'T-0003': fs.readFileSync(file, 'utf8').replace('prerequisites: [T-0001]', 'prerequisites: [T-0001, T-0008]') } }));
  assert.equal(added.status, 1, added.text);
  assert.match(added.text, /T-0003 names T-0008 in prerequisites, but/);
  assert.doesNotMatch(added.text, /names T-0001/, 'only the name the change adds');
});

test('ci names a naming record without an id by its path', t => {
  const p = setup(t);
  const base = p.merge(p.branch('no-id', p.main, { add: { 'T-0005': task('T-0005', 'prerequisites', 'T-0001').replace('id: T-0005\n', '') } }));
  const r = p.ci(base, p.branch('remove-named', base, { remove: ['T-0001'] }));
  assert.equal(r.status, 1, r.text);
  assert.match(r.text, /T-0001\.md is removed, but T-0003 \(prerequisites\), docs\/workflow\/tasks\/T-0005\.md \(prerequisites\) name T-0001;/);
});

test('ci reads the records from the configured records_dir', t => {
  const p = setup(t, { rd: 'wf' });
  const r = p.ci(p.main, p.branch('remove-prerequisite', p.main, { remove: ['T-0001'] }));
  assert.equal(r.status, 1, r.text);
  assert.match(r.text, /wf\/tasks\/T-0001\.md is removed, but T-0003 \(prerequisites\) names T-0001;/);
});
