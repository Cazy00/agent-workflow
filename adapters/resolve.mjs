// channel-resolve v3: turns the workflow section of a project's *base* config into the one release that judges its runs.
//
//   in : the base branch's docs/workflow/config.json (never the candidate's): workflow.repo, and either workflow.revision
//        (a hold) or workflow.channel with workflow.channel_key (the public key, or keys, that sign channel records)
//   out: { channel, revision, version, seq, expires_at }, or for a hold { channel: 'hold', revision, version: null,
//        declared_version }; otherwise a refusal with a reason (nothing falls back to main, to a marker or to a cache)
//
// The trust root is a SIGNED CHANNEL RECORD, not GitHub state. Anyone with write access to the workflow repository can
// create tags, mark releases latest or prerelease, and edit or delete release assets, and a ruleset's bypass list is
// invisible without admin rights, so none of that can say which release judges a project (review of #96, F1-F4). A key
// that only the release broker holds signs, per channel, the record
//   { v: 1, channel, major, tag, revision, version, seq, issued_at, expires_at }
// published with its detached signature as `channel-<name>.json` and `channel-<name>.json.sig` (base64 of the 64-byte
// Ed25519 signature over the file's exact bytes) on the workflow repository's fixed release `channels`. GitHub only
// stores them. The resolver refuses a bad signature (under every configured key), a record of another channel or major,
// a record that is not yet issued, expired, or valid for more than 72 hours, a revision that is not on main, a tag whose
// commit is not that revision, and a commit whose package.json version is not the record's. Tags, markers and assets are
// storage: changing them can make resolution fail (closed), never choose another revision.
//
// Accepted residual risk: the resolver is stateless, so a replayed older record that is still unexpired (at most 72 hours
// old) verifies. Within one run it reads each record once; a caller that knows a floor (the seq of its last `wf resolved`
// record) passes it as `minSeq`, and an older record is then refused.
//
// The contract changes only on a major release (docs/proposals/2026-11-07-central-release-channel.md). This module only
// reads: it writes nothing but a scratch repository it removes.
import { spawnSync } from 'node:child_process';
import { createPublicKey, verify as verifySignature } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BASE_MAJOR = 2;
export const CHANNEL_RELEASE = 'channels'; // the fixed release whose assets store the records
export const MAX_VALIDITY_MS = 72 * 3600 * 1000;
const SKEW_MS = 5 * 60 * 1000; // a record issued up to 5 minutes "in the future" is clock skew, not a forgery
const MAX_BYTES = 8192;
const MAX_KEYS = 4;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const CHANNEL = /^(stable|canary)(?:-([1-9]\d*))?$/;
const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const KEY = /^ed25519:([A-Za-z0-9+/]{43}=)$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;
const RECORD_KEYS = ['v', 'channel', 'major', 'tag', 'revision', 'version', 'seq', 'issued_at', 'expires_at'];

export class ResolveError extends Error {}
const refuse = message => { throw new ResolveError(message); };

// git runs with a clean environment: none of the caller's GIT_* variables (GIT_DIR, GIT_WORK_TREE, GIT_OBJECT_DIRECTORY,
// GIT_ALTERNATE_OBJECT_DIRECTORIES, GIT_CONFIG_*, ...) can point it at another repository or change its configuration.
// Kept: PATH, HOME and what git needs to reach an HTTPS remote (certificates, proxies).
const KEEP_ENV = /^(?:PATH|HOME|USER|LOGNAME|TMPDIR|TMP|TEMP|SYSTEMROOT|XDG_CONFIG_HOME|SSL_CERT_FILE|SSL_CERT_DIR|CURL_CA_BUNDLE|(?:ALL|HTTPS?|NO)_PROXY)$/i;
export const gitEnv = (source = process.env) => {
  const env = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined && KEEP_ENV.test(k)) env[k] = v;
  return { ...env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
};
export const run = (args, { cwd } = {}) => spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 180000, env: gitEnv() });
const gitOut = (what, args) => {
  const r = run(args);
  if (r.error || r.status !== 0) refuse(`${what} failed: ${(r.error?.message ?? r.stderr).trim().split('\n').pop()}`);
  return r.stdout;
};
const present = v => v !== undefined && v !== null && v !== '';

