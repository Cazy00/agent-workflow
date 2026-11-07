// channel-resolve v2: turns the workflow section of a project's *base* config into the one release that judges its runs.
//
//   in : the base branch's docs/workflow/config.json (never the candidate's), the release identity to trust
//   out: { channel, revision, version }  or a refusal with a reason (nothing falls back to main or to a cache)
//
// The config names either `workflow.revision` (a hold: the full hash, returned as it stands, channel "hold") or
// `workflow.channel`, a marker on a GitHub release of the workflow repository (never a ref that moves):
//   stable[-N]  the release GitHub marks latest, when it is of major N; for an older major, that major's newest
//               published release; for a major newer than the latest release, nothing yet (refused)
//   canary[-N]  the newest published release of major N: the highest vX.Y.Z that is neither a draft nor a prerelease
// `stable` and `canary` without a suffix cover major 2 (BASE_MAJOR); a later major N is `stable-N` / `canary-N`.
// The chosen release must be authored by the release identity. A release keeps its author when its tag is moved or its
// tag name is edited, so the author does not tie it to a commit; three checks do: an active tag ruleset forbids updating,
// deleting and force-pushing `v*` tags (read from the public rulesets API; refused when missing, inactive or unreadable),
// the commit is GitHub's own tag ref (annotated tags dereferenced) and is reachable from `main`, and that commit's
// package.json version equals the tag. A mirror (`gitUrl`) is used only for main's ancestry and to read the commit by its
// hash; the release, the tag's commit and the ruleset always come from the API. The contract changes only on a major
// release (docs/proposals/2026-11-07-central-release-channel.md). This module only reads: it writes nothing but a
// scratch repository it removes.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_API = 'https://api.github.com';
export const BASE_MAJOR = 2;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const CHANNEL = /^(stable|canary)(?:-([1-9]\d*))?$/;
const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const MAX_RULESETS = 5; // tag rulesets read in detail per resolution: bounds the API calls whatever rulesets exist
const TAG_PATTERNS = new Set(['~ALL', 'refs/tags/v*', 'refs/tags/*', 'refs/tags/**/*']); // includes that cover every vX.Y.Z
const TAG_RULES = ['update', 'deletion', 'non_fast_forward'];
const ADMIN_ROLE = 5; // the repository role id GitHub gives "admin" in a ruleset's bypass list

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
const parts = tag => tag.match(TAG).slice(1).map(Number);
const byVersionDesc = (a, b) => { const x = parts(a), y = parts(b); return (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]); };
const isTag = t => typeof t === 'string' && TAG.test(t);
const published = r => r && !r.draft && !r.prerelease && isTag(r.tag_name);

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
  const m = typeof w.channel === 'string' ? w.channel.match(CHANNEL) : null;
  if (!m || (m[2] && Number(m[2]) <= BASE_MAJOR)) refuse(`workflow.channel "${String(w.channel)}" is not a channel: stable or canary (major ${BASE_MAJOR}), or stable-N / canary-N for a later major N`);
  return { kind: 'channel', repo: w.repo, channel: w.channel, marker: m[1], major: m[2] ? Number(m[2]) : BASE_MAJOR };
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

// Refuses unless an active ruleset forbids updating, deleting and force-pushing every vX.Y.Z tag. GitHub shows a
// ruleset's bypass list only to admins; when it is shown, it may hold repository admins and nobody else.
export async function checkTagRuleset({ api, repo, token, fetchImpl }) {
  const list = await getJson({ url: `${api}/repos/${repo}/rulesets?includes_parents=true&per_page=100`, api, token, fetchImpl, what: `the rulesets of ${repo}` });
  if (list.status === 404 || !Array.isArray(list.body)) refuse(`the rulesets of ${repo} are not readable, so its tags cannot be trusted`);
  const why = [];
  for (const summary of list.body.filter(r => r?.target === 'tag' && r.enforcement === 'active').slice(0, MAX_RULESETS)) {
    const one = await getJson({ url: `${api}/repos/${repo}/rulesets/${encodeURIComponent(String(summary.id))}`, api, token, fetchImpl, what: `ruleset ${summary.id}` });
    const r = one.body;
    if (one.status === 404 || r?.target !== 'tag' || r.enforcement !== 'active') { why.push(`ruleset ${summary.id} is not an active tag ruleset`); continue; }
    const include = r.conditions?.ref_name?.include ?? [], exclude = r.conditions?.ref_name?.exclude ?? [];
    if (!include.some(p => TAG_PATTERNS.has(p))) { why.push(`ruleset ${summary.id} does not cover refs/tags/v*`); continue; }
    if (exclude.length) { why.push(`ruleset ${summary.id} excludes ${exclude.join(', ')}`); continue; }
    const types = new Set((r.rules ?? []).map(x => x?.type));
    const missing = TAG_RULES.filter(t => !types.has(t));
    if (missing.length) { why.push(`ruleset ${summary.id} does not forbid ${missing.join(', ')}`); continue; }
    if (Array.isArray(r.bypass_actors)) {
      const other = r.bypass_actors.filter(a => !(a?.actor_type === 'RepositoryRole' && a.actor_id === ADMIN_ROLE) && a?.actor_type !== 'OrganizationAdmin');
      if (other.length) { why.push(`ruleset ${summary.id} lets ${other.map(a => `${a?.actor_type} ${a?.actor_id}`).join(', ')} bypass it`); continue; }
    }
    return;
  }
  refuse(`no active tag ruleset forbids updating, deleting and force-pushing ${repo}'s v* tags${why.length ? `: ${why.join('; ')}` : ''}`);
}

