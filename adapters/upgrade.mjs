// Moving an adopted project to another workflow release (bin/wf-upgrade, MAINT-0011). It moves the pin, removes what the
// releases in between no longer read (config keys and files listed in a released upgrades.json), refreshes the workflow
// files the scaffold installed where the project has not changed them, and lists the manual steps each release names.
// It reads everything shared from the workflow repository's Git objects, never from a working tree, and only from
// released revisions or the target itself, so a local, unreleased commit never changes what is done to a project. It
// never commits, pushes or approves: the result is a workflow change that goes through a pull request.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { LEGACY_LAUNCHERS, sha256 } from './launcher.mjs';
import { IN_PROGRESS, validateWorkflowConfig } from '../validator/lib/records.js';
import { resolve } from './resolve.mjs';

const SHA = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
// Files the scaffold installs from a template, and how it fills them in.
export const INSTALLED = [
  { path: '.github/workflows/wf-ci.yml', template: 'templates/github/wf-ci.yml', branch: true },
  { path: '.github/workflows/wf-status.yml', template: 'templates/github/wf-status.yml', branch: true },
  { path: '.github/workflows/wf-client-page.yml', template: 'templates/github/wf-client-page.yml', branch: true },
  { path: '.claude/agents/independent-reviewer.md', template: 'templates/claude/agents/independent-reviewer.md' },
  { path: '.claude/agents/trial-walker.md', template: 'templates/claude/agents/trial-walker.md' },
  // MAINT-0018: the launcher, a template since v2.6.0; `legacy` holds the copies releases before that wrote (lib: adapters/launcher.mjs).
  { path: 'scripts/wf', template: 'templates/scripts/wf', mode: 0o755, legacy: LEGACY_LAUNCHERS },
];

