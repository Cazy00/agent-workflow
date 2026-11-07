// channel-resolve v1: turns the workflow section of a project's *base* config into the one release that judges its runs.
//
//   in : the base branch's docs/workflow/config.json (never the candidate's), the release identity to trust
//   out: { channel, revision, version }  or a refusal with a reason (nothing falls back to main or to a cache)
//
// The config names either `workflow.revision` (a hold: the full hash, returned as it stands, channel "hold") or
// `workflow.channel` (a branch `channel/<name>` in the workflow repository). A channel resolves only when, at the
// commit the branch points at: a tag `vX.Y.Z` exists, that tag's GitHub release exists, is published and was made by
// the release identity, GitHub's own ref for that tag points at that same commit (so a moved tag does not inherit the
// release, and a mirror cannot map a tag elsewhere), and the commit is reachable from `main`. A mirror (`gitUrl`) is
// trusted only for where the channel branch points and for main's ancestry; tags are always checked against the API. The contract changes only on a major release
// (docs/proposals/2026-11-07-central-release-channel.md). This module only reads: it writes nothing but a scratch
// repository it removes.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_API = 'https://api.github.com';
const REPO = /^[\w.-]+\/[\w.-]+$/;
const MAX_TAGS = 5; // release candidates checked per resolution, highest first: bounds the API calls whatever tags exist
const CHANNEL = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

// The token for the API: GITHUB_TOKEN, else GH_TOKEN (an empty one counts as unset).
export const pickToken = (env = process.env) => env.GITHUB_TOKEN || env.GH_TOKEN || '';

export class ResolveError extends Error {}
const refuse = message => { throw new ResolveError(message); };

const run = (args, { cwd, env } = {}) => spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 180000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...env } });
const gitOut = (what, args, opts) => {
  const r = run(args, opts);
  if (r.error || r.status !== 0) refuse(`${what} failed: ${(r.error?.message ?? r.stderr).trim().split('\n').pop()}`);
  return r.stdout;
};
const byVersionDesc = (a, b) => { const x = a.match(TAG).slice(1).map(Number), y = b.match(TAG).slice(1).map(Number); return (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]); };

// The workflow section of the config -> { kind: 'hold' | 'channel', ... }, or a refusal.
export function readWorkflow(config) {
  const w = config?.workflow;
  if (!w || typeof w !== 'object') refuse('the base config has no workflow section');
  if (typeof w.repo !== 'string' || !REPO.test(w.repo) || w.repo.split('/').some(part => part === '.' || part === '..')) refuse('the base config needs workflow.repo as owner/name');
  const hasChannel = w.channel !== undefined && w.channel !== null && w.channel !== '';
  const hasRevision = w.revision !== undefined && w.revision !== null && w.revision !== '';
  if (hasChannel && hasRevision) refuse('the base config sets both workflow.channel and workflow.revision; it names one');
  if (!hasChannel && !hasRevision) refuse('the base config names neither workflow.channel nor a full workflow.revision');
  if (hasRevision) {
    if (typeof w.revision !== 'string' || !HASH.test(w.revision)) refuse('workflow.revision is not a full hash');
    return { kind: 'hold', repo: w.repo, revision: w.revision, version: typeof w.version === 'string' && w.version ? w.version : null };
  }
  if (typeof w.channel !== 'string' || !CHANNEL.test(w.channel) || w.channel === 'hold') refuse(`workflow.channel "${String(w.channel)}" is not a channel name (lowercase letters, digits and single hyphens)`);
  return { kind: 'channel', repo: w.repo, channel: w.channel };
}

// One GET of the API as JSON: { status, body }. Only a read; the token goes to GitHub itself, never to a mirror or a test server.
async function getJson({ url, api, token, fetchImpl, what }) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'agent-workflow-wf-resolve', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token && api === DEFAULT_API) headers.Authorization = `Bearer ${token}`;
  let res;
  try { res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30000) }); }
  catch (e) { refuse(`could not read ${what}: ${e.message}`); }
  if (res.status === 404) return { status: 404 };
  if (!res.ok) refuse(`could not read ${what}: HTTP ${res.status}`);
  try { return { status: 200, body: await res.json() }; } catch { refuse(`${what} is not readable JSON`); }
}

// The commit GitHub says the tag points at: its ref, then (for an annotated tag) the tag objects down to a commit.
async function apiTagCommit({ api, repo, tag, token, fetchImpl }) {
  const base = `${api}/repos/${repo}/git`;
  const ref = await getJson({ url: `${base}/ref/tags/${encodeURIComponent(tag)}`, api, token, fetchImpl, what: `the ref of ${tag}` });
  if (ref.status === 404 || ref.body?.ref !== `refs/tags/${tag}`) return null;
  let obj = ref.body.object;
  for (let depth = 0; obj?.type === 'tag' && depth < 5; depth++) {
    const next = await getJson({ url: `${base}/tags/${encodeURIComponent(String(obj.sha))}`, api, token, fetchImpl, what: `the tag object of ${tag}` });
    if (next.status === 404) return null;
    obj = next.body?.object;
  }
  return obj?.type === 'commit' && typeof obj.sha === 'string' ? obj.sha : null;
}

