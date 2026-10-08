// `wf status --client` (MAINT-0008): the project's progress for a client who does not read records. It shows each
// milestone as a stage in plain words: its title and outcome, where it stands, how many of its parts are done and how
// many are on hold. No other record field leaves the records: no IDs, branches, people, decisions, readiness reasons or
// pull requests. The title, outcome and measure are shown as written, so they are written for the client. Like
// `wf status` it is derived and read-only, grants nothing and no gate reads it. Record text is escaped.
import { list, loadAll, loadConfig } from './records.js';

// What each milestone status means to someone outside the work.
const STAGE = {
  Draft: { words: 'Planned', tone: 'planned', order: 0 },
  Authorised: { words: 'Up next', tone: 'planned', order: 1 },
  Active: { words: 'In progress', tone: 'active', order: 2 },
  Blocked: { words: 'Paused for now', tone: 'review', order: 2 },
  Verified: { words: 'Built and checked, awaiting sign-off', tone: 'review', order: 3 },
  Accepted: { words: 'Signed off', tone: 'done', order: 4 },
  Released: { words: 'Delivered', tone: 'done', order: 5 },
};
const PLACEHOLDER = /coherent journey or demonstrable technical outcome/i;

// The milestone's own heading names it ("# M-0002 — Customers can order online"); its outcome says what it delivers.
function titleOf(record) {
  const heading = (record.body ?? '').match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '';
  const named = heading.replace(/^M-\d{4}\s*[—–-]\s*/, '').trim();
  return named && !PLACEHOLDER.test(named) && !/^M-\d{4}$/.test(named) ? named : null;
}

export function evaluateClient({ source, updated = null }) {
  const config = loadConfig(source);
  const rd = config.records_dir ?? 'docs/workflow';
  const client = config.client ?? {};
  const exclude = new Set(list(client.exclude));
  const all = loadAll(source, rd);
  const profile = all.profile?.data ?? {};
  const tasks = [...all.tasks.values()].map(r => r.data).filter(Boolean);
  const stages = [...all.milestones.values()]
    .filter(r => r.data?.id && !exclude.has(r.data.id))
    .sort((a, b) => String(a.data.id).localeCompare(String(b.data.id)))
    .map(r => {
      const m = r.data;
      const stage = STAGE[m.status] ?? STAGE.Draft; // never a raw record word
      const own = tasks.filter(t => t.milestone === m.id);
      // Task records are removed once a milestone is accepted, so a signed-off stage is complete by definition.
      const finished = stage.tone === 'done';
      const total = finished ? null : Math.max(new Set(list(m.tasks)).size, own.length);
      const done = finished ? null : own.filter(t => t.status === 'Done').length;
      const title = titleOf(r) ?? m.outcome ?? 'Untitled stage';
      return {
        title,
        outcome: m.outcome && m.outcome !== title ? m.outcome : null,
        measure: m.measure ?? null,
        status: stage.words, tone: stage.tone, finished, paused: m.status === 'Blocked',
        parts: total ? { done, total } : null,
        on_hold: finished ? 0 : own.filter(t => t.status === 'Blocked').length,
      };
    });
  const current = stages.find(s => s.tone === 'review' && !s.paused) ?? stages.find(s => s.tone === 'active') ?? stages.find(s => s.paused) ?? null;
  const delivered = stages.filter(s => s.finished).length;
  let headline;
  if (!stages.length) headline = 'The project is being planned.';
  else if (current?.paused) headline = `${current.title} is paused for now.`;
  else if (current?.tone === 'review') headline = `${current.title}: built and checked, and waiting for sign-off.`;
  else if (current) headline = `Now working on ${lowerFirst(current.title)}.`;
  else if (delivered === stages.length) headline = 'Everything planned so far is delivered.';
  else if (stages.some(s => s.status === 'Up next')) headline = `Next: ${lowerFirst(stages.find(s => s.status === 'Up next').title)}.`;
  else headline = 'The next stage is being planned.';
  return {
    title: typeof client.title === 'string' && client.title.trim() ? client.title.trim() : profile.project ?? 'Project',
    goal: profile.measure ?? null,
    headline, delivered, total: stages.length,
    current: current ? stages.indexOf(current) : null,
    stages, updated,
  };
}