export const parseVersion = v => (String(v ?? '').match(/^v?(\d+)\.(\d+)\.(\d+)$/) ?? []).slice(1).map(Number);
export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  if (x.length !== 3 || y.length !== 3) throw new Error(`cannot compare versions ${a} and ${b}`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

const git = (repo, args, allowFailure = false) => {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
  if (r.status !== 0 && !allowFailure) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.error?.message || '').trim()}`);
  return r;
};
const show = (repo, rev, file) => { const r = git(repo, ['show', `${rev}:${file}`], true); return r.status === 0 ? r.stdout : null; };
// Release tags, newest first by version number (git's own sort reads the `v` as a character).
const releaseTags = (repo, ...args) => git(repo, ['tag', ...args], true).stdout.split('\n').filter(t => parseVersion(t).length === 3).sort((a, b) => compareVersions(b, a));

// The release a revision is: its exact tag; between tags, for a target, the version its package.json is heading for (so
// that release's steps apply), and for a pin, the last release it contains (so the next release's steps still apply).
function releaseOf(repo, rev, { pin = false } = {}) {
  const tag = git(repo, ['describe', '--tags', '--match', 'v[0-9]*', '--exact-match', rev], true).stdout.trim();
  if (parseVersion(tag).length === 3) return { tag, version: tag };
  const nearest = git(repo, ['describe', '--tags', '--match', 'v[0-9]*', '--abbrev=0', rev], true).stdout.trim();
  if (pin && parseVersion(nearest).length === 3) return { tag: null, version: nearest };
  let version = null;
  try { version = `v${JSON.parse(show(repo, rev, 'package.json')).version}`; } catch { /* below */ }
  if (parseVersion(version).length !== 3) version = parseVersion(nearest).length === 3 ? nearest : null;
  return { tag: null, version };
}

// The project's config with dotted keys removed; reports which were there.
function withoutKeys(config, keys) {
  const next = structuredClone(config);
  const removed = [];
  for (const key of keys) {
    const parts = key.split('.');
    let at = next;
    for (const p of parts.slice(0, -1)) at = at && typeof at === 'object' ? at[p] : undefined;
    const last = parts.at(-1);
    if (at && typeof at === 'object' && Object.hasOwn(at, last)) { delete at[last]; removed.push(key); }
  }
  return { config: next, removed };
}

const inside = (project, rel) => { const full = path.resolve(project, rel); const r = path.relative(project, full); return r && !r.startsWith('..') && !path.isAbsolute(r) ? full : null; };

// resolveChannel(config) -> { version, revision }: the release a channel config resolves to (default: the resolver,
// adapters/resolve.mjs, over the signed channel record); only asked when no --rev / --entry names the release.
const defaultResolve = config => resolve({ config });
export async function planUpgrade({ project, workflowRepo, rev, resolveChannel = defaultResolve }) {
  const configPath = path.join(project, 'docs/workflow/config.json');
  if (!fs.existsSync(configPath)) throw new Error('docs/workflow/config.json not found: this project is not adopted (bin/wf-adopt)');
  const configText = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(configText);
  const from = config.workflow?.revision;
  if (!SHA.test(from ?? '') && typeof config.workflow?.channel === 'string' && config.workflow.channel) return planChannelCallers({ project, workflowRepo, rev, config, resolveChannel });
  if (!SHA.test(from ?? '')) throw new Error('the project pins no full workflow revision (workflow.revision)');
  if (git(workflowRepo, ['cat-file', '-e', `${from}^{commit}`], true).status !== 0) throw new Error(`the workflow repository does not hold the project's pinned revision ${from.slice(0, 12)}: fetch its full history and tags (git fetch --tags)`);
  const target = rev ?? releaseTags(workflowRepo)[0];
  if (!target) throw new Error('no release tag found: pass --rev, or fetch the tags (git fetch --tags)');
  const resolved = git(workflowRepo, ['rev-parse', '--verify', '--end-of-options', `${target}^{commit}`], true);
  if (resolved.status !== 0) throw new Error(`--rev ${target} does not resolve to a commit in ${workflowRepo}`);
  const to = resolved.stdout.trim();
  // The pinned revision's own tag is the truth; a hand-edited version that disagrees with it is reported, not trusted.
  const pinned = releaseOf(workflowRepo, from, { pin: true });
  const recorded = parseVersion(config.workflow?.version).length === 3 ? config.workflow.version : null;
  const fromRelease = { version: pinned.version ?? recorded };
  const warnings = [];
  if (pinned.version && recorded && compareVersions(pinned.version, recorded) !== 0) warnings.push(`workflow.version says ${recorded}, but the pinned revision is ${pinned.tag ?? `after ${pinned.version}`}; the upgrade goes from ${pinned.version}`);
  const toRelease = releaseOf(workflowRepo, to);
  if (!fromRelease.version || !toRelease.version) throw new Error('cannot tell which releases the pinned and target revisions are');
  // A hold that keeps a channel's thin callers (F2 of the review of #110): they move with the pin, to the target's tag,
  // and on a pin already at the target they still move to it.
  const held = refreshHoldCallers({ project, workflowRepo, config, toRelease, to });
  const holdCallers = new Set(held.paths);
  if (to === from) {
    const current = !held.changes.length && !held.left.length;
    return { project, from, to, from_version: fromRelease.version, to_version: toRelease.tag ?? toRelease.version, current, changes: held.changes, notes: [...warnings, ...held.notes], left: held.left, removed_config: [], steps_from: null };
  }
  if (git(workflowRepo, ['merge-base', '--is-ancestor', from, to], true).status !== 0) throw new Error(`the target ${to.slice(0, 12)} does not contain the pinned revision ${from.slice(0, 12)}: a pin moves forward only`);

  // What the releases after the pin, up to and including the target, ask for. Later releases document earlier ones (an
  // older target may predate upgrades.json), so the list comes from the newest release tag that contains the target and
  // holds one, else from the target itself: never from an unreleased commit, which could change what is done to a project.
  let manifest = {};
  const released = releaseTags(workflowRepo, '--contains', to);
  const listTag = released.find(t => show(workflowRepo, t, 'upgrades.json') !== null) ?? null;
  const listFrom = listTag ?? to;
  const raw = show(workflowRepo, listFrom, 'upgrades.json');
  const listName = listTag ? `release ${listTag}` : `the target ${to.slice(0, 12)}`;
  if (raw !== null) { try { manifest = JSON.parse(raw); } catch { throw new Error(`upgrades.json in ${listName} is not valid JSON`); } }
  const steps = Object.entries(manifest).filter(([v]) => parseVersion(v).length === 3 && compareVersions(v, fromRelease.version) > 0 && compareVersions(v, toRelease.version) <= 0).sort(([a], [b]) => compareVersions(a, b));
  const removeKeys = steps.flatMap(([, s]) => s.remove_config ?? []);
  const removeFiles = steps.flatMap(([, s]) => s.remove_files ?? []);
  const addFiles = new Set(steps.flatMap(([, s]) => s.add_files ?? []));
  if (raw === null) warnings.push(`no released upgrades.json covers this target, so the steps from ${fromRelease.version} to ${toRelease.version} are not listed: read them in CHANGELOG.md`);
  const notes = [...warnings, ...steps.flatMap(([v, s]) => (s.notes ?? []).map(n => `${v}: ${n}`)), ...held.notes];

  const changes = [];
  const left = [...held.left];
  // The pin and the keys no release reads any more.
  const { config: cleaned, removed } = withoutKeys(config, removeKeys);
  cleaned.workflow = { ...cleaned.workflow, version: toRelease.tag ?? 'UNRELEASED', revision: to };
  const nextConfig = `${JSON.stringify(cleaned, null, 2)}\n`;
  changes.push({ path: 'docs/workflow/config.json', action: 'update', content: nextConfig, why: `pin ${fromRelease.version} (${from.slice(0, 12)}) → ${toRelease.tag ?? `${toRelease.version}, unreleased`} (${to.slice(0, 12)})${removed.length ? `; removes ${removed.join(', ')}, which nothing reads any more` : ''}` });
  const rd = config.records_dir ?? 'docs/workflow';
  const profilePath = path.join(project, rd, 'profile.md');
  if (fs.existsSync(profilePath)) {
    const profile = fs.readFileSync(profilePath, 'utf8');
    const next = profile.replace(/^workflow_version:.*$/m, `workflow_version: ${toRelease.tag ?? 'UNRELEASED'}`);
    if (next !== profile) changes.push({ path: `${rd}/profile.md`, action: 'update', content: next, why: 'workflow_version follows the pin' });
  }
  // MAINT-0018: a milestone in progress runs under the pin (its workflow_version); moving the pin moves it, which only the
  // owner decides. The change says so, and the owner's merge of it is that decision (procedures/maintenance.md).
  const milestones = path.join(project, rd, 'milestones');
  const version = toRelease.tag ?? 'UNRELEASED';
  if (fs.existsSync(milestones)) for (const file of fs.readdirSync(milestones).filter(f => /^M-\d{4}\.md$/.test(f)).sort()) {
    const rel = `${rd}/milestones/${file}`;
    const text = fs.readFileSync(path.join(project, rel), 'utf8');
    const front = text.match(/^---\r?\n[\s\S]*?\r?\n---/)?.[0];
    const status = front?.match(/^status:[ \t]*(\S+)/m)?.[1];
    if (!front || !IN_PROGRESS.includes(status)) continue;
    const moved = /^workflow_version:.*$/m.test(front) ? front.replace(/^workflow_version:.*$/m, `workflow_version: ${version}`) : front.replace(/^status:.*$/m, line => `${line}\nworkflow_version: ${version}`);
    if (moved !== front) changes.push({ path: rel, action: 'update', content: moved + text.slice(front.length), why: `${file.slice(0, 6)} is ${status}: it moves to ${version} with the pin, which is the owner's decision; merging this change makes it` });
  }
  for (const rel of removeFiles) {
    const full = inside(project, rel);
    if (!full) throw new Error(`upgrades.json names a path outside the project: ${rel}`);
    if (fs.existsSync(full)) changes.push({ path: rel, action: 'remove', why: 'no release reads it any more' });
  }
  // The workflow files the scaffold installed: refreshed where they are still the old release's copy.
  const fill = (text, item) => (item.branch ? text.replaceAll('__TRUSTED_BRANCH__', config.trusted_branch ?? 'main') : text);
  for (const item of INSTALLED) {
    const full = path.join(project, item.path);
    const newer = show(workflowRepo, to, item.template);
    if (newer === null) continue;
    const want = fill(newer, item);
    if (!fs.existsSync(full)) {
      if (addFiles.has(item.path)) changes.push({ path: item.path, action: 'add', content: want, mode: item.mode, why: 'the scaffold installs it since a release after the pin; delete it to opt out' });
      continue;
    }
    const have = fs.readFileSync(full, 'utf8');
    if (have === want) continue;
    if (holdCallers.has(item.path)) continue;
    const older = show(workflowRepo, from, item.template);
    if ((older !== null && have === fill(older, item)) || item.legacy?.includes(sha256(have))) changes.push({ path: item.path, action: 'update', content: want, mode: item.mode, why: 'still the pinned release\'s copy, so it takes the new one' });
    else left.push({ path: item.path, why: `changed in this project; compare it with ${item.template} at ${to.slice(0, 12)} and merge by hand` });
  }
  changes.push(...held.changes);
  return { project, from, to, from_version: fromRelease.version, to_version: toRelease.tag ?? `${toRelease.version} (unreleased)`, current: false, changes, notes, left, removed_config: removed, steps_from: raw === null ? null : listName };
}