// `ed25519:<base64 of the 32-byte raw public key>` -> a KeyObject, or a refusal.
export function parseKey(text) {
  const m = typeof text === 'string' ? text.match(KEY) : null;
  const raw = m ? Buffer.from(m[1], 'base64') : null;
  if (!raw || raw.length !== 32) refuse(`workflow.channel_key "${String(text)}" is not ed25519:<base64 of a 32-byte public key>`);
  try { return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' }); }
  catch { refuse(`workflow.channel_key "${text}" is not an Ed25519 public key`); }
}

// The workflow section of the config -> { kind: 'hold' | 'channel', ... }, or a refusal.
export function readWorkflow(config) {
  const w = config?.workflow;
  if (!w || typeof w !== 'object') refuse('the base config has no workflow section');
  if (typeof w.repo !== 'string' || !REPO.test(w.repo) || w.repo.split('/').some(part => part === '.' || part === '..')) refuse('the base config needs workflow.repo as owner/name');
  const hasChannel = present(w.channel), hasRevision = present(w.revision);
  if (hasChannel && hasRevision) refuse('the base config sets both workflow.channel and workflow.revision; it names one');
  if (!hasChannel && !hasRevision) refuse('the base config names neither workflow.channel nor a full workflow.revision');
  if (hasRevision) {
    if (typeof w.revision !== 'string' || !HASH.test(w.revision)) refuse('workflow.revision is not a full hash');
    // The version beside a hold is what the config declares; nothing here checks it against the revision.
    return { kind: 'hold', repo: w.repo, revision: w.revision, declaredVersion: typeof w.version === 'string' && w.version ? w.version : null };
  }
  const m = typeof w.channel === 'string' ? w.channel.match(CHANNEL) : null;
  if (!m || (m[2] && Number(m[2]) <= BASE_MAJOR)) refuse(`workflow.channel "${String(w.channel)}" is not a channel: stable or canary (major ${BASE_MAJOR}), or stable-N / canary-N for a later major N`);
  const listed = Array.isArray(w.channel_key) ? w.channel_key : present(w.channel_key) ? [w.channel_key] : [];
  if (!listed.length) refuse('a channel needs workflow.channel_key, the public key that signs channel records, in the base config');
  if (listed.length > MAX_KEYS) refuse(`workflow.channel_key lists more than ${MAX_KEYS} keys`);
  return { kind: 'channel', repo: w.repo, channel: w.channel, major: m[2] ? Number(m[2]) : BASE_MAJOR, keys: listed.map(parseKey) };
}

// The default record source: the assets of the fixed release, downloaded without a token (public repository; the
// download host is not the API, so no API rate limit applies). Returns the asset's bytes, or null when it is missing.
export function githubRecords(repo, fetchImpl = globalThis.fetch) {
  return async name => {
    const url = `https://github.com/${repo}/releases/download/${CHANNEL_RELEASE}/${encodeURIComponent(name)}`;
    let res;
    try { res = await fetchImpl(url, { headers: { 'User-Agent': 'agent-workflow-wf-resolve' }, redirect: 'follow', signal: AbortSignal.timeout(30000) }); }
    catch (e) { refuse(`could not read ${name}: ${e.message}`); }
    if (res.status === 404) { await res.body?.cancel?.().catch(() => {}); return null; }
    if (!res.ok) { await res.body?.cancel?.().catch(() => {}); refuse(`could not read ${name}: HTTP ${res.status}`); }
    // The body is counted as it arrives and dropped past the cap: an oversized asset is never held in memory, and a
    // failure while reading it (reset, timeout) is a fetch failure with its real reason.
    const declared = Number(res.headers?.get?.('content-length'));
    if (declared > MAX_BYTES) { await res.body?.cancel?.().catch(() => {}); refuse(`${name} is larger than ${MAX_BYTES} bytes`); }
    const chunks = [];
    let size = 0;
    try {
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) { await reader.cancel().catch(() => {}); refuse(`${name} is larger than ${MAX_BYTES} bytes`); }
          chunks.push(value);
        }
      }
    } catch (e) {
      if (e instanceof ResolveError) throw e;
      refuse(`could not read ${name}: ${e.message}`);
    }
    return Buffer.concat(chunks);
  };
}

