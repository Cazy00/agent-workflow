// Moving an adopted project to another workflow release (bin/wf-upgrade, MAINT-0011). It moves the pin, removes what the
// releases in between no longer read (config keys and files listed in the target release's upgrades.json), refreshes the
// workflow files the scaffold installed where the project has not changed them, and lists the manual steps each release
// names. It reads everything shared from the workflow repository's Git objects, never from a working tree, and it never
// commits, pushes or approves: the result is a workflow change that goes through a pull request.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SHA = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
// Files the scaffold installs from a template, and how it fills them in.
const INSTALLED = [
  { path: '.github/workflows/wf-ci.yml', template: 'templates/github/wf-ci.yml' },
  { path: '.github/workflows/wf-status.yml', template: 'templates/github/wf-status.yml', branch: true },
  { path: '.github/workflows/wf-client-page.yml', template: 'templates/github/wf-client-page.yml', branch: true },
  { path: '.claude/agents/independent-reviewer.md', template: 'templates/claude/agents/independent-reviewer.md' },
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

// The release a revision is: its exact tag, or, between tags, the version its package.json is heading for.
function releaseOf(repo, rev) {
  const tag = git(repo, ['describe', '--tags', '--exact-match', rev], true).stdout.trim();
  if (parseVersion(tag).length === 3) return { tag, version: tag };
  const pkg = show(repo, rev, 'package.json');
  let version = null;
  try { version = `v${JSON.parse(pkg).version}`; } catch { /* below */ }
  if (parseVersion(version).length !== 3) {
    const nearest = git(repo, ['describe', '--tags', '--abbrev=0', rev], true).stdout.trim();
    version = parseVersion(nearest).length === 3 ? nearest : null;
  }
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

export function planUpgrade({ project, workflowRepo, rev }) {
  const configPath = path.join(project, 'docs/workflow/config.json');
  if (!fs.existsSync(configPath)) throw new Error('docs/workflow/config.json not found: this project is not adopted (bin/wf-adopt)');
  const configText = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(configText);
  const from = config.workflow?.revision;
  if (!SHA.test(from ?? '')) throw new Error('the project pins no full workflow revision (workflow.revision)');
  if (git(workflowRepo, ['cat-file', '-e', `${from}^{commit}`], true).status !== 0) throw new Error(`the workflow repository does not hold the project's pinned revision ${from.slice(0, 12)}: fetch its full history and tags (git fetch --tags)`);
  const target = rev ?? git(workflowRepo, ['tag', '--sort=-v:refname'], true).stdout.split('\n').find(t => parseVersion(t).length === 3);
  if (!target) throw new Error('no release tag found: pass --rev, or fetch the tags (git fetch --tags)');
  const resolved = git(workflowRepo, ['rev-parse', '--verify', '--end-of-options', `${target}^{commit}`], true);
  if (resolved.status !== 0) throw new Error(`--rev ${target} does not resolve to a commit in ${workflowRepo}`);
  const to = resolved.stdout.trim();
  // The pinned revision's own tag is the truth; a hand-edited version that disagrees with it is reported, not trusted.
  const pinned = releaseOf(workflowRepo, from);
  const recorded = parseVersion(config.workflow?.version).length === 3 ? config.workflow.version : null;
  const fromRelease = { version: pinned.tag ?? recorded ?? pinned.version };
  const warnings = [];
  if (pinned.tag && recorded && compareVersions(pinned.tag, recorded) !== 0) warnings.push(`workflow.version says ${recorded}, but the pinned revision is ${pinned.tag}; the upgrade goes from ${pinned.tag}`);
  const toRelease = releaseOf(workflowRepo, to);
  if (!fromRelease.version || !toRelease.version) throw new Error('cannot tell which releases the pinned and target revisions are');
  if (to === from) return { project, from, to, from_version: fromRelease.version, to_version: toRelease.version, current: true, changes: [], notes: warnings, left: [] };
  if (git(workflowRepo, ['merge-base', '--is-ancestor', from, to], true).status !== 0) throw new Error(`the target ${to.slice(0, 12)} does not contain the pinned revision ${from.slice(0, 12)}: a pin moves forward only`);

  // What the releases after the pin, up to and including the target, ask for. Later releases document earlier ones, so
  // the list comes from this checkout's HEAD when it contains the target (an older target may predate upgrades.json).
  let manifest = {};
  const head = git(workflowRepo, ['rev-parse', 'HEAD'], true).stdout.trim();
  const listFrom = SHA.test(head) && git(workflowRepo, ['merge-base', '--is-ancestor', to, head], true).status === 0 && show(workflowRepo, head, 'upgrades.json') !== null ? head : to;
  const raw = show(workflowRepo, listFrom, 'upgrades.json');
  if (raw !== null) { try { manifest = JSON.parse(raw); } catch { throw new Error('the target release\'s upgrades.json is not valid JSON'); } }
  const steps = Object.entries(manifest).filter(([v]) => parseVersion(v).length === 3 && compareVersions(v, fromRelease.version) > 0 && compareVersions(v, toRelease.version) <= 0).sort(([a], [b]) => compareVersions(a, b));
  const removeKeys = steps.flatMap(([, s]) => s.remove_config ?? []);
  const removeFiles = steps.flatMap(([, s]) => s.remove_files ?? []);
  const addFiles = new Set(steps.flatMap(([, s]) => s.add_files ?? []));
  const notes = [...warnings, ...steps.flatMap(([v, s]) => (s.notes ?? []).map(n => `${v}: ${n}`))];

  const changes = [];
  const left = [];
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
      if (addFiles.has(item.path)) changes.push({ path: item.path, action: 'add', content: want, why: 'the scaffold installs it since a release after the pin; delete it to opt out' });
      continue;
    }
    const have = fs.readFileSync(full, 'utf8');
    if (have === want) continue;
    const older = show(workflowRepo, from, item.template);
    if (older !== null && have === fill(older, item)) changes.push({ path: item.path, action: 'update', content: want, why: 'still the pinned release\'s copy, so it takes the new one' });
    else left.push({ path: item.path, why: `changed in this project; compare it with ${item.template} at ${to.slice(0, 12)} and merge by hand` });
  }
  return { project, from, to, from_version: fromRelease.version, to_version: toRelease.tag ?? `${toRelease.version} (unreleased)`, current: false, changes, notes, left, removed_config: removed };
}