// The release that carries the channel's marker, or a refusal.
async function markedRelease({ api, repo, marker, major, token, fetchImpl }) {
  const ofMajor = r => published(r) && parts(r.tag_name)[0] === major;
  const newestOfMajor = async () => {
    const list = await getJson({ url: `${api}/repos/${repo}/releases?per_page=100`, api, token, fetchImpl, what: `the releases of ${repo}` });
    if (list.status === 404 || !Array.isArray(list.body)) refuse(`the releases of ${repo} are not readable`);
    return list.body.filter(ofMajor).sort((a, b) => byVersionDesc(a.tag_name, b.tag_name))[0] ?? null;
  };
  if (marker === 'canary') return (await newestOfMajor()) ?? refuse(`canary has no published release of major ${major}`);
  const latest = await getJson({ url: `${api}/repos/${repo}/releases/latest`, api, token, fetchImpl, what: `the latest release of ${repo}` });
  if (latest.status === 404) refuse(`${repo} has no release marked latest, so stable has nothing`);
  if (!published(latest.body)) refuse(`the release marked latest (${String(latest.body?.tag_name)}) is not a published vX.Y.Z release`);
  const latestMajor = parts(latest.body.tag_name)[0];
  if (latestMajor === major) return latest.body;
  if (latestMajor < major) refuse(`stable has no release of major ${major} yet: the latest is ${latest.body.tag_name}`);
  return (await newestOfMajor()) ?? refuse(`stable has no published release of major ${major}`);
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
  return obj?.type === 'commit' && typeof obj.sha === 'string' && HASH.test(obj.sha) ? obj.sha : null;
}

// In a scratch clone of main (no blobs until read): whether `commit` is reachable from main, and the version its
// package.json carries. Reading by the exact hash also proves the commit exists under it.
function inspectOnMain({ gitUrl, commit }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-resolve-'));
  const dir = path.join(temp, 'repo');
  try {
    gitOut('fetching main', ['clone', '-q', '--bare', '--filter=blob:none', '--no-tags', '--single-branch', '--branch', 'main', '--', gitUrl, dir]);
    const is = run(['-C', dir, 'merge-base', '--is-ancestor', commit, 'refs/heads/main']);
    if (is.status === 1 || (is.status !== 0 && /not a valid|bad object|no such commit/i.test(is.stderr))) return { onMain: false };
    if (is.error || is.status !== 0) refuse(`checking ${commit.slice(0, 12)} against main failed: ${(is.error?.message ?? is.stderr).trim()}`);
    const text = gitOut(`reading package.json at ${commit.slice(0, 12)}`, ['-C', dir, 'show', `${commit}:package.json`]);
    let version;
    try { version = JSON.parse(text).version; } catch { refuse(`package.json at ${commit.slice(0, 12)} is not valid JSON`); }
    return { onMain: true, version: typeof version === 'string' ? version : null };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

// resolve({config, releaseIdentity, gitUrl?, api?, token?, fetchImpl?}) -> { channel, revision, version }
export async function resolve({ config, releaseIdentity, gitUrl, api = DEFAULT_API, token = '', fetchImpl = globalThis.fetch }) {
  const w = readWorkflow(config);
  if (w.kind === 'hold') return { channel: 'hold', revision: w.revision, version: w.version };
  if (!releaseIdentity) refuse('no release identity is configured, so no release can be trusted');
  if (gitUrl !== undefined && (typeof gitUrl !== 'string' || !gitUrl || gitUrl.startsWith('-'))) refuse('the git URL is not a repository address');
  const io = { api, repo: w.repo, token, fetchImpl };
  const release = await markedRelease({ ...io, marker: w.marker, major: w.major });
  const tag = release.tag_name;
  if (release.author?.login !== releaseIdentity) refuse(`${w.channel} is ${tag}, whose release was made by ${String(release.author?.login)}, not the release identity ${releaseIdentity}`);
  await checkTagRuleset(io);
  const commit = await apiTagCommit({ ...io, tag });
  if (!commit) refuse(`${w.channel} is ${tag}, which has no tag ref on GitHub`);
  const seen = inspectOnMain({ gitUrl: gitUrl ?? `https://github.com/${w.repo}.git`, commit });
  if (!seen.onMain) refuse(`${w.channel} is ${tag} at ${commit.slice(0, 12)}, which is not on main`);
  if (`v${seen.version}` !== tag) refuse(`${w.channel} is ${tag} at ${commit.slice(0, 12)}, whose package.json says ${String(seen.version)}: the tag was moved or the release renamed`);
  return { channel: w.channel, revision: commit, version: tag };
}
