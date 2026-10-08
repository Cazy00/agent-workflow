// The setup page (bin/wf-setup, MAINT-0009): adopt the workflow and change its settings later from a local web page.
// Before adoption it collects bin/wf-adopt's choices and runs the scaffold; afterwards it edits the settings an owner
// chooses (approval mode and accounts, the project's name and measure, required checks, production paths, the client
// page) in docs/workflow/config.json and the profile, validating a copy before it writes, and lets the owner tick
// their own setup steps. It never commits, pushes or approves: a settings change is a governing or workflow change
// that reaches the trusted branch through the approval route like any other. The server listens on 127.0.0.1 only,
// and every request needs the session's random token and this server's own Host, so another site in the browser
// cannot drive it.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirSource, list, listedOwners, loadAll, loadConfig, validateRecords } from '../validator/lib/index.js';
import { parseFrontMatter } from '../validator/lib/frontmatter.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const MILESTONE = /^M-\d{4}$/;
const MECHANISM = { manual: 'manual-signed-receipts', 'owner-merge': 'owner-merge', enforced: 'github-rulesets-codeowners' };
const VERSION = /^[\w.\/-]+$/;
// Inspection reads the whole tracked tree: once per server and revision, not on every reload of the page.
const inspected = new Map();
async function inspectOnce(args) {
  const key = JSON.stringify(args);
  if (!inspected.has(key)) inspected.set(key, import('./inspect.mjs').then(m => m.inspectProject(args)));
  return inspected.get(key);
}

const git = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 20000 });
const rel = project => p => path.join(project, p);

// One line of front matter text: no line breaks, and for list items nothing that would split or close the list.
function oneLine(value, what) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length > 400) throw new Error(`${what} is longer than 400 characters`);
  return text;
}
// A list: for the front matter (`[a, b]`) no item may hold a comma or a bracket; JSON lists (globs) may.
function items(values, what, { frontMatter = true } = {}) {
  if (!Array.isArray(values)) throw new Error(`${what} must be a list`);
  const out = [...new Set(values.map(v => oneLine(v, what)).filter(Boolean))];
  if (frontMatter) for (const v of out) if (/[,[\]]/.test(v)) throw new Error(`${what}: "${v}" cannot contain a comma or a square bracket`);
  return out;
}