// Writes the plan. Refuses when a file it would change has uncommitted edits, so nothing of the owner's is overwritten.
export function applyUpgrade(plan) {
  const dirty = git(plan.project, ['status', '--porcelain', '--', ...plan.changes.map(c => c.path)], true);
  if (dirty.status !== 0) throw new Error('cannot tell whether the files it would change have uncommitted edits (git status failed): --apply needs the project\'s Git checkout');
  if (dirty.stdout.trim()) throw new Error(`commit or stash these first; the upgrade would change them:\n${dirty.stdout.trimEnd()}`);
  for (const c of plan.changes) {
    const full = path.join(plan.project, c.path);
    if (c.action === 'remove') fs.rmSync(full, { recursive: true, force: true });
    else { fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, c.content); }
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
  if (plan.current) return `Already at ${plan.to_version} (${plan.to.slice(0, 12)}); nothing to do.\n`;
  const lines = [`${applied ? 'Upgraded' : 'Upgrade plan for'} ${plan.project}: ${plan.from_version} → ${plan.to_version}`, ''];
  lines.push(applied ? 'Changed:' : 'Would change (run again with --apply):');
  for (const c of plan.changes) lines.push(`  ${c.action.padEnd(6)} ${c.path}: ${c.why}`);
  if (plan.left.length) lines.push('', 'Left as they are:', ...plan.left.map(l => `  ${l.path}: ${l.why}`));
  if (plan.notes.length) lines.push('', 'By hand, where it applies to this project:', ...plan.notes.map(n => `  - ${n}`));
  if (validation) lines.push('', validation.ok ? 'The new release\'s validator accepts the records (wf records).' : `The new release's validator reports:\n${validation.errors.map(e => `  - ${e}`).join('\n')}`);
  lines.push('', applied ? 'Nothing was committed or pushed: review the change and open a pull request for it (procedures/operate.md, Updates and upgrades).' : 'Nothing was written.');
  return `${lines.join('\n')}\n`;
}
