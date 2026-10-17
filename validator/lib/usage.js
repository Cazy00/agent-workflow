// MAINT-0020 P14: `wf usage`, what each agent used, read from the harnesses' own records. M-0005's two studies were made by hand
// from transcripts, and 12 of its 13 session outcomes had no usage (F13). It grants nothing and no gate reads it.
//
// Modules and contracts. A reader per harness (adapters/usage/<harness>.mjs) turns that harness's files into
// agent-workflow/usage-reader@1; this aggregator turns readings into agent-workflow/usage@1 (SCHEMA.md) and knows no harness's
// files; cli.js wires them. Replacing or adding a reader changes only that reader and its line in cli.js.
//
// agent-workflow/usage-reader@1 is { schema, harness, agents: [agent], notes: [text] }, an agent being
//   { id, session, parent: an agent id or null, kind: main | helper | run, description: a helper's launch description or null,
//     calls: [{ id, at, model, effort, input, cache_read, cache_write_5m, cache_write_1h, output, after: { tool, description } | null }]
//       one per model call in order (input is the uncached part; after is the tool call whose result preceded it, null after a
//       message), or null for a run (a second-model process), which gives instead
//     cwd (the folder it ran in, a path, or null), prompt_names (those of the names it was given that its first prompt names),
//     ids: { cwd: [ID], prompt: [ID] } (the T-, M- and R- IDs its folder and first prompt name), model, effort, refused (stopped
//       at the harness's usage limit), started, total: { input, cache_read, cache_write_5m, cache_write_1h, output } }
// A reader is called as read(paths, { since, until, names }), names being the repository's (cli.js). It passes no message text:
// only launch descriptions and Bash descriptions, and of a run's first prompt the IDs and given names it names.
import path from 'node:path';
import { list } from './records.js';
import { parseLaunchName } from './roles.js';
import { matchGlob } from './glob.js';

export const READER = 'agent-workflow/usage-reader@1';
export const SCHEMA = 'agent-workflow/usage@1';
const FIELDS = ['input', 'cache_read', 'cache_write_5m', 'cache_write_1h', 'output']; // also the price keys (records.js PRICE_KEYS)
// A call writes after a wait when the gap since its agent's previous call outlived the cache its writes use and those writes total
// more than REBUILD: M-0005's helpers rebuilt 19.4 M of their 31.5 M written tokens so (record § 9, F11). Each lifetime is judged on
// its own writes (v2.9.0 review S1-1): a call's five-minute writes count after a gap over 300 s, its one-hour writes after one over
// 3600 s, and REBUILD applies to their sum, so no mix of the two reads as zero or as all of it by which is larger.
const LIFETIME = { cache_write_5m: 300, cache_write_1h: 3600 }, REBUILD = 20000;
// MAINT-0020 P1: the peak context an implementing helper (implementer or fix) should stay under; M-0005's four largest reached
// 571–814 K. Slices (wf brief --lead) are the cut; this flags a recurrence, since no gate can read a harness's token counts.
export const HELPER_PEAK = 350000;
const ROLES = ['coordinator', 'lead', 'implementer', 'fix', 'reviewer', 'paperwork', 'walker', 'acceptance', 'plan', 'other'];
// Descriptions older than the launch-name convention (roles.js), as M-0005's read, in this order: "Task lead for T-0029" is a
// lead, "Implement T-0035 review fixes" a fix.
const KEYWORDS = [['lead', /\btask lead\b/i], ['paperwork', /paperwork/i], ['walker', /walk/i], ['fix', /\bfix/i], ['implementer', /\bimplement/i], ['reviewer', /review/i]];
const ID = /\b[TM]-\d{4}\b/;
const zero = () => Object.fromEntries(FIELDS.map(k => [k, 0]));
const written = c => c.cache_write_5m + c.cache_write_1h;
const tokensOf = t => FIELDS.reduce((n, k) => n + t[k], 0);
const cents = n => Math.round(n * 100) / 100;
const time = s => (s == null ? null : Date.parse(s));

