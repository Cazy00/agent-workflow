// Git as the gates read it. The clone the validator reads may be one an agent can write, so nothing in it may change
// what Git reports or make Git run a program:
// - objects as committed: replace refs, grafts and the commit-graph cache are ignored, and nothing is ever fetched
//   (no lazy fetch, no transport protocol);
// - paths from the work tree's real root: the root is where the `.git` entry is, whatever `core.worktree` says, and
//   `diff.relative`, `log.showRoot` and `log.follow` are fixed;
// - no program from config: hooks, signature display (which runs `gpg.program`) and fsmonitor are off;
// - a minimal environment: Git sees no owner signing variables or other secrets of the process that runs the gate.
// Callers also use plumbing (`diff-tree`, `ls-tree --full-tree`) where porcelain would read UI config. The overrides
// need Git 2.31 (GIT_CONFIG_COUNT); refusing lazy fetches outright needs 2.44, and a current Git (2.45.1 or later) is
// recommended for the one transport allowed, the local `file` clone that builds the verified mirror. A clone the
// agent can write can still hold rewritten object files, which Git does not re-hash when reading locally; the
// commands that decide what the owner signs and what the trusted branch becomes (`brief --repo`, `closeout`) read a
// verified mirror instead (verifiedMirror), which Git builds by re-hashing every object it transfers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// The operator's own choice of global and system config stays (it is outside any clone); the repository's config is
// read but overridden where it could change an answer or run a program.
const KEEP = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM'];
const OVERRIDES = [['core.commitGraph', 'false'], ['diff.relative', 'false'], ['log.showSignature', 'false'], ['log.showRoot', 'true'], ['log.follow', 'false'], ['core.fsmonitor', 'false'], ['core.untrackedCache', 'false'], ['core.hooksPath', '/dev/null'], ['advice.graftFileDeprecated', 'false']];

const isBare = d => !fs.existsSync(path.join(d, '.git')) && ['HEAD', 'objects', 'refs'].every(f => fs.existsSync(path.join(d, f)));
// The repository's layout: a bare repository is used as it is; otherwise the directory holding the `.git` entry at or
// above dir is the work tree's root.
export function repoLayout(dir) {
  const start = path.resolve(dir);
  if (isBare(start)) return { root: start, bare: true };
  for (let d = start; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return { root: d, bare: false };
    if (path.dirname(d) === d) return { root: start, bare: false };
  }
}
export const workTreeRoot = dir => repoLayout(dir).root;
export function safeEnv(root, { bare = false, protocols = 'none' } = {}) {
  const env = {};
  for (const k of KEEP) if (process.env[k] !== undefined) env[k] = process.env[k];
  Object.assign(env, { GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: protocols, GIT_TERMINAL_PROMPT: '0' });
  // A bare repository is named outright, so an operator's safe.bareRepository=explicit still lets the gates read it.
  if (bare) env.GIT_DIR = root; else env.GIT_WORK_TREE = root;
  // The operator's own command-line config comes first; these overrides come after it, so they win.
  const inherited = Number.parseInt(process.env.GIT_CONFIG_COUNT ?? '0', 10) || 0;
  const pairs = [];
  for (let i = 0; i < inherited; i++) if (process.env[`GIT_CONFIG_KEY_${i}`] !== undefined) pairs.push([process.env[`GIT_CONFIG_KEY_${i}`], process.env[`GIT_CONFIG_VALUE_${i}`] ?? '']);
  pairs.push(...OVERRIDES);
  env.GIT_CONFIG_COUNT = String(pairs.length);
  pairs.forEach(([key, value], i) => { env[`GIT_CONFIG_KEY_${i}`] = key; env[`GIT_CONFIG_VALUE_${i}`] = value; });
  return env;
}
// run(...args) -> spawnSync result, from the real root with the safe environment.
export function gitRunner(repo, { timeout = 30000, maxBuffer = 64 * 1024 * 1024, literal = true, encoding = 'utf8' } = {}) {
  const { root, bare } = repoLayout(repo);
  const env = safeEnv(root, { bare });
  return (...args) => spawnSync('git', [...(literal ? ['--literal-pathspecs'] : []), '-C', root, ...args], { encoding, timeout, maxBuffer, env });
}

// A bare mirror of the repository's refs in a new temporary directory, built through Git's transport so every object
// is re-hashed and checked for connectivity; the mirror carries none of the clone's config, hooks or caches. Throws if
// the clone fails, as it does for a rewritten object. `cleanup()` removes it.
// Mirrors left by a run that was killed are swept by the next one after an hour. No signal handler is installed: one
// would replace Node's default termination while the CLI runs synchronously, so a stop signal would be ignored.
const STALE = 60 * 60 * 1000;
const mirrors = new Set();
let watching = false;
const removeAll = () => { for (const dir of mirrors) fs.rmSync(dir, { recursive: true, force: true }); mirrors.clear(); };
const sweep = () => {
  try { for (const name of fs.readdirSync(os.tmpdir())) if (name.startsWith('wf-verified-')) { const p = path.join(os.tmpdir(), name); if (Date.now() - fs.statSync(p).mtimeMs > STALE) fs.rmSync(p, { recursive: true, force: true }); } } catch { /* best effort */ }
};
export function verifiedMirror(repo, { timeout = 600000 } = {}) {
  const { root } = repoLayout(repo);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-verified-'));
  const target = path.join(dir, 'mirror.git');
  mirrors.add(dir);
  if (!watching) { watching = true; process.once('exit', removeAll); sweep(); }
  const cleanup = () => { fs.rmSync(dir, { recursive: true, force: true }); mirrors.delete(dir); };
  const r = spawnSync('git', ['clone', '--mirror', '--no-local', '--quiet', '--', root, target], { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, env: safeEnv(dir, { bare: true, protocols: 'file' }) });
  if (r.status !== 0) { cleanup(); throw new Error(`the repository failed verification while being mirrored: ${(r.stderr || r.error?.message || 'git clone failed').trim().split('\n').slice(-2).join(' ')}`); }
  return { path: target, cleanup };
}

// Clean, smudge or process filters configured by the clone itself (local or worktree scope, includes counted where
// they are included); the operator's own global and system filters, such as git-lfs, are theirs to run.
export function cloneFilters(repo) {
  const r = gitRunner(repo, { literal: false })('config', '--show-scope', '-z', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$');
  if (r.status === 1) return []; // no match
  if (r.status !== 0) throw new Error('git cannot read the clone\'s config');
  const fields = r.stdout.split('\0'); // scope NUL key NEWLINE value NUL, repeated
  const found = [];
  for (let i = 0; i + 1 < fields.length; i += 2) if (['local', 'worktree'].includes(fields[i])) found.push(fields[i + 1].split('\n')[0]);
  return found;
}

// One rule, shared by derivation (never derived) and the brief (flagged and shown escaped), for path names that can
// pass for another path: a backslash, control, format or default-ignorable characters, blank-looking symbols, and any
// whitespace other than a single space between two other characters.
export function unsafePath(p) {
  const s = String(p);
  return /[\\⠀ㅤﾠ]/.test(s) || /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(s) || /\p{White_Space}/u.test(s.replace(/(?<=\S) (?=\S)/g, ''));
}
// A path as printable ASCII: a backslash, a backtick and anything outside printable ASCII are escaped, and so is any
// space that is not a single space between two characters, so two different paths never look alike.
export function showPath(p) {
  return String(p).replace(/[^\x21-\x5b\x5d-\x5f\x61-\x7e ]/gu, c => `\\u{${c.codePointAt(0).toString(16)}}`).replace(/^ | $| (?= )/g, '\\u{20}');
}