// v2.19.0: the second of the two opt-in pull requests (docs/proposals/2026-11-07-central-release-channel.md, *Opting in*).
// From a pin at v2.19.0 or later (the first one), or from another channel: writes workflow.channel and workflow.channel_key
// in place of the pin, moves each milestone in progress and the profile to the channel's name, and replaces the copied
// wf-ci.yml and wf-status.yml with the thin callers of the shared entry at the entry tag, where the project has not
// changed them (else lists them). The callers come from the entry tag's own templates/github/channel/.
export const CHANNEL_CALLERS = [
  { path: '.github/workflows/wf-ci.yml', template: 'templates/github/channel/wf-ci.yml', copied: 'templates/github/wf-ci.yml', always: true },
  { path: '.github/workflows/wf-status.yml', template: 'templates/github/channel/wf-status.yml', copied: 'templates/github/wf-status.yml' },
  // Only where the project publishes the page, and only from an entry that has the shared client page (part 5).
  { path: '.github/workflows/wf-client-page.yml', template: 'templates/github/channel/wf-client-page.yml', copied: 'templates/github/wf-client-page.yml', optional: true },
];
const FIRST_CHANNEL_RELEASE = 'v2.19.0';
export async function planToChannel({ project, workflowRepo, channel, keys, entry, resolveChannel = defaultResolve }) {
  const configPath = path.join(project, 'docs/workflow/config.json');
  if (!fs.existsSync(configPath)) throw new Error('docs/workflow/config.json not found: this project is not adopted (bin/wf-adopt)');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const w = config.workflow ?? {};
  if (!keys?.length) throw new Error('--to-channel needs --key ed25519:<base64>, the public key that signs channel records (up to four, repeated)');
  const nextWorkflow = { ...w, channel, channel_key: keys.length === 1 ? keys[0] : keys };
  delete nextWorkflow.revision; delete nextWorkflow.version;
  validateWorkflowConfig(nextWorkflow); // the channel name and the keys, as the validator will read them
  const from = w.revision;
  let fromVersion;
  if (SHA.test(from ?? '')) {
    if (git(workflowRepo, ['cat-file', '-e', `${from}^{commit}`], true).status !== 0) throw new Error(`the workflow repository does not hold the project's pinned revision ${from.slice(0, 12)}: fetch its full history and tags (git fetch --tags)`);
    fromVersion = releaseOf(workflowRepo, from, { pin: true }).version;
    if (show(workflowRepo, from, 'bin/wf-gate-ci') === null) throw new Error(`the pin ${fromVersion ?? from.slice(0, 12)} has no shared gate: first move the pin to ${FIRST_CHANNEL_RELEASE} or later with bin/wf-upgrade --rev (its own pull request), merge it, then opt in; the opt-in pull request is judged by the base branch's pin`);
  } else if (typeof w.channel === 'string' && w.channel) fromVersion = `channel ${w.channel}`;
  else throw new Error('the project names neither a full workflow.revision nor a channel');
  // The entry: --entry as given, else the release the target channel is on now, as the resolver verifies it (F1 of the
  // review of #110): never a tag the channel has not reached, such as a canary release that never passed the soak.
  const entryTag = entry ?? await channelRelease({ workflowRepo, config: { ...config, workflow: nextWorkflow }, resolveChannel, override: '--entry' });
  if (parseVersion(entryTag).length !== 3 || compareVersions(entryTag, FIRST_CHANNEL_RELEASE) < 0) throw new Error(`the entry must be a release tag ${FIRST_CHANNEL_RELEASE} or later (--entry vX.Y.Z), not ${entryTag ?? 'none'}`);
  if (git(workflowRepo, ['rev-parse', '--verify', '-q', '--end-of-options', `refs/tags/${entryTag}^{commit}`], true).status !== 0) throw new Error(`the entry tag ${entryTag} is not in ${workflowRepo}: fetch the tags (git fetch --tags)`);

  const changes = [], left = [];
  const nextConfig = { ...config, workflow: nextWorkflow };
  changes.push({ path: 'docs/workflow/config.json', action: 'update', content: `${JSON.stringify(nextConfig, null, 2)}\n`, why: `${fromVersion}${SHA.test(from ?? '') ? ` (${from.slice(0, 12)})` : ''} → channel ${channel}, verified with ${keys.length} key${keys.length === 1 ? '' : 's'}; the pin goes (a hold PR brings it back)` });
  const rd = config.records_dir ?? 'docs/workflow';
  const profilePath = path.join(project, rd, 'profile.md');
  if (fs.existsSync(profilePath)) {
    const profile = fs.readFileSync(profilePath, 'utf8');
    const next = profile.replace(/^workflow_version:.*$/m, `workflow_version: ${channel}`);
    if (next !== profile) changes.push({ path: `${rd}/profile.md`, action: 'update', content: next, why: 'workflow_version names the channel' });
  }
  const milestones = path.join(project, rd, 'milestones');
  if (fs.existsSync(milestones)) for (const file of fs.readdirSync(milestones).filter(f => /^M-\d{4}\.md$/.test(f)).sort()) {
    const rel = `${rd}/milestones/${file}`;
    const text = fs.readFileSync(path.join(project, rel), 'utf8');
    const front = text.match(/^---\r?\n[\s\S]*?\r?\n---/)?.[0];
    const status = front?.match(/^status:[ \t]*(\S+)/m)?.[1];
    if (!front || !IN_PROGRESS.includes(status)) continue;
    const moved = /^workflow_version:.*$/m.test(front) ? front.replace(/^workflow_version:.*$/m, `workflow_version: ${channel}`) : front.replace(/^status:.*$/m, line => `${line}\nworkflow_version: ${channel}`);
    if (moved !== front) changes.push({ path: rel, action: 'update', content: moved + text.slice(front.length), why: `${file.slice(0, 6)} is ${status}: from now on channel moves reach it, announced and recorded on every run; the owner's merge of this change is that decision` });
  }
  const branch = config.trusted_branch ?? 'main';
  const fill = text => text.replaceAll('__TRUSTED_BRANCH__', branch).replaceAll('__ENTRY__', entryTag);
  let noPage = false;
  for (const item of CHANNEL_CALLERS) {
    const template = show(workflowRepo, entryTag, item.template);
    if (template === null && item.optional) { if (fs.existsSync(path.join(project, item.path))) noPage = true; continue; }
    if (template === null) throw new Error(`${entryTag} has no ${item.template}`);
    const want = fill(template);
    const full = path.join(project, item.path);
    if (!fs.existsSync(full)) { if (item.always) changes.push({ path: item.path, action: 'add', content: want, why: `the thin caller of the shared entry at ${entryTag}` }); continue; }
    const have = fs.readFileSync(full, 'utf8');
    if (have === want) continue;
    const copied = SHA.test(from ?? '') ? show(workflowRepo, from, item.copied) : null;
    const knownCaller = /uses:\s*\S+\/\.github\/workflows\/wf-(?:gate|status|client-page)\.yml@v\d+\.\d+\.\d+/.test(have) && have.replace(/v\d+\.\d+\.\d+/g, 'vX') === want.replace(/v\d+\.\d+\.\d+/g, 'vX');
    if ((copied !== null && have.replaceAll('__TRUSTED_BRANCH__', branch) === copied.replaceAll('__TRUSTED_BRANCH__', branch)) || knownCaller) changes.push({ path: item.path, action: 'update', content: want, why: `still the pinned release's copy: the thin caller of the shared entry at ${entryTag} replaces it` });
    else left.push({ path: item.path, why: `changed in this project; replace it with ${item.template} at ${entryTag} (fill __TRUSTED_BRANCH__ and __ENTRY__) and keep your additions by hand${/client-page/.test(item.path) ? '; until then it still reads workflow.revision and fails on a channel config' : ''}` });
  }
  const notes = [
    `required check: the gate now reports as \`wf ci / gate\` (a reusable workflow's job is named <caller job> / <called job>): move the required check and the merge route to that name when this merges`,
    'Actions policy: the repository must allow workflows from Cazy00/agent-workflow (Settings, Actions, General)',
  ];
  if (noPage) notes.push(`.github/workflows/wf-client-page.yml still reads workflow.revision and the entry ${entryTag} has no shared client page: it fails on a channel config until one is released; delete it or keep the project on a hold, or pass --entry with a release that has it`);
  if (fs.existsSync(path.join(project, 'scripts/wf')) && !fs.readFileSync(path.join(project, 'scripts/wf'), 'utf8').includes('wf-resolve')) notes.push(`scripts/wf, the local launcher, is a copy from before channels and refuses a channel config: replace it with templates/scripts/wf at ${entryTag}; CI does not use it`);
  return { project, from: from ?? null, to: `channel ${channel}`, from_version: fromVersion, to_version: `channel ${channel}`, entry: entryTag, current: false, changes, notes, left, removed_config: ['workflow.revision', 'workflow.version'].filter(k => k.split('.')[1] in w) };
}

