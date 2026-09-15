// A source is where records are read from: a directory (fixtures, the working tree) or a git revision
// (the trusted baseline). Both expose the same four calls.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function dirSource(root) {
  return {
    kind: 'dir',
    name: root,
    read(rel) { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } },
    exists(rel) { return fs.existsSync(path.join(root, rel)); },
    list(relDir) {
      const dir = path.join(root, relDir);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => path.posix.join(relDir, f));
    },
    isAncestor() { return null; },
  };
}

export function gitSource(repo, rev) {
  const git = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  return {
    kind: 'git',
    name: rev,
    read(rel) { const r = git('show', `${rev}:${rel}`); return r.status === 0 ? r.stdout : null; },
    exists(rel) { return git('cat-file', '-e', `${rev}:${rel}`).status === 0; },
    list(relDir) {
      const r = git('ls-tree', '--name-only', rev, `${relDir}/`);
      return r.status === 0 ? r.stdout.split('\n').filter((f) => f.endsWith('.md')).sort() : [];
    },
    isAncestor(commit) { return git('merge-base', '--is-ancestor', commit, rev).status === 0; },
  };
}
