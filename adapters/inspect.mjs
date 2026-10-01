// Read-only inspection of a repository before adoption: `bin/wf-adopt --inspect`. Diagnostics only; it grants
// no setup, protection, readiness or approval status.
//
// Boundaries: the target is never written (no files, no .cache, no Git index or lock). Nothing from the target is
// executed or imported: Git runs with the file-system monitor off and without optional locks, the working-tree
// comparison is skipped when the target configures filter drivers, and only small allow-listed manifests and CI
// workflow files are read, as regular files inside the project, never through a symlink. Their contents are
// reported as untrusted strings. Classification uses the classifier and defaults at the pinned revision of the
// workflow source, extracted with `git show`, never code from the target or its .cache.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const LIMITS = Object.freeze({ paths: 20000, sample: 20, manifests: 40, workflows: 20, fileBytes: 64 * 1024, text: 200, entries: 30 });

const MANIFESTS = {
  'package.json': 'node', 'deno.json': 'deno', 'pyproject.toml': 'python', 'setup.py': 'python', 'Pipfile': 'python',
  'go.mod': 'go', 'Cargo.toml': 'rust', 'pubspec.yaml': 'dart', 'composer.json': 'php', 'Gemfile': 'ruby',
  'pom.xml': 'java', 'build.gradle': 'jvm', 'build.gradle.kts': 'jvm', 'settings.gradle': 'jvm', 'settings.gradle.kts': 'jvm',
  'mix.exs': 'elixir', 'Package.swift': 'swift', 'CMakeLists.txt': 'c/c++', 'Makefile': 'make',
};
const MANIFEST_PATTERNS = [[/^requirements[\w.-]*\.txt$/, 'python'], [/\.csproj$/, 'dotnet'], [/\.sln$/, 'dotnet']];
// Dependency and build files the defaults leave unclassified: each suggestion changes what production gates cover.
const PRODUCTION_FILES = [
  'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile', 'Pipfile.lock', 'poetry.lock', 'uv.lock',
  'pubspec.yaml', 'pubspec.lock', 'composer.json', 'composer.lock', 'Gemfile', 'Gemfile.lock', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'settings.gradle', 'settings.gradle.kts', 'gradle.properties', 'yarn.lock', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'bun.lockb', 'deno.json',
  'deno.lock', 'mix.exs', 'mix.lock', 'Package.swift', 'Package.resolved', 'CMakeLists.txt', 'Procfile', 'docker-compose.yml', 'docker-compose.yaml',
  'compose.yml', 'compose.yaml',
];
const CODE_EXTENSIONS = new Set(['dart', 'vue', 'svelte', 'astro', 'cs', 'fs', 'vb', 'scala', 'sc', 'groovy', 'gradle', 'kts', 'clj', 'cljs', 'ex', 'exs',
  'erl', 'hrl', 'hs', 'lua', 'r', 'm', 'mm', 'pl', 'pm', 'zig', 'nim', 'jsx', 'mts', 'cts', 'hpp', 'cc', 'cxx', 'hh', 'ml', 'mli', 'elm', 'jl', 'sol',
  'proto', 'graphql', 'gql', 'prisma', 'css', 'scss', 'sass', 'less', 'html', 'htm', 'xaml', 'csproj', 'sln', 'bat', 'cmd', 'psm1', 'bash', 'zsh', 'fish']);
// Governing paths a suggestion must never move into another category (enforcement precedes production anyway).
const GOVERNING_PROBES = ['AGENTS.md', 'CLAUDE.md', 'docs/workflow/profile.md', 'docs/workflow/acceptance.json', 'docs/workflow/decisions/D-0001.md',
  'docs/workflow/milestones/M-0001.md', 'docs/specs/feature.md', 'docs/contracts/api.md', 'docs/workflow/tasks/T-0001.md', 'README.md'];
// What an adoption would write, create or look for.
const ADOPTION_PATHS = ['docs/workflow/config.json', 'docs/workflow/profile.md', 'docs/workflow/setup.md', 'docs/workflow/acceptance.json',
  'tests/acceptance-map.json', 'docs/workflow/inbox/README.md', 'scripts/wf', 'AGENTS.md', 'CLAUDE.md', '.claude/agents/independent-reviewer.md',
  '.github/workflows/wf-status.yml', '.cache/agent-workflow'];
