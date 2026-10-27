// `wf prune --milestone M-NNNN` (MAINT-0020 P8, procedures/execute.md): a client project kept 34 Done task records of five accepted
// milestones on main, read by every `wf next` and readiness run, because nothing removed them and the one removal tried by hand
// was refused as ad hoc deletion. This removes exactly what the procedure says, in one commit on the current branch, and no other path.
import { spawnSync } from 'node:child_process';
import { DIRS, WfError, namesIn } from './records.js';
import { gitRunner } from './git.js';

export const ACCEPTED = ['Accepted', 'Released'];

// The Done task records of `milestone`, chosen by each record's own `milestone` (its `tasks:` list misses tasks added after
// authorisation), less every one a remaining record names (execute.md; a chain goes together). `kept` says which record names it.
export function prunable(all, milestone) {
  const named = [];
  for (const [kind, records] of [['task', all.tasks], ['decision', all.decisions], ['feedback', all.feedback], ['milestone', all.milestones]]) {
    for (const r of records.values()) if (r.data && !(kind === 'milestone' && r.data.id === milestone)) named.push(...namesIn(r.data, kind).map(n => ({ ...n, by: r.data.id ?? r.path })));
  }
  const gone = new Map([...all.tasks.values()].filter(r => r.data?.id && r.data.milestone === milestone && r.data.status === 'Done').map(r => [r.data.id, r.path]));
  const kept = [];
  for (let moved = true; moved;) {
    moved = false;
    for (const id of [...gone.keys()]) {
      const by = named.filter(n => n.id === id && n.by !== id && !gone.has(n.by));
      if (by.length) { kept.push({ task: id, named_by: by.map(n => `${n.by} (${n.field})`) }); gone.delete(id); moved = true; }
    }
  }
  return { remove: [...gone].map(([id, path]) => ({ id, path })).sort((a, b) => a.id.localeCompare(b.id)), kept: kept.sort((a, b) => a.task.localeCompare(b.task)) };
}

export function prune({ repo, rd, all, milestone, dryRun, trustedBranch = 'main' }) {
  const m = all.milestones.get(milestone)?.data;
  if (!m) throw new WfError(`${milestone} has no record in ${rd}/${DIRS.milestone}`);
  if (!ACCEPTED.includes(m.status)) throw new WfError(`${milestone} is ${m.status}: prune takes only an Accepted or Released milestone, whose task records nothing reads any more (procedures/execute.md)`);
  // A record that cannot be read could name a task, so a removal on records with errors could leave a dangling name.
  if (all.errors.length) throw new WfError(`fix the record errors first (wf records): ${all.errors.slice(0, 3).join('; ')}${all.errors.length > 3 ? `; and ${all.errors.length - 3} more` : ''}`);
  const { remove, kept } = prunable(all, milestone);
  const git = gitRunner(repo);
  const branch = git('branch', '--show-current').stdout?.trim();
  const out = { ok: true, milestone, dry_run: dryRun, branch: branch || null, removed: remove.map(r => r.id), kept, commit: null };
  if (dryRun || !remove.length) return out;
  if (!branch) throw new WfError('HEAD is detached: check out the branch the commit belongs on first');
  // v2.8.0 review: the prune rides in a pull request (execute.md), never a commit on the trusted branch itself.
  if (branch === trustedBranch) throw new WfError(`${branch} is the trusted branch: the prune rides in a pull request, so check out a branch for it first (git switch -c prune-${milestone})`);
  const status = git('status', '--porcelain', '--untracked-files=no');
  if (status.status !== 0) throw new WfError(`git status failed: ${status.stderr.trim()}`);
  if (status.stdout.trim()) throw new WfError('the working tree has uncommitted changes: commit or discard them first, so the commit holds only the removals');
  // The commit is written as the operator's own `git commit` would be, hooks included; only the removed records are named.
  const write = (...args) => { const r = spawnSync('git', ['--literal-pathspecs', '-C', repo, ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new WfError(`git ${args[0]} failed: ${(r.stderr || r.error?.message || '').trim()}`); return r.stdout; };
  const paths = remove.map(r => r.path);
  const message = `Prune ${milestone}: remove its ${remove.length} Done task record${remove.length === 1 ? '' : 's'}\n\nRemoved: ${out.removed.join(', ')}${kept.length ? `\nKept, named by another record: ${kept.map(k => k.task).join(', ')}` : ''}\n`;
  const before = git('rev-parse', 'HEAD').stdout.trim();
  const restore = (changed = paths) => {
    spawnSync('git', ['--literal-pathspecs', '-C', repo, 'reset', '-q', before, '--', ...changed]);
    spawnSync('git', ['--literal-pathspecs', '-C', repo, 'checkout', '--', ...paths]);
  };
  write('rm', '-q', '--', ...paths);
  // v2.8.0 review: `--only` commits the named paths alone, whatever else is staged; a hook can still stage into that commit, so
  // its changed paths are checked to be exactly the removals. If not, the branch goes back to `before` and the records return,
  // and the work tree keeps whatever the hook wrote.
  try { write('commit', '-q', '--only', '-m', message, '--', ...paths); } catch (e) { restore(); throw e; }
  out.commit = git('rev-parse', 'HEAD').stdout.trim();
  const diff = git('diff-tree', '-r', '-z', '--no-renames', '--no-commit-id', '--name-status', out.commit).stdout ?? '';
  const parts = diff.split('\0').filter(Boolean), changed = parts.filter((_, i) => i % 2), deleted = parts.filter((x, i) => !(i % 2) && x === 'D').length;
  const parent = git('rev-parse', `${out.commit}^`).stdout?.trim();
  if (parent !== before || deleted !== paths.length || changed.length !== paths.length || changed.some(p => !paths.includes(p))) {
    if (parent === before) { write('reset', '-q', '--soft', before); restore([...new Set([...changed, ...paths])]); }
    throw new WfError(`the commit ${out.commit.slice(0, 12)} changed ${changed.join(', ') || 'nothing'}, not only the removed records (a commit hook?)${parent === before ? '; it was undone, and the work tree kept as it was' : `; its parent is not ${before.slice(0, 12)}, so it was left for you to undo`}`);
  }
  return out;
}
