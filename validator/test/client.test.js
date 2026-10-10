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
  // Plain task titles, except T-0002, whose title is a developer's and whose client_title is what the client reads.
  const NAMES = { 'T-0001': 'title: Choose a cake', 'T-0002': 'title: Stripe PaymentIntent webhook for bob-worker\nclient_title: Pay by card', 'T-0003': 'title: Email the receipt', 'T-0004': 'title: Gift message\ndecisions: [D-0007]' };
  const task = (id, status) => write(`docs/workflow/tasks/${id}.md`, `---\nrecord: task\nid: ${id}\n${NAMES[id]}\nstatus: ${status}\nmilestone: M-0002\nowner: bob-worker\nscope: [src]\ngoverning: [PROFILE]\nacceptance: []\nresume_condition: decision D-0007 on the card provider\n---\n# ${id}\n`);
  task('T-0001', 'Done'); task('T-0002', 'Done'); task('T-0003', 'Active'); task('T-0004', 'Blocked');
  write('docs/workflow/decisions/D-0007.md', '---\nrecord: decision\nid: D-0007\nquestion: Which gift wrap options do we offer?\ntype: decision\nowner: alice-owner\naffects: []\nrequired_before: implement\nstatus: Proposed\n---\n# D-0007\n');
  write('docs/workflow/decisions/D-0008.md', '---\nrecord: decision\nid: D-0008\nquestion: Internal hosting provider choice\ntype: decision\nowner: alice-owner\naffects: [src/server]\nrequired_before: implement\nstatus: Open\n---\n# D-0008\n');
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
  for (const leak of ['M-000', 'T-000', 'D-000', 'alice-owner', 'bob-worker', 'Stripe', 'card provider', 'Internal hosting', 'src/server', 'Daily', 'bakery sees']) assert.ok(!html.includes(leak), `leaked ${leak}`);
  assert.match(html, /<bdi>Pay by card<\/bdi>/, 'a task\'s client_title is what the client reads');
  assert.match(html, /<p class="question"><bdi>Which gift wrap options do we offer\?<\/bdi><\/p><p class="meta">An answer is proposed and waiting for approval\. Holds up: <bdi>Gift message<\/bdi><\/p>/, 'a decision shows while it holds up a part on the page');
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
  for (const [client, message] of [[{ colour: 'red' }, /client may contain only title, exclude, language, detail, theme/], [{ language: 'fr' }, /en or ar/],
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
  assert.match(fs.readFileSync(path.join(paged, 'docs/workflow/setup.md'), 'utf8'), /^- \[ \] \*\*Turn on the client page\.\*\* Turn on GitHub Pages .* The page is public, even for a private repository/m);
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

// The page's depth (MAINT-0008 follow-up): what is being worked on now, what comes next and in what order, what waits on
// a decision, and each stage's parts with their state, plan order and work added along the way.
test('the page shows now, next, what waits on a decision, and each stage\'s parts in plan order', t => {
  const dir = project(t, { extraMilestones: [['M-0004', 'Draft', 'Gift cards']] });
  const write = (rel, body) => fs.writeFileSync(path.join(dir, rel), body);
  write('docs/workflow/tasks/T-0005.md', '---\nrecord: task\nid: T-0005\ntitle: Order tracking page\nstatus: Ready\nmilestone: M-0002\nowner: bob-worker\nscope: [src]\ngoverning: [PROFILE]\nacceptance: []\n---\n# T\n');
  write('docs/workflow/tasks/T-0006.md', '---\nrecord: task\nid: T-0006\ntitle: Design the gift card\nstatus: Draft\nmilestone: M-0004\nowner: bob-worker\nscope: [src]\ngoverning: [PROFILE]\nacceptance: []\n---\n# T\n');
  const view = evaluateClient({ source: dirSource(dir) });
  assert.deepEqual(view.now, { stage: 'M-0002', review: false, paused: false, items: ['Email the receipt'] });
  assert.deepEqual(view.next, [{ title: 'Order tracking page', stage: 'Online ordering', stageId: 'M-0002' }, { title: 'Design the gift card', stage: 'Gift cards', stageId: 'M-0004' }]);
  assert.equal(view.then, 'The bakery sees each day\'s orders.');
  assert.deepEqual(view.overall, { done: 2, total: 6 }, 'parts across the stages still open');
  const ordering = view.stages[1];
  assert.deepEqual(ordering.items.map(i => [i.title, i.state, i.added]), [['Choose a cake', 'done', false], ['Pay by card', 'done', false], ['Email the receipt', 'active', false], ['Gift message', 'hold', false], ['Order tracking page', 'next', true]], 'the plan\'s order, then work added along the way');
  assert.deepEqual(view.waiting.map(d => d.holds), [['Gift message']], 'a decision about nothing on the page is not shown');
  const html = renderClient(view);
  assert.match(html, /<h2 id="now">Now<\/h2>/); assert.match(html, /<h2 id="next">Next<\/h2>/); assert.match(html, /<h2 id="waiting"><span aria-hidden="true"><svg[^]*?<\/svg><\/span>Waiting on a decision<\/h2>/);
  assert.match(html, /Design the gift card<\/bdi> <span class="where">in <bdi>Gift cards<\/bdi>/);
  assert.match(html, /<span class="tag">added along the way<\/span>/);
  assert.match(html, /<details class="more"><summary>The 1 part of this stage<\/summary>/, 'other stages fold their parts away');
  assert.match(html, /<summary>How a stage moves<\/summary>/);
  // Narrower detail: parts without decisions, or stages only, as before.
  const set = detail => { const c = JSON.parse(fs.readFileSync(path.join(dir, 'docs/workflow/config.json'), 'utf8')); c.client = { detail }; fs.writeFileSync(path.join(dir, 'docs/workflow/config.json'), JSON.stringify(c)); };
  set('parts');
  const parts = renderClient(evaluateClient({ source: dirSource(dir) }));
  assert.doesNotMatch(parts, /Waiting on a decision|gift wrap/); assert.match(parts, /Email the receipt/);
  set('stages');
  const stages = renderClient(evaluateClient({ source: dirSource(dir) }));
  for (const absent of ['Email the receipt', 'id="now"', 'id="next"', 'gift wrap', 'class="items"']) assert.ok(!stages.includes(absent), absent);
  assert.match(stages, /2 of 5 parts done, 1 on hold/);
  assert.throws(() => { set('everything'); evaluateClient({ source: dirSource(dir) }); }, /stages, parts or full/);
});

test('the deeper page speaks Arabic too', t => {
  const html = renderClient(evaluateClient({ source: dirSource(project(t, { client: { language: 'ar' } })) }));
  for (const words of ['<h2 id="now">الآن</h2>', '<h2 id="next">التالي</h2>', '</span>بانتظار قرار</h2>', 'هناك إجابة مقترحة بانتظار الموافقة. يؤخر:', '<span class="state">قيد التنفيذ</span>', '<summary>كيف تتقدم المرحلة</summary>', 'الأجزاء المنجزة في المراحل المفتوحة: 2 من 4.']) assert.ok(html.includes(words), words);
});

// The depth review's cases (MAINT-0008): Now for a paused or signed-off-waiting stage, Next with only a next stage, decisions
// matched through `affects` and never holding finished work, `client_question`, the four-part limit, and rows that shrink.
test('Now, Next and decisions say the right thing in every state', t => {
  const dir = project(t);
  const write = (rel, body) => fs.writeFileSync(path.join(dir, rel), body);
  const status = (id, value) => write(`docs/workflow/milestones/${id}.md`, fs.readFileSync(path.join(dir, `docs/workflow/milestones/${id}.md`), 'utf8').replace(/^status: .*$/m, `status: ${value}`));
  write('docs/workflow/decisions/D-0007.md', fs.readFileSync(path.join(dir, 'docs/workflow/decisions/D-0007.md'), 'utf8').replace('question: Which gift wrap options do we offer?', 'question: gift_wrap enum values\nclient_question: Which gift wrap options would you like to offer?'));
  write('docs/workflow/decisions/D-0009.md', '---\nrecord: decision\nid: D-0009\nquestion: Ordering hours\ntype: decision\nowner: alice-owner\naffects: [M-0002, M-0001]\nrequired_before: implement\nstatus: Open\n---\n# D\n');
  write('docs/workflow/decisions/D-0010.md', '---\nrecord: decision\nid: D-0010\nquestion: Old question\ntype: decision\nowner: alice-owner\naffects: [M-0001, T-0001]\nrequired_before: implement\nstatus: Open\n---\n# D\n');
  let view = evaluateClient({ source: dirSource(dir) });
  assert.deepEqual(view.waiting.map(d => [d.question, d.holds]), [['Which gift wrap options would you like to offer?', ['Gift message']], ['Ordering hours', ['Online ordering']]], 'client_question wins; affects matches a milestone; a delivered stage and a done part are never held up');
  assert.ok(!renderClient(view).includes('gift_wrap'), 'the developer\'s question stays out');
  // A paused stage with nothing in progress.
  write('docs/workflow/tasks/T-0003.md', fs.readFileSync(path.join(dir, 'docs/workflow/tasks/T-0003.md'), 'utf8').replace('status: Active', 'status: Ready'));
  status('M-0002', 'Blocked');
  view = evaluateClient({ source: dirSource(dir) });
  assert.equal(view.headline, 'Online ordering is paused for now.');
  assert.match(renderClient(view), /This stage is paused for now; work resumes once what it waits for is settled\./);
  assert.doesNotMatch(renderClient(view), /the next part starts soon/);
  // A stage built and waiting for sign-off, with only a next stage after it.
  status('M-0002', 'Verified');
  for (const id of ['T-0003', 'T-0004']) write(`docs/workflow/tasks/${id}.md`, fs.readFileSync(path.join(dir, `docs/workflow/tasks/${id}.md`), 'utf8').replace(/^status: .*$/m, 'status: Done'));
  view = evaluateClient({ source: dirSource(dir) });
  const html = renderClient(view);
  assert.match(html, /Everything in this stage is built and checked\. It is waiting for sign-off\./);
  assert.deepEqual(view.next, []);
  assert.match(html, /Then the next stage: <bdi>The bakery sees each day&#39;s orders\.<\/bdi>/);
  assert.doesNotMatch(html, /<ol class="queue"/, 'no empty queue beside the next stage');
  // Nothing in progress yet: an approved stage whose parts are all still to start.
  status('M-0002', 'Authorised');
  for (const id of ['T-0003', 'T-0004']) write(`docs/workflow/tasks/${id}.md`, fs.readFileSync(path.join(dir, `docs/workflow/tasks/${id}.md`), 'utf8').replace(/^status: .*$/m, 'status: Ready'));
  assert.match(renderClient(evaluateClient({ source: dirSource(dir) })), /<h2 id="now">Now<\/h2>\s*<p>Nothing is being built at this moment; the next part starts soon\.<\/p>/);
});

test('Next lists at most four parts across stages, and part rows shrink at phone width', t => {
  const dir = project(t, { extraMilestones: [['M-0004', 'Draft', 'Gift cards']] });
  for (let n = 5; n <= 9; n++) fs.writeFileSync(path.join(dir, `docs/workflow/tasks/T-000${n}.md`), `---\nrecord: task\nid: T-000${n}\ntitle: Part ${n}\nstatus: Draft\nmilestone: M-0004\nowner: bob-worker\nscope: [src]\ngoverning: [PROFILE]\nacceptance: []\n---\n# T\n`);
  const view = evaluateClient({ source: dirSource(dir) });
  assert.equal(view.next.length, 4);
  const html = renderClient(view);
  assert.match(html, /\.item \{ display: grid; grid-template-columns: 1\.25rem minmax\(0, 1fr\) auto;/, 'the name column can shrink, so the state never spills out of the card');
  assert.match(html, /@media \(max-width: 26rem\) \{ \.item \{ grid-template-columns: 1\.25rem minmax\(0, 1fr\);[^}]*\} \.item \.state \{ grid-column: 2; \} \}/, 'on narrow phones the state goes under the name, so words are not broken');
});

// MAINT-0013: a milestone's own title, outcome and measure are the team's words; its `client_` fields are the client's,
// in the page's language, and replace them field by field. The profile's `client_measure` replaces its measure likewise.
test('a stage and the goal read in the client\'s words where the records give them', t => {
  const dir = project(t);
  const edit = (rel, from, to) => { const f = path.join(dir, rel); const s = fs.readFileSync(f, 'utf8'); assert.ok(s.includes(from), `${rel} holds ${from}`); fs.writeFileSync(f, s.replace(from, to)); };
  edit('docs/workflow/milestones/M-0002.md', 'outcome: Customers choose a cake and pay by card.\n',
    'outcome: Checkout via Stripe PaymentIntents with webhook reconciliation (A4.2).\nmeasure: e2e suite green on staging.\nclient_title: الطلب عبر الموقع\nclient_outcome: يختار الزبون الكعكة ويدفع بالبطاقة.\nclient_measure: اطلب كعكة من الموقع وادفع ببطاقة تجريبية.\n');
  edit('docs/workflow/milestones/M-0003.md', 'outcome: The bakery sees each day\'s orders.\n', 'outcome: Daily orders view, group 3 (B1).\nmeasure: Orders screen lists today.\nclient_title: Today\'s orders\nclient_measure:   \n');
  edit('docs/workflow/profile.md', 'measure: A customer can order a cake online.\n', 'measure: Orders table matches the till for 4 weeks (D4).\nclient_measure: Every order the bakery takes shows here for four weeks running.\n');
  const view = evaluateClient({ source: dirSource(dir) });
  assert.deepEqual([view.stages[1].title, view.stages[1].outcome, view.stages[1].measure],
    ['الطلب عبر الموقع', 'يختار الزبون الكعكة ويدفع بالبطاقة.', 'اطلب كعكة من الموقع وادفع ببطاقة تجريبية.']);
  assert.equal(view.headline, 'Now working on الطلب عبر الموقع.');
  assert.deepEqual([view.stages[2].title, view.stages[2].outcome, view.stages[2].measure], ['Today\'s orders', 'Daily orders view, group 3 (B1).', 'Orders screen lists today.'],
    'a field the client wording leaves out, or leaves blank, keeps the record\'s own');
  assert.equal(view.goal, 'Every order the bakery takes shows here for four weeks running.');
  const html = renderClient(view);
  for (const team of ['Stripe', 'e2e suite', 'Orders table matches the till', 'Online ordering']) assert.doesNotMatch(html, new RegExp(team), `${team} is the team's wording`);
});