// Reads the record and its signature; true when one of the keys verifies them.
async function readSigned(readRecord, name, keys) {
  const body = await readRecord(name), sigText = await readRecord(`${name}.sig`);
  if (!body || !sigText) return { missing: true };
  if (body.length > MAX_BYTES || sigText.length > MAX_BYTES) refuse(`${name} or its signature is larger than ${MAX_BYTES} bytes`);
  const sig = Buffer.from(sigText.toString('utf8').trim(), 'base64');
  const ok = sig.length === 64 && keys.some(key => verifySignature(null, body, key, sig));
  return { body, ok };
}

// The checks on a verified record's content, or a refusal.
export function checkRecord(record, { channel, major, now, minSeq }) {
  const name = `channel-${channel}.json`;
  if (!record || typeof record !== 'object' || Array.isArray(record)) refuse(`${name} is not a JSON object`);
  const keys = Object.keys(record).sort();
  if (record.v !== 1) refuse(`${name} has record format ${JSON.stringify(record.v)}; this resolver reads format 1`);
  if (keys.join() !== [...RECORD_KEYS].sort().join()) refuse(`${name} must have exactly the fields ${RECORD_KEYS.join(', ')}`);
  if (record.channel !== channel) refuse(`${name} is signed for channel ${JSON.stringify(record.channel)}, not ${channel}`);
  if (record.major !== major) refuse(`${name} is signed for major ${JSON.stringify(record.major)}, not ${major}`);
  const t = typeof record.tag === 'string' ? record.tag.match(TAG) : null;
  if (!t) refuse(`${name} names tag ${JSON.stringify(record.tag)}, not a vX.Y.Z tag`);
  if (Number(t[1]) !== major) refuse(`${name} names ${record.tag}, which is not of major ${major}`);
  if (record.version !== record.tag.slice(1)) refuse(`${name} names tag ${record.tag} with version ${JSON.stringify(record.version)}`);
  if (typeof record.revision !== 'string' || !HASH.test(record.revision)) refuse(`${name} names no full revision`);
  if (!Number.isSafeInteger(record.seq) || record.seq < 1) refuse(`${name} has no positive integer seq`);
  const issued = ISO.test(record.issued_at ?? '') ? Date.parse(record.issued_at) : NaN;
  const expires = ISO.test(record.expires_at ?? '') ? Date.parse(record.expires_at) : NaN;
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) refuse(`${name} needs issued_at and expires_at as UTC ISO times`);
  if (expires <= issued || expires - issued > MAX_VALIDITY_MS) refuse(`${name} is valid from ${record.issued_at} to ${record.expires_at}: more than 72 hours, or not at all`);
  if (issued > now + SKEW_MS) refuse(`${name} is issued at ${record.issued_at}, in the future`);
  if (now >= expires) refuse(`${name} expired at ${record.expires_at}; the broker re-signs it at least daily`);
  if (minSeq !== undefined && record.seq < minSeq) refuse(`${name} has seq ${record.seq}, older than the floor ${minSeq}: a replayed record`);
  return record;
}