const CALLER_ENTRY = /^\s*uses:\s*\S+\/\.github\/workflows\/wf-(?:gate|status|client-page)\.yml@(v\d+\.\d+\.\d+)\s*$/m;

// The release a channel config is on, as the resolver verifies it: the signed channel record (workflow.channel_key), its
// tag on main and its version (adapters/resolve.mjs, the same trust root the gate uses). Never this checkout's newest
// tag: tags are storage, and a release that never reached the channel (a canary that failed its soak) keeps its tag.
// The checkout's own tag must be the record's commit, since the callers' templates are read from it. Fails closed.
async function channelRelease({ workflowRepo, config, resolveChannel, override }) {
  const name = config.workflow?.channel;
  let r;
  try { r = await resolveChannel(config); } catch (e) { throw new Error(`cannot tell which release channel ${name} is on (${e.message}), so there is no default: pass ${override} vX.Y.Z to name the release yourself`); }
  const version = r?.version;
  if (parseVersion(version).length !== 3 || !SHA.test(r?.revision ?? '')) throw new Error(`cannot tell which release channel ${name} is on (the resolver returned no release), so there is no default: pass ${override} vX.Y.Z to name the release yourself`);
  const local = git(workflowRepo, ['rev-parse', '--verify', '-q', '--end-of-options', `refs/tags/${version}^{commit}`], true).stdout.trim();
  if (!local) throw new Error(`channel ${name} is on ${version}, which is not in ${workflowRepo}: fetch the tags (git fetch --tags), or pass ${override} vX.Y.Z`);
  if (local !== r.revision) throw new Error(`channel ${name} is on ${version} at ${r.revision.slice(0, 12)}, but the tag ${version} in ${workflowRepo} is ${local.slice(0, 12)}: fetch the tags (git fetch --tags --force) before upgrading`);
  return version;
}

