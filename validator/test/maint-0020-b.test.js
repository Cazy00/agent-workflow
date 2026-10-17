import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource, loadConfig } from '../lib/index.js';
import { LAUNCH_ROLES, launchName, parseLaunchName } from '../lib/roles.js';
import { cli, project, taskPath } from './helpers/maint-0018.js';

// MAINT-0020, v2.9.0: what M-0005 of mateen-systems measured on v2.7.0, the second part. Later slices append their tests here.
const root = fileURLToPath(new URL('../..', import.meta.url));

// P14 fixtures: small transcripts written here, never real ones. SECRET stands for anything an agent read or wrote; it is in
// every tool result, message, thinking block, prompt and tool output, and must never reach wf usage's output.
const SECRET = 'sk-live-7f3a9c-DO-NOT-PRINT';
const at = minutes => new Date(Date.UTC(2026, 9, 16, 8, 0, 0) + minutes * 60000).toISOString();
const usage = ({ input = 3, read = 0, w5 = 0, w1 = 0, out = 10 } = {}) => ({ input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: w5 + w1, cache_creation: { ephemeral_5m_input_tokens: w5, ephemeral_1h_input_tokens: w1 }, output_tokens: out });
const call = (id, minute, u, content = [{ type: 'text', text: SECRET }], { model = 'claude-opus-5-5', effort = 'xhigh' } = {}) => ({ type: 'assistant', timestamp: at(minute), effort, message: { id, model, role: 'assistant', content, usage: u } });
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const result = (minute, id) => ({ type: 'user', timestamp: at(minute), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: `output ${SECRET}` }] }, toolUseResult: { stdout: SECRET } });
const said = (minute, text) => ({ type: 'user', timestamp: at(minute), message: { role: 'user', content: text } });
const tempDir = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-usage-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const jsonl = (file, lines) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${lines.map(l => JSON.stringify(l)).join('\n')}\n`); };

// A coordinator, a named lead with its helpers, an older lead and a helper with no task, as Claude Code lays them out.
function claudeSession(dir) {
  const id = 'c0ffee00-0000-4000-8000-000000000001', sub = path.join(dir, id, 'subagents');
  jsonl(path.join(dir, `${id}.jsonl`), [
    // One call streamed as three lines with one message ID: counted once, at the largest output.
    call('msg_c1', 0, usage({ read: 1000, w1: 30000, out: 5 }), [{ type: 'thinking', thinking: SECRET }]),
    call('msg_c1', 0, usage({ read: 1000, w1: 30000, out: 50 }), [tool('toolu_a', 'Agent', { description: 'T-0007 lead claim and deliver', prompt: SECRET })]),
    call('msg_c1', 0, usage({ read: 1000, w1: 30000, out: 20 })),
    result(70, 'toolu_a'), // the lead ran 70 minutes: the coordinator's one-hour cache expired
    call('msg_c2', 70, usage({ read: 30000, w1: 40000, out: 7 }), [tool('toolu_q', 'AskUserQuestion', { question: SECRET })]),
    result(75, 'toolu_q'),
    call('msg_c3', 75, usage({ read: 70000, w1: 25000, out: 7 })),
    said(90, `the owner: ${SECRET}`),
    call('msg_c4', 160, usage({ read: 95000, w1: 10000, out: 7 })), // 85 minutes, but under 20 K written
    { type: 'assistant', timestamp: at(161), message: { id: 'msg_err', model: '<synthetic>', content: [{ type: 'text', text: SECRET }], usage: usage({ w5: 99999 }) } },
  ]);
  const helper = (agent, meta, lines) => { jsonl(path.join(sub, `agent-${agent}.jsonl`), lines); fs.writeFileSync(path.join(sub, `agent-${agent}.meta.json`), JSON.stringify({ agentType: 'general-purpose', ...meta })); };
  helper('lead1', { description: 'T-0007 lead claim and deliver' }, [
    call('l1', 1, usage({ w5: 25000 }), [tool('tb1', 'Bash', { description: 'Run the unit tests', command: `echo ${SECRET}` })]),
    result(9, 'tb1'), // eight minutes: the five-minute cache expired
    call('l2', 9, usage({ read: 25000, w5: 30000 }), [tool('tb2', 'Agent', { description: 'Implement the parser change', prompt: SECRET })]),
    result(30, 'tb2'),
    call('l3', 30, usage({ read: 55000, w5: 21000 }), [tool('tb3', 'Bash', { description: 'Wait for checks', command: 'sleep 200' })]),
    result(33, 'tb3'),
    call('l4', 33, usage({ read: 76000, w5: 50000 })),
    call('l5', 43, usage({ read: 126000, w1: 30000 })), // ten minutes, on the one-hour cache: not a rebuild
  ]);
  helper('impl1', { description: 'Implement the parser change', parentAgentId: 'lead1' }, [call('i1', 10, usage({ w5: 40000 }), [tool('ti1', 'Read', { file_path: '/x' })]), result(11, 'ti1'), call('i2', 11, usage({ read: 40000, w5: 5000 }))]);
  helper('fix1', { description: 'Fix R-0012 findings', parentAgentId: 'lead1' }, [call('f1', 31, usage({ w5: 1000 }))]);
  helper('rev', { description: 'T-0007 reviewer: second look', parentAgentId: 'lead1' }, [call('r1', 34, usage({ w5: 2000 }))]);
  helper('paper', { description: 'T-0007 paperwork', parentAgentId: 'lead1' }, [call('p1', 44, usage({ w5: 300000, out: 100 }), [], { model: 'claude-haiku-5-5', effort: 'low' })]);
  // An older description, and a call that is also in another file: one count per message ID.
  helper('old', { description: 'Task lead for T-0008' }, [call('o1', 50, usage({ w5: 4000 })), call('i2', 11, usage({ read: 40000, w5: 5000 }))]);
  helper('survey', { description: 'Survey the orders' }, [call('s1', 55, usage({ w5: 500 }), [], { model: 'claude-sonnet-5-5', effort: 'high' })]);
  return path.join(dir, `${id}.jsonl`);
}

// Codex logs: matched by folder and by prompt, unmatched, refused, and outside the window.
function codexLogs(dir, runs) {
  for (const [i, r] of runs.entries()) {
    const day = r.started.slice(0, 10).split('-').join('/');
    jsonl(path.join(dir, day, `rollout-${i}.jsonl`), [
      { type: 'session_meta', timestamp: r.started, payload: { id: `run-${i}`, timestamp: r.started, cwd: r.cwd, originator: 'codex_exec' } },
      { type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'high', cwd: r.cwd } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `# AGENTS.md instructions for ${r.cwd} T-0099` }, { type: 'input_text', text: '<environment_context>T-0098</environment_context>' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `${r.prompt} ${SECRET}` }] } },
      // The same words in what a tool printed are not a refusal.
      { type: 'response_item', payload: { type: 'custom_tool_call_output', output: `2 refused at Codex's usage limit ${SECRET}` } },
      ...(r.tokens ? [{ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 } } } }] : []),
      { type: 'event_msg', payload: { type: 'task_complete', last_agent_message: null, ...(r.refused ? { error: { message: 'You’ve hit your usage limit. Try again later.' } } : {}) } },
    ]);
  }
  return dir;
}
const RUNS = [
  { started: at(20), cwd: '/work/.review-T-0007', prompt: 'Review T-0007 against M-0001', tokens: true },
  { started: at(25), cwd: '/tmp/a', prompt: 'A second look at R-0012', tokens: true },
  { started: at(26), cwd: '/tmp/b', prompt: 'Review T-0099', tokens: true },
  { started: at(27), cwd: '/work/.review-T-0008', prompt: 'Review it', refused: true },
  { started: '2026-10-10T08:00:00.000Z', cwd: '/work/.review-T-0007', prompt: 'an earlier milestone', tokens: true },
  { started: at(200), cwd: '/work/.review-T-0007', prompt: 'after the window', tokens: true },
];

