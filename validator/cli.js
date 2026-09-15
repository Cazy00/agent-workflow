#!/usr/bin/env node
// wf <records|readiness|paths|ci> — see QUICKSTART.md "Commands" and SCHEMA.md for the rules.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { WfError, classifyPaths, dirSource, evaluateCi, evaluateReadiness, gitSource, loadConfig, validateRecords } from './lib/index.js';

const USAGE = `usage: wf <records|readiness|paths|ci> [--repo DIR] [--baseline REV|DIR] [--candidate REV|DIR]
          [--task T-0001 | --branch NAME] [--changed PATH]... [--base REV --head REV] [--json]`;
const COMMANDS = ['records', 'readiness', 'paths', 'ci'];

function parseArgs(argv) {
  const o = { changed: [] };
  let cmd = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { o.json = true; continue; }
    if (a.startsWith('--')) {
      const v = argv[++i];
      if (v === undefined) throw new WfError(`${a} needs a value`);
      if (a === '--changed') o.changed.push(v); else o[a.slice(2)] = v;
    } else if (!cmd) cmd = a;
    else throw new WfError(`unexpected argument ${a}`);
  }
  return { cmd, o };
}

const git = (repo, ...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

function main() {
  const { cmd, o } = parseArgs(process.argv.slice(2));
  if (!COMMANDS.includes(cmd)) { console.error(USAGE); return 2; }
  const repo = path.resolve(o.repo ?? (git(process.cwd(), 'rev-parse', '--show-toplevel').stdout.trim() || process.cwd()));
  const source = (spec) => {
    const p = path.resolve(repo, spec);
    return fs.existsSync(p) && fs.statSync(p).isDirectory() ? dirSource(p) : gitSource(repo, spec);
  };
  const candidate = o.candidate ? source(o.candidate) : dirSource(repo);
  let baseline;
  if (o.baseline) baseline = source(o.baseline);
  else {
    const branch = (() => { try { return loadConfig(candidate).trusted_branch ?? 'main'; } catch { return 'main'; } })();
    baseline = gitSource(repo, `origin/${branch}`);
  }
  const rd = (() => { try { return loadConfig(baseline).records_dir ?? 'docs/workflow'; } catch { return 'docs/workflow'; } })();

  const changed = () => {
    if (o.changed.length) return o.changed;
    if (o.base && o.head) return git(repo, 'diff', '--name-only', `${o.base}...${o.head}`).stdout.split('\n').filter(Boolean);
    if (baseline.kind !== 'git') throw new WfError('give --changed PATH... or --base REV --head REV when the baseline is a directory');
    const tracked = git(repo, 'diff', '--name-only', baseline.name).stdout.split('\n');
    const untracked = git(repo, 'ls-files', '--others', '--exclude-standard').stdout.split('\n');
    return [...new Set([...tracked, ...untracked].filter(Boolean))];
  };
  const taskId = () => {
    if (o.task) return o.task;
    const branch = o.branch ?? git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
    return branch.match(/^(T-\d{4})/)?.[1] ?? null;
  };
  const emit = (result, lines) => { if (o.json) console.log(JSON.stringify(result, null, 2)); else console.log(lines.join('\n')); };

  if (cmd === 'records') {
    const r = validateRecords(candidate, rd);
    emit(r, r.ok ? [`records: ok (${r.counts.tasks} tasks, ${r.counts.decisions} decisions, ${r.counts.feedback} feedback)`] : ['records: errors', ...r.errors.map((e) => `  ${e}`)]);
    return r.ok ? 0 : 1;
  }
  if (cmd === 'readiness') {
    const task = taskId();
    if (!task) throw new WfError('no task id: use --task T-0001 or a branch named T-0001-…');
    const r = evaluateReadiness({ baseline, candidate, task });
    emit(r, [
      `readiness ${task} (status ${r.status}, stage ${r.stage}, baseline ${r.baseline}): ${r.outcome}`,
      ...r.reasons.map((x) => `  ${x}`),
      ...(r.subset.length ? [`  subset: ${r.subset.join(', ')}`] : []),
      ...r.pending.map((x) => `  pending: ${x}`),
    ]);
    return r.outcome === 'Needs discovery or resolution' ? 1 : 0;
  }
  if (cmd === 'paths') {
    const classes = classifyPaths(loadConfig(baseline), changed());
    emit(classes, classes.map((c) => `${c.category}: ${c.path}`));
    return classes.some((c) => c.category === 'unclassified') ? 1 : 0;
  }
  const r = evaluateCi({ baseline, candidate, task: taskId(), changed: changed() });
  emit(r, [`ci: ${r.verdict}`, ...r.findings.map((x) => `  ${x}`)]);
  return r.verdict === 'pass' ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (e) {
  console.error(e instanceof WfError ? `wf: ${e.message}` : e);
  process.exitCode = 2;
}
