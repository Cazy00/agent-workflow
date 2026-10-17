// MAINT-0020 P14: the Codex reader of `wf usage`. One module per harness turns that harness's own files into the shared reader
// contract, agent-workflow/usage-reader@1 (stated in validator/lib/usage.js, which aggregates it and knows no harness's files).
// Replacing or adding a reader changes only that reader and its line in validator/cli.js.
//
// Each log under the sessions folder (YYYY/MM/DD/*.jsonl, dated in local time) is one run: `session_meta` gives its cwd and
// start, `turn_context` its model and effort, and the last `total_token_usage` its total (input_tokens holds the cached ones).
// A run stopped by Codex's usage limit says so in an error message; the same words in a tool's output are not a refusal (M-0005's
// own record says "usage limit"). The folder leaves this module as it is, a path; of the first prompt only the T-, M- and R- IDs
// it names and which of the names it was given (the repository's) it names (v2.9.0 final review S1: the aggregator then knows
// which runs are this project's, since ~/.codex/sessions holds every project's).
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA = 'agent-workflow/usage-reader@1';
const DAY = 86400000;
const ids = text => [...new Set(String(text ?? '').match(/\b[TMR]-\d{4}\b/g) ?? [])];
// A name is named as a whole word, in any case: never inside another (other-project does not name project, nor project.js),
// though a sentence's full stop may follow it.
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const naming = (text, names) => names.filter(n => new RegExp(`(?<![\\w.-])${escape(n)}(?![\\w-]|\\.\\w)`, 'i').test(text));

// The logs of the days around the window (a folder's date is local, the window's times UTC); every log without a window.
function logs(root, since, until) {
  const lo = since ? Date.parse(since) - DAY : -Infinity, hi = until ? Date.parse(until) + DAY : Infinity;
  const out = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const d = path.relative(root, dir).split(path.sep).join('/').match(/(\d{4})\/(\d{2})\/(\d{2})$/);
      const day = d ? Date.UTC(+d[1], +d[2] - 1, +d[3]) : null;
      if (day === null || (day + DAY >= lo && day <= hi)) out.push(p);
    }
  };
  walk(root);
  return out;
}

function run(file, names) {
  let meta = null, turn = null, total = null, refused = false, prompt = null, named = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const p = o.payload ?? {};
    if (o.type === 'session_meta') meta ??= p;
    else if (o.type === 'turn_context') turn ??= p;
    else if (p.type === 'token_count' && p.info?.total_token_usage) total = p.info.total_token_usage;
    else if (o.type === 'response_item' && p.type === 'message' && p.role === 'user' && prompt === null) {
      // The first prompt is the first user text that is not the harness's own wrapping (AGENTS.md, the environment).
      const text = (Array.isArray(p.content) ? p.content : []).map(c => c?.text).find(t => typeof t === 'string' && !/^\s*(<|# AGENTS\.md instructions)/.test(t));
      if (text !== undefined) { prompt = ids(text); named = naming(text, names); }
    }
    const error = typeof p.error?.message === 'string' ? p.error.message : p.type === 'error' && typeof p.message === 'string' ? p.message : null;
    if (error && /usage limit/i.test(error)) refused = true;
  }
  if (!meta) return null;
  const n = k => Number(total?.[k]) || 0;
  return {
    id: meta.id ?? path.basename(file, '.jsonl'), session: meta.id ?? path.basename(file, '.jsonl'), parent: null, kind: 'run', description: null,
    cwd: typeof meta.cwd === 'string' && meta.cwd ? meta.cwd : null, prompt_names: named, ids: { cwd: ids(meta.cwd), prompt: prompt ?? [] }, model: turn?.model ?? null, effort: turn?.effort ?? null, refused, started: meta.timestamp ?? null, calls: null,
    // Codex reports its cache writes without a lifetime; they are counted as five-minute writes.
    total: { input: Math.max(0, n('input_tokens') - n('cached_input_tokens')), cache_read: n('cached_input_tokens'), cache_write_5m: n('cache_write_input_tokens'), cache_write_1h: 0, output: n('output_tokens') },
  };
}

export function read(paths, { since = null, until = null, names = [] } = {}) {
  const out = { schema: SCHEMA, harness: 'codex', agents: [], notes: [] };
  const given = names.filter(n => typeof n === 'string' && n.trim()).map(n => n.trim());
  for (const root of paths) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) { out.notes.push(`no Codex session logs at ${root}`); continue; }
    for (const file of logs(root, since, until)) { const r = run(file, given); if (r) out.agents.push(r); }
  }
  return out;
}
