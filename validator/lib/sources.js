// Sources pin Git revisions once and never read through paths outside their root.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function safePath(rel) {
  if (typeof rel !== 'string' || !rel || rel.startsWith(':') || rel.includes('\\') || rel.includes('\0') || path.posix.isAbsolute(rel) || rel.split('/').some(p => p === '..' || p === '.' || p === '')) throw new Error(`invalid repository path: ${rel}`);
  return rel;
}
export function dirSource(root) {
  root = fs.realpathSync(root);
  const resolve = rel => {
    const target = path.join(root, safePath(rel));
    // Reject links in every existing component, including directory links.
    let current = root;
    for (const part of rel.split('/')) {
      current = path.join(current, part);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`symbolic link in record path: ${rel}`);
    }
    return target;
  };
  return {
    kind: 'dir', name: root,
    read(rel) { const p = resolve(rel); try { return fs.readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT' || e.code === 'EISDIR') return null; throw e; } },
    exists(rel) { return fs.existsSync(resolve(rel)); },
    list(relDir) {
      const dir = resolve(relDir);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true }).filter(f => f.isFile() && f.name.endsWith('.md')).sort((a,b) => a.name.localeCompare(b.name)).map(f => `${relDir}/${f.name}`);
    },
    isAncestor() { return null; },
    changedSince() { return null; },
  };
}
export function gitSource(repo, revision) {
  const git = (...args) => spawnSync('git', ['--literal-pathspecs', '-C', repo, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  const resolved = git('rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`);
  if (resolved.status !== 0) throw new Error(`invalid git revision: ${revision}`);
  const rev = resolved.stdout.trim();
  return {
    kind: 'git', name: rev,
    atRevision(commit) { return gitSource(repo, commit); },
    read(rel) { safePath(rel); const r = git('show', `${rev}:${rel}`); return r.status === 0 ? r.stdout : null; },
    exists(rel) { safePath(rel); return git('cat-file', '-e', `${rev}:${rel}`).status === 0; },
    list(relDir) {
      safePath(relDir);
      const r = git('ls-tree', '-r', '-z', '--name-only', rev, '--', `${relDir}/`);
      if (r.status !== 0) throw new Error(`cannot list ${relDir} at ${rev}`);
      return r.stdout.split('\0').filter(f => f.endsWith('.md') && path.posix.dirname(f) === relDir).sort();
    },
    hasCommit(commit) { return /^[a-f0-9]{40,64}$/.test(commit ?? '') && git('cat-file', '-e', `${commit}^{commit}`).status === 0; },
    isAncestor(commit) { if (!/^[a-f0-9]{40,64}$/.test(commit)) return false; return git('merge-base', '--is-ancestor', commit, rev).status === 0; },
    changedSince(commit, paths) {
      if (!/^[a-f0-9]{40,64}$/.test(commit)) return true;
      return git('diff', '--quiet', commit, rev, '--', ...paths).status !== 0;
    },
  };
}
