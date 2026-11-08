// channel-install v1: one per-user installation of the workflow, read by every session instead of a copy per project
// (docs/proposals/2026-11-07-central-release-channel.md, *Procedures and skills from one installation*).
//
//   layout under ROOT (default ${XDG_DATA_HOME:-~/.local/share}/agent-workflow):
//     revisions/<hash>/       one verified revision's tree, made read-only; never changed after it is written
//     channels/<name>         a symlink to ../revisions/<hash>, replaced atomically (a new link renamed over the old)
//     channels/<name>.json    the resolution that chose it (channel, revision, version, seq, expires_at, installed_at)
//     uses/<hash>             touched when a session starts on the revision, and when it is installed
//
//   install({root, channel, keys, repo}) : resolve (channel-resolve v3) -> extract the verified commit -> switch the pointer
//   install({root, revision, repo})      : a hold, installed at its full hash; no pointer
//   use({root, name})                    : a session's start: the revision directory it reads to its end, and a use mark
//   prune({root, days})                  : removes a revision no pointer names and no session used in the last `days`
//
// A session resolves the pointer once (use) and keeps that directory, so a later switch never mixes two releases into
// one task. Nothing here signs, tags or moves a channel; the resolver is the only judge of which revision a channel is.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolve, run, ResolveError } from './resolve.mjs';

const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const NAME = /^(stable|canary)(?:-[1-9]\d*)?$/;
const DAY_MS = 24 * 3600 * 1000;
export class InstallError extends Error {}
const refuse = message => { throw new InstallError(message); };

export const defaultRoot = (env = process.env) => path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'agent-workflow');
const dirs = root => ({ revisions: path.join(root, 'revisions'), channels: path.join(root, 'channels'), uses: path.join(root, 'uses') });

function mark(root, revision, now) {
  const { uses } = dirs(root);
  fs.mkdirSync(uses, { recursive: true });
  const file = path.join(uses, revision);
  fs.closeSync(fs.openSync(file, 'a'));
  const t = new Date(now);
  fs.utimesSync(file, t, t);
}

function walk(dir, fn) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, fn);
    fn(p, e);
  }
}
const readOnly = dir => { walk(dir, (p, e) => { if (!e.isSymbolicLink()) fs.chmodSync(p, fs.statSync(p).mode & ~0o222); }); fs.chmodSync(dir, fs.statSync(dir).mode & ~0o222); };
const writable = dir => { fs.chmodSync(dir, fs.statSync(dir).mode | 0o200); walk(dir, (p, e) => { if (e.isDirectory()) fs.chmodSync(p, fs.statSync(p).mode | 0o200); }); };

// Extracts `revision` from the repository's main into revisions/<revision>, once; an existing directory is kept as is.
function extract({ root, revision, gitUrl }) {
  const { revisions } = dirs(root);
  const target = path.join(revisions, revision);
  if (fs.existsSync(target)) return { target, fresh: false };
  fs.mkdirSync(revisions, { recursive: true });
  const temp = fs.mkdtempSync(path.join(revisions, `.incoming-${revision.slice(0, 12)}-`));
  const repo = path.join(os.tmpdir(), `wf-install-${process.pid}-${Date.now()}`);
  try {
    const git = (what, args) => { const r = run(args); if (r.error || r.status !== 0) refuse(`${what} failed: ${(r.error?.message ?? r.stderr).trim().split('\n').pop()}`); return r; };
    git('fetching main', ['clone', '-q', '--bare', '--no-tags', '--single-branch', '--branch', 'main', '--', gitUrl, repo]);
    // Only a revision on main is installed: a hold names a released revision, and a channel's was checked on main already.
    const on = run(['-C', repo, 'merge-base', '--is-ancestor', revision, 'refs/heads/main']);
    if (on.status !== 0) refuse(`${revision.slice(0, 12)} is not on main of ${gitUrl}`);
    const tar = path.join(temp, '.tree.tar');
    git(`extracting ${revision.slice(0, 12)}`, ['-C', repo, 'archive', '--format=tar', '-o', tar, revision]);
    const x = spawnTar(tar, temp);
    if (x.status !== 0) refuse(`unpacking ${revision.slice(0, 12)} failed: ${x.stderr.trim()}`);
    fs.rmSync(tar);
    readOnly(temp);
    try { fs.renameSync(temp, target); }
    catch (e) { if (fs.existsSync(target)) { writable(temp); fs.rmSync(temp, { recursive: true, force: true }); return { target, fresh: false }; } throw e; }
    return { target, fresh: true };
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    if (fs.existsSync(temp)) { writable(temp); fs.rmSync(temp, { recursive: true, force: true }); }
  }
}
const spawnTar = (tar, dir) => spawnSync('tar', ['-x', '-f', tar, '-C', dir], { encoding: 'utf8' });