// In a scratch clone of main (no blobs until read): whether `commit` is reachable from main, the commit the repository's
// tag points at, and the version the commit's package.json carries. Reading by the exact hash also proves it exists.
function inspect({ gitUrl, commit, tag }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-resolve-'));
  const dir = path.join(temp, 'repo');
  try {
    gitOut('fetching main', ['clone', '-q', '--bare', '--filter=blob:none', '--no-tags', '--single-branch', '--branch', 'main', '--', gitUrl, dir]);
    const got = run(['-C', dir, 'fetch', '-q', '--no-tags', '--filter=blob:none', 'origin', `+refs/tags/${tag}:refs/tags/${tag}`]);
    // Only "the remote has no such tag" means the tag does not exist; any other failure is a failed fetch.
    if (got.error || (got.status !== 0 && !/couldn't find remote ref/i.test(got.stderr))) refuse(`fetching tag ${tag} failed: ${(got.error?.message ?? got.stderr).trim().split('\n').pop()}`);
    const tagged = got.status === 0 ? run(['-C', dir, 'rev-parse', '--verify', '-q', `refs/tags/${tag}^{commit}`]).stdout.trim() : '';
    const is = run(['-C', dir, 'merge-base', '--is-ancestor', commit, 'refs/heads/main']);
    if (is.status === 1 || (is.status !== 0 && /not a valid|bad object|no such commit/i.test(is.stderr))) return { onMain: false, tagged };
    if (is.error || is.status !== 0) refuse(`checking ${commit.slice(0, 12)} against main failed: ${(is.error?.message ?? is.stderr).trim()}`);
    const text = gitOut(`reading package.json at ${commit.slice(0, 12)}`, ['-C', dir, 'show', `${commit}:package.json`]);
    let version;
    try { version = JSON.parse(text).version; } catch { refuse(`package.json at ${commit.slice(0, 12)} is not valid JSON`); }
    return { onMain: true, tagged, version: typeof version === 'string' ? version : null };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

// resolve({config, readRecord?, gitUrl?, now?, minSeq?, retryMs?}) -> the resolution, or a ResolveError.
// readRecord(name) -> Buffer | null stands in for the release assets (tests, mirrors); gitUrl for the repository.
export async function resolve({ config, readRecord, gitUrl, now = Date.now(), minSeq, retryMs = 3000 }) {
  const w = readWorkflow(config);
  if (w.kind === 'hold') return { channel: 'hold', revision: w.revision, version: null, declared_version: w.declaredVersion };
  if (gitUrl !== undefined && (typeof gitUrl !== 'string' || !gitUrl || gitUrl.startsWith('-'))) refuse('the git URL is not a repository address');
  if (minSeq !== undefined && (!Number.isSafeInteger(minSeq) || minSeq < 1)) refuse('the seq floor is not a positive integer');
  const name = `channel-${w.channel}.json`;
  const read = readRecord ?? githubRecords(w.repo);
  // The broker replaces the record and its signature one after the other, so a reader can catch the pair mid-swap:
  // read once more after a pause before refusing. A forgery fails both reads.
  let got = await readSigned(read, name, w.keys);
  if (got.missing || !got.ok) { if (retryMs) await new Promise(ok => setTimeout(ok, retryMs)); got = await readSigned(read, name, w.keys); }
  if (got.missing) refuse(`${name} or its signature is missing from the ${CHANNEL_RELEASE} release of ${w.repo}`);
  if (!got.ok) refuse(`${name} is not signed by workflow.channel_key`);
  let record;
  try { record = JSON.parse(got.body.toString('utf8')); } catch { refuse(`${name} is not valid JSON`); }
  checkRecord(record, { channel: w.channel, major: w.major, now, minSeq });
  const { tag, revision } = record;
  const seen = inspect({ gitUrl: gitUrl ?? `https://github.com/${w.repo}.git`, commit: revision, tag });
  if (!seen.onMain) refuse(`${w.channel} is ${tag} at ${revision.slice(0, 12)}, which is not on main`);
  if (seen.tagged !== revision) refuse(`${w.channel} is ${tag} at ${revision.slice(0, 12)}, but the tag ${seen.tagged ? `points at ${seen.tagged.slice(0, 12)}` : 'does not exist'}`);
  if (seen.version !== record.version) refuse(`${w.channel} is ${tag} at ${revision.slice(0, 12)}, whose package.json says ${String(seen.version)}`);
  return { channel: w.channel, revision, version: tag, seq: record.seq, expires_at: record.expires_at };
}
