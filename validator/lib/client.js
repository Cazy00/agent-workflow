// `wf status --client` (MAINT-0008): the project's progress for a client who does not read records. It shows each
// milestone as a stage in plain words: its title and outcome, where it stands, how many of its parts are done and how
// many are on hold. No other record field leaves the records: no IDs, branches, people, decisions, readiness reasons or
// pull requests. The title, outcome and measure are shown as written, so they are written for the client. Like
// `wf status` it is derived and read-only, grants nothing and no gate reads it. Record text is escaped.
//
// The page wears the client's design system when the config gives one (`client.theme`: colours, fonts, logo, radius)
// and speaks the client's language (`client.language`: English or Arabic, which also sets right-to-left). Without a
// theme it is the default design below. Fonts and logo are embedded, so the page stays one self-contained file.
import { list, loadAll, loadConfig } from './records.js';

const PLACEHOLDER = /coherent journey or demonstrable technical outcome/i;
const TONE = { Draft: 'planned', Authorised: 'planned', Active: 'active', Blocked: 'review', Verified: 'review', Accepted: 'done', Released: 'done' };

// Every word the page says, in each language it speaks. Arabic keeps Western digits (they are what clients' price
// cards and invoices use) and avoids number agreement by putting counts after a label.
const STRINGS = {
  en: {
    dir: 'ltr', locale: 'en-GB',
    status: { Draft: 'Planned', Authorised: 'Up next', Active: 'In progress', Blocked: 'Paused for now', Verified: 'Built and checked, awaiting sign-off', Accepted: 'Signed off', Released: 'Delivered' },
    planning: 'The project is being planned.',
    review: t => `${t}: built and checked, and waiting for sign-off.`,
    paused: t => `${t} is paused for now.`,
    working: t => `Now working on ${lowerFirst(t)}.`,
    delivered: 'Everything planned so far is delivered.',
    next: t => `Next: ${lowerFirst(t)}.`,
    nextPlanned: 'The next stage is being planned.',
    summary: (d, n) => `${d} of ${n} stage${n === 1 ? '' : 's'} delivered.`,
    goal: 'How you will know it works:',
    stages: 'Stages',
    position: (i, n) => `Stage ${i} of ${n}: `,
    measure: 'You will be able to check it by:',
    parts: (d, n, h) => `${d} of ${n} part${n === 1 ? '' : 's'} done${h ? `, ${h} on hold` : ''}`,
    empty: 'The stages appear here once the first one is planned.',
    untitled: 'Untitled stage',
    updated: when => `Updated ${when}.`,
    updatedLatest: 'Updated from the latest project records.',
    onHold: 'A part on hold is waiting for a decision or for something outside the work.',
    progressOnly: 'This page shows progress only. Approvals and sign-off happen with the project owner.',
    title: t => `${t}: progress`,
  },
  ar: {
    dir: 'rtl', locale: 'ar-OM-u-nu-latn',
    status: { Draft: 'مخطط لها', Authorised: 'التالية', Active: 'قيد التنفيذ', Blocked: 'متوقفة مؤقتاً', Verified: 'اكتمل البناء والفحص، بانتظار الاعتماد', Accepted: 'معتمدة', Released: 'سُلّمت' },
    planning: 'المشروع قيد التخطيط.',
    review: t => `${t}: اكتمل البناء والفحص، بانتظار الاعتماد.`,
    paused: t => `${t}: متوقفة مؤقتاً.`,
    working: t => `نعمل الآن على: ${t}.`,
    delivered: 'سُلّم كل ما خُطط له حتى الآن.',
    next: t => `التالي: ${t}.`,
    nextPlanned: 'المرحلة التالية قيد التخطيط.',
    summary: (d, n) => `المراحل المسلّمة: ${d} من ${n}.`,
    goal: 'كيف تعرف أن المشروع يعمل:',
    stages: 'المراحل',
    position: (i, n) => `المرحلة ${i} من ${n}: `,
    measure: 'يمكنك التحقق منها:',
    parts: (d, n, h) => `الأجزاء المنجزة: ${d} من ${n}${h ? `، والمتوقفة: ${h}` : ''}`,
    empty: 'تظهر المراحل هنا بعد التخطيط لأولاها.',
    untitled: 'مرحلة بلا عنوان',
    updated: when => `آخر تحديث: ${when}.`,
    updatedLatest: 'محدّثة من أحدث سجلات المشروع.',
    onHold: 'الجزء المتوقف ينتظر قراراً أو أمراً خارج نطاق العمل.',
    progressOnly: 'تعرض هذه الصفحة سير العمل فقط، ويجري الاعتماد مع صاحب المشروع.',
    title: t => `${t}: سير العمل`,
  },
};
export const LANGUAGES = Object.keys(STRINGS);

