// The client page with a plan (MAINT-0014): header with the whole plan's progress, Now, Waiting on you, Recently done,
// then each phase and its steps. `renderClient` wraps it in the page's head and theme; `h` carries its escaping helpers and the part list.
export function planBody(view, say, h) {
  const { esc, bdi, ICON } = h;
  const plan = view.plan;
  const pct = n => `${Math.round(Math.min(1, Math.max(0, n)) * 100)}%`;
  const bar = n => `<div class="bar" aria-hidden="true"><span style="width:${pct(n)}"></span></div>`;
  const date = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(say.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); };
  const active = plan.steps.filter(s => s.state === 'active');
  const next = plan.steps.find(s => s.state === 'next');
  const headline = active.length ? say.working(active[0].title) : next ? say.next(next.title) : say.allDone;
  const named = active[0]?.title ?? next?.title;
  const h1 = named && headline.includes(named) ? esc(headline).replace(esc(named), bdi(named)) : esc(headline);
  const nowItems = active.flatMap(s => s.items.filter(i => i.state === 'active' || i.state === 'checking').map(i => ({ ...i, step: s.title })));
  const now = `<section class="panel now" aria-labelledby="now"><h2 id="now">${esc(say.now)}</h2>${nowItems.length
    ? `<ul class="items" role="list">${nowItems.map(i => `<li class="item ${i.state}"><span class="icon" aria-hidden="true">${ICON[i.state]}</span><span class="name">${bdi(i.title)} <span class="where">${esc(say.nextIn)} ${bdi(i.step)}</span></span><span class="state">${esc(say.part[i.state])}</span></li>`).join('')}</ul>`
    : `<p>${next ? esc(say.startsNext(next.title)) : esc(say.allDone)}</p>`}</section>`;
  const waiting = view.waiting.length ? `<section class="panel waiting" aria-labelledby="waiting"><h2 id="waiting"><span aria-hidden="true">${ICON.hold}</span>${esc(say.waitingYou)}</h2><ul class="decisions" role="list">${view.waiting.map(d => `<li><p class="question">${bdi(d.question)}</p><p class="meta">${esc(d.proposed ? say.decisionProposed : say.decisionOpen)}. ${esc(say.holds)} ${d.holds.map(bdi).join(view.language === 'ar' ? '، ' : ', ')}</p></li>`).join('')}</ul></section>` : '';
  const recent = view.recent.length ? `<section class="panel recent" aria-labelledby="recent"><h2 id="recent">${esc(say.recent)}</h2><ul class="items" role="list">${view.recent.map(p => `<li class="item done"><span class="icon" aria-hidden="true">${ICON.done}</span><span class="name">${bdi(p.title)}</span><span class="state">${esc(date(p.date))}</span></li>`).join('')}</ul></section>` : '';
  const current = active[0] ?? next;
  const step = s => {
    const parts = s.items.length
      ? s === current ? h.partList(s.items) : `<details class="more"><summary>${esc(s.state === 'done' ? say.stepDelivered(s.items.length) : say.stepParts(s.items.length))}</summary>${h.partList(s.items)}</details>`
      : s.state === 'done' ? '' : `<p class="later">${esc(say.laterParts)}</p>`;
    return `<li class="step ${s.state}${s === current ? ' current' : ''}"><span class="marker" aria-hidden="true">${s.state === 'done' ? ICON.done : ''}</span><div class="body"><p class="status">${esc(say.step[s.state])}${s.added ? ` <span class="tag">${esc(say.addedStep)}</span>` : ''}</p><h4>${bdi(s.title)}</h4>${s.summary ? `<p class="outcome">${bdi(s.summary)}</p>` : ''}${s.parts && s.state !== 'done' ? `<div class="parts">${bar(s.progress)}<p>${esc(say.parts(s.parts.done, s.parts.total, s.on_hold))}</p></div>` : ''}${parts}</div></li>`;
  };
  const phases = plan.phases.map(p => `<section class="phase">${p.title ? `<div class="phase-head"><h3>${bdi(p.title)}</h3>${bar(p.progress)}</div>${p.summary ? `<p class="outcome">${bdi(p.summary)}</p>` : ''}` : ''}<ol class="steps" role="list">${p.steps.map(step).join('')}</ol></section>`).join('');
  const updated = view.updated ? `<p>${esc(say.lastUpdated)}: <time data-ago datetime="${esc(view.updated)}" data-locale="${esc(say.locale)}">${esc(date(view.updated))}</time></p>` : '';
  return `<header>
    <p class="project">${esc(view.title)}</p>
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
  ol.steps { list-style: none; margin: 1rem 0 0; padding: 0; display: grid; gap: 1.1rem; }
  .step { display: grid; grid-template-columns: 1.6rem minmax(0, 1fr); gap: .9rem; }
  .step .marker { width: 1.6rem; height: 1.6rem; border-radius: 50%; display: grid; place-items: center; border: 2px solid var(--planned); background: var(--page); }
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
  .panel.recent .item { grid-template-columns: 1.25rem minmax(0, 1fr) auto; }
`;