const PRICES = {
  'claude-opus': { input: 99, output: 99, cache_read: 99, cache_write_5m: 99, cache_write_1h: 99 },
  'claude-opus-5': { input: 4, output: 20, cache_read: 0.2, cache_write_5m: 5, cache_write_1h: 8 },
  'claude-haiku': { input: 1, output: 5, cache_read: 0.1, cache_write_5m: 1.25, cache_write_1h: 2 },
};
function setup(t, { prices = null } = {}) {
  const dir = tempDir(t), repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  if (prices) {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'config.default.json'), 'utf8'));
    fs.mkdirSync(path.join(repo, 'docs/workflow'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/workflow/config.json'), JSON.stringify({ ...config, usage: { prices } }));
  }
  const sessionFile = claudeSession(path.join(dir, 'claude')), codex = codexLogs(path.join(dir, 'codex'), RUNS);
  // HOME points into the fixture, so no default path reads the machine's own transcripts.
  const usageRun = (...args) => spawnSync(process.execPath, [cli, 'usage', '--repo', repo, '--claude-session', sessionFile, '--codex-dir', codex, ...args], { encoding: 'utf8', env: { ...process.env, HOME: dir } });
  const json = (...args) => { const r = usageRun('--json', ...args); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
  return { dir, repo, sessionFile, codex, usageRun, json };
}
const agent = (u, description) => u.agents.find(a => a.description === description);

test('MAINT-0020 P14: wf usage counts each message ID once at its largest output, splits five-minute and one-hour writes and finds the peak', t => {
  const u = setup(t).json();
  assert.equal(u.schema, 'agent-workflow/usage@1');
  const coordinator = u.agents.find(a => a.role === 'coordinator');
  assert.deepEqual([coordinator.calls, coordinator.output, coordinator.cache_read, coordinator.cache_write_1h, coordinator.cache_write_5m], [4, 71, 196000, 105000, 0], 'msg_c1 once, at output 50; the synthetic error line is no call');
  assert.equal(coordinator.peak_context, 3 + 95000 + 10000, 'peak context is one call\'s input, reads and writes');
  const lead = agent(u, 'T-0007 lead claim and deliver');
  assert.deepEqual([lead.calls, lead.cache_write_5m, lead.cache_write_1h, lead.peak_context], [5, 126000, 30000, 3 + 126000 + 30000]);
  assert.equal(agent(u, 'Task lead for T-0008').calls, 1, 'a message ID already counted in another file is not counted again');
  assert.equal(u.totals.calls, 4 + 5 + 2 + 1 + 1 + 1 + 1 + 1);
  assert.deepEqual([u.totals.cache_write_5m, u.totals.cache_write_1h], [126000 + 45000 + 1000 + 2000 + 300000 + 4000 + 500, 105000 + 30000]);
  assert.deepEqual([coordinator.model, coordinator.effort, agent(u, 'T-0007 paperwork').model, agent(u, 'T-0007 paperwork').effort], ['claude-opus-5-5', 'xhigh', 'claude-haiku-5-5', 'low']);
});

test('MAINT-0020 P14: a write after a wait outlived its cache\'s lifetime and wrote over 20 K, and names the tool call before it', t => {
  const { usageRun, json } = setup(t);
  const u = json();
  // The coordinator's 70-minute wait on its lead (one-hour cache); the lead's 8-minute test run and 21-minute wait on its helper
  // (five-minute cache). Not: 85 minutes with 10 K written, nor 10 minutes on the one-hour cache, nor 3 minutes on the five-minute.
  assert.deepEqual([u.agents.find(a => a.role === 'coordinator').after_wait, agent(u, 'T-0007 lead claim and deliver').after_wait], [{ calls: 1, tokens: 40000 }, { calls: 2, tokens: 51000 }]);
  assert.deepEqual([u.writes_after_wait.calls, u.writes_after_wait.tokens], [3, 91000]);
  assert.deepEqual(u.writes_after_wait.by_tool, [{ tool: 'Agent', calls: 2, tokens: 61000 }, { tool: 'Bash', calls: 1, tokens: 30000 }]);
  assert.deepEqual(u.writes_after_wait.by_call.find(e => e.tool === 'Bash'), { tool: 'Bash', description: 'Run the unit tests', calls: 1, tokens: 30000 });
  const text = usageRun().stdout;
  assert.match(text, /Writes after a wait longer than the cache's lifetime \(over 20 K written\): 3 call\(s\), 91 K; helpers 51 K, the coordinator 40 K\./);
  assert.match(text, /by the tool call before them: Agent 61 K, Bash 30 K\n {2}Bash "Run the unit tests": 1 call\(s\), 30 K\n/);
});

test('MAINT-0020 P14: agents are attributed by launch name, by the words of older descriptions (inferred), and by their parent', t => {
  const u = setup(t).json();
  const who = d => { const a = agent(u, d); return [a.task, a.role, a.attribution, a.task_from]; };
  assert.deepEqual(who('T-0007 lead claim and deliver'), ['T-0007', 'lead', 'named', 'name']);
  assert.deepEqual(who('T-0007 reviewer: second look'), ['T-0007', 'reviewer', 'named', 'name']);
  assert.deepEqual(who('Task lead for T-0008'), ['T-0008', 'lead', 'inferred', 'description']);
  assert.deepEqual(who('Implement the parser change'), ['T-0007', 'implementer', 'inferred', 'parent']);
  assert.deepEqual(who('Fix R-0012 findings'), ['T-0007', 'fix', 'inferred', 'parent']);
  assert.deepEqual(who('Survey the orders'), [null, 'other', 'none', null], 'its parent, the coordinator, has no task to give');
  assert.deepEqual(u.agents.filter(a => a.kind === 'main').map(a => [a.task, a.role, a.attribution]), [[null, 'coordinator', 'main']]);
  assert.deepEqual(u.by_role.map(g => [g.role, g.agents]), [['coordinator', 1], ['lead', 2], ['implementer', 1], ['fix', 1], ['reviewer', 1], ['paperwork', 1], ['other', 1]]);
  assert.deepEqual(u.by_task.map(g => [g.task, g.agents]), [['T-0007', 5], ['T-0008', 1], [null, 2]]);
  assert.match(u.notes.join(' | '), /3 agent\(s\) attributed by the words of their description \(inferred\) and 1 by none/);
  // The convention, as the brief prints it, and what is not it.
  for (const [kind, roles] of Object.entries(LAUNCH_ROLES)) for (const role of roles) assert.deepEqual(parseLaunchName(`${launchName(kind === 'task' ? 'T-0042' : 'M-0006', role)} a few words`), { id: kind === 'task' ? 'T-0042' : 'M-0006', role });
  for (const d of ['T-0042 walker', 'M-0006 lead', 'T-0042 leader of it', 'Task lead for T-0042', 'x T-0042 fix', '', null]) assert.equal(parseLaunchName(d), null, String(d));
});

test('MAINT-0020 P14: wf brief --lead names each helper it asks for, in the convention wf usage reads', t => {
  const p = project(t);
  const r = spawnSync(process.execPath, [cli, 'brief', '--lead', '--task', 'T-0001', '--repo', p.repo, '--baseline', p.baseline], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const line = 'Name each launch for `wf usage`: its description starts `T-0001 lead` (yours), `T-0001 implementer`, `T-0001 fix` (each fix round), `T-0001 reviewer` (a Claude reviewer) or `T-0001 paperwork`, then a few words.';
  assert.ok(r.stdout.split('\n').includes(line), r.stdout);
  assert.deepEqual([...line.matchAll(/`(T-0001 [a-z]+)`/g)].map(m => parseLaunchName(m[1]).role), ['lead', 'implementer', 'fix', 'reviewer', 'paperwork']);
});

test('MAINT-0020 P14: with usage.prices, an estimated list-price cost by the longest model prefix; without, tokens only', t => {
  const off = setup(t);
  const plain = off.json();
  assert.equal(plain.priced, false);
  assert.ok(plain.agents.every(a => a.cost === null) && plain.totals.cost === null);
  const text = off.usageRun().stdout;
  assert.match(text, /: tokens only \(the config sets no usage\.prices\)\n/);
  assert.doesNotMatch(text, /est\. cost|estimated/);
  assert.match(text, /Largest agents, by tokens:\n {2}lead of T-0007 "T-0007 lead claim and deliver": 5 call\(s\), cache reads 282 K, writes 156 K \(51 K after waits\), peak 156 K, claude-opus-5-5 xhigh\n/);
  const on = setup(t, { prices: PRICES });
  const u = on.json();
  assert.equal(u.priced, true);
  // claude-opus-5 wins over claude-opus: 12 × 4 + 196,000 × 0.2 + 105,000 × 8 + 71 × 20 per million.
  assert.equal(u.agents.find(a => a.role === 'coordinator').cost, 0.88);
  assert.equal(agent(u, 'T-0007 paperwork').cost, 0.38, 'haiku prices: 3 × 1 + 300,000 × 1.25 + 100 × 5 per million');
  assert.equal(agent(u, 'Survey the orders').cost, 0, 'a model without a price is left out');
  assert.match(u.notes.join(' | '), /1 call\(s\) of models usage\.prices does not name are left out of the estimate/);
  assert.equal(u.totals.cost, Math.round(u.agents.reduce((n, a) => n + a.cost, 0) * 100) / 100);
  assert.equal(u.second_model.runs[0].cost, null, 'no price for gpt-6: none');
  const priced = on.usageRun().stdout;
  assert.match(priced, /: costs are estimates at the list prices in usage\.prices\n/);
  assert.match(priced, /Largest agents, by estimated cost:\n {2}lead of T-0007 "T-0007 lead claim and deliver": 5 call\(s\), [^\n]*, est\. 0\.93\n {2}coordinator: 4 call\(s\), [^\n]*, est\. 0\.88\n/);
  assert.match(priced, /estimated list-price cost \d+\.\d\d\./);
  // A malformed price is refused where the config is read, as every config key is.
  const configAt = (t, prices) => { const dir = tempDir(t); fs.mkdirSync(path.join(dir, 'docs/workflow'), { recursive: true }); fs.writeFileSync(path.join(dir, 'docs/workflow/config.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(root, 'config.default.json'), 'utf8')), usage: prices }), 'utf8'); return () => loadConfig(dirSource(dir)); };
  assert.ok(configAt(t, { prices: PRICES })());
  for (const [bad, pattern] of [
    [{ prices: {} }, /usage\.prices maps a model ID prefix/],
    [{ cost: {} }, /usage may contain only prices/],
    [{ prices: { 'claude opus': PRICES['claude-opus-5'] } }, /must be a plain model ID prefix/],
    [{ prices: { 'claude-opus-5': { ...PRICES['claude-opus-5'], cache_write_1h: undefined } } }, /usage\.prices\.claude-opus-5\.cache_write_1h must be a price per million tokens/],
    [{ prices: { 'claude-opus-5': { ...PRICES['claude-opus-5'], output: -1 } } }, /output must be a price per million tokens/],
    [{ prices: { 'claude-opus-5': { ...PRICES['claude-opus-5'], dollars: 1 } } }, /usage\.prices\.claude-opus-5 may contain only input, output/],
  ]) assert.throws(configAt(t, bad), pattern, JSON.stringify(bad));
});

test('MAINT-0020 P14: Codex runs in the window are matched by their folder or first prompt, unmatched, or refused at the usage limit', t => {
  const { usageRun, json, codex } = setup(t);
  const s = json().second_model;
  assert.deepEqual(s.window, { since: at(0), until: at(160) }, 'the Claude sessions\' span');
  assert.deepEqual(s.runs.map(r => [r.named, r.named_in, r.task, r.matched, r.refused]), [
    ['T-0007', 'cwd', 'T-0007', true, false], ['R-0012', 'prompt', null, true, false], [null, null, null, false, false], ['T-0008', 'cwd', 'T-0008', true, true],
  ], 'the wrapper\'s IDs (AGENTS.md, environment) are not the prompt; a tool output saying "usage limit" is not a refusal');
  assert.deepEqual([s.matched, s.refused, s.unmatched, s.by_task], [3, 1, 1, { 'T-0007': 1, 'R-0012': 1 }]);
  assert.deepEqual(['input', 'cache_read', 'output', 'model', 'effort'].map(k => s.runs[0][k]), [200, 800, 50, 'gpt-6.1-sol', 'high'], 'Codex\'s input_tokens holds the cached ones');
  const text = usageRun().stdout;
  assert.match(text, /Second-model runs in the window: 3 named this project's IDs, 1 of them refused at the usage limit; 1 named none of them\.\n {2}run: R-0012 1, T-0007 1\n {2}refused: T-0008 at /);
  // A window given explicitly; without a Claude session the runs alone, which need --since.
  const alone = spawnSync(process.execPath, [cli, 'usage', '--codex-dir', codex], { encoding: 'utf8' });
  assert.equal(alone.status, 2);
  assert.match(alone.stderr, /usage needs --claude-session SESSION\.jsonl, or --since ISO/);
  assert.deepEqual(json('--since', '2026-10-10T00:00:00Z', '--until', '2026-10-10T23:59:00Z').second_model.runs.map(r => r.started), ['2026-10-10T08:00:00.000Z']);
});

test('MAINT-0020 P5(a), P14: wf usage --milestone counts the runs used against the budget wf next computes, and warns before the reserve', t => {
  const withSecondModel = { review: { second_model: { tool: 'codex', model: 'gpt-6.1-sol', max_effort: 'high' } } };
  const p = project(t, { configEdit: c => ({ ...c, ...withSecondModel }) });
  const task = fs.readFileSync(path.join(p.repo, taskPath), 'utf8');
  const deep = x => x.replace(/^review: .*$/m, 'review: deep');
  p.edit(taskPath, deep);
  p.write('docs/workflow/tasks/T-0002.md', deep(task.replaceAll('T-0001', 'T-0002')));
  const sha = p.commit('two deep tasks');
  const budget = p.run(['next', '--baseline', sha]).out.second_model_budget[0];
  assert.deepEqual(budget, { milestone: 'M-0001', deep_tasks: 2, runs: 5 });
  const codex = path.join(p.temp, 'codex');
  const runs = [['T-0001', 0], ['T-0001', 1], ['T-0002', 2], ['T-0002', 3]].map(([id, m]) => ({ started: at(m), cwd: `/work/.review-${id}`, prompt: 'Review', tokens: true }));
  const used = extra => {
    fs.rmSync(codex, { recursive: true, force: true });
    codexLogs(codex, [...runs, ...extra]);
    const r = p.run(['usage', '--since', at(-1), '--until', at(60), '--codex-dir', codex, '--milestone', 'M-0001']);
    assert.equal(r.status, 0, r.stderr);
    return r.out.second_model.milestone;
  };
  // Four task runs of the four the deep tasks may use: one more would take the milestone review's.
  assert.deepEqual(used([{ started: at(4), cwd: '/work/.review-T-0001', prompt: 'Review', refused: true }]), { id: 'M-0001', budget: budget.runs, deep_tasks: budget.deep_tasks, used: 4, task_runs: 4, review_runs: 0, refused: 1, warning: 'one more task run would use the milestone review\'s reserve (4 of 4 task runs used)' });
  assert.deepEqual(used([]).warning, 'one more task run would use the milestone review\'s reserve (4 of 4 task runs used)');
  const spent = used([{ started: at(5), cwd: '/work/.review-M-0001', prompt: 'The milestone review', tokens: true }]);
  assert.deepEqual([spent.used, spent.review_runs, spent.warning], [5, 1, 'the budget is spent: 5 of 5 runs used']);
  runs.splice(3, 1);
  assert.equal(used([]).warning, null, 'three task runs leave room before the reserve');
  const text = spawnSync(process.execPath, [cli, 'usage', '--repo', p.repo, '--since', at(-1), '--until', at(60), '--codex-dir', codex, '--milestone', 'M-0001'], { encoding: 'utf8' }).stdout;
  assert.match(text, /\n {2}M-0001: 3 of its budget of 5 run\(s\) used \(two per deep task, one for the milestone review\)\n/);
  // wf next's own line is unchanged, computed by the same function.
  assert.match(fs.readFileSync(path.join(root, 'validator/lib/next.js'), 'utf8'), /export function secondModelBudget\(config, records, milestoneIds\)/);
  assert.match(fs.readFileSync(path.join(root, 'validator/cli.js'), 'utf8'), /secondModelBudget\(config, records, \[o\.milestone\]\)/);
});

test('MAINT-0020 P14: --outcome prints the selected task\'s usage block for its session outcome', t => {
  const { usageRun } = setup(t);
  const r = usageRun('--task', 'T-0007', '--outcome');
  assert.equal(r.status, 0, r.stderr);
  const block = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(block), Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'templates/session.json'), 'utf8')).usage));
  assert.deepEqual(block, {
    time_seconds: 43 * 60, // the task's first call (its lead, minute 1) to its last (the paperwork, minute 44)
    tokens: { calls: 10, input: 30, cache_read: 25000 + 55000 + 76000 + 126000 + 40000, cache_write_5m: 126000 + 45000 + 1000 + 2000 + 300000, cache_write_1h: 30000, output: 100 + 9 * 10, second_model: { runs: 1, input: 200, cache_read: 800, cache_write_5m: 0, cache_write_1h: 0, output: 50 } },
    spend: null, attempts: null,
  });
  const priced = setup(t, { prices: PRICES }).usageRun('--task', 'T-0007', '--outcome');
  assert.deepEqual(Object.keys(JSON.parse(priced.stdout).spend), ['estimate', 'basis']);
  for (const args of [['--outcome'], ['--task', 'M-0001', '--outcome']]) assert.equal(usageRun(...args).status, 2, args.join(' '));
  assert.match(usageRun('--outcome').stderr, /usage --outcome needs --task T-0001/);
  assert.match(spawnSync(process.execPath, [cli, 'records', '--outcome'], { encoding: 'utf8' }).stderr, /are only for usage/);
});

test('MAINT-0020 P14: wf usage copies no content: what agents read, wrote or were told never reaches its output', t => {
  for (const s of [setup(t), setup(t, { prices: PRICES })]) {
    for (const args of [[], ['--json'], ['--task', 'T-0007', '--outcome'], ['--json', '--task', 'T-0007'], ['--milestone', 'M-0001']]) {
      const r = s.usageRun(...args);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET), `${args.join(' ')} printed the secret`);
      assert.ok(!/AGENTS\.md instructions|environment_context|the owner:|sleep 200|echo /.test(r.stdout), args.join(' '));
    }
    assert.match(s.usageRun().stdout, /"Run the unit tests"/, 'a Bash call\'s description may appear');
  }
});