// Sentence case inside a sentence, unless the title starts with an acronym or a proper noun we cannot tell apart.
const lowerFirst = text => /^[A-Z][a-z]/.test(text) && !/^[A-Z][a-z]+[A-Z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderClient(view) {
  const date = view.updated ? new Date(view.updated) : null;
  const when = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null;
  // How far the route line is filled: through the last finished stage, and halfway into the current one.
  const lastDone = view.stages.map(s => s.finished).lastIndexOf(true);
  const reach = view.current != null ? view.current + 0.5 : lastDone + 1;
  const fill = view.stages.length ? Math.min(100, Math.max(0, (reach / view.stages.length) * 100)) : 0;
  const stage = (s, i) => {
    const pct = s.parts ? Math.round((s.parts.done / s.parts.total) * 100) : s.finished ? 100 : 0;
    const progress = s.parts
      ? `<div class="parts"><div class="bar" aria-hidden="true"><span style="width:${pct}%"></span></div><p>${s.parts.done} of ${s.parts.total} part${s.parts.total === 1 ? '' : 's'} done${s.on_hold ? `, ${s.on_hold} on hold` : ''}</p></div>`
      : '';
    return `<li class="stage ${s.tone}${i === view.current ? ' current' : ''}">
        <span class="marker" aria-hidden="true">${s.finished ? '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>' : i + 1}</span>
        <div class="body">
          <p class="status"><span class="visually-hidden">Stage ${i + 1} of ${view.stages.length}: </span>${esc(s.status)}</p>
          <h3>${esc(s.title)}</h3>
          ${s.outcome ? `<p class="outcome">${esc(s.outcome)}</p>` : ''}
          ${s.measure && !s.finished ? `<p class="measure">You will be able to check it by: ${esc(s.measure)}</p>` : ''}
          ${progress}
        </div>
      </li>`;
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(view.title)}: progress</title>
<style>
  :root {
    --paper: #f2f5f1; --sheet: #fbfcfa; --ink: #1e2b2f; --muted: #5a6a6d; --rule: #d3dbd4;
    --done: #2e6b4f; --active: #2f4fb0; --review: #8a5e0e; --planned: #8a9799;
    --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
    --sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root { --paper: #121a1c; --sheet: #172124; --ink: #e4ebe8; --muted: #9aa9a9; --rule: #2c3a3d; --done: #6fbf94; --active: #8fa6ff; --review: #e0b357; --planned: #6c7a7c; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.55 var(--sans); }
  main { max-width: 44rem; margin: 0 auto; padding: 3.5rem 1.25rem 4rem; }
  header { margin-bottom: 2.75rem; }
  .project { margin: 0 0 .9rem; color: var(--muted); font-size: 1rem; }
  h1 { margin: 0; font: 400 clamp(1.9rem, 5vw, 2.6rem)/1.18 var(--serif); letter-spacing: -.01em; text-wrap: balance; }
  .summary { margin: 1.1rem 0 0; font-size: 1.05rem; }
  .goal { margin: .6rem 0 0; color: var(--muted); max-width: 36rem; }
  h2 { margin: 0 0 1.25rem; font: 600 1rem/1.3 var(--sans); }
  ol { list-style: none; margin: 0; padding: 0; position: relative; }
  ol::before, ol::after { content: ""; position: absolute; left: 1.05rem; top: 1.1rem; width: 2px; border-radius: 1px; }
  ol::before { bottom: 1.1rem; background: var(--rule); }
  ol::after { height: calc((100% - 2.2rem) * var(--fill)); background: var(--done); transform-origin: top; animation: grow .9s ease-out both; }
  @keyframes grow { from { transform: scaleY(0); } }
  .stage { position: relative; display: grid; grid-template-columns: 2.1rem 1fr; gap: 1.1rem; padding-bottom: 2rem; }
  .stage:last-child { padding-bottom: 0; }
  .marker { position: relative; z-index: 1; width: 2.1rem; height: 2.1rem; border-radius: 50%; display: grid; place-items: center; font: 600 .95rem var(--sans); background: var(--paper); border: 2px solid var(--planned); color: var(--muted); }
  .marker svg { width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .done .marker { background: var(--done); border-color: var(--done); color: var(--sheet); }
  .active .marker { border-color: var(--active); color: var(--active); }
  .review .marker { border-color: var(--review); color: var(--review); }
  .body { padding-top: .2rem; min-width: 0; }
  .status { margin: 0; font-size: .9rem; font-weight: 600; color: var(--muted); }
  .done .status { color: var(--done); } .active .status { color: var(--active); } .review .status { color: var(--review); }
  h3 { margin: .15rem 0 0; font: 400 1.35rem/1.3 var(--serif); }
  .done h3 { font-size: 1.15rem; }
  .outcome, .measure { margin: .35rem 0 0; color: var(--muted); }
  .current .body { background: var(--sheet); border: 1px solid var(--rule); border-radius: 10px; padding: 1rem 1.15rem 1.1rem; margin-top: -.35rem; }
  .parts { margin-top: .8rem; }
  .parts p { margin: .35rem 0 0; font-size: .92rem; color: var(--muted); }
  .bar { height: .45rem; border-radius: .25rem; background: var(--rule); overflow: hidden; max-width: 22rem; }
  .bar span { display: block; height: 100%; background: var(--planned); }
  .active .bar span { background: var(--active); } .review .bar span { background: var(--review); }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  footer { margin-top: 3.5rem; padding-top: 1.25rem; border-top: 1px solid var(--rule); color: var(--muted); font-size: .9rem; }
  footer p { margin: 0 0 .4rem; }
  @media (prefers-reduced-motion: reduce) { ol::after { animation: none; } }
  @media print { body { background: #fff; } ol::after { animation: none; } .current .body { border-color: #bbb; } }
</style>
</head>
<body>
<main>
  <header>
    <p class="project">${esc(view.title)}</p>
    <h1>${esc(view.headline)}</h1>
    ${view.total ? `<p class="summary">${view.delivered} of ${view.total} stage${view.total === 1 ? '' : 's'} delivered.</p>` : ''}
    ${view.goal ? `<p class="goal">How you will know it works: ${esc(view.goal)}</p>` : ''}
  </header>
  ${view.stages.length ? `<section aria-labelledby="stages">
    <h2 id="stages">Stages</h2>
    <ol role="list" style="--fill:${(fill / 100).toFixed(3)}">
      ${view.stages.map(stage).join('\n      ')}
    </ol>
  </section>` : '<p>The stages appear here once the first one is planned.</p>'}
  <footer>
    <p>${when ? `Updated ${esc(when)}.` : 'Updated from the latest project records.'} A part on hold is waiting for a decision or for something outside the work.</p>
    <p>This page shows progress only. Approvals and sign-off happen with the project owner.</p>
  </footer>
</main>
</body>
</html>
`;
}