// One thin caller against the target release: { update: { content, why } }, { left: why }, { note }, or {} when it is
// already the target's caller. A caller counts as unchanged when it is exactly a released caller template (any channel
// release) with the trusted branch and its own entry filled in; that is checked first, so a customised caller is always
// reported as customised. An unchanged caller moves forward only. A file with no entry line is not a thin caller yet: a
// released copy of the pre-channel workflow is replaced, anything else is listed.
function refreshCaller({ workflowRepo, item, have, target, branch }) {
  const fill = (text, tag) => text.replaceAll('__TRUSTED_BRANCH__', branch).replaceAll('__ENTRY__', tag);
  const template = show(workflowRepo, target, item.template);
  if (template === null) return { left: `${target} has no ${item.template}: keep it as it is or pass --rev with a release that has it` };
  const want = fill(template, target);
  if (have === want) return {};
  const byHand = `by hand: replace it with ${item.template} at ${target} (fill __TRUSTED_BRANCH__ with ${branch} and __ENTRY__ with ${target}) and keep your additions`;
  const tags = releaseTags(workflowRepo);
  const at = have.match(CALLER_ENTRY)?.[1] ?? null;
  if (at) {
    const unchanged = tags.filter(t => compareVersions(t, FIRST_CHANNEL_RELEASE) >= 0).some(t => { const old = show(workflowRepo, t, item.template); return old !== null && fill(old, at) === have; });
    if (!unchanged) return { left: `a thin caller changed in this project; ${byHand}` };
    if (compareVersions(at, target) > 0) return { note: `${item.path} names the entry ${at}, newer than ${target}: left as it is (a caller moves forward only)` };
    return { update: { content: want, why: `still a released caller (entry ${at}): the thin caller of the shared entry at ${target} replaces it` } };
  }
  const copy = tags.filter(t => compareVersions(t, target) <= 0).some(t => { const old = show(workflowRepo, t, item.copied); return old !== null && old.replaceAll('__TRUSTED_BRANCH__', branch) === have; });
  if (copy) return { update: { content: want, why: `still a released copy of ${item.copied} from before channels: the thin caller of the shared entry at ${target} replaces it` } };
  return { left: `not a thin caller yet, and not a released copy of ${item.copied} (changed in this project); ${byHand}` };
}

