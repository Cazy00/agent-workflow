// `wf status --client` (MAINT-0008): the project's progress for a client who does not read records. It answers what a
// client asks, in their words: where things stand, what is being worked on now, what comes next, what is waiting on a
// decision, and, stage by stage, the parts each is made of and how far each has got. It is the developer's status view
// (`wf status`) translated for someone outside the work: no IDs, branches, people, commands or readiness reasons.
// What it shows of the records: each milestone's `client_title`, `client_outcome` and `client_measure` (or its title,
// outcome and measure; MAINT-0013); each task's `client_title` (or its title) and how far it has got; each decision's
// `client_question` (or its question) while it holds work up; and the profile's `client_measure` (or its measure). The
// `client_` fields are written for the client, in the page's language, where the record's own words are the team's.
// `client.detail` narrows it: `stages` (stages only), `parts` (no decisions) or `full` (the default).
// Like `wf status` it is derived and read-only, grants nothing and no gate reads it. Record text is escaped.
//
// The page wears the client's design system when the config gives one (`client.theme`: colours, fonts, logo, radius)
// and speaks the client's language (`client.language`: English or Arabic, which also sets right-to-left). Without a
// theme it is the default design below. Fonts and logo are embedded, so the page stays one self-contained file.
import { list, loadAll, loadConfig } from './records.js';
import { loadPlan, planView } from './client-plan.js';
import { planBody, PLAN_CSS } from './client-plan-render.js';
import { overlayTasks } from './client-live.js';
import { parseFrontMatter } from './frontmatter.js';

const PLACEHOLDER = /coherent journey or demonstrable technical outcome/i;
const TONE = { Draft: 'planned', Authorised: 'planned', Active: 'active', Blocked: 'review', Verified: 'review', Accepted: 'done', Released: 'done' };
// A task's status as a client reads it.
const PART = { Done: 'done', Active: 'active', Ready: 'next', Draft: 'planned', Blocked: 'hold' };
export const DETAIL = ['stages', 'parts', 'full'];