// Replaces or adds `key: value` lines in a record's front matter, leaving every other line and the body as they are.
export function setFrontMatter(text, values) {
  const lines = text.split('\n');
  if (lines[0].replace(/\r$/, '') !== '---') throw new Error('the profile has no front matter');
  const end = lines.findIndex((l, i) => i > 0 && l.replace(/\r$/, '') === '---');
  if (end === -1) throw new Error('the profile\'s front matter is not closed');
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}: ${Array.isArray(value) ? `[${value.join(', ')}]` : value ?? ''}`.trimEnd();
    const at = lines.slice(1, end).findIndex(l => new RegExp(`^${key}:`).test(l));
    if (at === -1) { lines.splice(end, 0, line); continue; }
    lines[at + 1] = line;
  }
  return lines.join('\n');
}

// Owner and agent setup steps, as the setup record lists them; the owner's can be ticked here.
function checklist(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const agentAt = lines.findIndex(l => /^## Agent steps/.test(l));
  const steps = [];
  lines.forEach((line, index) => {
    const m = line.match(/^- \[( |x|X)\] (.*)$/);
    if (m) steps.push({ index, who: agentAt !== -1 && index > agentAt ? 'agent' : 'owner', done: m[1] !== ' ', text: m[2] });
  });
  return steps;
}

function remoteRepository(project) {
  const url = git(project, 'remote', 'get-url', 'origin').stdout?.trim() ?? '';
  const m = url.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : '';
}

export async function readState({ project, workflowRepo }) {
  const file = rel(project);
  const adopted = fs.existsSync(file('docs/workflow/config.json'));
  const state = { project, name: path.basename(project), adopted };
  if (!adopted) {
    const repository = remoteRepository(project);
    const tags = (git(workflowRepo, 'tag', '--sort=-creatordate').stdout ?? '').split('\n').filter(t => /^v\d/.test(t)).slice(0, 12);
    let inspection = null;
    try { inspection = await inspectOnce({ project, workflowRepo, rev: tags[0] ?? 'HEAD' }); } catch (e) { inspection = { error: e.message }; }
    state.defaults = {
      repository, coordinator: repository.split('/')[0] ?? '',
      lane: git(project, 'rev-parse', '--verify', '--quiet', 'HEAD').status === 0 ? 'existing' : 'new',
      versions: tags.length ? tags : ['HEAD'],
      production: (inspection?.suggested_production ?? []).map(s => ({ glob: s.glob, reason: s.reason, covers: s.covers })),
      warnings: inspection?.warnings ?? (inspection?.error ? [inspection.error] : []),
      collisions: inspection?.collisions ?? [],
    };
    return state;
  }
  const source = dirSource(project);
  const config = loadConfig(source);
  const rd = config.records_dir ?? 'docs/workflow';
  const profile = loadAll(source, rd).profile?.data ?? {};
  const owners = listedOwners(profile);
  let suggestedChecks = [];
  try { suggestedChecks = (await inspectOnce({ project, workflowRepo, rev: config.workflow?.revision || 'HEAD' })).suggested_required_checks.map(s => s.name); } catch { /* suggestions are optional */ }
  state.settings = {
    repository: config.repository ?? '', trusted_branch: config.trusted_branch ?? 'main', workflow: config.workflow ?? {},
    owners, shared: owners.length >= 2,
    approval: { label: config.approval?.label ?? 'manual', approver: config.approval?.approver ?? '', agent_identity: config.approval?.agent_identity ?? '', derived_baselines: config.approval?.derived_baselines === true },
    project: profile.project ?? '', measure: profile.measure ?? '', coordinator: profile.coordinator ?? '',
    required_checks: list(profile.required_checks), production: list(config.paths?.production),
    // The workflow's own defaults, so the page can show what this project adds and fold the rest away.
    default_production: (() => { try { return list(JSON.parse(fs.readFileSync(path.join(workflowRepo, 'config.default.json'), 'utf8')).paths?.production); } catch { return []; } })(),
    client: { title: config.client?.title ?? '', exclude: list(config.client?.exclude) },
    milestones: [...loadAll(source, rd).milestones.values()].map(r => r.data?.id).filter(Boolean).sort(),
  };
  state.suggested_checks = suggestedChecks.filter(c => !state.settings.required_checks.includes(c));
  state.checklist = checklist(source.read(`${rd}/setup.md`));
  return state;
}

// bin/wf-adopt's arguments from the form; the scaffold itself checks them again.
export function adoptArguments(form, project) {
  const args = ['--project', project];
  const repository = oneLine(form.repository, 'repository');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('the repository must look like OWNER/REPOSITORY');
  const coordinator = oneLine(form.coordinator, 'your GitHub username');
  if (!USERNAME.test(coordinator)) throw new Error('your GitHub username is not a valid username');
  const version = oneLine(form.version || 'HEAD', 'version');
  if (!VERSION.test(version) || version.startsWith('-')) throw new Error('choose a workflow release');
  args.push('--repository', repository, '--coordinator', coordinator, '--rev', version);
  if (!['manual', 'owner-merge'].includes(form.approval)) throw new Error('choose how you approve work');
  args.push('--approval', form.approval);
  if (form.worker) { const w = oneLine(form.worker, 'the agent\'s account'); if (!USERNAME.test(w)) throw new Error('the agent\'s GitHub account is not a valid username'); args.push('--worker', w); }
  if (!['new', 'existing'].includes(form.lane)) throw new Error('say whether the repository already has code');
  args.push('--lane', form.lane);
  for (const glob of items(form.production ?? [], 'production paths', { frontMatter: false })) args.push('--production', glob);
  if (form.client_page === true) args.push('--client-page');
  return args;
}

export function adopt({ project, workflowRepo, form }) {
  const args = adoptArguments(form, project);
  const r = spawnSync(process.execPath, [path.join(workflowRepo, 'bin/wf-adopt'), '--workflow-repo', workflowRepo, ...args], { encoding: 'utf8', timeout: 180000 });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}`.trim() };
}