// What a release must be: published (not a draft or prerelease), for this tag, made by the release identity, and the tag
// must be at `commit` on GitHub itself. Returns null when it is, else the reason it is not.
async function checkRelease({ api, repo, tag, commit, identity, token, fetchImpl }) {
  const rel = await getJson({ url: `${api}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, api, token, fetchImpl, what: `the release of ${tag}` });
  if (rel.status === 404) return `${tag} has no GitHub release`;
  const release = rel.body;
  if (release?.tag_name !== tag) return `the release found for ${tag} is for ${String(release?.tag_name)}`;
  if (release.draft || release.prerelease) return `the release of ${tag} is a ${release.draft ? 'draft' : 'prerelease'}`;
  if (release.author?.login !== identity) return `the release of ${tag} was made by ${String(release.author?.login)}, not the release identity ${identity}`;
  const onApi = await apiTagCommit({ api, repo, tag, token, fetchImpl });
  if (!onApi) return `${tag} has no tag ref on the API`;
  if (onApi !== commit) return `${tag} points at ${onApi.slice(0, 12)} on the API, not at the channel commit ${commit.slice(0, 12)}`;
  return null;
}

// Whether `commit` is reachable from main, checked in a scratch repository that also proves the commit exists under that
// exact hash (the same check wf-ci.yml makes when it fetches a pin).
function checkOnMain({ gitUrl, channel, commit }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-resolve-'));
  try {
    gitOut('creating the scratch repository', ['init', '-q', '--bare', dir]);
    gitOut('fetching main and the channel', ['-C', dir, 'fetch', '-q', '--no-tags', '--filter=blob:none', '--', gitUrl, '+refs/heads/main:refs/heads/main', `+refs/heads/channel/${channel}:refs/heads/channel`]);
    const have = gitOut('reading the fetched channel', ['-C', dir, 'rev-parse', '--verify', '-q', 'refs/heads/channel^{commit}']).trim();
    if (have !== commit) refuse(`channel/${channel} moved while it was being resolved (${commit.slice(0, 12)} then ${have.slice(0, 12)}); run again`);
    const is = run(['-C', dir, 'merge-base', '--is-ancestor', commit, 'refs/heads/main']);
    if (is.status === 1) return false;
    if (is.error || is.status !== 0) refuse(`checking ${commit.slice(0, 12)} against main failed: ${(is.error?.message ?? is.stderr).trim()}`);
    return true;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// resolve({config, releaseIdentity, gitUrl?, api?, token?, fetchImpl?}) -> { channel, revision, version }
export async function resolve({ config, releaseIdentity, gitUrl, api = DEFAULT_API, token = '', fetchImpl = globalThis.fetch }) {
  const w = readWorkflow(config);
  if (w.kind === 'hold') return { channel: 'hold', revision: w.revision, version: w.version };
  if (!releaseIdentity) refuse('no release identity is configured, so no release can be trusted');
  const url = gitUrl ?? `https://github.com/${w.repo}.git`;
  const ref = `refs/heads/channel/${w.channel}`;
  const refs = new Map();
  for (const line of gitOut('listing the workflow repository', ['ls-remote', '--', url, ref, 'refs/tags/v*']).split('\n')) {
    const [hash, name] = line.split('\t');
    if (hash && name) refs.set(name, hash);
  }
  const commit = refs.get(ref);
  if (!commit) refuse(`the workflow repository has no channel/${w.channel}`);
  if (!HASH.test(commit)) refuse(`channel/${w.channel} points at "${commit}", not a commit hash`);
  // An annotated tag lists its commit on the peeled `^{}` line; a lightweight tag lists it directly.
  const tags = [];
  for (const [name, hash] of refs) {
    const m = name.match(/^refs\/tags\/(v\d+\.\d+\.\d+)(\^\{\})?$/);
    if (m && !m[2] && (refs.get(`${name}^{}`) ?? hash) === commit) tags.push(m[1]);
  }
  if (!tags.length) refuse(`channel/${w.channel} (${commit.slice(0, 12)}) is not at any release tag vX.Y.Z`);
  const why = [];
  let version = null;
  const sorted = tags.sort(byVersionDesc);
  for (const tag of sorted.slice(0, MAX_TAGS)) {
    const problem = await checkRelease({ api, repo: w.repo, tag, commit, identity: releaseIdentity, token, fetchImpl });
    if (!problem) { version = tag; break; }
    why.push(problem);
  }
  if (!version) refuse(`channel/${w.channel} (${commit.slice(0, 12)}) has no release made by the release identity: ${why.join('; ')}${sorted.length > MAX_TAGS ? `; ${sorted.length - MAX_TAGS} lower tags were not checked` : ''}`);
  if (!checkOnMain({ gitUrl: url, channel: w.channel, commit })) refuse(`channel/${w.channel} (${commit.slice(0, 12)}, ${version}) is not on main`);
  return { channel: w.channel, revision: commit, version };
}
