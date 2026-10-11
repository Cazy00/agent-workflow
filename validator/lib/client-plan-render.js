// The client page with a plan (MAINT-0014): header with the whole plan's progress, Now, Waiting on you, Recently done,
// then each phase and its steps. `renderClient` wraps it in the page's head and theme; `h` carries its escaping helpers and the part list.
export function planBody(view, say, h) {
  const { esc, bdi, ICON, band, look } = h;
  const plan = view.plan;
  const pct = n => `${Math.round(Math.min(1, Math.max(0, n)) * 100)}%`;
  const bar = n => `<div class="bar" aria-hidden="true"><span style="width:${pct(n)}"></span></div>`;
  const date = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(say.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); };
  // Every step in progress, the one leading the headline (a moving one first, a paused one last), and the next.
  const active = plan.steps.filter(s => s.state === 'active');
  const next = plan.steps.find(s => s.state === 'next');
  const lead = active.find(s => s.moving) ?? active.find(s => !s.paused) ?? active[0];
  const finished = plan.steps.length > 0 && plan.steps.every(s => s.state === 'done');
  // A sentence naming a title, with the title kept in its own direction (a function, so `$&` in it stays text).
  const named = (sentence, title) => { const e = esc(sentence); const t = esc(title); return e.includes(t) ? e.replace(t, () => bdi(title)) : e; };
  const why = s => s.paused ? say.paused(s.title) : s.review ? say.review(s.title) : say.working(s.title);
  const h1 = lead ? named(why(lead), lead.title) : next ? named(say.next(next.title), next.title) : esc(finished ? say.allDone : say.planning);
  const row = (state, name, label) => `<li class="item ${state}"><span class="icon" aria-hidden="true">${ICON[state]}</span><span class="name">${name}</span>${label ? `<span class="state">${esc(label)}</span>` : ''}</li>`;
  const where = (title, step) => `${bdi(title)} <span class="where">${esc(say.nextIn)} ${bdi(step)}</span>`;
  const moves = i => i.state === 'active' || i.state === 'checking';
  // Parts in progress, then being checked (the sort is stable); then each step in progress with no part moving in
  // view: paused, awaiting sign-off, its part up next, or the step itself (detail 'stages' lists no parts).
  const rows = [
    ...active.flatMap(s => s.items.filter(moves).map(i => ({ ...i, step: s.title }))).sort((a, b) => (a.state === 'checking') - (b.state === 'checking'))
      .map(i => row(i.state, where(i.title, i.step), say.part[i.state])),
    ...active.filter(s => !s.items.some(moves)).map(s => {
      if (s.paused) return row('hold', named(say.paused(s.title), s.title));
      if (s.review) return row('checking', named(say.review(s.title), s.title));
      const ready = s.items.find(i => i.state === 'next');
      return ready ? row('next', where(ready.title, s.title), say.part.next) : row('active', bdi(s.title), say.step.active);
    }),
  ];
  const now = `<section class="panel now" aria-labelledby="now"><h2 id="now">${esc(say.now)}</h2>${rows.length
    ? `<ul class="items" role="list">${rows.join('')}</ul>`
    : `<p>${next ? named(say.startsNext(next.title), next.title) : esc(finished ? say.allDone : say.planning)}</p>`}</section>`;
  const waiting = view.waiting.length ? `<section class="panel waiting" aria-labelledby="waiting"><h2 id="waiting"><span aria-hidden="true">${ICON.hold}</span>${esc(say.waitingYou)}</h2><ul class="decisions" role="list">${view.waiting.map(d => `<li><p class="question">${bdi(d.question)}</p><p class="meta">${esc(d.proposed ? say.decisionProposed : say.decisionOpen)}. ${esc(say.holds)} ${d.holds.map(bdi).join(view.language === 'ar' ? '، ' : ', ')}</p></li>`).join('')}</ul></section>` : '';
  const recent = view.recent.length ? `<section class="panel recent" aria-labelledby="recent"><h2 id="recent">${esc(say.recent)}</h2><ul class="items" role="list">${view.recent.map(p => `<li class="item done"><span class="icon" aria-hidden="true">${ICON.done}</span><span class="name">${bdi(p.title)}</span><span class="state">${esc(date(p.date))}</span></li>`).join('')}</ul></section>` : '';
  // Every step in progress is open (the next step when none is); the first carries the highlight.
  const current = active[0] ?? next;
  const opened = s => active.length ? s.state === 'active' : s === next;
  const step = s => {
    const parts = s.items.length
      ? opened(s) ? h.partList(s.items) : `<details class="more"><summary>${esc(s.state === 'done' ? say.stepDelivered(s.items.length) : say.stepParts(s.items.length))}</summary>${h.partList(s.items)}</details>`
      : s.state === 'done' || s.planned ? '' : `<p class="later">${esc(say.laterParts)}</p>`;
    return `<li class="step ${s.state}${s === current ? ' current' : ''}"><span class="marker" aria-hidden="true">${s.state === 'done' ? ICON.done : ''}</span><div class="body"><p class="status">${esc(say.step[s.state])}${s.added ? ` <span class="tag">${esc(say.addedStep)}</span>` : ''}</p><h4>${bdi(s.title)}</h4>${s.summary ? `<p class="outcome">${bdi(s.summary)}</p>` : ''}${s.parts && s.state !== 'done' ? `<div class="parts">${bar(s.progress)}<p>${esc(say.parts(s.parts.done, s.parts.total, s.on_hold))}</p></div>` : ''}${parts}</div></li>`;
  };
  const phases = plan.phases.map(p => `<section class="phase">${p.title ? `<div class="phase-head"><h3>${bdi(p.title)}</h3>${bar(p.progress)}</div>${p.summary ? `<p class="outcome">${bdi(p.summary)}</p>` : ''}` : ''}<ol class="steps" role="list">${p.steps.map(step).join('')}</ol></section>`).join('');
  const updated = view.updated ? `<p>${esc(say.lastUpdated)}: <time data-ago datetime="${esc(view.updated)}" data-locale="${esc(say.locale)}">${esc(date(view.updated))}</time></p>` : '';
  return `<header>
    ${!band && look?.logo ? `<img class="logo" src="${look.logo}" alt="${esc(view.title)}">` : ''}
    ${band ? '' : `<p class="project">${esc(view.title)}</p>`}
    <h1>${h1}</h1>
    <div class="overall">${bar(plan.progress)}<p>${plan.position ? esc(say.stepOf(plan.position.index, plan.position.total)) : ''}</p></div>
    ${view.goal ? `<p class="goal">${esc(say.goal)} ${bdi(view.goal)}</p>` : ''}
    ${updated}
  </header>
  <div class="panels">${now}${waiting}${recent}</div>
  <section aria-labelledby="plan"><h2 id="plan">${esc(say.planHeading)}</h2>${phases}</section>
  <footer><p>${esc(say.readPlan)}</p><p>${esc(say.readOnly)}</p></footer>
  <script>(() => { const el = document.querySelector('time[data-ago]'); if (!el || !window.Intl || !Intl.RelativeTimeFormat) return; const show = () => { const s = Math.max(0, (Date.now() - Date.parse(el.dateTime)) / 1000); const [n, u] = s < 3600 ? [Math.round(s / 60), 'minute'] : s < 86400 ? [Math.round(s / 3600), 'hour'] : [Math.round(s / 86400), 'day']; el.title = el.title || el.textContent; el.textContent = new Intl.RelativeTimeFormat(el.dataset.locale, { numeric: 'auto' }).format(-n, u); }; show(); setInterval(show, 60000); })();</script>`;
}