// Applies the settings form. Everything is checked on a copy of the records first; nothing is written on an error.
export function saveSettings({ project, form }) {
  const file = rel(project);
  const configText = fs.readFileSync(file('docs/workflow/config.json'), 'utf8');
  const config = JSON.parse(configText);
  const rd = config.records_dir ?? 'docs/workflow';
  const profilePath = `${rd}/profile.md`;
  const profileText = fs.readFileSync(file(profilePath), 'utf8');
  const before = parseFrontMatter(profileText).data ?? {};
  const shared = listedOwners(before).length >= 2;
  const label = form.approval?.label;
  if (!['manual', 'owner-merge', 'enforced'].includes(label)) throw new Error('choose an approval mode');
  if (label === 'owner-merge' && shared) throw new Error('owner-merge is for one owner; a shared project uses manual or enforced');
  const approver = oneLine(form.approval?.approver, 'the owner\'s username'), worker = oneLine(form.approval?.agent_identity, 'the agent\'s account');
  for (const [name, value] of [['the owner\'s username', approver], ['the agent\'s account', worker]]) if (value && !USERNAME.test(value)) throw new Error(`${name} is not a valid GitHub username`);
  if (worker && approver && worker.toLowerCase() === approver.toLowerCase()) throw new Error('the agent\'s account must differ from yours; leave it empty to work with one account');
  if (label === 'enforced' && !shared && !worker) throw new Error('enforced mode needs the agent\'s own account: GitHub never lets you approve your own pull request');
  if (label === 'enforced' && !shared && !approver) throw new Error('enforced mode needs your GitHub username: code-owner review names you');
  const branch = oneLine(form.trusted_branch, 'the trusted branch');
  if (!/^[\w./-]+$/.test(branch)) throw new Error('the trusted branch must be a plain branch name');
  const exclude = items(form.client?.exclude ?? [], 'hidden stages');
  for (const id of exclude) if (!MILESTONE.test(id)) throw new Error(`hidden stages must be milestone IDs like M-0001 (got ${id})`);

  const next = structuredClone(config);
  next.trusted_branch = branch;
  next.approval = { ...(next.approval ?? {}), label, approver, agent_identity: worker, derived_baselines: form.approval?.derived_baselines === true };
  if (MECHANISM[label]) next.approval.mechanism = MECHANISM[label];
  next.paths = { ...(next.paths ?? {}), production: items(form.production ?? [], 'production paths', { frontMatter: false }) };
  const title = oneLine(form.client?.title, 'the client page title');
  if (title || exclude.length) next.client = { ...(title ? { title } : {}), ...(exclude.length ? { exclude } : {}) };
  else delete next.client;
  const values = {
    project: oneLine(form.project, 'the project name') || before.project,
    measure: oneLine(form.measure, 'the measure'),
    approval_label: label,
    required_checks: items(form.required_checks ?? [], 'required checks'),
  };
  if (MECHANISM[label]) values.approval_mechanism = MECHANISM[label];
  for (const key of ['project', 'measure']) if (/^\[.*\]$/.test(values[key] ?? '')) throw new Error(`the ${key} cannot be wrapped in square brackets`);
  const nextConfig = `${JSON.stringify(next, null, 2)}\n`;
  const nextProfile = setFrontMatter(profileText, values);

  // The project as it would be with the two new files, checked as the validator checks it; everything else (specs,
  // acceptance tests, records) is read from the project itself.
  const real = dirSource(project);
  const pending = new Map([['docs/workflow/config.json', nextConfig], [profilePath, nextProfile]]);
  const source = { ...real, read: p => pending.has(p) ? pending.get(p) : real.read(p), exists: p => pending.has(p) || real.exists(p), isFile: p => pending.has(p) || real.isFile(p) };
  loadConfig(source);
  const already = new Set(validateRecords(real, rd).errors);
  const errors = validateRecords(source, rd).errors.filter(e => !already.has(e)); // only what this change introduces
  if (errors.length) throw new Error(errors.join('; '));

  const changed = [];
  if (nextConfig !== configText) { fs.writeFileSync(file('docs/workflow/config.json'), nextConfig); changed.push('docs/workflow/config.json'); }
  if (nextProfile !== profileText) { fs.writeFileSync(file(profilePath), nextProfile); changed.push(profilePath); }
  const notes = [];
  if (label !== config.approval?.label) notes.push(`The approval mode changes from ${config.approval?.label ?? 'manual'} to ${label}. ${label === 'enforced' ? 'Switch only once wf-protect --target enforced passes (setup step 9), and update AGENTS.md\'s auto-merge sentence in the same pull request.' : label === 'owner-merge' ? 'Your own merge becomes the approval, and nothing proves who merged; update AGENTS.md\'s merge sentence in the same pull request.' : 'Receipts you sign become the approval again.'}`);
  if (label !== config.approval?.label && [label, config.approval?.label ?? 'manual'].every(l => l !== 'enforced')) notes.push(`The owner steps in ${rd}/setup.md were written for the old mode: update steps 2, 6 and 9 there${label === 'owner-merge' ? ', and state under Supported scope that nothing proves who merged' : ''}.`);
  if (JSON.stringify(values.required_checks) !== JSON.stringify(list(before.required_checks))) notes.push('Required checks changed: after this is approved, rerun wf-protect --apply so GitHub requires them too.');
  if (approver !== (config.approval?.approver ?? '')) notes.push('Your username changed: update .github/CODEOWNERS to name it in the same pull request.');
  if (branch !== (config.trusted_branch ?? 'main')) notes.push(`The trusted branch changed: change the branch named in .github/workflows/wf-status.yml${fs.existsSync(file('.github/workflows/wf-client-page.yml')) ? ' and wf-client-page.yml' : ''} in the same pull request.`);
  return { ok: true, changed, notes, next: changed.length ? 'These are governing and workflow changes: commit them on a branch and open a pull request (in manual mode you also sign a governing-change and a workflow-change receipt). This page never commits or pushes.' : 'Nothing changed.' };
}