// Switches channels/<name> to revisions/<revision> atomically, with its resolution beside it.
function point({ root, name, revision, resolution }) {
  const { channels } = dirs(root);
  fs.mkdirSync(channels, { recursive: true });
  const tmp = path.join(channels, `.${name}.${process.pid}.${Date.now()}`);
  fs.writeFileSync(`${tmp}.json`, `${JSON.stringify(resolution, null, 2)}\n`);
  fs.renameSync(`${tmp}.json`, path.join(channels, `${name}.json`));
  fs.symlinkSync(path.join('..', 'revisions', revision), tmp);
  fs.renameSync(tmp, path.join(channels, name));
}

export async function install({ root = defaultRoot(), channel, keys, revision, repo = 'Cazy00/agent-workflow', gitUrl, readRecord, minSeq, now = Date.now(), retryMs }) {
  if (Boolean(channel) === Boolean(revision)) refuse('give exactly one of a channel and a revision');
  const url = gitUrl ?? `https://github.com/${repo}.git`;
  if (revision) {
    if (!HASH.test(revision)) refuse(`${revision} is not a full revision hash`);
    const { target, fresh } = extract({ root, revision, gitUrl: url });
    mark(root, revision, now);
    return { channel: 'hold', revision, dir: target, fresh };
  }
  if (!NAME.test(channel)) refuse(`${channel} is not a channel: stable, canary, stable-N or canary-N`);
  if (!keys?.length) refuse('a channel needs --key, the public key that signs its records');
  let resolved;
  try { resolved = await resolve({ config: { workflow: { repo, channel, channel_key: keys } }, readRecord, gitUrl, minSeq, now, retryMs }); }
  catch (e) { if (e instanceof ResolveError) refuse(`resolving ${channel}: ${e.message}`); throw e; }
  const { target, fresh } = extract({ root, revision: resolved.revision, gitUrl: url });
  mark(root, resolved.revision, now);
  const { channels } = dirs(root);
  let previous = null;
  try { previous = path.basename(fs.readlinkSync(path.join(channels, channel))); } catch { /* first install */ }
  point({ root, name: channel, revision: resolved.revision, resolution: { ...resolved, installed_at: new Date(now).toISOString() } });
  return { ...resolved, dir: target, fresh, previous: previous === resolved.revision ? null : previous };
}

// A session's start: the directory it reads to its end. NAME is a channel (its pointer, read once) or a hold's hash.
export function use({ root = defaultRoot(), name, now = Date.now() }) {
  const { revisions, channels } = dirs(root);
  let revision;
  if (HASH.test(name)) revision = name;
  else if (NAME.test(name)) {
    try { revision = path.basename(fs.readlinkSync(path.join(channels, name))); }
    catch { refuse(`channel ${name} is not installed under ${root}: run wf-install --channel ${name} first`); }
  } else refuse(`${name} is neither a channel nor a full revision hash`);
  const dir = path.join(revisions, revision);
  if (!HASH.test(revision) || !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) refuse(`revision ${revision.slice(0, 12)} is not installed under ${root}`);
  mark(root, revision, now);
  return { name, revision, dir };
}

// Removes each revision that no channel pointer names and that no session used (or install wrote) in the last `days`.
export function prune({ root = defaultRoot(), days = 7, now = Date.now() }) {
  const { revisions, channels, uses } = dirs(root);
  if (!fs.existsSync(revisions)) return { removed: [], kept: [] };
  const pointed = new Set();
  for (const e of fs.existsSync(channels) ? fs.readdirSync(channels, { withFileTypes: true }) : []) {
    if (e.isSymbolicLink()) pointed.add(path.basename(fs.readlinkSync(path.join(channels, e.name))));
  }
  const removed = [], kept = [];
  for (const e of fs.readdirSync(revisions, { withFileTypes: true })) {
    if (!e.isDirectory() || !HASH.test(e.name)) continue;
    const used = fs.statSync(path.join(uses, e.name), { throwIfNoEntry: false })?.mtimeMs ?? 0;
    if (pointed.has(e.name) || now - used < days * DAY_MS) { kept.push(e.name); continue; }
    const dir = path.join(revisions, e.name);
    writable(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.join(uses, e.name), { force: true });
    removed.push(e.name);
  }
  return { removed, kept };
}
