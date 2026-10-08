import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource, loadConfig } from '../lib/index.js';
import { evaluateClient, renderClient } from '../lib/client.js';

// `wf status --client` (MAINT-0008): the records as plain-language progress for a client. It must say where each stage
// stands in words a client understands, and must not carry IDs, people, branches or reasons out of the records.
const root = fileURLToPath(new URL('../..', import.meta.url));
const cli = path.join(root, 'validator/cli.js');

function project(t, { client, extraMilestones = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-client-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.default.json'), 'utf8'));
  write('docs/workflow/config.json', JSON.stringify({ ...config, repository: 'acme/shop', ...(client ? { client } : {}) }));
  write('docs/workflow/profile.md', '---\nrecord: profile\nproject: shop\nworkflow_version: v1\napproval_mechanism: owner-merge\napproval_label: owner-merge\ncoordinator: alice-owner\nmeasure: A customer can order a cake online.\nreadiness: Ready\nrequired_checks: [test]\nsetup_budget_days: 2\n---\n# Profile\n');
  const milestone = (id, status, title, outcome, tasks = []) => write(`docs/workflow/milestones/${id}.md`, `---\nrecord: milestone\nid: ${id}\noutcome: ${outcome}\nstatus: ${status}\ncoordinator: agent\nowner: alice-owner\nscope: [src]\ngoverning: [PROFILE]\nacceptance: []\nauthority: owner\nlimits: x\ndemonstration: x\nstop_conditions: x\nrelease_authority: owner\ntasks: [${tasks.join(', ')}]\n---\n# ${id} — ${title}\n`);
  milestone('M-0001', 'Released', 'Menu and prices online', 'Owners can update the menu.');
  milestone('M-0002', 'Active', 'Online ordering', 'Customers choose a cake and pay by card.', ['T-0001', 'T-0002', 'T-0003', 'T-0004']);
  milestone('M-0003', 'Draft', 'coherent journey or demonstrable technical outcome', 'The bakery sees each day\'s orders.');
  for (const [id, status, title] of extraMilestones) milestone(id, status, title, `${title}.`);
  const task = (id, status) => write(`docs/workflow/tasks/${id}.md`, `---\nrecord: task\nid: ${id}\ntitle: Secret task ${id} for bob-worker\nstatus: ${status}\nmilestone: M-0002\nowner: bob-worker\nscope: [src]\ngoverning: [PROFILE]\nacceptance: []\nresume_condition: decision D-0007 on the card provider\n---\n# ${id}\n`);
  task('T-0001', 'Done'); task('T-0002', 'Done'); task('T-0003', 'Active'); task('T-0004', 'Blocked');
  return dir;
}

test('the client view names each stage in plain words, with parts done and on hold', t => {
  const view = evaluateClient({ source: dirSource(project(t)), updated: '2026-10-08T10:00:00Z' });
  assert.equal(view.title, 'shop');
  assert.equal(view.headline, 'Now working on online ordering.');
  assert.deepEqual([view.delivered, view.total, view.current], [1, 3, 1]);
  assert.deepEqual(view.stages.map(s => [s.title, s.status, s.parts, s.on_hold]), [
    ['Menu and prices online', 'Delivered', null, 0],
    ['Online ordering', 'In progress', { done: 2, total: 4 }, 1],
    ['The bakery sees each day\'s orders.', 'Planned', null, 0],
  ]);
  assert.equal(view.stages[2].outcome, null, 'a placeholder heading falls back to the outcome, shown once');
});

test('the headline follows the project: awaiting sign-off, all delivered, nothing yet', t => {
  const review = evaluateClient({ source: dirSource(project(t, { extraMilestones: [['M-0004', 'Verified', 'Gift cards']] })) });
  assert.equal(review.headline, 'Gift cards: built and checked, and waiting for sign-off.');
  const dir = project(t);
  for (const id of ['M-0002', 'M-0003']) fs.rmSync(path.join(dir, `docs/workflow/milestones/${id}.md`));
  assert.equal(evaluateClient({ source: dirSource(dir) }).headline, 'Everything planned so far is delivered.');
  fs.rmSync(path.join(dir, 'docs/workflow/milestones/M-0001.md'));
  const empty = evaluateClient({ source: dirSource(dir) });
  assert.equal(empty.headline, 'The project is being planned.');
  assert.match(renderClient(empty), /The stages appear here once the first one is planned/);
});

test('a paused milestone says so, an unknown status reads as planned, and Up next leads when nothing is under way', t => {
  const paused = project(t, { extraMilestones: [['M-0004', 'Blocked', 'Gift cards']] });
  fs.writeFileSync(path.join(paused, 'docs/workflow/milestones/M-0002.md'), fs.readFileSync(path.join(paused, 'docs/workflow/milestones/M-0002.md'), 'utf8').replace('status: Active', 'status: Authorised').replace('tasks: [T-0001, T-0002, T-0003, T-0004]', 'tasks: [T-0001, T-0001, T-0002]'));
  const view = evaluateClient({ source: dirSource(paused) });
  assert.equal(view.headline, 'Gift cards is paused for now.');
  assert.deepEqual(view.stages.map(s => s.status), ['Delivered', 'Up next', 'Planned', 'Paused for now']);
  assert.deepEqual(view.stages[1].parts, { done: 2, total: 4 }, 'a task planned twice counts once; the records are the larger count');
  fs.rmSync(path.join(paused, 'docs/workflow/milestones/M-0004.md'));
  assert.equal(evaluateClient({ source: dirSource(paused) }).headline, 'Next: online ordering.');
  fs.writeFileSync(path.join(paused, 'docs/workflow/milestones/M-0002.md'), fs.readFileSync(path.join(paused, 'docs/workflow/milestones/M-0002.md'), 'utf8').replace('status: Authorised', 'status: Someday'));
  assert.equal(evaluateClient({ source: dirSource(paused) }).stages[1].status, 'Planned', 'never a raw record word');
});

test('the page carries no IDs, people, branches or reasons, and escapes record text', t => {
  const dir = project(t, { client: { title: 'Layla\'s <Bakery>', exclude: ['M-0003'] } });
  fs.appendFileSync(path.join(dir, 'docs/workflow/milestones/M-0002.md'), '');
  const text = fs.readFileSync(path.join(dir, 'docs/workflow/milestones/M-0002.md'), 'utf8').replace('Online ordering', 'Online <script>alert(1)</script> ordering');
  fs.writeFileSync(path.join(dir, 'docs/workflow/milestones/M-0002.md'), text);
  const html = renderClient(evaluateClient({ source: dirSource(dir), updated: '2026-10-08T10:00:00Z' }));
  for (const leak of ['M-000', 'T-000', 'D-0007', 'alice-owner', 'bob-worker', 'Secret task', 'card provider', 'Daily', 'bakery sees']) assert.ok(!html.includes(leak), `leaked ${leak}`);
  assert.ok(!html.includes('<script>'), 'record text is escaped');
  assert.match(html, /Online &lt;script&gt;alert\(1\)&lt;\/script&gt; ordering/);
  assert.match(html, /<title>Layla&#39;s &lt;Bakery&gt;: progress<\/title>/);
  assert.match(html, /2 of 4 parts done, 1 on hold/);
  assert.match(html, /Updated 8 October 2026\./);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(html, /<(link|script|img)\b|https?:\/\//, 'self-contained: nothing is fetched');
});

test('wf status --client prints the page; the option is refused elsewhere; client config is checked', t => {
  const dir = project(t);
  const r = spawnSync(process.execPath, [cli, 'status', '--client', '--repo', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^<!doctype html>/);
  // From a commit, the page is dated by the commit, not by today.
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'records', '--date', '2026-03-05T12:00:00Z']]) assert.equal(spawnSync('git', ['-C', dir, ...args], { env: { ...process.env, GIT_COMMITTER_DATE: '2026-03-05T12:00:00Z' } }).status, 0);
  const dated = spawnSync(process.execPath, [cli, 'status', '--client', '--repo', dir, '--candidate', 'HEAD'], { encoding: 'utf8' });
  assert.equal(dated.status, 0, dated.stderr);
  assert.match(dated.stdout, /Updated 5 March 2026\./);
  for (const args of [['ci', '--client', '--baseline', dir], ['status', '--client', '--json']]) {
    const refused = spawnSync(process.execPath, [cli, ...args, '--repo', dir], { encoding: 'utf8' });
    assert.equal(refused.status, 2, refused.stdout + refused.stderr);
    assert.match(refused.stderr, /--client is only for status/);
  }
  for (const [client, message] of [[{ colour: 'red' }, /client may contain only title, exclude, language, theme/], [{ language: 'fr' }, /en or ar/],
    [{ theme: { colors: { brand: 'red; } body { display: none' } } }, /hex colour/], [{ theme: { fonts: { text: 'X"; } * { color: red' } } }, /plain font name/],
    [{ theme: { logo: '../secret.svg' } }, /inside the repository/], [{ theme: { fonts: { files: [{ family: 'Zain', file: '/etc/passwd' }] } } }, /inside the repository/],
    [{ theme: { radius: 99 } }, /0 to 40/], [{ theme: { shadow: 'big' } }, /client.theme may contain only/], [{ exclude: ['T-0001'] }, /milestone IDs/], [{ title: 3 }, /client.title must be a string/]]) {
    assert.throws(() => loadConfig(dirSource(project(t, { client }))), message);
  }
});

test('wf-adopt installs the Pages workflow only on request, with a public-page warning in the checklist', t => {
  if (spawnSync('git', ['-C', root, 'cat-file', '-e', 'HEAD:templates/github/wf-client-page.yml']).status !== 0) return t.skip('template not committed at HEAD');
  const adopt = (dir, ...extra) => spawnSync(process.execPath, [path.join(root, 'bin/wf-adopt'), '--project', dir, '--workflow-repo', root, '--rev', 'HEAD', '--repository', 'acme/shop', '--coordinator', 'owner', ...extra], { encoding: 'utf8' });
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-client-adopt-')), paged = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-client-adopt-'));
  t.after(() => { fs.rmSync(plain, { recursive: true, force: true }); fs.rmSync(paged, { recursive: true, force: true }); });
  for (const d of [plain, paged]) spawnSync('git', ['-C', d, 'init', '-q']);
  assert.equal(adopt(plain).status, 0);
  assert.ok(!fs.existsSync(path.join(plain, '.github/workflows/wf-client-page.yml')), 'never by default');
  assert.equal(adopt(paged, '--client-page').status, 0);
  const workflow = fs.readFileSync(path.join(paged, '.github/workflows/wf-client-page.yml'), 'utf8');
  assert.match(workflow, /branches: \[main\]/); assert.doesNotMatch(workflow, /__TRUSTED_BRANCH__/);
  assert.match(workflow, /scripts\/wf status --client/);
  assert.match(fs.readFileSync(path.join(paged, 'docs/workflow/setup.md'), 'utf8'), /^- \[ \] \*\*Turn on the client page \(optional\)\.\*\* Turn on GitHub Pages .* The page is public, even for a private repository/m);
});