export function tickStep({ project, index, done, text }) {
  const config = JSON.parse(fs.readFileSync(path.join(project, 'docs/workflow/config.json'), 'utf8'));
  const file = path.join(project, config.records_dir ?? 'docs/workflow', 'setup.md');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const step = checklist(lines.join('\n')).find(s => s.index === index);
  if (!step || step.text !== text) throw new Error('the setup record changed since this page loaded: reload it');
  if (step.who !== 'owner') throw new Error('agent steps are ticked by the agent, in its own session');
  lines[index] = `- [${done ? 'x' : ' '}] ${step.text}`;
  fs.writeFileSync(file, lines.join('\n'));
  return { ok: true };
}

// The local server. `onQuit` runs when the owner presses Done on the page.
export function createSetupServer({ project, workflowRepo, token = randomBytes(24).toString('hex'), onQuit = () => {} }) {
  const page = fs.readFileSync(path.join(HERE, 'setup-page.html'), 'utf8').replace('__TOKEN__', token);
  const secret = Buffer.from(token);
  const authorised = url => { const t = Buffer.from(url.searchParams.get('t') ?? ''); return t.length === secret.length && timingSafeEqual(t, secret); };
  const server = http.createServer((req, res) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
      res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    };
    const { port } = server.address();
    // Only this server's own address: a page elsewhere that resolves its name to 127.0.0.1 is refused.
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return send(403, { error: 'wrong host' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!authorised(url)) return send(403, { error: 'open the address wf-setup printed, with its token' });
    if (req.method === 'GET' && url.pathname === '/') return send(200, page, 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/state') return readState({ project, workflowRepo }).then(s => send(200, s), e => send(500, { error: e.message }));
    if (req.method !== 'POST') return send(404, { error: 'not found' });
    if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) return send(415, { error: 'JSON only' });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(403, { error: 'wrong origin' });
    let body = '';
    req.setEncoding('utf8');
    let tooLarge = false;
    req.on('data', chunk => { if (tooLarge) return; body += chunk; if (body.length > 65536) { tooLarge = true; send(413, { error: 'request too large' }); req.destroy(); } });
    req.on('end', () => {
      if (tooLarge) return;
      let input;
      try { input = JSON.parse(body || '{}'); } catch { return send(400, { error: 'invalid JSON' }); }
      try {
        if (url.pathname === '/api/adopt') {
          if (fs.existsSync(path.join(project, 'docs/workflow/config.json'))) throw new Error('this project is adopted already');
          return send(200, adopt({ project, workflowRepo, form: input }));
        }
        if (url.pathname === '/api/settings') return send(200, saveSettings({ project, form: input }));
        if (url.pathname === '/api/step') return send(200, tickStep({ project, ...input }));
        if (url.pathname === '/api/quit') { send(200, { ok: true }); return setImmediate(onQuit); }
        return send(404, { error: 'not found' });
      } catch (e) { return send(400, { error: e.message }); }
    });
  });
  return { server, token };
}