// Each agent's task and role: its launch name (named); else the older words and the first task or milestone ID in its description
// (inferred); the main session is the coordinator. A helper naming no task takes its parent's.
function attribute(agents) {
  const byId = new Map(agents.map(a => [a.id, a])), done = new Map();
  const own = a => {
    if (a.kind === 'main') return { role: 'coordinator', attribution: 'main', task: null, task_from: null };
    const named = parseLaunchName(a.description);
    if (named) return { role: named.role, attribution: 'named', task: named.id, task_from: 'name' };
    const word = KEYWORDS.find(([, re]) => re.test(a.description ?? ''))?.[0];
    const task = String(a.description ?? '').match(ID)?.[0] ?? null;
    return { role: word ?? 'other', attribution: word ? 'inferred' : 'none', task, task_from: task ? 'description' : null };
  };
  const resolve = (a, path = new Set()) => {
    if (done.has(a.id)) return done.get(a.id);
    const r = own(a);
    const parent = byId.get(a.parent);
    if (!r.task && parent && !path.has(parent.id)) { const p = resolve(parent, new Set([...path, a.id])); if (p.task) Object.assign(r, { task: p.task, task_from: 'parent' }); }
    done.set(a.id, r);
    return r;
  };
  return agents.map(a => ({ ...a, ...resolve(a) }));
}

const priceOf = (prices, model) => {
  const key = prices && model ? Object.keys(prices).filter(k => model.startsWith(k)).sort((a, b) => b.length - a.length)[0] : null;
  return key ? prices[key] : null;
};
const costOf = (price, t) => FIELDS.reduce((n, k) => n + t[k] * price[k], 0) / 1e6;
const most = counts => Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

// One agent's calls in the window, counted once per message ID across every file read (templates/pilot.md).
function measure(a, inWindow, seen, prices, waits) {
  const m = { calls: 0, ...zero(), peak_context: 0, after_wait: { calls: 0, tokens: 0 }, first_call: null, last_call: null, cost: prices ? 0 : null, unpriced_calls: 0 };
  const models = {}, efforts = {};
  let prev = null;
  for (const c of a.calls ?? []) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const gap = prev ? (time(c.at) - time(prev.at)) / 1000 : 0, rebuilt = Object.entries(LIFETIME).reduce((n, [k, seconds]) => n + (gap > seconds ? c[k] : 0), 0);
    prev = c;
    if (!inWindow(c.at)) continue;
    m.calls++;
    for (const k of FIELDS) m[k] += c[k];
    m.peak_context = Math.max(m.peak_context, c.input + c.cache_read + written(c));
    m.first_call ??= c.at; m.last_call = c.at;
    if (c.model) models[c.model] = (models[c.model] ?? 0) + 1;
    if (c.effort) efforts[c.effort] = (efforts[c.effort] ?? 0) + 1;
    if (rebuilt > REBUILD) { m.after_wait.calls++; m.after_wait.tokens += rebuilt; waits.push({ task: a.task, tool: c.after?.tool ?? null, description: c.after?.description ?? null, tokens: rebuilt }); }
    if (prices) { const p = priceOf(prices, c.model); if (p) m.cost += costOf(p, c); else m.unpriced_calls++; }
  }
  return { ...m, model: most(models), effort: most(efforts), cost: m.cost == null ? null : cents(m.cost) };
}

function sum(agents, priced) {
  const g = { agents: 0, calls: 0, ...zero(), after_wait: { calls: 0, tokens: 0 }, peak_context: 0, first_call: null, last_call: null, time_seconds: null, models: [], efforts: [], cost: priced ? 0 : null };
  for (const a of agents) {
    g.agents++; g.calls += a.calls;
    for (const f of FIELDS) g[f] += a[f];
    g.after_wait.calls += a.after_wait.calls; g.after_wait.tokens += a.after_wait.tokens;
    g.peak_context = Math.max(g.peak_context, a.peak_context);
    if (!g.first_call || time(a.first_call) < time(g.first_call)) g.first_call = a.first_call;
    if (!g.last_call || time(a.last_call) > time(g.last_call)) g.last_call = a.last_call;
    for (const [f, v] of [['models', a.model], ['efforts', a.effort]]) if (v && !g[f].includes(v)) g[f].push(v);
    if (priced) g.cost = cents(g.cost + a.cost);
  }
  g.time_seconds = g.first_call ? Math.round((time(g.last_call) - time(g.first_call)) / 1000) : null;
  return g;
}
const group = (agents, key, name, priced) => [...new Set(agents.map(key))].map(k => ({ [name]: k, ...sum(agents.filter(a => key(a) === k), priced) }));