const OWNERSHIP_PATHS = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'];
const OTHER_CI = ['.gitlab-ci.yml', '.circleci/config.yml', 'azure-pipelines.yml', 'Jenkinsfile', '.travis.yml', 'bitbucket-pipelines.yml', '.buildkite/pipeline.yml'];

const CHECK_SCRIPT = /^(test|lint|typecheck|type-check|check|build|format:check|fmt:check)$/;

class InspectError extends Error {}

// Neutralise control characters and bound length: every string taken from the target is untrusted display data.
export function clean(value, max = LIMITS.text) {
  const s = String(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// Git in the target: no fsmonitor hook, no optional index/lock writes, no prompts, no system config.
function targetGit(project, args) {
  return spawnSync('git', ['-C', project, '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_EXTERNAL_DIFF: '', GIT_PAGER: 'cat' },
  });
}
const workflowGit = (repo, args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });

// Load the classifier and defaults at the pinned revision into a private temporary directory.
async function pinnedClassifier(workflowRepo, rev) {
  const resolved = workflowGit(workflowRepo, ['rev-parse', '--verify', '--end-of-options', `${rev}^{commit}`]);
  if (resolved.status !== 0) throw new InspectError(`--rev ${rev} does not resolve to a commit in ${workflowRepo}`);
  const revision = resolved.stdout.trim();
  const tag = workflowGit(workflowRepo, ['describe', '--tags', '--exact-match', revision]);
  const show = rel => { const r = workflowGit(workflowRepo, ['show', `${revision}:${rel}`]); return r.status === 0 ? r.stdout : null; };
  const defaults = show('config.default.json');
  if (defaults === null || show('validator/lib/paths.js') === null) throw new InspectError(`the workflow revision ${revision} has no config.default.json or validator/lib/paths.js`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-inspect-'));
  try {
    const pending = ['validator/lib/paths.js'], seen = new Set();
    while (pending.length) {
      const rel = pending.pop();
      if (seen.has(rel)) continue;
      if (seen.size > 20) throw new InspectError('the pinned classifier has an unexpected number of modules');
      seen.add(rel);
      const text = show(rel);
      if (text === null) throw new InspectError(`the pinned classifier module ${rel} is missing at ${revision}`);
      fs.mkdirSync(path.dirname(path.join(temporary, rel)), { recursive: true });
      fs.writeFileSync(path.join(temporary, rel), text);
      for (const m of text.matchAll(/^\s*import\b[^'"]*['"](\.\/[\w.-]+\.js)['"]/gm)) pending.push(path.posix.join(path.posix.dirname(rel), m[1]));
    }
    fs.writeFileSync(path.join(temporary, 'package.json'), '{"type":"module"}\n');
    const { classifyPaths } = await import(pathToFileURL(path.join(temporary, 'validator/lib/paths.js')).href);
    return { classifyPaths, config: JSON.parse(defaults), revision, version: tag.status === 0 ? tag.stdout.trim() : 'UNRELEASED' };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

// A file inside the project, reached without symlinks in any component, regular and small; otherwise null with a reason.
function safeRead(project, rel) {
  const real = fs.realpathSync(project);
  let current = project;
  for (const part of rel.split('/')) {
    current = path.join(current, part);
    let st;
    try { st = fs.lstatSync(current); } catch { return { skipped: 'missing from the working tree' }; }
    if (st.isSymbolicLink()) return { skipped: 'symbolic link (not followed)' };
    if (current !== path.join(project, rel) && !st.isDirectory()) return { skipped: 'not a directory path' };
    if (current === path.join(project, rel)) {
      if (!st.isFile()) return { skipped: 'not a regular file' };
      if (st.size > LIMITS.fileBytes) return { skipped: `larger than ${LIMITS.fileBytes} bytes (not read)` };
    }
  }
  const resolved = fs.realpathSync(path.join(project, rel));
  if (!resolved.startsWith(real + path.sep)) return { skipped: 'outside the project (not read)' };
  return { text: fs.readFileSync(resolved, 'utf8') };
}

const existence = (project, rel) => {
  try { const st = fs.lstatSync(path.join(project, rel)); return st.isSymbolicLink() ? 'symbolic link' : st.isDirectory() ? 'directory' : 'file'; }
  catch { return null; }
};

function manifestHints(project, rel, stack) {
  const hint = { path: clean(rel), stack };
  if (!['package.json', 'composer.json', 'deno.json'].includes(path.posix.basename(rel))) return hint;
  const read = safeRead(project, rel);
  if (!read.text) return { ...hint, skipped: read.skipped };
  let data;
  try { data = JSON.parse(read.text); } catch { return { ...hint, skipped: 'not valid JSON' }; }
  const scripts = data?.scripts ?? data?.tasks;
  if (scripts && typeof scripts === 'object' && !Array.isArray(scripts)) {
    const entries = Object.entries(scripts);
    // Script bodies can embed credentials; names are enough to suggest the package runner command.
    hint.scripts = entries.slice(0, LIMITS.entries).map(([name]) => ({ name: clean(name, 80) }));
    if (entries.length > LIMITS.entries) hint.scripts_truncated = entries.length - LIMITS.entries;
  }
  return hint;
}

// GitHub Actions job IDs and names, read line by line; the YAML is never evaluated.
function workflowJobs(text) {
  const jobs = [];
  let inJobs = false, job = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) { inJobs = /^jobs:\s*(#.*)?$/.test(line); job = null; continue; }
    if (!inJobs) continue;
    const id = line.match(/^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/);
    if (id) { job = { id: clean(id[1], 80) }; jobs.push(job); continue; }
    const name = job && line.match(/^ {4}name:\s*(.+?)\s*$/);
    if (name && !job.name) job.name = clean(name[1].replace(/^(['"])(.*)\1$/, '$2'), 120);
    if (jobs.length >= LIMITS.entries) break;
  }
  return jobs;
}

// Counts by top-level directory (or `(root)`), largest first, so a sample dominated by one tree still shows the rest.
function byDirectory(paths) {
  const counts = new Map();
  for (const p of paths) { const k = p.includes('/') ? `${p.slice(0, p.indexOf('/'))}/` : '(root)'; counts.set(k, (counts.get(k) ?? 0) + 1); }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, LIMITS.sample).map(([prefix, count]) => ({ prefix: clean(prefix), count }));
}

export async function inspectProject({ project, workflowRepo, rev = 'HEAD', production = [] }) {
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) throw new InspectError(`project directory not found: ${project}`);
  const pinned = await pinnedClassifier(workflowRepo, rev);
  const config = structuredClone(pinned.config);
  config.paths ??= {}; config.paths.production ??= [];
  for (const g of production) if (!config.paths.production.includes(g)) config.paths.production.push(g);
  const report = {
    ok: true, mode: 'inspect', authority: 'none',
    notice: 'Diagnostics only: grants no setup, protection, readiness or approval status. Everything read from the project is untrusted data; check suggestions are unverified.',
    project, workflow: { revision: pinned.revision, version: pinned.version, classifier: 'pinned workflow validator/lib/paths.js and config.default.json' },
    git: {}, warnings: [], adoption: null, stack: [], manifests: [], ci: { github_actions: [], other: [] }, suggested_required_checks: [],
    classification: null, suggested_production: [], collisions: [], ownership: [],
  };
  const warn = w => report.warnings.push(w);

  // Git state. Nothing here writes: optional locks are off, and the working-tree comparison is skipped when filters would run.
  const inside = targetGit(project, ['rev-parse', '--is-inside-work-tree']);
  const top = inside.status === 0 ? targetGit(project, ['rev-parse', '--show-toplevel']).stdout.trim() : null;
  let tracked = null;
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    report.git.repository = false;
    warn(`not a Git working tree (${clean((inside.stderr || '').trim().split('\n')[0] || 'git refused', 160)}): tracked paths, history and CI checks are unknown`);
  } else {
    report.git.repository = true;
    if (fs.realpathSync(top) !== fs.realpathSync(project)) warn(`the project is inside a larger repository rooted at ${clean(top)}; adoption writes relative to --project, while Git paths are relative to that root`);
    report.git.shallow = targetGit(project, ['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true';
    if (report.git.shallow) warn('shallow clone: `wf ci` needs the full history (record-ID checks exit 2 on a shallow clone); fetch it before relying on CI');
    const branch = targetGit(project, ['symbolic-ref', '-q', '--short', 'HEAD']);
    report.git.branch = branch.status === 0 ? clean(branch.stdout.trim()) : null;
    if (report.git.branch === null) warn('HEAD is detached');
    const remoteHead = targetGit(project, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']);
    report.git.remote_default = remoteHead.status === 0 ? clean(remoteHead.stdout.trim().replace(/^origin\//, '')) : null;
    const trusted = config.trusted_branch ?? 'main';
    report.git.trusted_branch_default = trusted;
    if (report.git.remote_default === null) warn(`origin's default branch is not recorded locally (no network lookup was made); confirm it is ${trusted}, or set trusted_branch in both docs/workflow/config.json and .github/workflows/wf-status.yml`);
    else if (report.git.remote_default !== trusted) warn(`origin's default branch is ${report.git.remote_default}, not ${trusted}: set trusted_branch in both docs/workflow/config.json and .github/workflows/wf-status.yml`);
    const filters = targetGit(project, ['config', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$']);
    if (filters.status === 0 && filters.stdout.trim()) {
      report.git.dirty = null;
      warn('working-tree state not checked: the repository configures Git filter drivers, which a comparison would execute');
    } else {
      const status = targetGit(project, ['status', '--porcelain=v1', '-z', '--ignore-submodules=all', '--untracked-files=normal']);
      report.git.dirty = status.status === 0 ? status.stdout.length > 0 : null;
      if (report.git.dirty) warn('uncommitted changes: inspection lists tracked paths from the index; adopt from a clean tree so the scaffold is its own commit');
    }
    const listed = targetGit(project, ['ls-files', '-z', '-s', '--full-name']);
    if (listed.status !== 0) warn('could not list tracked paths');
    else {
      tracked = [];
      let symlinks = 0, submodules = 0;
      for (const entry of listed.stdout.split('\0')) {
        const m = entry.match(/^(\d{6}) [0-9a-f]+ \d\t(.*)$/s);
        if (!m) continue;
        if (m[1] === '120000') symlinks++;
        if (m[1] === '160000') { submodules++; continue; }
        tracked.push({ path: m[2], symlink: m[1] === '120000' });
      }
      tracked = [...new Map(tracked.map(e => [e.path, e])).values()];
      report.git.tracked = tracked.length; report.git.tracked_symlinks = symlinks; report.git.submodules = submodules;
      if (submodules) warn(`${submodules} submodule(s) are not inspected`);
    }
  }
  const relative = top && tracked ? path.relative(fs.realpathSync(top), fs.realpathSync(project)).split(path.sep).join('/') : '';
  const local = tracked ? tracked.filter(e => !relative || e.path.startsWith(`${relative}/`)).map(e => ({ ...e, path: relative ? e.path.slice(relative.length + 1) : e.path })) : null;

  // Existing adoption, reported as the project states it.
  const adopted = existence(project, 'docs/workflow/config.json');
  if (adopted) {
    const read = safeRead(project, 'docs/workflow/config.json');
    let data = null;
    try { data = read.text ? JSON.parse(read.text) : null; } catch { /* reported below */ }
    report.adoption = data ? {
      workflow: { repo: clean(data.workflow?.repo ?? ''), version: clean(data.workflow?.version ?? ''), revision: clean(data.workflow?.revision ?? '') },
      approval_label: clean(data.approval?.label ?? ''), repository: clean(data.repository ?? ''), trusted_branch: clean(data.trusted_branch ?? 'main'),
    } : { unreadable: read.skipped ?? 'not valid JSON' };
    warn('already adopted: wf-adopt will refuse; changing the pin is a deliberate edit of docs/workflow/config.json. Classification below uses the workflow defaults, not this project\'s config; use `scripts/wf paths` for that');
  }

  // Manifests and CI: tracked, allow-listed files only.
  if (local) {
    const manifests = [];
    for (const { path: p, symlink } of local) {
      const base = path.posix.basename(p);
      const stack = MANIFESTS[base] ?? MANIFEST_PATTERNS.find(([re]) => re.test(base))?.[1];
      if (!stack || p.split('/').includes('node_modules') || p.split('/').includes('vendor')) continue;
      manifests.push({ p, stack, symlink });
    }
    manifests.sort((a, b) => a.p.split('/').length - b.p.split('/').length || a.p.localeCompare(b.p));
    report.stack = [...new Set(manifests.map(m => m.stack))].sort();
    for (const m of manifests.slice(0, LIMITS.manifests)) report.manifests.push(m.symlink ? { path: clean(m.p), stack: m.stack, skipped: 'symbolic link (not followed)' } : manifestHints(project, m.p, m.stack));
    if (manifests.length > LIMITS.manifests) report.manifests_truncated = manifests.length - LIMITS.manifests;
    const workflows = local.filter(e => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(e.path)).slice(0, LIMITS.workflows);
    for (const { path: p, symlink } of workflows) {
      const read = symlink ? { skipped: 'symbolic link (not followed)' } : safeRead(project, p);
      report.ci.github_actions.push(read.text ? { path: clean(p), jobs: workflowJobs(read.text) } : { path: clean(p), skipped: read.skipped });
    }
    report.ci.other = OTHER_CI.filter(p => local.some(e => e.path === p));
    const seen = new Set();
    for (const w of report.ci.github_actions) for (const j of w.jobs ?? []) {
      const name = j.name ?? j.id;
      if (!seen.has(name) && !/\$\{\{/.test(name) && !w.path.endsWith('wf-status.yml')) { seen.add(name); report.suggested_required_checks.push({ name, source: `${w.path} job ${j.id}`, verified: false }); }
    }
    for (const m of report.manifests) for (const s of m.scripts ?? []) {
      if (CHECK_SCRIPT.test(s.name)) report.suggested_required_checks.push({ name: `${m.path}: ${s.name}`, source: `${m.path} scripts (not run)`, verified: false });
    }
    report.suggested_required_checks = report.suggested_required_checks.slice(0, LIMITS.entries);
  }

  // Classification of tracked paths with the pinned classifier; suggestions only for recognised code and dependency files.
  if (local) {
    const considered = local.slice(0, LIMITS.paths).map(e => e.path);
    if (local.length > LIMITS.paths) warn(`only the first ${LIMITS.paths} of ${local.length} tracked paths were classified`);
    const classes = pinned.classifyPaths(config, considered);
    const counts = {};
    for (const c of classes) counts[c.category] = (counts[c.category] ?? 0) + 1;
    const unclassified = classes.filter(c => c.category === 'unclassified').map(c => c.path);
    const proposals = new Map();
    for (const p of unclassified) {
      const base = path.posix.basename(p);
      const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : null;
      if (PRODUCTION_FILES.includes(base) || /^requirements[\w.-]*\.txt$/.test(base)) proposals.set(`**/${base.startsWith('requirements') ? 'requirements*.txt' : base}`, 'dependency or build file');
      else if (ext && CODE_EXTENSIONS.has(ext) && /^[a-z0-9]+$/.test(ext)) proposals.set(`**/*.${ext}`, 'source file extension');
    }
    // A suggestion may only claim unclassified paths: it must not move a classified path or a governing probe.
    const guard = [...classes.filter(c => c.category !== 'unclassified').map(c => c.path), ...GOVERNING_PROBES];
    const before = pinned.classifyPaths(config, guard).map(c => c.category);
    for (const [glob, reason] of proposals) {
      const trial = structuredClone(config); trial.paths.production.push(glob);
      const moved = pinned.classifyPaths(trial, guard).filter((c, i) => c.category !== before[i]);
      if (moved.length) { warn(`not suggesting ${glob}: it would reclassify ${clean(moved[0].path)}`); continue; }
      const covers = unclassified.filter(p => pinned.classifyPaths(trial, [p])[0].category === 'production').length;
      report.suggested_production.push({ glob, reason, covers });
    }
    report.suggested_production.sort((a, b) => b.covers - a.covers || a.glob.localeCompare(b.glob));
    const extra = { ...config, paths: { ...config.paths, production: [...config.paths.production, ...report.suggested_production.map(s => s.glob)] } };
    const remaining = pinned.classifyPaths(extra, unclassified).filter(c => c.category === 'unclassified').map(c => c.path);
    report.classification = {
      counts, unclassified: unclassified.length,
      unclassified_by_directory: byDirectory(unclassified),
      unclassified_sample: unclassified.slice(0, LIMITS.sample).map(p => clean(p)),
      unclassified_after_suggestions: remaining.length,
      remaining_sample: remaining.slice(0, LIMITS.sample).map(p => clean(p)),
      note: 'Paths left unclassified block `wf ci` when a pull request changes them; classify each by its effect (setup step 4) before relying on CI.',
    };
  }

  for (const rel of ADOPTION_PATHS) {
    const kind = existence(project, rel);
    if (kind) report.collisions.push({ path: rel, exists: kind, effect: rel === 'docs/workflow/config.json' ? 'adoption refused' : kind === 'symbolic link' ? 'left as it is; a symbolic link is not followed' : rel === 'CLAUDE.md' ? 'left as it is; add the workflow pointer and the section in templates/claude/compact-instructions.md yourself' : 'left as it is; add the workflow pointer yourself if it is an adapter' });
  }
  const gitignore = safeRead(project, '.gitignore');
  if (gitignore.text !== undefined && !gitignore.text.split(/\r?\n/).some(l => ['.cache/', '.cache'].includes(l.trim()))) report.collisions.push({ path: '.gitignore', exists: 'file', effect: '.cache/ is appended' });
  for (const rel of OWNERSHIP_PATHS) { const kind = existence(project, rel); if (kind) report.ownership.push({ path: rel, exists: kind, effect: 'existing code ownership: reconcile with setup step 5 by hand' }); }

  const quoted = report.suggested_production.map(s => ` --production '${s.glob}'`).join('');
  report.next = report.adoption ? null : `bin/wf-adopt --project '${project.replaceAll("'", "'\\''")}' --repository OWNER/REPOSITORY --rev ${pinned.version === 'UNRELEASED' ? pinned.revision : pinned.version} --coordinator OWNER_USERNAME --lane existing${quoted}`;
  if (pinned.version === 'UNRELEASED') warn('the workflow revision is not a released tag; adopt a released tag');
  return report;
}

export function renderText(r) {
  const lines = [`Inspection of ${clean(r.project)} (workflow ${r.workflow.version} ${r.workflow.revision})`, r.notice, ''];
  const list = (title, items) => { if (items.length) lines.push(`${title}:`, ...items.map(i => `  ${i}`), ''); };
  list('Warnings', r.warnings);
  if (r.adoption) list('Existing adoption (as the project states it)', [JSON.stringify(r.adoption)]);
  if (r.git.repository) lines.push(`Git: branch ${r.git.branch ?? '(detached)'}, origin default ${r.git.remote_default ?? 'unknown'}, shallow ${r.git.shallow}, dirty ${r.git.dirty ?? 'unchecked'}, ${r.git.tracked ?? '?'} tracked paths`, '');
  list('Stack hints', r.stack);
  list('Manifests (untrusted; scripts are shown, never run)', r.manifests.map(m => `${m.path} [${m.stack}]${m.skipped ? ` skipped: ${m.skipped}` : ''}${m.scripts ? ` scripts: ${m.scripts.map(s => s.name).join(', ')}` : ''}`));
  list('GitHub Actions jobs (untrusted)', r.ci.github_actions.map(w => `${w.path}: ${w.skipped ? `skipped: ${w.skipped}` : w.jobs.map(j => j.name ? `${j.id} (${j.name})` : j.id).join(', ')}`));
  list('Other CI files', r.ci.other);
  list('Required-check hints (unverified; confirm the exact names CI reports)', r.suggested_required_checks.map(s => `${s.name} — ${s.source}`));
  if (r.classification) {
    lines.push(`Classification with the pinned defaults: ${Object.entries(r.classification.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    list('Suggested --production globs', r.suggested_production.map(s => `${s.glob} (${s.reason}; covers ${s.covers})`));
    list(`Unclassified by top-level directory (${r.classification.unclassified})`, r.classification.unclassified_by_directory.map(d => `${d.prefix} ${d.count}`));
    list(`Still unclassified after the suggestions (${r.classification.unclassified_after_suggestions}; sample)`, r.classification.remaining_sample);
    lines.push(r.classification.note, '');
  }
  list('Adoption collisions', r.collisions.map(c => `${c.path} (${c.exists}): ${c.effect}`));
  list('Code ownership', r.ownership.map(c => `${c.path} (${c.exists}): ${c.effect}`));
  if (r.next) lines.push('Adopt with (fill in the placeholders):', `  ${r.next}`);
  return lines.join('\n');
}

export { InspectError };