// The milestone's own heading names it ("# M-0002 — Customers can order online"); its outcome says what it delivers.
function titleOf(record) {
  const heading = (record.body ?? '').match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '';
  const named = heading.replace(/^M-\d{4}\s*[—–-]\s*/, '').trim();
  return named && !PLACEHOLDER.test(named) && !/^M-\d{4}$/.test(named) ? named : null;
}

// The theme's files, read as bytes from the same revision as the records and embedded as data URLs.
const MIME = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const LIMIT = 2 * 1024 * 1024;
function embed(source, file, kinds, budget) {
  const ext = file.split('.').pop().toLowerCase();
  if (!kinds.includes(ext)) throw new Error(`client.theme: ${file} must be one of ${kinds.join(', ')}`);
  const tooBig = () => new Error('client.theme: the fonts and logo together exceed 2 MB; use woff2 files and fewer weights');
  let bytes;
  try { bytes = source.readBuffer?.(file, LIMIT - budget.used) ?? null; } catch (e) { if (e.code === 'TOO_LARGE') throw tooBig(); throw e; }
  if (!bytes) throw new Error(`client.theme: ${file} is not a file in ${source.name}`);
  budget.used += bytes.length;
  if (budget.used > LIMIT) throw tooBig();
  return `data:${MIME[ext]};base64,${bytes.toString('base64')}`;
}

export function evaluateClient({ source, updated = null }) {
  const config = loadConfig(source);
  const rd = config.records_dir ?? 'docs/workflow';
  const client = config.client ?? {};
  const language = client.language ?? 'en';
  const say = STRINGS[language];
  const exclude = new Set(list(client.exclude));
  const all = loadAll(source, rd);
  const profile = all.profile?.data ?? {};
  const tasks = [...all.tasks.values()].map(r => r.data).filter(Boolean);
  const stages = [...all.milestones.values()]
    .filter(r => r.data?.id && !exclude.has(r.data.id))
    .sort((a, b) => String(a.data.id).localeCompare(String(b.data.id)))
    .map(r => {
      const m = r.data;
      const known = Object.hasOwn(TONE, m.status) ? m.status : 'Draft'; // never a raw record word
      const tone = TONE[known];
      const own = tasks.filter(t => t.milestone === m.id);
      // Task records are removed once a milestone is accepted, so a signed-off stage is complete by definition.
      const finished = tone === 'done';
      const total = finished ? null : Math.max(new Set(list(m.tasks)).size, own.length);
      const done = finished ? null : own.filter(t => t.status === 'Done').length;
      const title = titleOf(r) ?? m.outcome ?? say.untitled;
      return {
        title,
        outcome: m.outcome && m.outcome !== title ? m.outcome : null,
        measure: m.measure ?? null,
        status: say.status[known], tone, finished, paused: known === 'Blocked', upNext: known === 'Authorised',
        parts: total ? { done, total } : null,
        on_hold: finished ? 0 : own.filter(t => t.status === 'Blocked').length,
      };
    });
  const current = stages.find(s => s.tone === 'review' && !s.paused) ?? stages.find(s => s.tone === 'active') ?? stages.find(s => s.paused) ?? null;
  const delivered = stages.filter(s => s.finished).length;
  const upNext = stages.find(s => s.upNext);
  let headline;
  if (!stages.length) headline = say.planning;
  else if (current?.paused) headline = say.paused(current.title);
  else if (current?.tone === 'review') headline = say.review(current.title);
  else if (current) headline = say.working(current.title);
  else if (delivered === stages.length) headline = say.delivered;
  else if (upNext) headline = say.next(upNext.title);
  else headline = say.nextPlanned;

  const theme = client.theme ?? null;
  const budget = { used: 0 };
  const look = theme ? {
    colors: theme.colors ?? {},
    dark: theme.dark && typeof theme.dark === 'object' ? { ...DARK, ...theme.dark } : null, // keys it leaves out stay readable
    fonts: { text: theme.fonts?.text ?? null, display: theme.fonts?.display ?? null, faces: (theme.fonts?.files ?? []).map(f => ({ family: f.family, weight: f.weight ?? 400, url: embed(source, f.file, ['woff2', 'woff', 'ttf', 'otf'], budget) })) },
    logo: theme.logo ? embed(source, theme.logo, ['svg', 'png', 'jpg', 'jpeg', 'webp'], budget) : null,
    radius: theme.radius ?? null,
  } : null;
  return {
    language, title: typeof client.title === 'string' && client.title.trim() ? client.title.trim() : profile.project ?? 'Project',
    goal: profile.measure ?? null,
    headline, headline_title: current?.title ?? (!current && delivered !== stages.length ? upNext?.title : null) ?? null, delivered, total: stages.length,
    current: current ? stages.indexOf(current) : null,
    stages, updated, look,
  };
}