// The project's IDs a second-model run can name: its records' tasks and milestones, and the reviews their findings cite; `reviews`
// maps each such review to the tasks citing it (accepted_findings, found_from), so a run naming only a review reaches a milestone
// through them (v2.9.0 review S1-2); with --milestone, the milestone's tasks (null without records: every matched run then counts).
// cli.js adds where the project is: `folders` (the repository and its worktrees), `folder_names` (usage.folders) and `names`.
export function usageProject(records, milestone = null) {
  if (!records) return { ids: new Set(), tasksOf: null, reviews: new Map() };
  const ids = new Set([...records.tasks.keys(), ...records.milestones.keys()].filter(id => ID.test(id))), reviews = new Map();
  for (const r of records.tasks.values()) for (const f of [...list(r.data?.accepted_findings), r.data?.found_from]) { const review = String(f ?? '').match(/^R-\d{4}/)?.[0]; if (review) { ids.add(review); reviews.set(review, (reviews.get(review) ?? new Set()).add(r.data?.id)); } }
  const tasksOf = milestone ? new Set([...[...records.tasks.values()].filter(r => r.data?.milestone === milestone).map(r => r.data.id), ...list(records.milestones.get(milestone)?.data?.tasks)]) : null;
  return { ids, tasksOf, reviews };
}

// The window the readers are read for: as given, else the span of the calls read so far (the Claude sessions'), so Codex runs
// are counted over the same time.
export function usageWindow(readings, since = null, until = null) {
  const ats = readings.flatMap(r => r.agents.flatMap(a => (a.calls ?? []).map(c => c.at))).filter(at => (!since || time(at) >= time(since)) && (!until || time(at) <= time(until))).sort((a, b) => time(a) - time(b));
  return { since: since ?? ats[0] ?? null, until: until ?? ats.at(-1) ?? null };
}

// v2.9.0 final review S1: a run is this project's when it ran in the repository or one of its worktrees, or in or below a folder
// whose name usage.folders allows, or when its first prompt names the repository. Codex keeps every project's runs in one folder,
// and IDs alone (T-0001, M-0001) are any project's: another project's runs used this one's budget.
const inside = (dir, root) => { const rel = path.relative(root, dir); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); };
export function projectOf(run, { folders = [], folder_names = [], names = [] } = {}) {
  const cwd = typeof run.cwd === 'string' && path.isAbsolute(run.cwd) ? path.resolve(run.cwd) : null;
  if (cwd && (folders.some(f => inside(cwd, path.resolve(f))) || cwd.split(path.sep).filter(Boolean).some(seg => folder_names.some(g => matchGlob(g, seg))))) return 'folder';
  return (run.prompt_names ?? []).some(n => names.includes(n)) ? 'prompt' : null;
}