// The client's design system and language (MAINT-0008 follow-up): colours, fonts and logo from `client.theme`, Arabic and
// right-to-left from `client.language`. The default design is unchanged without them.
test('a theme dresses the page in the client\'s design system, and Arabic turns it right-to-left', t => {
  const theme = { colors: { brand: '#174A7C', on_brand: '#FFFFFF', page: '#FBF8F4', active: '#174A7C' }, fonts: { text: 'IBM Plex Sans Arabic', display: 'Zain', files: [{ family: 'Zain', weight: 700, file: 'docs/workflow/client/Zain-Bold.woff2' }] }, logo: 'docs/workflow/client/logo.svg', radius: 14 };
  const dir = project(t, { client: { title: 'بُن الكيف', language: 'ar', theme } });
  fs.mkdirSync(path.join(dir, 'docs/workflow/client'), { recursive: true });
  const font = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0xff, 0x10, 0x80]); // binary, not UTF-8
  fs.writeFileSync(path.join(dir, 'docs/workflow/client/Zain-Bold.woff2'), font);
  fs.writeFileSync(path.join(dir, 'docs/workflow/client/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'records']]) assert.equal(spawnSync('git', ['-C', dir, ...args]).status, 0);
  for (const candidate of [[], ['--candidate', 'HEAD']]) {
    const r = spawnSync(process.execPath, [cli, 'status', '--client', '--repo', dir, ...candidate], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const html = r.stdout;
    assert.match(html, /<html lang="ar" dir="rtl">/);
    assert.match(html, /<title>بُن الكيف: سير العمل<\/title>/);
    assert.match(html, /<h1>نعمل الآن على: <bdi>Online ordering<\/bdi>\.<\/h1>/, 'English record text keeps its direction in Arabic');
    assert.match(html, /<h3><bdi>Online ordering<\/bdi><\/h3>/);
    assert.match(html, /آخر تحديث: \d{1,2} أكتوبر 2026\./, 'an Arabic date with Western digits');
    assert.match(html, /المراحل المسلّمة: 1 من 3\./);
    assert.match(html, /الأجزاء المنجزة: 2 من 4، والمتوقفة: 1/);
    assert.match(html, /--brand: #174A7C;/); assert.match(html, /--page: #FBF8F4;/); assert.match(html, /--radius: 14px;/);
    assert.ok(html.includes(`src: url(data:font/woff2;base64,${font.toString('base64')})`), 'the font is embedded byte for byte, from the working tree and from a commit');
    assert.match(html, /<div class="band"><div class="inner"><img src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+" alt="بُن الكيف">/);
    assert.match(html, /color-scheme: light;/); assert.doesNotMatch(html, /prefers-color-scheme: dark/, 'a brand palette has no invented dark mode');
    assert.match(html, /inset-inline-start/); assert.doesNotMatch(html, /\bleft:/, 'logical properties only, so the route mirrors');
    assert.doesNotMatch(html, /<script|https?:\/\/(?!www\.w3\.org)/, 'still self-contained');
  }
  fs.rmSync(path.join(dir, 'docs/workflow/client/logo.svg'));
  const missing = spawnSync(process.execPath, [cli, 'status', '--client', '--repo', dir], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /client.theme: docs\/workflow\/client\/logo.svg is not a file/);
});

test('without a theme the page keeps the default design, in both languages', t => {
  const html = renderClient(evaluateClient({ source: dirSource(project(t)) }));
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.match(html, /--page: #f2f5f1;/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.doesNotMatch(html, /class="band"|@font-face/);
  const arabic = renderClient(evaluateClient({ source: dirSource(project(t, { client: { language: 'ar' } })) }));
  assert.match(arabic, /<html lang="ar" dir="rtl">/);
  assert.match(arabic, /<h2 id="stages">المراحل<\/h2>/);
  assert.match(arabic, /prefers-color-scheme: dark/);
});

test('theme limits and edges: the 2 MB budget before reading, file types, a partial dark set, a band without a logo', t => {
  const dir = project(t);
  const configPath = path.join(dir, 'docs/workflow/config.json');
  const setTheme = theme => { const c = JSON.parse(fs.readFileSync(configPath, 'utf8')); c.client = { theme }; fs.writeFileSync(configPath, JSON.stringify(c)); };
  fs.mkdirSync(path.join(dir, 'docs/workflow/client'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/workflow/client/big.woff2'), Buffer.alloc(2 * 1024 * 1024 + 1));
  fs.writeFileSync(path.join(dir, 'docs/workflow/client/logo.gif'), 'GIF89a');
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'records']]) assert.equal(spawnSync('git', ['-C', dir, ...args]).status, 0);
  setTheme({ fonts: { files: [{ family: 'Big', file: 'docs/workflow/client/big.woff2' }] } });
  for (const candidate of [[], ['--candidate', 'HEAD']]) {
    if (candidate.length) { spawnSync('git', ['-C', dir, 'add', '.']); spawnSync('git', ['-C', dir, '-c', 'user.name=F', '-c', 'user.email=f@example.invalid', 'commit', '-qm', 'theme']); }
    const r = spawnSync(process.execPath, [cli, 'status', '--client', '--repo', dir, ...candidate], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /exceed 2 MB/, 'refused as too large, from the working tree and from a commit');
  }
  setTheme({ logo: 'docs/workflow/client/logo.gif' });
  assert.throws(() => evaluateClient({ source: dirSource(dir) }), /must be one of svg, png, jpg, jpeg, webp/);
  setTheme({ colors: { brand: '#174A7C' }, dark: { page: '#101418' } });
  const html = renderClient(evaluateClient({ source: dirSource(dir) }));
  const dark = html.match(/prefers-color-scheme: dark\) \{ :root \{ ([^}]*) \}/)[1];
  assert.match(dark, /--page: #101418;/); assert.match(dark, /--text: #e4ebe8;/, 'colours a dark set leaves out come from the default dark palette');
  assert.equal(html.match(/>shop</g)?.length, 1, 'a band without a logo names the project once');
  assert.match(html, /<div class="band"><div class="inner"><p>shop<\/p>/);
});