// Sentence case inside an English sentence, unless the title starts with what looks like a proper noun.
function lowerFirst(text) { return /^[A-Z][a-z]/.test(text) && !/^[A-Z][a-z]+[A-Z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text; }
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Record text keeps its own direction inside a page of the other language (an English title on an Arabic page).
const bdi = value => `<bdi>${esc(value)}</bdi>`;

// The default design's tokens, which a theme's colours replace one by one.
const LIGHT = { page: '#f2f5f1', surface: '#fbfcfa', text: '#1e2b2f', muted: '#5a6a6d', line: '#d3dbd4', done: '#2e6b4f', active: '#2f4fb0', review: '#8a5e0e', planned: '#8a9799', brand: null, on_brand: '#ffffff' };
const DARK = { page: '#121a1c', surface: '#172124', text: '#e4ebe8', muted: '#9aa9a9', line: '#2c3a3d', done: '#6fbf94', active: '#8fa6ff', review: '#e0b357', planned: '#6c7a7c' };
const vars = colors => Object.entries(colors).filter(([, v]) => v).map(([k, v]) => `--${k.replace('_', '-')}: ${v};`).join(' ');
const family = name => `"${name}"`;

export function renderClient(view) {
  const say = STRINGS[view.language] ?? STRINGS.en;
  const look = view.look;
  const date = view.updated ? new Date(view.updated) : null;
  const when = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(say.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null;
  // How far the route line is filled: through the last finished stage, and halfway into the current one.
  const lastDone = view.stages.map(s => s.finished).lastIndexOf(true);
  const reach = view.current != null ? view.current + 0.5 : lastDone + 1;
  const fill = view.stages.length ? Math.min(100, Math.max(0, (reach / view.stages.length) * 100)) : 0;
  const light = { ...LIGHT, ...(look?.colors ?? {}) };
  // A themed page is the client's palette in light; it has a dark palette only when the theme gives one.
  const dark = look ? look.dark : DARK;
  const sans = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const serif = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
  const textFont = look?.fonts.text ? `${family(look.fonts.text)}, ${sans}` : sans;
  const displayFont = look?.fonts.display ? `${family(look.fonts.display)}, ${textFont}` : look?.fonts.text ? textFont : serif;
  const faces = (look?.fonts.faces ?? []).map(f => `@font-face { font-family: ${family(f.family)}; font-weight: ${Number(f.weight)}; font-display: swap; src: url(${f.url}); }`).join('\n  ');
  const band = Boolean(light.brand);
  const t = view.headline_title;
  const headline = t && view.headline.includes(t) ? esc(view.headline).replace(esc(t), bdi(t)) : esc(view.headline);
  const stage = (s, i) => {
    const pct = s.parts ? Math.round((s.parts.done / s.parts.total) * 100) : s.finished ? 100 : 0;
    const progress = s.parts
      ? `<div class="parts"><div class="bar" aria-hidden="true"><span style="width:${pct}%"></span></div><p>${esc(say.parts(s.parts.done, s.parts.total, s.on_hold))}</p></div>`
      : '';
    return `<li class="stage ${s.tone}${i === view.current ? ' current' : ''}">
        <span class="marker" aria-hidden="true">${s.finished ? '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>' : i + 1}</span>
        <div class="body">
          <p class="status"><span class="visually-hidden">${esc(say.position(i + 1, view.stages.length))}</span>${esc(s.status)}</p>
          <h3>${bdi(s.title)}</h3>
          ${s.outcome ? `<p class="outcome">${bdi(s.outcome)}</p>` : ''}
          ${s.measure && !s.finished ? `<p class="measure">${esc(say.measure)} ${bdi(s.measure)}</p>` : ''}
          ${progress}
        </div>
      </li>`;
  };
  return `<!doctype html>
<html lang="${esc(view.language)}" dir="${say.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(say.title(view.title))}</title>
<style>
  ${faces}
  :root {
    ${vars(light)}
    --radius: ${look?.radius ?? 10}px;
    --text-font: ${textFont}; --display-font: ${displayFont};
    color-scheme: ${dark ? 'light dark' : 'light'};
  }
  ${dark ? `@media (prefers-color-scheme: dark) { :root { ${vars(dark)} } }` : ''}
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--page); color: var(--text); font: 17px/1.55 var(--text-font); }
  :lang(ar) body { line-height: 1.8; }
  main { max-width: 44rem; margin: 0 auto; padding: 3.5rem 1.25rem 4rem; }
  .band { background: var(--brand); color: var(--on-brand); }
  .band .inner { max-width: 44rem; margin: 0 auto; padding: 1.1rem 1.25rem; display: flex; align-items: center; gap: .9rem; }
  .band img { height: 3.5rem; width: auto; }
  .band p { margin: 0; font-weight: 600; }
  header { margin-bottom: 2.75rem; }
  .logo { display: block; height: 3rem; width: auto; margin-bottom: 1.25rem; }
  .project { margin: 0 0 .9rem; color: var(--muted); font-size: 1rem; }
  h1 { margin: 0; font: 400 clamp(1.9rem, 5vw, 2.6rem)/1.18 var(--display-font); letter-spacing: -.01em; text-wrap: balance; }
  :lang(ar) h1 { line-height: 1.3; letter-spacing: 0; } :lang(ar) h3 { line-height: 1.45; }
  ${look?.fonts.display ? 'h1, h3 { font-weight: 700; }' : ''}
  .summary { margin: 1.1rem 0 0; font-size: 1.05rem; }
  .goal { margin: .6rem 0 0; color: var(--muted); max-width: 36rem; }
  h2 { margin: 0 0 1.25rem; font: 600 1rem/1.3 var(--text-font); }
  ol { list-style: none; margin: 0; padding: 0; position: relative; }
  ol::before, ol::after { content: ""; position: absolute; inset-inline-start: 1.05rem; top: 1.1rem; width: 2px; border-radius: 1px; }
  ol::before { bottom: 1.1rem; background: var(--line); }
  ol::after { height: calc((100% - 2.2rem) * var(--fill)); background: var(--done); transform-origin: top; animation: grow .9s ease-out both; }
  @keyframes grow { from { transform: scaleY(0); } }
  .stage { position: relative; display: grid; grid-template-columns: 2.1rem 1fr; gap: 1.1rem; padding-bottom: 2rem; }
  .stage:last-child { padding-bottom: 0; }
  .marker { position: relative; z-index: 1; width: 2.1rem; height: 2.1rem; border-radius: 50%; display: grid; place-items: center; font: 600 .95rem var(--text-font); background: var(--page); border: 2px solid var(--planned); color: var(--muted); }
  .marker svg { width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .done .marker { background: var(--done); border-color: var(--done); color: var(--surface); }
  .active .marker { border-color: var(--active); color: var(--active); }
  .review .marker { border-color: var(--review); color: var(--review); }
  .body { padding-top: .2rem; min-width: 0; }
  .status { margin: 0; font-size: .9rem; font-weight: 600; color: var(--muted); }
  .done .status { color: var(--done); } .active .status { color: var(--active); } .review .status { color: var(--review); }
  h3 { margin: .15rem 0 0; font: 400 1.35rem/1.3 var(--display-font); }
  .done h3 { font-size: 1.15rem; }
  .outcome, .measure { margin: .35rem 0 0; color: var(--muted); }
  .current .body { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem 1.15rem 1.1rem; margin-top: -.35rem; }
  .parts { margin-top: .8rem; }
  .parts p { margin: .35rem 0 0; font-size: .92rem; color: var(--muted); }
  .bar { height: .45rem; border-radius: .25rem; background: var(--line); overflow: hidden; max-width: 22rem; }
  .bar span { display: block; height: 100%; background: var(--planned); }
  .active .bar span { background: var(--active); } .review .bar span { background: var(--review); }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  footer { margin-top: 3.5rem; padding-top: 1.25rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .9rem; }
  footer p { margin: 0 0 .4rem; }
  @media (prefers-reduced-motion: reduce) { ol::after { animation: none; } }
  @media print { body { background: #fff; } ol::after { animation: none; } .current .body { border-color: #bbb; } }
</style>
</head>
<body>
${band ? `<div class="band"><div class="inner">${look.logo ? `<img src="${look.logo}" alt="${esc(view.title)}">` : `<p>${esc(view.title)}</p>`}</div></div>` : ''}
<main>
  <header>
    ${!band && look?.logo ? `<img class="logo" src="${look.logo}" alt="${esc(view.title)}">` : ''}
    ${band ? '' : `<p class="project">${esc(view.title)}</p>`}
    <h1>${headline}</h1>
    ${view.total ? `<p class="summary">${esc(say.summary(view.delivered, view.total))}</p>` : ''}
    ${view.goal ? `<p class="goal">${esc(say.goal)} ${bdi(view.goal)}</p>` : ''}
  </header>
  ${view.stages.length ? `<section aria-labelledby="stages">
    <h2 id="stages">${esc(say.stages)}</h2>
    <ol role="list" style="--fill:${(fill / 100).toFixed(3)}">
      ${view.stages.map(stage).join('\n      ')}
    </ol>
  </section>` : `<p>${esc(say.empty)}</p>`}
  <footer>
    <p>${esc(when ? say.updated(when) : say.updatedLatest)} ${esc(say.onHold)}</p>
    <p>${esc(say.progressOnly)}</p>
  </footer>
</main>
</body>
</html>
`;
}