// Every word the page says, in each language it speaks. Arabic keeps Western digits (they are what clients' price
// cards and invoices use) and avoids number agreement by putting counts after a label.
const STRINGS = {
  en: {
    dir: 'ltr', locale: 'en-GB',
    status: { Draft: 'Planned', Authorised: 'Up next', Active: 'In progress', Blocked: 'Paused for now', Verified: 'Built and checked, awaiting sign-off', Accepted: 'Signed off', Released: 'Delivered' },
    part: { done: 'Done', active: 'In progress', next: 'Up next', planned: 'Being planned', hold: 'On hold', checking: 'Being checked' },
    planning: 'The project is being planned.',
    review: t => `${t}: built and checked, and waiting for sign-off.`,
    paused: t => `${t} is paused for now.`,
    working: t => `Now working on ${lowerFirst(t)}.`,
    delivered: 'Everything planned so far is delivered.',
    next: t => `Next: ${lowerFirst(t)}.`,
    nextPlanned: 'The next stage is being planned.',
    summary: (d, n) => `${d} of ${n} stage${n === 1 ? '' : 's'} delivered.`,
    overall: (d, n) => `${d} of ${n} part${n === 1 ? '' : 's'} done in the stages still open.`,
    goal: 'How you will know it works:',
    now: 'Now',
    nowNothing: 'Nothing is being built at this moment; the next part starts soon.',
    nowReview: 'Everything in this stage is built and checked. It is waiting for sign-off.',
    nowPaused: 'This stage is paused for now; work resumes once what it waits for is settled.',
    nextHeading: 'Next',
    nextIn: 'in',
    then: 'Then the next stage:',
    waiting: 'Waiting on a decision',
    decisionOpen: 'Still to be decided',
    decisionProposed: 'An answer is proposed and waiting for approval',
    holds: 'Holds up:',
    stages: 'Stages',
    position: (i, n) => `Stage ${i} of ${n}: `,
    measure: 'You will be able to check it by:',
    parts: (d, n, h) => `${d} of ${n} part${n === 1 ? '' : 's'} done${h ? `, ${h} on hold` : ''}`,
    showParts: n => `The ${n} part${n === 1 ? '' : 's'} of this stage`,
    added: 'added along the way',
    howHeading: 'How a stage moves',
    how: [
      ['Planned', 'We work out what the stage includes and split it into parts.'],
      ['Up next', 'The plan is approved; work starts soon.'],
      ['In progress', 'Each part is built, checked by a second reviewer, and tested.'],
      ['Built and checked', 'Every part is done; the stage waits for sign-off.'],
      ['Signed off', 'The project owner has accepted it as working.'],
      ['Delivered', 'It is released for use.'],
    ],
    empty: 'The stages appear here once the first one is planned.',
    untitled: 'Untitled stage',
    untitledPart: 'Untitled part',
    updated: when => `Updated ${when}.`,
    updatedLatest: 'Updated from the latest project records.',
    onHold: 'A part on hold is waiting for a decision or for something outside the work.',
    progressOnly: 'This page shows progress only. Approvals and sign-off happen with the project owner.',
    title: t => `${t}: progress`,
    step: { done: 'Done', active: 'In progress', next: 'Next', later: 'Later' },
    stepOf: (i, n) => `Step ${i} of ${n}`,
    allDone: 'Every step is done.',
    planHeading: 'The plan',
    recent: 'Recently done',
    waitingYou: 'Waiting on you',
    startsNext: t => `Starting next: ${t}`,
    laterParts: 'Its parts are planned when we reach it.',
    stepDelivered: n => `What it delivered (${n})`, // not `delivered`: that key is the old page's headline
    stepParts: n => `Its parts (${n})`,
    addedStep: 'Added',
    lastUpdated: 'Last updated',
    readPlan: 'Each step is done, in progress, next or later; a step is made of parts, which we plan when we reach it. The plan can grow: what we add along the way is marked.',
    readOnly: 'This page shows progress only; nothing can be changed from it.',
  },
  ar: {
    dir: 'rtl', locale: 'ar-OM-u-nu-latn',
    status: { Draft: 'مخطط لها', Authorised: 'التالية', Active: 'قيد التنفيذ', Blocked: 'متوقفة مؤقتاً', Verified: 'اكتمل البناء والفحص، بانتظار الاعتماد', Accepted: 'معتمدة', Released: 'سُلّمت' },
    part: { done: 'منجز', active: 'قيد التنفيذ', next: 'التالي', planned: 'قيد التخطيط', hold: 'متوقف', checking: 'قيد المراجعة' },
    planning: 'المشروع قيد التخطيط.',
    review: t => `${t}: اكتمل البناء والفحص، بانتظار الاعتماد.`,
    paused: t => `${t}: متوقفة مؤقتاً.`,
    working: t => `نعمل الآن على: ${t}.`,
    delivered: 'سُلّم كل ما خُطط له حتى الآن.',
    next: t => `التالي: ${t}.`,
    nextPlanned: 'المرحلة التالية قيد التخطيط.',
    summary: (d, n) => `المراحل المسلّمة: ${d} من ${n}.`,
    overall: (d, n) => `الأجزاء المنجزة في المراحل المفتوحة: ${d} من ${n}.`,
    goal: 'كيف تعرف أن المشروع يعمل:',
    now: 'الآن',
    nowNothing: 'لا يجري العمل على جزء في هذه اللحظة، ويبدأ الجزء التالي قريباً.',
    nowReview: 'اكتمل بناء كل أجزاء هذه المرحلة وفحصها، وهي بانتظار الاعتماد.',
    nowPaused: 'هذه المرحلة متوقفة مؤقتاً، ويُستأنف العمل حين يُحسم ما تنتظره.',
    nextHeading: 'التالي',
    nextIn: 'ضمن',
    then: 'ثم المرحلة التالية:',
    waiting: 'بانتظار قرار',
    decisionOpen: 'لم يُحسم بعد',
    decisionProposed: 'هناك إجابة مقترحة بانتظار الموافقة',
    holds: 'يؤخر:',
    stages: 'المراحل',
    position: (i, n) => `المرحلة ${i} من ${n}: `,
    measure: 'يمكنك التحقق منها:',
    parts: (d, n, h) => `الأجزاء المنجزة: ${d} من ${n}${h ? `، والمتوقفة: ${h}` : ''}`,
    showParts: n => `أجزاء هذه المرحلة (${n})`,
    added: 'أُضيف أثناء العمل',
    howHeading: 'كيف تتقدم المرحلة',
    how: [
      ['مخطط لها', 'نحدد ما تشمله المرحلة ونقسمها إلى أجزاء.'],
      ['التالية', 'اعتُمدت الخطة، ويبدأ العمل قريباً.'],
      ['قيد التنفيذ', 'يُبنى كل جزء، ويراجعه مراجع ثانٍ، ثم يُختبر.'],
      ['اكتمل البناء والفحص', 'أُنجزت كل الأجزاء، والمرحلة بانتظار الاعتماد.'],
      ['معتمدة', 'قبلها صاحب المشروع بعد التأكد من عملها.'],
      ['سُلّمت', 'أصبحت متاحة للاستخدام.'],
    ],
    empty: 'تظهر المراحل هنا بعد التخطيط لأولاها.',
    untitled: 'مرحلة بلا عنوان',
    untitledPart: 'جزء بلا عنوان',
    updated: when => `آخر تحديث: ${when}.`,
    updatedLatest: 'محدّثة من أحدث سجلات المشروع.',
    onHold: 'الجزء المتوقف ينتظر قراراً أو أمراً خارج نطاق العمل.',
    progressOnly: 'تعرض هذه الصفحة سير العمل فقط، ويجري الاعتماد مع صاحب المشروع.',
    title: t => `${t}: سير العمل`,
    step: { done: 'منجزة', active: 'قيد التنفيذ', next: 'التالية', later: 'لاحقاً' },
    stepOf: (i, n) => `الخطوة ${i} من ${n}`,
    allDone: 'اكتملت كل الخطوات.',
    planHeading: 'الخطة',
    recent: 'أُنجز مؤخراً',
    waitingYou: 'بانتظارك',
    startsNext: t => `يبدأ بعد ذلك: ${t}`,
    laterParts: 'نحدد أجزاءها حين نصل إليها.',
    stepDelivered: n => `ما أنجزته (${n})`,
    stepParts: n => `أجزاؤها (${n})`,
    addedStep: 'أُضيفت',
    lastUpdated: 'آخر تحديث',
    readPlan: 'كل خطوة إما منجزة أو قيد التنفيذ أو التالية أو لاحقة، وتتكون من أجزاء نحددها حين نصل إليها. قد تكبر الخطة، وما نضيفه أثناء العمل يظهر بعلامة.',
    readOnly: 'تعرض هذه الصفحة سير العمل فقط، ولا يمكن تغيير شيء منها.',
  },
};
export const LANGUAGES = Object.keys(STRINGS);