// A hold's thin callers (files that name an entry tag): refreshed to the target's tag with refreshCaller, where the target
// is a release tag v2.19.0 or later; the copied-template logic never sees them.
function refreshHoldCallers({ project, workflowRepo, config, toRelease, to }) {
  const branch = config.trusted_branch ?? 'main';
  const out = { changes: [], left: [], notes: [], paths: [] };
  for (const item of CHANNEL_CALLERS) {
    const full = path.join(project, item.path);
    if (!fs.existsSync(full)) continue;
    const have = fs.readFileSync(full, 'utf8');
    if (!CALLER_ENTRY.test(have)) continue;
    out.paths.push(item.path);
    if (!toRelease.tag || compareVersions(toRelease.tag, FIRST_CHANNEL_RELEASE) < 0) { out.left.push({ path: item.path, why: `a thin caller of the shared entry; the target ${toRelease.tag ?? to.slice(0, 12)} is not a release tag ${FIRST_CHANNEL_RELEASE} or later, so it names no entry: keep the caller, or pass --rev with such a release` }); continue; }
    const r = refreshCaller({ workflowRepo, item, have, target: toRelease.tag, branch });
    if (r.update) out.changes.push({ path: item.path, action: 'update', content: r.update.content, why: `${r.update.why} (a hold's caller moves with the pin)` });
    else if (r.left) out.left.push({ path: item.path, why: r.left });
    else if (r.note) out.notes.push(r.note);
  }
  return out;
}