test('MAINT-0020 P14: the harness readers are adapters behind one contract, so the validator alone still runs every other command', t => {
  const dir = tempDir(t);
  fs.cpSync(path.join(root, 'validator'), path.join(dir, 'validator'), { recursive: true });
  const p = project(t);
  const records = spawnSync(process.execPath, [path.join(dir, 'validator/cli.js'), 'records', '--repo', p.repo], { encoding: 'utf8' });
  assert.equal(records.status, 0, records.stderr);
  const usage = spawnSync(process.execPath, [path.join(dir, 'validator/cli.js'), 'usage', '--since', at(0), '--codex-dir', dir], { encoding: 'utf8', env: { ...process.env, HOME: dir } });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage needs adapters\/usage\/codex\.mjs of the workflow installation/);
  // Each reader returns the reader contract; the aggregator refuses anything else.
  for (const file of ['claude-code.mjs', 'codex.mjs']) assert.match(fs.readFileSync(path.join(root, 'adapters/usage', file), 'utf8'), /export const SCHEMA = 'agent-workflow\/usage-reader@1';[\s\S]*export function read\(paths/);
  assert.match(fs.readFileSync(path.join(root, 'validator/lib/usage.js'), 'utf8'), /Replacing or adding a reader changes only that reader and its line in cli\.js/);
});
