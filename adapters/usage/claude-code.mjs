// MAINT-0020 P14: the Claude Code reader of `wf usage`. One module per harness turns that harness's own files into the shared
// reader contract, agent-workflow/usage-reader@1 (stated in validator/lib/usage.js, which aggregates it and knows no harness's
// files). This one knows nothing of tasks, roles, prices or output. Replacing or adding a reader changes only that reader and
// its line in validator/cli.js.
//
// A session is <dir>/<session-id>.jsonl, its helpers <dir>/<session-id>/subagents/agent-*.jsonl, each beside an agent-*.meta.json
// holding description, parentAgentId and agentType. An assistant line carries message.id, model, usage and the line's effort and
// timestamp; streaming repeats a message ID once per content block, so a call counts once, at its largest counts. User lines and
// tool calls are read only for which tool's result preceded a call. No message text leaves this module: only a helper's launch
// description and a Bash call's description.
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA = 'agent-workflow/usage-reader@1';
const short = (s, n) => (typeof s === 'string' ? s.slice(0, n) : null);
function* lines(file) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { yield JSON.parse(line); } catch { /* a torn last line, as a live transcript can end */ }
  }
}

function calls(file) {
  const byId = new Map(), order = [], tools = new Map();
  let after = null;
  for (const o of lines(file)) {
    if (o.type === 'user') {
      // A tool's result: the next call follows that tool. Any other user line is a message (the owner's, the harness's, a
      // background helper's report), after which no tool preceded the call.
      const results = Array.isArray(o.message?.content) ? o.message.content.filter(c => c?.type === 'tool_result') : [];
      after = results.length ? tools.get(results.at(-1).tool_use_id) ?? { tool: null, description: null } : null;
      continue;
    }
    if (o.type !== 'assistant') continue;
    const m = o.message, u = m?.usage;
    if (!m?.id || !u || m.model === '<synthetic>') continue;
    let c = byId.get(m.id);
    // A new call takes what preceded it once: a call straight after another follows no tool.
    if (!c) { c = { id: m.id, at: o.timestamp, model: m.model ?? null, effort: o.effort ?? null, input: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, output: 0, after }; byId.set(m.id, c); order.push(c); after = null; }
    const hour = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    // Without the breakdown (older transcripts) every write is the default five-minute one.
    const five = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - hour);
    for (const [k, v] of [['input', u.input_tokens], ['cache_read', u.cache_read_input_tokens], ['cache_write_5m', five], ['cache_write_1h', hour], ['output', u.output_tokens]]) c[k] = Math.max(c[k], Number(v) || 0);
    for (const b of Array.isArray(m.content) ? m.content : []) if (b?.type === 'tool_use' && b.id) tools.set(b.id, { tool: short(b.name, 80), description: b.name === 'Bash' ? short(b.input?.description, 160) : null });
  }
  return order;
}

// One session, given as its .jsonl or its folder.
function session(spec) {
  const main = spec.endsWith('.jsonl') ? spec : `${spec.replace(/\/+$/, '')}.jsonl`;
  const folder = main.slice(0, -'.jsonl'.length), id = path.basename(folder);
  const agents = [], notes = [];
  const hasMain = fs.existsSync(main);
  if (hasMain) agents.push({ id, parent: null, kind: 'main', description: null, calls: calls(main) });
  const sub = path.join(folder, 'subagents');
  if (!hasMain && !fs.existsSync(sub)) throw new Error(`no Claude Code session at ${spec}: give its .jsonl or its folder`);
  for (const f of fs.existsSync(sub) ? fs.readdirSync(sub).filter(f => /^agent-.+\.jsonl$/.test(f)).sort() : []) {
    const agent = f.slice('agent-'.length, -'.jsonl'.length);
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(sub, `agent-${agent}.meta.json`), 'utf8')); } catch { notes.push(`helper ${agent} has no readable meta.json: no description or parent`); }
    agents.push({ id: agent, parent: typeof meta.parentAgentId === 'string' ? meta.parentAgentId : hasMain ? id : null, kind: 'helper', description: short(meta.description, 200), calls: calls(path.join(sub, f)) });
  }
  return { id, agents, notes };
}

export function read(paths) {
  const out = { schema: SCHEMA, harness: 'claude-code', agents: [], notes: [] };
  for (const p of paths) { const s = session(path.resolve(p)); out.agents.push(...s.agents.map(a => ({ ...a, session: s.id }))); out.notes.push(...s.notes); }
  return out;
}