// A project on a channel: the channel moves the shared gate, not the project's thin callers, which name their entry tag.
// The plain upgrade (no --to-channel) refreshes each caller that is still exactly a released caller template to the
// target release's template at that release's tag (refreshCaller); a caller the project changed is left as it is and
// listed. The target is --rev (a release tag), else the release the project's own channel is on now, as the resolver
// verifies it from the signed channel record (channelRelease); without one there is no default. It writes no config:
// the channel and its keys stay; a channel move is --to-channel.
async function planChannelCallers({ project, workflowRepo, rev, config, resolveChannel }) {
  const w = config.workflow;
  const target = rev ?? await channelRelease({ workflowRepo, config, resolveChannel, override: '--rev' });
  if (parseVersion(target).length !== 3 || compareVersions(target, FIRST_CHANNEL_RELEASE) < 0) throw new Error(`a channel project's callers move to a release tag ${FIRST_CHANNEL_RELEASE} or later (--rev vX.Y.Z), not ${target}`);
  if (git(workflowRepo, ['rev-parse', '--verify', '-q', '--end-of-options', `refs/tags/${target}^{commit}`], true).status !== 0) throw new Error(`the release tag ${target} is not in ${workflowRepo}: fetch the tags (git fetch --tags)`);
  const branch = config.trusted_branch ?? 'main';
  const changes = [], left = [], notes = [], entries = [];
  for (const item of CHANNEL_CALLERS) {
    const full = path.join(project, item.path);
    if (!fs.existsSync(full)) continue;
    const have = fs.readFileSync(full, 'utf8');
    const at = have.match(CALLER_ENTRY)?.[1] ?? null;
    if (at) entries.push(at);
    const r = refreshCaller({ workflowRepo, item, have, target, branch });
    if (r.update) changes.push({ path: item.path, action: 'update', content: r.update.content, why: r.update.why });
    else if (r.left) left.push({ path: item.path, why: r.left });
    else if (r.note) notes.push(r.note);
  }
  if (!entries.length && !changes.length && !left.length) throw new Error(`the project follows channel ${w.channel} but has no thin caller naming an entry (${CHANNEL_CALLERS[0].path}): run bin/wf-upgrade --to-channel ${w.channel} --key … to write them`);
  const fromEntry = entries.sort(compareVersions)[0] ?? 'none';
  const base = { project, from: null, to: `channel ${w.channel}`, from_version: `channel ${w.channel}, entry ${fromEntry}`, to_version: `channel ${w.channel}, entry ${target}`, entry: target, channel: w.channel, notes, left, removed_config: [] };
  if (!changes.length && !left.length) return { ...base, current: true, changes };
  return { ...base, current: false, changes, steps_from: null };
}