function secondModel(runs, { window, project, milestone, budget, prices }) {
  const inWindow = at => at && (!window.since || time(at) >= time(window.since)) && (!window.until || time(at) <= time(window.until));
  const out = runs.filter(r => inWindow(r.started)).map(r => {
    // The run's ID, once it is this project's: from its folder first, a task before a milestone before a review, else from its
    // first prompt. A run naming the project's IDs and nothing else of it is another project's (ids_only).
    const pick = ids => { const mine = ids.filter(id => project.ids.has(id)); return mine.find(i => i[0] === 'T') ?? mine.find(i => i[0] === 'M') ?? mine[0] ?? null; };
    const by = projectOf(r, project), fromCwd = pick(r.ids?.cwd ?? []), id = fromCwd ?? pick(r.ids?.prompt ?? []), named = by ? id : null;
    const price = priceOf(prices, r.model);
    return { harness: r.harness, id: r.id, started: r.started, model: r.model, effort: r.effort, matched_by: by, named, named_in: named ? (fromCwd ? 'cwd' : 'prompt') : null, task: named && named[0] !== 'R' ? named : null, matched: !!by, ids_only: !by && !!id, refused: !!r.refused, ...r.total, cost: prices ? (price ? cents(costOf(price, r.total)) : null) : null };
  });
  const counted = out.filter(r => r.matched && !r.refused);
  const by_task = {};
  for (const r of counted) if (r.named) by_task[r.named] = (by_task[r.named] ?? 0) + 1;
  let m = null;
  if (milestone) {
    // A run is the milestone's when it names the milestone, one of its tasks, or a review one of those tasks cites.
    const ofMilestone = id => id === milestone || !project.tasksOf || project.tasksOf.has(id) || [...(project.reviews?.get(id) ?? [])].some(t => project.tasksOf.has(t));
    const mine = out.filter(r => r.matched && ofMilestone(r.named));
    const used = mine.filter(r => !r.refused), review = used.filter(r => r.named === milestone).length, taskRuns = used.length - review;
    const warning = !budget ? null : used.length >= budget.runs ? `the budget is spent: ${used.length} of ${budget.runs} runs used` : !review && taskRuns + 1 >= budget.runs ? `one more task run would use the milestone review's reserve (${taskRuns} of ${budget.runs - 1} task runs used)` : null;
    m = { id: milestone, budget: budget?.runs ?? null, deep_tasks: budget?.deep_tasks ?? null, used: used.length, task_runs: taskRuns, review_runs: review, refused: mine.length - used.length, warning };
  }
  return { window, runs: out, matched: out.filter(r => r.matched).length, refused: out.filter(r => r.matched && r.refused).length, unmatched: out.filter(r => !r.matched).length, ids_only: out.filter(r => r.ids_only).length, by_task, milestone: m };
}

