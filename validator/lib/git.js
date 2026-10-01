// Git as the gates read it. The clone the validator reads may be one an agent can write, so nothing in it may change
// what Git reports or make Git run a program:
// - objects as committed: replace refs, grafts and the commit-graph cache are ignored, and a missing object is never
//   fetched lazily from a promisor remote;
// - paths from the work tree's real root: the root is where the `.git` entry is, whatever `core.worktree` says, and
//   `diff.relative` is off;
// - no program from config: signature display (which runs `gpg.program`) and fsmonitor are off;
// - a minimal environment: Git sees no owner signing variables or other secrets of the process that runs the gate.
// Callers also use plumbing (`diff-tree`, `ls-tree --full-tree`) where porcelain would read UI config.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// The operator's own choice of global and system config stays (it is outside any clone); the repository's config is
// read but overridden where it could change an answer.
const KEEP = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM'];
const OVERRIDES = [['core.commitGraph', 'false'], ['diff.relative', 'false'], ['log.showSignature', 'false'], ['core.fsmonitor', 'false'], ['core.untrackedCache', 'false']];

// The directory holding the `.git` entry at or above dir.
export function workTreeRoot(dir) {
  let d = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) return path.resolve(dir);
    d = up;
  }
}
export function safeEnv(root) {
  const env = {};
  for (const k of KEEP) if (process.env[k] !== undefined) env[k] = process.env[k];
  Object.assign(env, { GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_WORK_TREE: root, GIT_CONFIG_COUNT: String(OVERRIDES.length) });
  OVERRIDES.forEach(([key, value], i) => { env[`GIT_CONFIG_KEY_${i}`] = key; env[`GIT_CONFIG_VALUE_${i}`] = value; });
  return env;
}
// run(repo)(...args) -> spawnSync result, from the real root with the safe environment.
export function gitRunner(repo, { timeout = 30000, maxBuffer = 64 * 1024 * 1024, literal = true } = {}) {
  const root = workTreeRoot(repo);
  const env = safeEnv(root);
  return (...args) => spawnSync('git', [...(literal ? ['--literal-pathspecs'] : []), '-C', root, ...args], { encoding: 'utf8', timeout, maxBuffer, env });
}

// One rule, shared by derivation (never derived) and the brief (shown escaped), for path names that can pass for
// another path: a backslash, control, format or default-ignorable characters, and any whitespace other than a single
// space between two other characters.
export function unsafePath(p) {
  return /\\/.test(p) || /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(p) || /\p{White_Space}/u.test(String(p).replace(/(?<=\S) (?=\S)/g, ''));
}
// A path as printable ASCII: anything else, and a space that is not a single space between two characters, is escaped.
export function showPath(p) {
  return String(p).replace(/[^\x21-\x7e ]/gu, c => `\\u{${c.codePointAt(0).toString(16)}}`).replace(/^ | $| (?= )/g, '\\u{20}');
}
