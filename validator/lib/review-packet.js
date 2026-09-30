// Prepare canonical review inputs without copying the implementer's conversation.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitSource } from './sources.js';
import { loadAll, loadConfig, list, WfError } from './records.js';
export function prepareReview({ repo, baseline, candidate, tasks, evidence = [] }) {
  if (!/^[0-9a-f]{40,64}$/.test(baseline ?? '') || !/^[0-9a-f]{40,64}$/.test(candidate ?? '')) throw new WfError('review-packet requires exact committed --baseline and --candidate SHAs');
  if (!Array.isArray(tasks) || !tasks.length || tasks.some(t => !/^T-\d{4}$/.test(t)) || new Set(tasks).size !== tasks.length) throw new WfError('review-packet requires distinct --task or --tasks IDs');
  const git = (...args) => {
    const r = spawnSync('git', ['--no-optional-locks', '-C', repo, '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    if (r.status === 1 && args[0] === 'config' && args.includes('--get-regexp')) return '';
    if (r.status !== 0) throw new WfError(`cannot prepare review: git ${args[0]} failed`);
    return r.stdout.trim();
  };
  // Worktree comparisons can execute clean/process filters. A filter-configured project needs an isolated
  // review checkout without those drivers; do not execute candidate-selected commands to test cleanliness.
  const cfg = git('config', '--null', '--get-regexp', '^filter\\..*\\.(clean|process)$');
  if (cfg.split('\0').some(s => /^filter\.[^\n]+\.(clean|process)\n/.test(s))) throw new WfError('review-packet cannot check a worktree with clean/process filters; use an isolated review checkout without those drivers');
  if (git('rev-parse', 'HEAD') !== candidate) throw new WfError('review checkout HEAD differs from the candidate');
  if (git('status', '--porcelain=v1', '--untracked-files=normal')) throw new WfError('review checkout is dirty; commit the candidate and keep evidence outside the checkout');
  const base = gitSource(repo, baseline), head = gitSource(repo, candidate);
  if (!head.isAncestor(base.name)) throw new WfError('review candidate must contain the stated baseline');
  const config = loadConfig(base), rd = config.records_dir ?? 'docs/workflow';
  const b = loadAll(base, rd), c = loadAll(head, rd);
  if (b.errors.length || c.errors.length) throw new WfError('review records are invalid; run wf records');
  const source = (revision, file) => ({ revision, path: file });
  const canonical = [source(base.name, `${rd}/profile.md`)];
  const scopes = [];
  for (const id of tasks) {
    const task = c.tasks.get(id)?.data;
    if (!task) throw new WfError(`review task ${id} is missing`);
    const milestone = b.milestones.get(task.milestone);
    if (!milestone) throw new WfError(`review milestone ${task.milestone} is missing from the baseline`);
    canonical.push(source(head.name, `${rd}/tasks/${id}.md`), source(base.name, milestone.path));
    for (const file of [task.feature_readiness, task.design, ...list(task.governing)].filter(Boolean)) {
      const p = file === 'PROFILE' ? `${rd}/profile.md` : /^D-\d{4}$/.test(file) ? `${rd}/decisions/${file}.md` : /^T-\d{4}$/.test(file) ? `${rd}/tasks/${file}.md` : file;
      if (!base.exists(p)) throw new WfError(`governing review source is missing from the baseline: ${p}`);
      canonical.push(source(base.name, p));
    }
    for (const id of [...list(task.decisions), ...list(task.prerequisites).filter(x => /^D-\d{4}$/.test(x)), ...list(task.deferred_inputs).map(x => x.split('@')[0])]) canonical.push(source(base.name, `${rd}/decisions/${id}.md`));
    scopes.push({ task: id, owner: task.owner, paths: list(task.scope), acceptance: list(task.acceptance) });
  }
  for (const file of ['AGENTS.md', `${rd}/acceptance.json`]) if (base.exists(file)) canonical.push(source(base.name, file));
  if (head.exists('tests/acceptance-map.json')) canonical.push(source(head.name, 'tests/acceptance-map.json'));
  if (!evidence.length) throw new WfError('review-packet needs --evidence FILE (repeatable); keep run evidence outside the checkout');
  const files = evidence.map(file => {
    const real = fs.realpathSync(file), rel = path.relative(fs.realpathSync(repo), real);
    if (!rel || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))) throw new WfError('review evidence must be outside the checkout');
    if (!fs.statSync(real).isFile()) throw new WfError('review evidence must be a regular file');
    return real;
  });
  const packet = { schema: 'wf-review-packet/v1', authority: 'none', repository: config.repository ?? null, checkout: fs.realpathSync(repo), baseline: base.name, candidate: head.name, candidate_tree: git('rev-parse', `${head.name}^{tree}`), tasks: scopes, canonical_sources: [...new Map(canonical.map(s => [`${s.revision}:${s.path}`, s])).values()], evidence: files,
    launch: { codex: { fork_turns: 'none' }, claude_code: { fresh_session: true, resume: false }, context: 'canonical sources only; no implementer conversation or informal reasoning' },
    reviewer_instructions: 'Read AGENTS.md, the adopted review procedure and the listed canonical sources at their stated revisions. Review the entire baseline..candidate diff and verification evidence; run relevant checks. Cover scope, correctness, maintainability, security, regression and test fidelity, including helpers, fixtures and weakened assertions. Report actual candidate, reviewer identity, context provenance, findings/severity/disposition, checks and limitations. Do not edit, publish, approve or ask another agent. The coordinator must collect your actual result, record the harness invocation proving a fresh context, and rerun review-packet after review to confirm HEAD/tree/worktree stayed unchanged. Changed candidates require affected review and verification again.',
    limitation: 'This packet prepares inputs and checks local revision/cleanliness at collection time. It does not launch a reviewer, prove context independence, establish readiness, or grant approval. An agent-written separate_context label is not harness provenance.' };
  // Catch concurrent edits during collection; ignored runtime output is not part of the committed candidate.
  if (git('rev-parse', 'HEAD') !== candidate || git('status', '--porcelain=v1', '--untracked-files=normal')) throw new WfError('review checkout changed during packet collection');
  return packet;
}