export const PLAN_CSS = `
  .header-time, header time { color: var(--muted); }
  .phase { margin-top: 2rem; }
  .phase-head { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .phase-head h3 { margin: 0; font: 600 1.25rem/1.35 var(--display-font); }
  .phase-head .bar { flex: 1 1 8rem; max-width: 14rem; }
  ol.steps { list-style: none; margin: 1rem 0 0; padding: 0; display: grid; gap: 1.1rem; position: relative; }
  ol.steps::before { content: ""; position: absolute; inset-inline-start: .7rem; top: .8rem; bottom: .8rem; width: 2px; border-radius: 1px; background: var(--line); }
  .step { display: grid; grid-template-columns: 1.6rem minmax(0, 1fr); gap: .9rem; }
  .step .marker { position: relative; z-index: 1; width: 1.6rem; height: 1.6rem; border-radius: 50%; display: grid; place-items: center; border: 2px solid var(--planned); background: var(--page); }
  .step .marker svg { width: .9rem; height: .9rem; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .step.done .marker { background: var(--done); border-color: var(--done); color: var(--surface); }
  .step.active .marker { border-color: var(--active); background: var(--active); }
  .step.next .marker { border-color: var(--text); }
  .step.done .status { color: var(--done); } .step.active .status { color: var(--active); } .step.next .status { color: var(--text); }
  .step h4 { margin: .1rem 0 0; font: 400 1.15rem/1.4 var(--display-font); }
  .step.later h4 { color: var(--muted); }
  .step.current .body { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: .9rem 1.05rem 1rem; margin-top: -.3rem; }
  .step .later { margin: .35rem 0 0; color: var(--muted); font-size: .92rem; }
  .step.active .bar span { background: var(--active); }
  .panel .where { color: var(--muted); font-size: .9rem; }
  .panel.now .item { grid-template-columns: 1.25rem minmax(0, 1fr) auto; }
  .panel.recent .item { grid-template-columns: 1.25rem minmax(0, 1fr) auto; }
`;