// The milestone's own heading names it ("# M-0002 — Customers can order online"); its outcome says what it delivers.
export function titleOf(record) {
  const heading = (record.body ?? '').match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '';
  const named = heading.replace(/^M-\d{4}\s*[—–-]\s*/, '').trim();
  return named && !PLACEHOLDER.test(named) && !/^M-\d{4}$/.test(named) ? named : null;
}
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;

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

export function evaluateClient({ source, updated = null, history = null, live = null }) {
  const config = loadConfig(source);
  const rd = config.records_dir ?? 'docs/workflow';
  const client = config.client ?? {};
  const language = client.language ?? 'en';
  const detail = client.detail ?? 'full';
  const say = STRINGS[language];
  const exclude = new Set(list(client.exclude));
  const all = loadAll(source, rd);
  const profile = all.profile?.data ?? {};
  const milestoneIds = new Set([...all.milestones.values()].map(r => r.data?.id).filter(Boolean));
  const recorded = [...all.tasks.values()].map(r => r.data).filter(t => t?.id);
  // Branches being worked on move their own parts forward (client-live.js); nothing else on the page comes from them.
  const tasks = live ? overlayTasks(recorded, live.parts, milestoneIds) : recorded;
  const stages = [...all.milestones.values()]
    .filter(r => r.data?.id && !exclude.has(r.data.id))
    .sort((a, b) => String(a.data.id).localeCompare(String(b.data.id)))
    .map(r => {
      const m = r.data;
      const known = Object.hasOwn(TONE, m.status) ? m.status : 'Draft'; // never a raw record word
      const tone = TONE[known];
      const planned = [...new Set(list(m.tasks))];
      // The plan's order first, then work found along the way, by ID.
      // A finished milestone's removed task records come back from history, so a done step keeps what it delivered.
      const kept = tasks.filter(t => t.milestone === m.id);
      const recovered = tone === 'done' && history ? planned.filter(id => !kept.some(t => t.id === id)).map(id => parseFrontMatter(history.lastVersion(id) ?? '').data).filter(t => t?.id) : [];
      const own = [...kept, ...recovered].sort((a, b) => {
        const [x, y] = [planned.indexOf(a.id), planned.indexOf(b.id)];
        return (x === -1 ? Infinity : x) - (y === -1 ? Infinity : y) || a.id.localeCompare(b.id);
      });
      // Task records are removed once a milestone is accepted, so a signed-off stage is complete by definition.
      const finished = tone === 'done';
      const total = finished ? null : Math.max(planned.length, own.length);
      const done = finished ? null : own.filter(t => t.status === 'Done').length;
      // A stage's `client_` wording replaces the team's field by field; a field it leaves out keeps the record's own.
      const outcome = text(m.client_outcome) ?? text(m.outcome);
      const title = text(m.client_title) ?? titleOf(r) ?? outcome ?? say.untitled;
      return {
        id: m.id, title,
        outcome: outcome && outcome !== title ? outcome : null,
        measure: text(m.client_measure) ?? text(m.measure),
        status: say.status[known], tone, finished, paused: known === 'Blocked', upNext: known === 'Authorised',
        parts: total ? { done, total } : null,
        on_hold: finished ? 0 : own.filter(t => t.status === 'Blocked').length,
        moving: !finished && own.some(t => t.status === 'Active'), // kept apart from items, which detail 'stages' leaves empty
        items: detail === 'stages' ? [] : own.map(t => {
          const state = finished ? 'done' : t.live === 'checking' ? 'checking' : PART[t.status] ?? 'planned';
          return { id: t.id, title: text(t.client_title) ?? text(t.title) ?? say.untitledPart, state, added: planned.length > 0 && !planned.includes(t.id), doneAt: state === 'done' ? history?.doneDate(t.id) ?? null : null };
        }),
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

  // Now and next, from the stage in focus: the current one, or the first not yet finished. Stages run in ID order, so the
  // queue looks forward from the focus; an unfinished stage before it still shows its parts in the list below.
  const focus = current ?? stages.find(s => !s.finished) ?? null;
  const later = focus ? stages.slice(stages.indexOf(focus) + 1).filter(s => !s.finished) : [];
  const now = focus && detail !== 'stages' ? { stage: focus.id, review: focus.tone === 'review' && !focus.paused, paused: focus.paused, items: focus.items.filter(i => i.state === 'active' || i.state === 'checking').map(i => i.title) } : null;
  let next = [];
  if (detail !== 'stages' && focus) {
    const rank = { next: 0, planned: 1 };
    const pick = s => s.items.filter(i => i.state in rank).sort((a, b) => rank[a.state] - rank[b.state]).map(i => ({ title: i.title, stage: s.title, stageId: s.id }));
    next = pick(focus);
    for (const s of later) { if (next.length >= 4) break; next.push(...pick(s)); }
    next = next.slice(0, 4);
  }
  const then = later[0]?.title ?? null;

  // Decisions that hold up work on this page, while they are open or proposed.
  const visible = new Map(stages.filter(s => !s.finished).flatMap(s => [[s.id, s.title], ...s.items.filter(i => i.state !== 'done').map(i => [i.id, i.title])])); // only work still open is held up
  const waiting = detail === 'full' ? [...all.decisions.values()].map(r => r.data).filter(d => d?.id && ['Open', 'Proposed'].includes(d.status)).map(d => {
    const held = [...new Set([...list(d.affects).filter(a => visible.has(a)), ...tasks.filter(t => list(t.decisions).includes(d.id) && visible.has(t.id)).map(t => t.id)])];
    return held.length ? { question: text(d.client_question) ?? text(d.question) ?? '', proposed: d.status === 'Proposed', holds: held.map(id => visible.get(id)) } : null;
  }).filter(d => d && d.question) : [];
  const open = stages.filter(s => !s.finished && s.parts);
  const overall = open.length ? { done: open.reduce((n, s) => n + s.parts.done, 0), total: open.reduce((n, s) => n + s.parts.total, 0) } : null;

  // The five parts finished most recently, newest first, when history gives their dates.
  const recent = stages.flatMap(s => s.items).filter(i => i.doneAt).sort((a, b) => Date.parse(b.doneAt) - Date.parse(a.doneAt)).slice(0, 5).map(i => ({ title: i.title, date: i.doneAt }));

  // The whole plan (MAINT-0014), when the project keeps one: phases and steps from the plan file, states from the stages.
  const warnings = [];
  let plan = null;
  if (client.plan) {
    plan = planView({ plan: loadPlan(source, client.plan), stages, known: milestoneIds, exclude });
    for (const id of plan.unplaced) warnings.push(`client.plan: ${id} is in no step of the client plan; it shows as an added step at the end until a step lists it`);
  }

  if (live) {
    warnings.push(...live.warnings);
    if (live.newest && (!updated || Date.parse(live.newest) > Date.parse(updated))) updated = live.newest;
  }

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
    language, detail, title: typeof client.title === 'string' && client.title.trim() ? client.title.trim() : profile.project ?? 'Project',
    goal: text(profile.client_measure) ?? text(profile.measure),
    headline, headline_title: current?.title ?? (!current && delivered !== stages.length ? upNext?.title : null) ?? null, delivered, total: stages.length,
    current: current ? stages.indexOf(current) : null,
    overall, now, next, then, waiting, recent,
    stages, updated, look, plan, warnings,
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
// The shape beside each part says its state without colour alone.
const ICON = {
  done: '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>',
  active: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2.2" class="fill" /></svg>',
  next: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" /></svg>',
  planned: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" stroke-dasharray="2.4 2.2" /></svg>',
  hold: '<svg viewBox="0 0 16 16"><path d="M6 4.5v7M10 4.5v7" /></svg>',
  checking: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" /><path d="M5.5 8.2l1.8 1.8 3.2-3.6" /></svg>',
};

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
  const bar = (done, total) => `<div class="bar" aria-hidden="true"><span style="width:${total ? Math.round((done / total) * 100) : 0}%"></span></div>`;
  const partList = items => `<ul class="items" role="list">${items.map(i => `<li class="item ${i.state}"><span class="icon" aria-hidden="true">${ICON[i.state]}</span><span class="name">${bdi(i.title)}${i.added ? ` <span class="tag">${esc(say.added)}</span>` : ''}</span><span class="state">${esc(say.part[i.state])}</span></li>`).join('')}</ul>`;
  const stage = (s, i) => {
    const progress = s.parts ? `<div class="parts">${bar(s.parts.done, s.parts.total)}<p>${esc(say.parts(s.parts.done, s.parts.total, s.on_hold))}</p></div>` : '';
    const items = s.items.length ? (i === view.current ? partList(s.items) : `<details class="more"><summary>${esc(say.showParts(s.items.length))}</summary>${partList(s.items)}</details>`) : '';
    return `<li class="stage ${s.tone}${i === view.current ? ' current' : ''}">
        <span class="marker" aria-hidden="true">${s.finished ? ICON.done : i + 1}</span>
        <div class="body">
          <p class="status"><span class="visually-hidden">${esc(say.position(i + 1, view.stages.length))}</span>${esc(s.status)}</p>
          <h3>${bdi(s.title)}</h3>
          ${s.outcome ? `<p class="outcome">${bdi(s.outcome)}</p>` : ''}
          ${s.measure && !s.finished ? `<p class="measure">${esc(say.measure)} ${bdi(s.measure)}</p>` : ''}
          ${progress}
          ${items}
        </div>
      </li>`;
  };
  const nowBlock = view.now ? `<section class="panel now" aria-labelledby="now">
    <h2 id="now">${esc(say.now)}</h2>
    ${view.now.items.length ? `<ul class="items" role="list">${view.now.items.map(n => `<li class="item active"><span class="icon" aria-hidden="true">${ICON.active}</span><span class="name">${bdi(n)}</span></li>`).join('')}</ul>` : `<p>${esc(view.now.review ? say.nowReview : view.now.paused ? say.nowPaused : say.nowNothing)}</p>`}
  </section>` : '';
  const nextBlock = view.detail !== 'stages' && (view.next.length || view.then) ? `<section class="panel next" aria-labelledby="next">
    <h2 id="next">${esc(say.nextHeading)}</h2>
    ${view.next.length ? `<ol class="queue" role="list">${view.next.map(n => `<li>${bdi(n.title)}${n.stageId !== view.now?.stage ? ` <span class="where">${esc(say.nextIn)} ${bdi(n.stage)}</span>` : ''}</li>`).join('')}</ol>` : ''}
    ${view.then ? `<p class="then">${esc(say.then)} ${bdi(view.then)}</p>` : ''}
  </section>` : '';
  const waitBlock = view.waiting.length ? `<section class="panel waiting" aria-labelledby="waiting">
    <h2 id="waiting"><span aria-hidden="true">${ICON.hold}</span>${esc(say.waiting)}</h2>
    <ul class="decisions" role="list">${view.waiting.map(d => `<li><p class="question">${bdi(d.question)}</p><p class="meta">${esc(d.proposed ? say.decisionProposed : say.decisionOpen)}. ${esc(say.holds)} ${d.holds.map(bdi).join(view.language === 'ar' ? '، ' : ', ')}</p></li>`).join('')}</ul>
  </section>` : '';
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
  main { max-width: 46rem; margin: 0 auto; padding: 3.5rem 1.25rem 4rem; }
  .band { background: var(--brand); color: var(--on-brand); }
  .band .inner { max-width: 46rem; margin: 0 auto; padding: 1.1rem 1.25rem; display: flex; align-items: center; gap: .9rem; }
  .band img { height: 3.5rem; width: auto; }
  .band p { margin: 0; font-weight: 600; }
  header { margin-bottom: 2.25rem; }
  .logo { display: block; height: 3rem; width: auto; margin-bottom: 1.25rem; }
  .project { margin: 0 0 .9rem; color: var(--muted); font-size: 1rem; }
  h1 { margin: 0; font: 400 clamp(1.9rem, 5vw, 2.6rem)/1.18 var(--display-font); letter-spacing: -.01em; text-wrap: balance; }
  :lang(ar) h1 { line-height: 1.3; letter-spacing: 0; } :lang(ar) h3 { line-height: 1.45; }
  ${look?.fonts.display ? 'h1, h3 { font-weight: 700; }' : ''}
  .summary { margin: 1.1rem 0 0; font-size: 1.05rem; }
  .overall { margin-top: .7rem; max-width: 26rem; }
  .overall p { margin: .35rem 0 0; color: var(--muted); font-size: .92rem; }
  .goal { margin: .9rem 0 0; color: var(--muted); max-width: 36rem; }
  h2 { margin: 0 0 .9rem; font: 600 1rem/1.3 var(--text-font); }
  section { margin-top: 2.25rem; }
  .panels { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); align-items: start; }
  .panel { margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem 1.15rem 1.1rem; }
  .panel p { margin: 0; color: var(--muted); }
  .panel.waiting { grid-column: 1 / -1; }
  .panel.waiting h2 { display: flex; align-items: center; gap: .45rem; color: var(--review); }
  .panel.waiting h2 svg { width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
  .queue { margin: 0; padding-inline-start: 1.25rem; display: grid; gap: .45rem; }
  .queue .where, .then { color: var(--muted); font-size: .92rem; }
  .panel .then { margin-top: .75rem; }
  .decisions { list-style: none; margin: 0; padding: 0; display: grid; gap: .9rem; }
  .panel .decisions .question { color: var(--text); font-weight: 600; }
  .decisions .meta { font-size: .92rem; margin-top: .2rem; }
  .items { list-style: none; margin: .75rem 0 0; padding: 0; display: grid; }
  .item { display: grid; grid-template-columns: 1.25rem minmax(0, 1fr) auto; gap: .6rem; align-items: baseline; padding: .32rem 0; border-top: 1px solid var(--line); }
  .item .name { overflow-wrap: break-word; }
  @media (max-width: 26rem) { .item { grid-template-columns: 1.25rem minmax(0, 1fr); row-gap: 0; } .item .state { grid-column: 2; } }
  .item:first-child { border-top: 0; }
  .panel .items { margin-top: 0; } .panel .item { grid-template-columns: 1.25rem minmax(0, 1fr); border-top: 0; padding: .2rem 0; }
  .icon svg { width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; transform: translateY(.15rem); }
  .icon .fill { fill: currentColor; stroke: none; }
  .item.done .icon { color: var(--done); } .item.active .icon, .item.checking .icon { color: var(--active); } .item.next .icon { color: var(--text); } .item.planned .icon { color: var(--planned); } .item.hold .icon { color: var(--review); }
  .item.done .name { color: var(--muted); }
  .item .state { font-size: .85rem; color: var(--muted); white-space: nowrap; }
  .item.active .state, .item.checking .state { color: var(--active); font-weight: 600; } .item.hold .state { color: var(--review); font-weight: 600; }
  .tag { display: inline-block; font-size: .8rem; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 0 .45rem; white-space: nowrap; }
  ol.route { list-style: none; margin: 0; padding: 0; position: relative; }
  ol.route::before, ol.route::after { content: ""; position: absolute; inset-inline-start: 1.05rem; top: 1.1rem; width: 2px; border-radius: 1px; }
  ol.route::before { bottom: 1.1rem; background: var(--line); }
  ol.route::after { height: calc((100% - 2.2rem) * var(--fill)); background: var(--done); transform-origin: top; animation: grow .9s ease-out both; }
  @keyframes grow { from { transform: scaleY(0); } }
  .stage { position: relative; display: grid; grid-template-columns: 2.1rem 1fr; gap: 1.1rem; padding-bottom: 2rem; }
  .stage:last-child { padding-bottom: 0; }
  .marker { position: relative; z-index: 1; width: 2.1rem; height: 2.1rem; border-radius: 50%; display: grid; place-items: center; font: 600 .95rem var(--text-font); background: var(--page); border: 2px solid var(--planned); color: var(--muted); }
  .marker svg { width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .stage.done .marker { background: var(--done); border-color: var(--done); color: var(--surface); }
  .stage.active .marker { border-color: var(--active); color: var(--active); }
  .stage.review .marker { border-color: var(--review); color: var(--review); }
  .body { padding-top: .2rem; min-width: 0; }
  .status { margin: 0; font-size: .9rem; font-weight: 600; color: var(--muted); }
  .stage.done .status { color: var(--done); } .stage.active .status { color: var(--active); } .stage.review .status { color: var(--review); }
  h3 { margin: .15rem 0 0; font: 400 1.35rem/1.3 var(--display-font); }
  .stage.done h3 { font-size: 1.15rem; }
  .outcome, .measure { margin: .35rem 0 0; color: var(--muted); }
  .current .body { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem 1.15rem 1.1rem; margin-top: -.35rem; }
  .parts { margin-top: .8rem; }
  .parts p { margin: .35rem 0 0; font-size: .92rem; color: var(--muted); }
  .bar { height: .45rem; border-radius: .25rem; background: var(--line); overflow: hidden; max-width: 22rem; }
  .bar span { display: block; height: 100%; background: var(--planned); }
  .overall .bar span { background: var(--done); }
  .stage.active .bar span { background: var(--active); } .stage.review .bar span { background: var(--review); }
  details.more { margin-top: .7rem; }
  details summary { cursor: pointer; color: var(--muted); font-size: .92rem; }
  .how ol { margin: .6rem 0 0; padding-inline-start: 1.25rem; display: grid; gap: .45rem; }
  .how li strong { font-weight: 600; }
  .how li span { color: var(--muted); }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  footer { margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .9rem; }
  footer p { margin: 0 0 .4rem; }
  @media (prefers-reduced-motion: reduce) { ol.route::after { animation: none; } }
  @media print { body { background: #fff; } ol.route::after { animation: none; } .current .body, .panel { border-color: #bbb; } }
  ${view.plan ? PLAN_CSS : ''}
</style>
</head>
<body>
${band ? `<div class="band"><div class="inner">${look.logo ? `<img src="${look.logo}" alt="${esc(view.title)}">` : `<p>${esc(view.title)}</p>`}</div></div>` : ''}
<main>
  ${view.plan ? planBody(view, say, { esc, bdi, ICON, partList, band, look }) : `<header>
    ${!band && look?.logo ? `<img class="logo" src="${look.logo}" alt="${esc(view.title)}">` : ''}
    ${band ? '' : `<p class="project">${esc(view.title)}</p>`}
    <h1>${headline}</h1>
    ${view.total ? `<p class="summary">${esc(say.summary(view.delivered, view.total))}</p>` : ''}
    ${view.overall && view.detail !== 'stages' ? `<div class="overall">${bar(view.overall.done, view.overall.total)}<p>${esc(say.overall(view.overall.done, view.overall.total))}</p></div>` : ''}
    ${view.goal ? `<p class="goal">${esc(say.goal)} ${bdi(view.goal)}</p>` : ''}
  </header>
  ${nowBlock || nextBlock || waitBlock ? `<div class="panels">${nowBlock}${nextBlock}${waitBlock}</div>` : ''}
  ${view.stages.length ? `<section aria-labelledby="stages">
    <h2 id="stages">${esc(say.stages)}</h2>
    <ol class="route" role="list" style="--fill:${(fill / 100).toFixed(3)}">
      ${view.stages.map(stage).join('\n      ')}
    </ol>
  </section>` : `<p>${esc(say.empty)}</p>`}
  ${view.stages.length ? `<section class="how"><details><summary>${esc(say.howHeading)}</summary><ol>${say.how.map(([name, what]) => `<li><strong>${esc(name)}</strong>: <span>${esc(what)}</span></li>`).join('')}</ol></details></section>` : ''}
  <footer>
    <p>${esc(when ? say.updated(when) : say.updatedLatest)} ${esc(say.onHold)}</p>
    <p>${esc(say.progressOnly)}</p>
  </footer>`}
</main>
</body>
</html>
`;
}