// Writes the plan. Refuses when a file it would change has uncommitted edits, so nothing of the owner's is overwritten.
export function applyUpgrade(plan) {
  if (!plan.changes.length) return;
  const dirty = git(plan.project, ['status', '--porcelain', '--', ...plan.changes.map(c => c.path)], true);
  if (dirty.status !== 0) throw new Error('cannot tell whether the files it would change have uncommitted edits (git status failed): --apply needs the project\'s Git checkout');
  if (dirty.stdout.trim()) throw new Error(`commit or stash these first; the upgrade would change them:\n${dirty.stdout.trimEnd()}`);
  for (const c of plan.changes) {
    const full = path.join(plan.project, c.path);
    if (c.action === 'remove') fs.rmSync(full, { recursive: true, force: true });
    else { fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, c.content); if (c.mode) fs.chmodSync(full, c.mode); }
  }
}

// The target release's own validator, extracted from its Git objects, checks the upgraded records.
export function validateWith({ workflowRepo, rev, project }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-upgrade-'));
  try {
    const archive = spawnSync('git', ['-C', workflowRepo, 'archive', '--format=tar', rev, 'validator'], { maxBuffer: 64 * 1024 * 1024 });
    if (archive.status !== 0) throw new Error('git archive failed');
    const untar = spawnSync('tar', ['-x', '-C', dir], { input: archive.stdout });
    if (untar.status !== 0) throw new Error('tar failed');
    const r = spawnSync(process.execPath, [path.join(dir, 'validator/cli.js'), 'records', '--repo', project, '--json'], { encoding: 'utf8' });
    let out = null;
    try { out = JSON.parse(r.stdout); } catch { /* reported below */ }
    return { ok: r.status === 0 && out?.ok === true, errors: out?.errors ?? [(r.stderr || 'the validator did not run').trim()] };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export function renderPlan(plan, { applied = false, validation = null } = {}) {
  if (plan.current) return `Already at ${plan.to_version}${plan.channel ? '' : ` (${plan.to.slice(0, 12)})`}; nothing to do.\n${plan.notes.map(n => `  - ${n}\n`).join('')}`;
  const lines = [`${applied ? 'Upgraded' : 'Upgrade plan for'} ${plan.project}: ${plan.from_version} → ${plan.to_version}${plan.steps_from ? ` (steps from upgrades.json in ${plan.steps_from})` : ''}`, ''];
  lines.push(applied ? 'Changed:' : 'Would change (run again with --apply):');
  for (const c of plan.changes) lines.push(`  ${c.action.padEnd(6)} ${c.path}: ${c.why}`);
  if (plan.left.length) lines.push('', 'Left as they are:', ...plan.left.map(l => `  ${l.path}: ${l.why}`));
  if (plan.notes.length) lines.push('', 'By hand, where it applies to this project:', ...plan.notes.map(n => `  - ${n}`));
  if (validation) lines.push('', validation.ok ? 'The new release\'s validator accepts the records (wf records).' : `The new release's validator reports:\n${validation.errors.map(e => `  - ${e}`).join('\n')}`);
  lines.push('', applied ? 'Nothing was committed or pushed: review the change and open a pull request for it (procedures/operate.md, Updates and upgrades).' : 'Nothing was written.');
  return `${lines.join('\n')}\n`;
}