export function evaluateUsage({ readings, since = null, until = null, task = null, milestone = null, prices = null, project = { ids: new Set(), tasksOf: null, reviews: new Map() }, budget = null, notes = [] }) {
  for (const r of readings) if (r?.schema !== READER) throw new Error(`a usage reader returned ${r?.schema ?? 'nothing'}, not ${READER}`);
  const window = usageWindow(readings, since, until);
  const inWindow = at => (!since || time(at) >= time(since)) && (!until || time(at) <= time(until));
  const priced = !!prices, seen = new Set(), waits = [];
  const read = attribute(readings.flatMap(r => r.agents.filter(a => a.kind !== 'run').map(a => ({ ...a, harness: r.harness }))));
  let agents = read.map(a => ({ harness: a.harness, session: a.session ?? null, id: a.id, parent: a.parent ?? null, kind: a.kind, description: a.description ?? null, task: a.task, task_from: a.task_from, role: a.role, attribution: a.attribution, ...measure(a, inWindow, seen, prices, waits) })).filter(a => a.calls);
  // The transcripts' own IDs belong to the project too, so a run is matched where no records are at hand.
  const ids = new Set(project.ids);
  for (const a of agents) for (const id of [a.task, ...(String(a.description ?? '').match(/\b[TMR]-\d{4}\b/g) ?? [])]) if (id) ids.add(id);
  const second = secondModel(readings.flatMap(r => r.agents.filter(a => a.kind === 'run').map(a => ({ ...a, harness: r.harness }))), { window, project: { ...project, ids }, milestone, budget, prices });
  if (task) agents = agents.filter(a => a.task === task);
  agents.sort((a, b) => time(a.first_call) - time(b.first_call));
  const byRole = group(agents, a => a.role, 'role', priced).sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
  const byTask = group(agents, a => a.task, 'task', priced).sort((a, b) => (a.task == null) - (b.task == null) || String(a.task).localeCompare(String(b.task)));
  const totals = sum(agents, priced);
  const waited = waits.filter(w => !task || w.task === task);
  const tally = (key, described) => [...waited.reduce((m, w) => { const e = m.get(key(w)) ?? { tool: w.tool, ...(described ? { description: w.description } : {}), calls: 0, tokens: 0 }; e.calls++; e.tokens += w.tokens; return m.set(key(w), e); }, new Map()).values()].sort((a, b) => b.tokens - a.tokens);
  const notesOut = [...notes, ...readings.flatMap(r => r.notes ?? [])];
  const inferred = agents.filter(a => a.attribution === 'inferred').length, none = agents.filter(a => a.attribution === 'none').length;
  if (inferred || none) notesOut.push(`${inferred} agent(s) attributed by the words of their description (inferred) and ${none} by none: their launch names do not follow the convention (wf brief --lead prints it)`);
  for (const a of agents.filter(a => ['implementer', 'fix'].includes(a.role) && a.peak_context > HELPER_PEAK).sort((x, y) => y.peak_context - x.peak_context)) notesOut.push(`${a.role} of ${a.task ?? 'no task'}${a.description ? ` "${a.description}"` : ''} peaked at ${Math.ceil(a.peak_context / 1e3)} K, over ${tok(HELPER_PEAK)}: slices keep a helper under it (MAINT-0020 P1; wf brief --lead lists them)`);
  const unpriced = agents.reduce((n, a) => n + a.unpriced_calls, 0);
  if (priced && unpriced) notesOut.push(`${unpriced} call(s) of models usage.prices does not name are left out of the estimate`);
  if (task && !agents.length) notesOut.push(`no agent of ${task} has a call in the window`);
  if (milestone && !budget) notesOut.push(`no second-model budget for ${milestone}: the config here sets no review.second_model, or there is no project config`);
  if (second.ids_only) notesOut.push(`${second.ids_only} second-model run(s) name this project's IDs but ran outside its folders (the repository, its worktrees, usage.folders) and do not name it in their first prompt (${(project.names ?? []).join(', ') || 'no name here'}): counted as other projects', not here`);
  if (second.runs.length && !(project.folders ?? []).length && !(project.names ?? []).length) notesOut.push('no Git repository and no config repository here: no second-model run can be this project\'s');
  return {
    schema: SCHEMA, window, filter: { task, milestone }, priced, agents, by_role: byRole, by_task: byTask, totals,
    writes_after_wait: { calls: totals.after_wait.calls, tokens: totals.after_wait.tokens, by_tool: tally(w => w.tool, false), by_call: tally(w => `${w.tool}\u0000${w.description}`, true) },
    second_model: second, notes: notesOut,
    limitation: 'Read from the harnesses\' own records; grants nothing and no gate reads it. Transcripts can under-record output tokens; a cost is an estimate at the configured list prices, not a bill.',
  };
}

// `--outcome`: the selected task's `usage` for its session outcome (templates/session.json), the second model's runs of it included.
export function outcomeUsage(u) {
  const t = u.totals, runs = u.second_model.runs.filter(r => r.matched && !r.refused && r.task && r.task === u.filter.task);
  const second = runs.length ? { second_model: { runs: runs.length, ...Object.fromEntries(FIELDS.map(k => [k, runs.reduce((n, r) => n + r[k], 0)])) } } : {};
  const spend = u.priced ? { estimate: cents(t.cost + runs.reduce((n, r) => n + (r.cost ?? 0), 0)), basis: 'list prices in usage.prices, not a bill; transcripts can under-record output tokens' } : null;
  return { time_seconds: t.time_seconds, tokens: { calls: t.calls, ...Object.fromEntries(FIELDS.map(k => [k, t[k]])), ...second }, spend, attempts: null };
}

const tok = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} K` : String(n));
function table(head, rows) {
  const width = head.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
  return [head, ...rows].map(r => `  ${r.map((c, i) => (i ? String(c).padStart(width[i]) : String(c).padEnd(width[i]))).join('  ')}`.trimEnd());
}
export function renderUsage(u) {
  const t = u.totals, cost = n => (n == null ? '—' : n.toFixed(2));
  const head = ['agents', 'calls', 'input', 'cache reads', 'writes 5m', 'writes 1h', 'after waits', 'output', 'peak', ...(u.priced ? ['est. cost'] : [])];
  const row = (name, g) => [name, g.agents, g.calls, tok(g.input), tok(g.cache_read), tok(g.cache_write_5m), tok(g.cache_write_1h), tok(g.after_wait.tokens), tok(g.output), tok(g.peak_context), ...(u.priced ? [cost(g.cost)] : [])];
  const lines = [`Usage of ${t.agents} agent(s), ${t.calls} model call(s), ${u.window.since ?? 'the start'} to ${u.window.until ?? 'the end'}${u.filter.task ? `, task ${u.filter.task}` : ''}: ${u.priced ? 'costs are estimates at the list prices in usage.prices' : 'tokens only (the config sets no usage.prices)'}`];
  lines.push('', 'By role:', ...table(['role', ...head], [...u.by_role.map(g => row(g.role, g)), row('all', t)]));
  lines.push('', 'By task:', ...table(['task', ...head], u.by_task.map(g => row(g.task ?? 'none', g))));
  const size = a => (u.priced ? a.cost ?? 0 : tokensOf(a));
  const label = a => `${a.role}${a.task ? ` of ${a.task}` : ''}${a.attribution === 'inferred' ? ' (inferred)' : a.attribution === 'none' ? ' (unattributed)' : ''}${a.description ? ` "${a.description}"` : ''}`;
  lines.push('', `Largest agents, by ${u.priced ? 'estimated cost' : 'tokens'}:`, ...[...u.agents].sort((a, b) => size(b) - size(a)).slice(0, 5).map(a => `  ${label(a)}: ${a.calls} call(s), cache reads ${tok(a.cache_read)}, writes ${tok(written(a))} (${tok(a.after_wait.tokens)} after waits), peak ${tok(a.peak_context)}, ${[a.model, a.effort].filter(Boolean).join(' ') || 'model unknown'}${u.priced ? `, est. ${cost(a.cost)}` : ''}`));
  const w = u.writes_after_wait, c = u.by_role.find(g => g.role === 'coordinator')?.after_wait ?? { calls: 0, tokens: 0 };
  lines.push('', `Writes after a wait longer than the cache's lifetime (over 20 K written): ${w.calls} call(s), ${tok(w.tokens)}; helpers ${tok(w.tokens - c.tokens)} in ${w.calls - c.calls}, the coordinator ${tok(c.tokens)} in ${c.calls}.`);
  if (w.calls) lines.push(`  by the tool call before them: ${w.by_tool.map(e => `${e.tool ?? 'a message'} ${tok(e.tokens)}`).join(', ')}`, ...w.by_call.filter(e => e.description).slice(0, 5).map(e => `  ${e.tool} "${e.description}": ${e.calls} call(s), ${tok(e.tokens)}`));
  const s = u.second_model;
  lines.push('', `Second-model runs in the window: ${s.matched} of this project (run in its folders, or naming it in their first prompt)${s.refused ? `, ${s.refused} of them refused at the usage limit` : ''}; ${s.unmatched} of other projects${s.ids_only ? `, ${s.ids_only} of them naming this project's IDs` : ''}.`);
  if (Object.keys(s.by_task).length) lines.push(`  run: ${Object.entries(s.by_task).sort().map(([k, n]) => `${k} ${n}`).join(', ')}`);
  if (s.refused) lines.push(`  refused: ${s.runs.filter(r => r.matched && r.refused).map(r => `${r.named} at ${r.started}`).join(', ')}`);
  const m = s.milestone;
  if (m) lines.push(m.budget == null ? `  ${m.id}: ${m.used} run(s) used; no budget here (no review.second_model, or no project config)` : `  ${m.id}: ${m.used} of its budget of ${m.budget} run(s) used (two per deep task, one for the milestone review)${m.refused ? `; ${m.refused} refused, not counted` : ''}${m.warning ? `. Warning: ${m.warning}` : ''}`);
  lines.push('', `Totals: input ${tok(t.input)}, cache reads ${tok(t.cache_read)}, writes ${tok(t.cache_write_5m)} five-minute and ${tok(t.cache_write_1h)} one-hour, output ${tok(t.output)}${u.priced ? `; estimated list-price cost ${cost(t.cost)}` : ''}.`);
  if (u.notes.length) lines.push('', 'Notes:', ...u.notes.map(n => `  - ${n}`));
  lines.push('', `(${u.limitation})`);
  return `${lines.join('\n')}\n`;
}
