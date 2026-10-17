import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource, loadConfig } from '../lib/index.js';
import { DEFAULT_ROLES, LAUNCH_ROLES, launchName, parseLaunchName, resolveRoles } from '../lib/roles.js';
import { FIRST_LOAD_LIMIT, acceptanceEvidenceErrors } from '../lib/acceptance-evidence.js';
import { INSTALLED } from '../../adapters/upgrade.mjs';
import { MAX_SLICES, READ_ONCE, WAIT_COMMANDS, sliceTask, waitLine } from '../lib/lead-brief.js';
import { HELPER_PEAK, READER, evaluateUsage } from '../lib/usage.js';
import { cli, evidence, project, taskPath } from './helpers/maint-0018.js';

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
  const s = setup(t), u = s.json();
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
  // The session's folder reads as its .jsonl does.
  const folder = spawnSync(process.execPath, [cli, 'usage', '--json', '--repo', s.repo, '--claude-session', s.sessionFile.replace(/\.jsonl$/, '/'), '--codex-dir', s.codex], { encoding: 'utf8', env: { ...process.env, HOME: s.dir } });
  assert.deepEqual(JSON.parse(folder.stdout).totals, u.totals);
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
  assert.match(text, /Writes after a wait longer than the cache's lifetime \(over 20 K written\): 3 call\(s\), 91 K; helpers 51 K in 2, the coordinator 40 K in 1\./);
  assert.match(text, /by the tool call before them: Agent 61 K, Bash 30 K\n {2}Bash "Run the unit tests": 1 call\(s\), 30 K\n/);
});

test('MAINT-0020 P14 (v2.9.0 review S1-1): a call\'s five-minute and one-hour writes are each judged by their own cache\'s lifetime, and 20 K applies to their sum', () => {
  const reading = (w5, w1, minutes) => ({ schema: READER, harness: 'claude-code', notes: [], agents: [{ id: 'm', session: 's', parent: null, kind: 'main', description: null, calls: [
    { id: 'a', at: at(0), model: null, effort: null, input: 1, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, output: 1, after: null },
    { id: 'b', at: at(minutes), model: null, effort: null, input: 1, cache_read: 0, cache_write_5m: w5, cache_write_1h: w1, output: 1, after: { tool: 'Bash', description: 'wait' } },
  ] }] });
  const after = (w5, w1, minutes) => { const u = evaluateUsage({ readings: [reading(w5, w1, minutes)] }); return [u.writes_after_wait.calls, u.writes_after_wait.tokens, u.agents[0].after_wait.tokens]; };
  // A ten-minute gap outlives the five-minute cache only: whichever write count is larger, only the five-minute writes were rebuilt.
  assert.deepEqual(after(25000, 30000, 10), [1, 25000, 25000], 'more one-hour writes than five-minute: the five-minute ones still count');
  assert.deepEqual(after(30000, 25000, 10), [1, 30000, 30000], 'reversed: the one-hour ones do not');
  assert.deepEqual(after(15000, 15000, 10), [0, 0, 0], '30 K written, 15 K of it after a lapse: under 20 K');
  assert.deepEqual(after(10000, 40000, 10), [0, 0, 0]);
  // A gap over an hour outlives both, and 20 K applies to the sum of the two.
  assert.deepEqual(after(12000, 12000, 70), [1, 24000, 24000]);
  assert.deepEqual(after(5000, 30000, 70), [1, 35000, 35000]);
  assert.deepEqual(after(12000, 5000, 70), [0, 0, 0]);
  assert.deepEqual(after(0, 30000, 30), [0, 0, 0], 'one-hour writes after half an hour: the cache held');
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
  // Codex's own folder by default, under the home directory.
  const home = tempDir(t);
  fs.cpSync(codex, path.join(home, '.codex', 'sessions'), { recursive: true });
  const byDefault = spawnSync(process.execPath, [cli, 'usage', '--json', '--since', at(0), '--until', at(160)], { encoding: 'utf8', env: { ...process.env, HOME: home }, cwd: home });
  assert.equal(JSON.parse(byDefault.stdout).second_model.runs.length, 4, byDefault.stderr);
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

test('MAINT-0020 P5(a), P14 (v2.9.0 review S1-2): a run naming only a review counts for the milestone of the task that cites it', t => {
  const p = project(t, { configEdit: c => ({ ...c, review: { second_model: { tool: 'codex', model: 'gpt-6.1-sol', max_effort: 'high' } } }) });
  const task = fs.readFileSync(path.join(p.repo, taskPath), 'utf8');
  // T-0001 (M-0001) accepted a finding of R-0001; T-0003 (M-0001) is a found task fixing one of R-0003; T-0002 (M-0002) cites R-0002.
  p.edit(taskPath, x => x.replace('deferred_inputs: []', 'deferred_inputs: []\naccepted_findings: [R-0001/F1]'));
  p.write('docs/workflow/tasks/T-0002.md', task.replaceAll('T-0001', 'T-0002').replace('milestone: M-0001', 'milestone: M-0002').replace('deferred_inputs: []', 'deferred_inputs: []\nfound_from: R-0002/F1'));
  p.write('docs/workflow/tasks/T-0003.md', task.replaceAll('T-0001', 'T-0003').replace('deferred_inputs: []', 'deferred_inputs: []\nfound_from: R-0003/F1'));
  const codex = path.join(p.temp, 'codex');
  codexLogs(codex, [
    { started: at(0), cwd: '/tmp/a', prompt: 'A second look at R-0001', tokens: true },
    { started: at(1), cwd: '/tmp/b', prompt: 'A second look at R-0002', tokens: true },
    { started: at(2), cwd: '/tmp/c', prompt: 'A second look at R-0003', tokens: true },
    { started: at(3), cwd: '/work/.review-T-0001', prompt: 'Review', tokens: true },
    { started: at(4), cwd: '/tmp/d', prompt: 'A second look at R-0004', tokens: true },
    { started: at(5), cwd: '/tmp/e', prompt: 'A second look at R-0001', refused: true },
  ]);
  const r = p.run(['usage', '--since', at(-1), '--until', at(60), '--codex-dir', codex, '--milestone', 'M-0001']);
  assert.equal(r.status, 0, r.stderr);
  const s = r.out.second_model;
  assert.deepEqual([s.matched, s.unmatched, s.by_task], [5, 1, { 'R-0001': 1, 'R-0002': 1, 'R-0003': 1, 'T-0001': 1 }], 'R-0004 is cited by no record: unmatched');
  // R-0001 (T-0001's) and R-0003 (T-0003's) reach M-0001 with the run of T-0001; R-0002 is another milestone's; the refused one is not counted.
  assert.deepEqual([s.milestone.used, s.milestone.task_runs, s.milestone.review_runs, s.milestone.refused], [3, 3, 0, 1]);
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
  assert.match(usage.stderr, /usage needs adapters\/usage\/codex\.mjs of the workflow installation \(run it from a full one: the project's scripts\/wf, or node validator\/cli\.js in a workflow checkout; bin\/wf extracts only validator\/\)/);
  assert.match(fs.readFileSync(path.join(root, 'SCHEMA.md'), 'utf8'), /`usage` runs from a full installation \(the project's `scripts\/wf`, or `node validator\/cli\.js` in a workflow checkout\): `bin\/wf` extracts only `validator\/`/);
  // Each reader returns the reader contract; the aggregator refuses anything else.
  for (const file of ['claude-code.mjs', 'codex.mjs']) assert.match(fs.readFileSync(path.join(root, 'adapters/usage', file), 'utf8'), /export const SCHEMA = 'agent-workflow\/usage-reader@1';[\s\S]*export function read\(paths/);
  assert.match(fs.readFileSync(path.join(root, 'validator/lib/usage.js'), 'utf8'), /Replacing or adding a reader changes only that reader and its line in cli\.js/);
  // Behaviour, not only declarations (v2.9.0 review S1-4): a result of another schema, or none, is refused, not aggregated.
  const reading = { schema: READER, harness: 'claude-code', agents: [], notes: [] };
  assert.equal(evaluateUsage({ readings: [reading] }).schema, 'agent-workflow/usage@1');
  for (const bad of [{ ...reading, schema: 'agent-workflow/usage-reader@2' }, { ...reading, schema: undefined }, undefined]) assert.throws(() => evaluateUsage({ readings: [reading, bad] }), /a usage reader returned .*, not agent-workflow\/usage-reader@1/, String(bad?.schema));
});

// P1. M-0005's four implementing helpers grew to 571–814 K and spent 37 % of the cache reads; a quarter to a half of their reading
// re-read a file they had read. The brief splits the task into slices, one fresh helper each, and tells each to read a file once.
const briefOf = (t, { ids, scope, review } = {}) => {
  const p = project(t);
  if (ids) p.write('docs/workflow/acceptance.json', JSON.stringify({ examples: ids.map(id => ({ id, requirement: 'docs/specs/feature.md', method: 'automated' })) }));
  p.edit(taskPath, x => {
    if (ids) x = x.replace(/^acceptance: .*$/m, `acceptance: [${ids.join(', ')}]`);
    if (scope) x = x.replace(/^scope: .*$/m, `scope: [${scope.join(', ')}]`);
    return review ? x.replace(/^review: .*$/m, `review: ${review}`) : x;
  });
  const sha = ids || scope || review ? p.commit('the task') : p.baseline;
  const r = spawnSync(process.execPath, [cli, 'brief', '--lead', '--task', 'T-0001', '--repo', p.repo, '--baseline', sha], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { out: r.stdout, sha };
};
const slicesIn = out => {
  const [, count, block] = out.match(/^## Slices \((\d+)\)\n[^\n]*\n([\s\S]*?)\n\nTell each implementing helper/m);
  const slices = [...block.matchAll(/^(\d+)\. `([^`]+)`, given ([^\n]+)\n((?: {3}- [^\n]+\n?)+)/gm)].map(m => ({ n: +m[1], name: m[2], given: m[3], items: m[4].trimEnd().split('\n').map(l => l.slice(5)) }));
  assert.equal(slices.length, +count, 'the heading counts the slices printed');
  return slices;
};
const ids = n => Array.from({ length: n }, (_, i) => `AC-001-${i + 1}`);
const idsOf = slice => slice.items.map(i => i.split(':')[0]);

test('MAINT-0020 P1: the lead\'s brief prints one slice for one acceptance ID, and one for a light task whatever its IDs', t => {
  const one = slicesIn(briefOf(t).out);
  assert.deepEqual(one.map(s => [s.n, s.name, s.given, s.items]), [[1, 'T-0001 implementer, slice 1 of 1', 'the task record', ['AC-001-1: docs/specs/feature.md (inspection)']]]);
  const light = slicesIn(briefOf(t, { ids: ids(3), review: 'light: copy and styling' }).out);
  assert.deepEqual(light.map(s => [s.name, idsOf(s)]), [['T-0001 implementer, slice 1 of 1', ids(3)]]);
  assert.equal(slicesIn(briefOf(t, { ids: ids(3), review: 'standard' }).out).length, 3, 'only a light task is one slice');
  assert.equal(slicesIn(briefOf(t, { ids: ids(3), review: 'deep' }).out).length, 3);
});

test('MAINT-0020 P1: the brief prints a slice for each of three IDs, and four for six, the consecutive IDs grouped', t => {
  const { out, sha } = briefOf(t, { ids: ids(3) });
  const three = slicesIn(out);
  assert.deepEqual(three.map(s => [s.name, idsOf(s)]), [1, 2, 3].map(n => [`T-0001 implementer, slice ${n} of 3`, [`AC-001-${n}`]]));
  assert.ok(three[0].items[0].startsWith('AC-001-1: docs/specs/feature.md (automated)'), 'an ID comes with its requirement and method, as the brief printed them');
  // Slice 1 gets the record; a later slice also the earlier checkpoints and the work so far, never a conversation.
  const diff = `\`git diff ${sha}..HEAD --stat\``;
  assert.deepEqual(three.map(s => s.given), ['the task record', `the task record, the checkpoint commit of slice 1 and ${diff}`, `the task record, the checkpoint commits of slices 1–2 and ${diff}`]);
  assert.match(out, /^Give each slice to its own fresh implementing helper, in order, ending at a checkpoint commit \(its message starts `T-0001`\); a helper gets what its slice lists, never an earlier helper's conversation\.$/m);
  const six = slicesIn(briefOf(t, { ids: ids(6) }).out);
  assert.deepEqual(six.map(s => idsOf(s)), [['AC-001-1', 'AC-001-2'], ['AC-001-3', 'AC-001-4'], ['AC-001-5'], ['AC-001-6']]);
  assert.deepEqual(six.map(s => s.name), [1, 2, 3, 4].map(n => `T-0001 implementer, slice ${n} of 4`));
  assert.match(six[3].given, /the checkpoint commits of slices 1–3 and/);
});

test('MAINT-0020 P1: a task without acceptance IDs is sliced by its scope entries the same way', t => {
  const scoped = (n, extra) => briefOf(t, { ids: [], scope: Array.from({ length: n }, (_, i) => `src/part${i + 1}`), ...extra }).out;
  const three = slicesIn(scoped(3));
  assert.deepEqual(three.map(s => [s.name, s.items]), [1, 2, 3].map(n => [`T-0001 implementer, slice ${n} of 3`, [`scope src/part${n}`]]));
  assert.deepEqual(slicesIn(scoped(6)).map(s => s.items.length), [2, 2, 1, 1]);
  assert.deepEqual(slicesIn(scoped(1)).map(s => s.items), [['scope src/part1']]);
  assert.equal(slicesIn(scoped(3, { review: 'light' })).length, 1);
  // An acceptance ID wins over scope: three IDs on a task with a long scope are three slices.
  assert.deepEqual(slicesIn(briefOf(t, { ids: ids(3), scope: ['a', 'b', 'c', 'd', 'e'] }).out).map(idsOf), [['AC-001-1'], ['AC-001-2'], ['AC-001-3']]);
  const none = slicesIn(briefOf(t, { ids: [], scope: [] }).out);
  assert.deepEqual(none.map(s => [s.name, s.items]), [['T-0001 implementer, slice 1 of 1', ['the whole task']]]);
  assert.match(briefOf(t, { ids: [] }).out, /^- Acceptance: none$/m);
  assert.match(briefOf(t).out, /^- Acceptance: in the slices above$/m);
});

test('MAINT-0020 P1: slices are balanced groups of consecutive entries, at most four, and a slice\'s launch name is the convention wf usage reads', t => {
  assert.equal(MAX_SLICES, 4);
  const items = n => Array.from({ length: n }, (_, i) => i + 1);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 9].map(n => sliceTask(items(n), 'standard').map(s => s.length)), [[0], [1], [1, 1], [1, 1, 1], [1, 1, 1, 1], [2, 1, 1, 1], [2, 2, 1, 1], [2, 2, 2, 1], [3, 2, 2, 2]]);
  assert.deepEqual(sliceTask(items(9), 'standard').flat(), items(9), 'every entry once, in order');
  assert.deepEqual(sliceTask(items(5), 'light'), [items(5)]);
  for (const s of slicesIn(briefOf(t, { ids: ids(3) }).out)) assert.deepEqual(parseLaunchName(s.name), { id: 'T-0001', role: 'implementer' });
  assert.equal(launchName('T-0042', 'fix', [2, 5]), 'T-0042 fix, slice 2 of 5');
  assert.equal(launchName('T-0042', 'fix'), 'T-0042 fix', 'no slice, no suffix');
});

test('MAINT-0020 P1: the brief tells each implementing helper to read a file once, by range, and to name what it relied on', t => {
  const { out } = briefOf(t, { ids: ids(2) });
  assert.ok(out.split('\n').includes('Tell each implementing helper, a fix round\'s too: read a file once, by range (find with `grep -n`, read with `sed -n a,bp`); do not re-read what is in your context; put the files and ranges you relied on in your checkpoint commit\'s message, so the next slice starts from them.'), out);
  // The fix round stays with a new helper given the record, the review and the head.
  assert.match(out, /each fix round goes to a new helper given the record, the review and the head;/);
});

test('MAINT-0020 P1: execute.md has the lead give each slice to its own fresh helper, in order', () => {
  const execute = fs.readFileSync(path.join(root, 'procedures/execute.md'), 'utf8');
  assert.ok(execute.includes('It gives each slice `wf brief --lead` lists to its own fresh helper, in order, each ending at its checkpoint commit,'));
  assert.doesNotMatch(execute, /It has a fresh helper implement it/);
});

test('MAINT-0020 P1: wf usage flags an implementer or fix whose peak context passed 350 K, naming P1, and no other', t => {
  const dir = tempDir(t), id = 'c0ffee00-0000-4000-8000-000000000002', sub = path.join(dir, 'claude', id, 'subagents'), codex = path.join(dir, 'codex');
  fs.mkdirSync(codex);
  jsonl(path.join(dir, 'claude', `${id}.jsonl`), [call('main-1', 0, usage({ read: 1000, w1: 2000 }))]);
  // One call each, peak = input + reads + writes: the 350 K line itself is not over.
  const helper = (agent, description, peak) => {
    jsonl(path.join(sub, `agent-${agent}.jsonl`), [call(`${agent}-1`, 1, usage({ read: peak - 20003, w5: 20000 }))]);
    fs.writeFileSync(path.join(sub, `agent-${agent}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description }));
  };
  helper('a', 'T-0007 fix R-0012 findings', 360000); // read first, flagged second: the largest comes first
  helper('b', 'T-0007 implementer, slice 2 of 2', 300000);
  helper('c', 'T-0007 implementer, slice 1 of 2', 400000);
  helper('d', 'T-0007 reviewer: second look', 500000);
  helper('e', 'T-0008 implementer', HELPER_PEAK);
  helper('f', 'Implement the old way for T-0009', HELPER_PEAK + 1);
  const run = (...args) => spawnSync(process.execPath, [cli, 'usage', '--repo', dir, '--claude-session', path.join(dir, 'claude', `${id}.jsonl`), '--codex-dir', codex, ...args], { encoding: 'utf8', env: { ...process.env, HOME: dir } });
  const text = run();
  assert.equal(text.status, 0, text.stderr);
  const flagged = text.stdout.split('\n').filter(l => /peaked at/.test(l));
  assert.deepEqual(flagged, [
    '  - implementer of T-0007 "T-0007 implementer, slice 1 of 2" peaked at 400 K, over 350 K: slices keep a helper under it (MAINT-0020 P1; wf brief --lead lists them)',
    '  - fix of T-0007 "T-0007 fix R-0012 findings" peaked at 360 K, over 350 K: slices keep a helper under it (MAINT-0020 P1; wf brief --lead lists them)',
    '  - implementer of T-0009 "Implement the old way for T-0009" peaked at 351 K, over 350 K: slices keep a helper under it (MAINT-0020 P1; wf brief --lead lists them)',
  ]);
  assert.ok(text.stdout.indexOf('peaked at') > text.stdout.indexOf('\nNotes:\n') && text.stdout.includes('\nNotes:\n'), 'in the Notes of the text output');
  const json = JSON.parse(run('--json').stdout);
  assert.equal(json.notes.filter(n => /peaked at/.test(n)).length, 3);
  const flaggedFor = task => JSON.parse(run('--json', '--task', task).stdout).notes.filter(n => /peaked at/.test(n)).length;
  assert.deepEqual([flaggedFor('T-0007'), flaggedFor('T-0008')], [2, 0], 'the filter leaves other tasks out, and a helper exactly at the line is not over it');
  assert.ok(fs.readFileSync(path.join(root, 'SCHEMA.md'), 'utf8').includes(`over ${HELPER_PEAK / 1000} K, \`HELPER_PEAK\``), 'SCHEMA.md documents the threshold');
});

// P3. M-0005's coordinator drafted M-0006, set up the trial server and wrote the acceptance package itself, and grew to 708 K,
// rebuilt thirteen times. `wf brief --acceptance` hands that work to fresh helpers, so the coordinator holds their results only.
// The owner's rule (17 October 2026): reviews alongside development use review.second_model.model at high effort; only the
// milestone review, the one last check of everything built, may use final_model.
const SECOND = { tool: 'codex', model: 'gpt-6.1-sol', max_effort: 'xhigh' };
const closing = (t, { second = { ...SECOND, final_model: 'gpt-6.1-astra', final_effort: 'xhigh' }, roles = { walker: { model: 'opus', effort: 'high' } }, listed = true } = {}) => {
  const p = project(t, { configEdit: c => ({ ...c, acceptance_evidence: true, approval: { ...c.approval, defer_to_acceptance: true }, roles, ...(second ? { review: { second_model: second } } : {}) }) });
  const task = fs.readFileSync(path.join(p.repo, taskPath), 'utf8');
  // T-0001 planned and Done, accepting two findings; T-0003 a found task carrying one of them (P11); T-0004 planned with no
  // record; T-0002 is another milestone's, and its finding is not owed here.
  p.edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised', `status: Active${listed ? '\ntasks: [T-0001, T-0004]' : ''}\nmeasure: The owner imports a list`));
  p.edit(taskPath, x => x.replace('status: Ready', 'status: Done').replace('deferred_inputs: []', 'deferred_inputs: []\naccepted_findings: [R-0001/N1, R-0003/F1]'));
  p.write('docs/workflow/tasks/T-0003.md', task.replaceAll('T-0001', 'T-0003').replace('status: Ready', 'status: Done').replace('deferred_inputs: []', 'deferred_inputs: []\nfound_from: R-0003/F1'));
  p.write('docs/workflow/tasks/T-0002.md', task.replaceAll('T-0001', 'T-0002').replace('milestone: M-0001', 'milestone: M-0002').replace('deferred_inputs: []', 'deferred_inputs: []\naccepted_findings: [R-0009/X1]'));
  const sha = p.commit('the milestone\'s records');
  const brief = (...args) => spawnSync(process.execPath, [cli, 'brief', '--acceptance', '--repo', p.repo, '--baseline', sha, ...args], { encoding: 'utf8' });
  const r = brief('--milestone', 'M-0001');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { p, sha, out: r.stdout, brief };
};
const helperLine = (out, n) => out.split('\n').find(l => l.startsWith(`${n}. `));

test('MAINT-0020 P3: the acceptance brief prints the milestone, its planned and found tasks, and the findings owed at acceptance', t => {
  const { out } = closing(t);
  assert.match(out, /^# M-0001 acceptance\n\nDemonstrate the fixture task\n/);
  for (const line of [
    '- Measure: The owner imports a list',
    '- Acceptance: AC-001-1',
    '- Planned tasks: T-0001 (Done), T-0004 (no record)',
    '- Found tasks: T-0003 (Done), found from R-0003/F1',
    '- Accepted findings owed at acceptance, each in the package\'s *Decided for your acceptance* and the evidence\'s `deferred`: R-0001/N1 (T-0001), R-0003/F1 (T-0001; carried by T-0003)',
    '- Left for the owner by approval.defer_to_acceptance: those findings, and each task pull request\'s `deferred` from `wf ci` (acceptance tests changed, scenarios that waited on found work), in the evidence\'s `deferred` and `tests_changed`',
  ]) assert.ok(out.split('\n').includes(line), `${line}\n---\n${out}`);
  assert.doesNotMatch(out, /R-0009|T-0002/, 'another milestone\'s task and finding are not this one\'s');
  // A milestone without a tasks: list: a task with a found_from is found, the others planned.
  const unlisted = closing(t, { listed: false }).out.split('\n');
  assert.ok(unlisted.includes('- Planned tasks: T-0001 (Done)') && unlisted.includes('- Found tasks: T-0003 (Done), found from R-0003/F1'), unlisted.join('\n'));
  assert.match(out, /you post their results on the acceptance pull request; do not write the package or walk the trial yourself, so your context grows by their results only/);
  assert.match(out, /Each helper returns text and links \(its posted comment, its commits, the screenshots\), not the files it read;/);
});

test('MAINT-0020 P3: the acceptance brief names its three helpers with their models and efforts, the next milestone\'s and the commands', t => {
  const { out, sha } = closing(t);
  const [reviewer, acceptance, walker] = [1, 2, 3].map(n => helperLine(out, n));
  assert.ok(reviewer.startsWith('1. `M-0001 reviewer`: the milestone review of the whole milestone diff (procedures/review.md), by the second model (review.second_model, its final_model): model gpt-6.1-astra, effort xhigh: `setsid nohup codex exec -m gpt-6.1-astra -c model_reasoning_effort=xhigh "M-0001 reviewer: …" > REVIEW_OUTPUT 2>&1 &`.'), reviewer);
  assert.match(reviewer, /Where it cannot run, a fresh reviewer of your own tool at effort max, with a security focus, and review\.fallback says why\.$/);
  assert.equal(acceptance, '2. `M-0001 acceptance`: the owner\'s trial environment with demo data, and the walker\'s own demo accounts and demo business (or tenant), never those the owner will use (a local production build counts when that is what the owner is given: it starts it and keeps it running for the walker; with no environment the owner can be given, the walk is unavailable, a blocker for the plan\'s question from `wf doctor`); and the acceptance package (templates/acceptance.md) naming its address and build, with its trial steps. Once the review and the walk are back, a fresh one completes the package and its evidence (templates/acceptance-evidence.json) from their results, fixing or listing for the owner what the walk found (each scenario still stuck, and a slow first load, in `deferred`), with the usage table the `wf usage` command below prints, and resets or reseeds a shared dataset after the last walk, before the owner is told the trial is ready: model sonnet, effort medium (roles.acceptance).');
  assert.equal(walker, '3. `M-0001 walker`: the trial walk on that environment, the address and build the owner will be given, never a development server, in its own demo accounts and business, a fresh one for each unguided pass: each scenario first from its outcome sentence alone, from a fresh sign-in, then those steps; it records the first page\'s load time, and over 5 s is a finding to report. Once the review\'s fixes are merged, in the background (procedures/accept-release.md): model opus, effort high (roles.walker).');
  assert.ok(out.includes('The next milestone\'s draft goes to a fresh helper, `M-0002 plan`, following procedures/readiness.md; it returns the draft\'s pull request.'), out);
  // Every name is the convention wf usage reads, the next milestone's plan helper included.
  assert.deepEqual([reviewer, acceptance, walker].map(l => parseLaunchName(l.match(/`(M-\d{4} [a-z]+)`/)[1]).role), ['reviewer', 'acceptance', 'walker']);
  assert.deepEqual(parseLaunchName('M-0002 plan drafts the next milestone'), { id: 'M-0002', role: 'plan' });
  const commands = out.slice(out.indexOf('## Commands'));
  assert.ok(commands.includes('- wf usage --milestone M-0001 --claude-session COORDINATOR_SESSION.jsonl --since AUTHORISED_AT  (the milestone\'s usage table, which the acceptance package carries: MAINT-0020 P14). '), commands);
  assert.ok(commands.includes(`- wf ci --baseline ${sha} --candidate HEAD --delivery-evidence PR_DESCRIPTION_FILE  (checks the acceptance evidence in the pull request description, as the wf ci check does)\n`), commands);
  // The waiting and reading lines are the lead brief's own, written once.
  for (const line of [...WAIT_COMMANDS.map(c => `- ${c}`), waitLine(true)]) assert.ok(commands.split('\n').includes(line), line);
  assert.ok(out.includes(`tell each: ${READ_ONCE}.`));
  const missing = closing(t).brief('--milestone', 'M-0009');
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /milestone M-0009 not found/);
  assert.match(closing(t).brief().stderr, /brief --acceptance needs --milestone M-0001/);
});

test('MAINT-0020 (the owner, 17 October 2026): the milestone reviewer falls back to model, a task\'s deep review keeps it at high, and each command carries its effort', t => {
  // final_model unset: the milestone review is by model; final_effort unset: high, under max_effort xhigh.
  assert.match(helperLine(closing(t, { second: SECOND }).out, 1), /by the second model \(review\.second_model\): model gpt-6\.1-sol, effort high: `setsid nohup codex exec -m gpt-6\.1-sol -c model_reasoning_effort=high "M-0001 reviewer: …"/);
  assert.match(helperLine(closing(t, { second: { ...SECOND, max_effort: 'medium' } }).out, 1), /model gpt-6\.1-sol, effort medium: .*-c model_reasoning_effort=medium /, 'high is capped at max_effort');
  // A tool whose command the brief does not know: one line says the effort must be passed.
  assert.match(helperLine(closing(t, { second: { tool: 'gemini', model: 'gemini-3-pro' } }).out, 1), /model gemini-3-pro, effort high: pass the effort explicitly when you launch gemini: the config names no command for it, and its default effort may be lower\. Where it cannot run/);
  assert.match(helperLine(closing(t, { second: null, roles: {} }).out, 1), /by a fresh reviewer of your own tool \(no review\.second_model\): model inherit, effort max\.$/);
  assert.match(helperLine(closing(t, { second: null, roles: {} }).out, 3), /model sonnet, effort medium \(roles\.walker\)\.$/, 'the default walker');
  // The lead's brief keeps model for a task's deep review, at high, with the effort in the command.
  const lead = sha => spawnSync(process.execPath, [cli, 'brief', '--lead', '--task', 'T-0001', '--repo', sha.p.repo, '--baseline', sha.sha], { encoding: 'utf8' }).stdout;
  const both = closing(t);
  // v2.9.0 final review S2: its fallback is the lead's own tool, and final_model is named only as the milestone review's.
  assert.ok(lead(both).split('\n').includes('- a deep review and its fix review, by the second model (review.second_model): model gpt-6.1-sol, effort high: `setsid nohup codex exec -m gpt-6.1-sol -c model_reasoning_effort=high "T-0001 reviewer: …" > REVIEW_OUTPUT 2>&1 &`. Where it cannot run, a fresh reviewer of your own tool at its highest effort, with a security focus, and review.fallback says why; never gpt-6.1-astra, its final_model, which is the milestone review\'s alone'), lead(both));
  assert.match(lead(closing(t, { second: SECOND })), /^- a deep review and its fix review, by the second model \(review\.second_model\): model gpt-6\.1-sol, effort high: .*, and review\.fallback says why$/m);
  assert.doesNotMatch(lead(closing(t, { second: null })), /second model/);
  assert.ok(fs.readFileSync(path.join(root, 'procedures/review.md'), 'utf8').includes('By the owner\'s decision of 17 October 2026, a task\'s review uses its `model` at high effort (at most `max_effort`), and only the milestone review, the one last check of everything built, may use `final_model` at `final_effort`'));
});

test('MAINT-0020 P3: wf next\'s action that prepares a milestone for acceptance runs the acceptance brief', t => {
  const p = project(t);
  p.edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised', 'status: Active\ntasks: [T-0001]'));
  p.edit(taskPath, x => x.replace('status: Ready', 'status: Done'));
  const sha = p.commit('the last task is Done');
  const n = p.run(['next', '--baseline', sha]).out;
  assert.equal(n.next.kind, 'present', JSON.stringify(n.next));
  assert.deepEqual(n.next.run, [`wf brief --acceptance --milestone M-0001 --baseline ${sha}  (the brief for the fresh helpers that close it; post their results)`]);
  for (const [file, text] of [['procedures/accept-release.md', 'Then give each job below and the package to a fresh helper with the brief `wf brief --acceptance --milestone M-NNNN` prints, and post their results; do not write the package yourself.'], ['procedures/execute.md', 'When a milestone\'s last task merges, give its closing work to fresh helpers with `wf brief --acceptance`, post their results and stop']]) assert.ok(fs.readFileSync(path.join(root, file), 'utf8').includes(text), file);
});

test('MAINT-0020: review.second_model takes final_model and final_effort, at most max_effort, and refuses other keys', t => {
  const configWith = second => {
    const dir = tempDir(t);
    const base = JSON.parse(fs.readFileSync(path.join(root, 'config.default.json'), 'utf8'));
    fs.mkdirSync(path.join(dir, 'docs/workflow'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/workflow/config.json'), JSON.stringify({ ...base, review: { second_model: second } }));
    return () => loadConfig(dirSource(dir)).review.second_model;
  };
  for (const good of [{ ...SECOND, final_model: 'gpt-6.1-astra', final_effort: 'xhigh' }, { ...SECOND, final_model: 'gpt-6.1-astra' }, { tool: 'codex', model: 'gpt-6.1-sol', final_effort: 'max' }]) assert.deepEqual(configWith(good)(), good);
  for (const [bad, pattern] of [
    [{ ...SECOND, max_effort: 'high', final_effort: 'xhigh' }, /review\.second_model\.final_effort xhigh is above max_effort high/],
    [{ ...SECOND, final_effort: 'ultra' }, /review\.second_model\.final_effort must be one of low, medium, high, xhigh, max/],
    [{ ...SECOND, final_model: 'gpt 6 astra' }, /review\.second_model\.final_model must be a plain name/],
    [{ ...SECOND, final_model: 6 }, /review\.second_model\.final_model must be a plain name/],
    [{ ...SECOND, final_reviewer: 'codex' }, /review\.second_model may contain only tool, model, max_effort, final_model, final_effort/],
  ]) assert.throws(configWith(bad), pattern, JSON.stringify(bad));
  // The settings page keeps them when it saves the second model's other fields.
  assert.match(fs.readFileSync(path.join(root, 'adapters/setup-page.html'), 'utf8'), /second_model: ticked\('second_model'\) \? \{ \.\.\.\(s\.review\.second_model \?\? \{\}\), tool: 'codex'/);
  assert.match(fs.readFileSync(path.join(root, 'SCHEMA.md'), 'utf8'), /`final_model` and `final_effort`, at most `max_effort`, for the milestone review alone/);
});

test('MAINT-0020 (the owner, 17 October 2026): the milestone review is accepted on final_model or model; a task\'s deep review on model only', t => {
  const second = { ...SECOND, final_model: 'gpt-6.1-astra' };
  // The acceptance pull request: the milestone review's model is final_model or model, or it says why in fallback.
  const a = project(t, { configEdit: c => ({ ...c, acceptance_evidence: true, review: { second_model: second } }) });
  a.edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised', 'status: Accepted'));
  const accepting = a.commit('Accept M-0001');
  const accept = review => a.run(['ci', '--baseline', a.baseline, '--candidate', accepting, '--task', 'T-0001'], { evidence: {
    schema: 'agent-workflow/acceptance-evidence@1', milestone: 'M-0001', candidate: a.baseline,
    review: { reviewer: 'codex exec, fresh context', revision: a.baseline, report: 'https://github.com/fixture/project/pull/9#issuecomment-1', ...review },
    walkthrough: { not_applicable: 'the fixture has no user interface' }, deferred: [], tests_changed: [],
  } });
  for (const model of ['gpt-6.1-astra', 'gpt-6.1-sol']) { const r = accept({ model }); assert.equal(r.status, 0, `${model}: ${r.stdout}${r.stderr}`); }
  assert.match(accept({ model: 'claude-opus-5-5' }).out.findings.join(' | '), /acceptance evidence: the milestone review is by gpt-6\.1-astra or gpt-6\.1-sol \(review\.second_model\), or says in fallback why it could not be/);
  assert.equal(accept({ model: 'claude-opus-5-5', fallback: 'codex refused at its usage limit' }).status, 0);
  assert.match(accept({ model: 'claude-opus-5-5', fallback: ' ' }).out.findings.join(' | '), /the milestone review's fallback must be a non-empty text when given/);
  // A task's deep review: model, or a fallback by the implementer's own tool; final_model is refused there.
  const d = project(t, { configEdit: c => ({ ...c, review: { second_model: second, deep_paths: ['src/**'] } }) });
  d.write('src/a.js', 'export const result = 1;\n');
  const head = d.commit('T-0001: the work');
  const deep = review => { const e = evidence(head); return d.run(['ci', '--baseline', d.baseline, '--candidate', head, '--task', 'T-0001'], { evidence: { ...e, review: { ...e.review, level: 'deep', ...review } } }); };
  const other = deep({ model: 'claude-opus-5-5' });
  assert.equal(other.status, 1);
  assert.match(other.out.findings.join(' | '), /delivery evidence: a deep review is by gpt-6\.1-sol \(review\.second_model; its final_model, gpt-6\.1-astra, is for the milestone review only\), or says in review\.fallback why it could not be/);
  for (const review of [{ model: 'gpt-6.1-sol' }, { model: 'claude-opus-5-5', fallback: 'gpt-6.1-sol is out of quota here' }]) { const r = deep(review); assert.equal(r.status, 0, `${JSON.stringify(review)}: ${r.stdout}${r.stderr}`); }
  // v2.9.0 final review S2: final_model on a task's review is refused at any level, with a fallback too (it was accepted with one).
  const never = 'delivery evidence: a task\'s review is never by gpt-6.1-astra, review.second_model\'s final_model, which the owner keeps for the milestone review, even as a fallback: it is by gpt-6.1-sol, or, where that cannot run, by a fresh reviewer of the implementer\'s own tool, and review.fallback says why';
  for (const review of [{ model: 'gpt-6.1-astra' }, { model: ' gpt-6.1-astra ', fallback: 'gpt-6.1-sol is out of quota here' }]) {
    const r = deep(review);
    assert.equal(r.status, 1, JSON.stringify(review));
    assert.deepEqual(r.out.findings.filter(f => f.startsWith('delivery evidence:')), [never], JSON.stringify(review));
  }
  const s = project(t, { configEdit: c => ({ ...c, review: { second_model: second } }) });
  s.write('src/a.js', 'export const result = 1;\n');
  const plain = s.commit('T-0001: the work');
  const standard = review => { const e = evidence(plain); return s.run(['ci', '--baseline', s.baseline, '--candidate', plain, '--task', 'T-0001'], { evidence: { ...e, review: { ...e.review, ...review } } }); };
  for (const level of ['light', 'standard']) for (const fallback of [undefined, 'a second look']) {
    const r = standard({ level, model: 'gpt-6.1-astra', ...(fallback ? { fallback } : {}) });
    assert.equal(r.status, 1, `${level} ${fallback}`);
    assert.ok(r.out.findings.includes(never), `${level} ${fallback}: ${r.out.findings.join(' | ')}`);
  }
  assert.equal(standard({ level: 'standard', model: 'gpt-6.1-sol' }).status, 0);
  // final_model equal to model is that model, and allowed.
  const same = project(t, { configEdit: c => ({ ...c, review: { second_model: { ...second, final_model: 'gpt-6.1-sol' } } }) });
  same.write('src/a.js', 'export const result = 1;\n');
  const sameHead = same.commit('T-0001: the work');
  const e = evidence(sameHead);
  assert.equal(same.run(['ci', '--baseline', same.baseline, '--candidate', sameHead, '--task', 'T-0001'], { evidence: { ...e, review: { ...e.review, model: 'gpt-6.1-sol' } } }).status, 0);
});

// P7. M-0005's walk ran on a development server, which the profile's trial-walk line started, and followed the steps. The owner's
// trial, on the same server, took 30 s to open and found, starting cold, that a new shop's Today never led to setup (T-0037).
const REV = 'c'.repeat(40);
const walkErrors = (edit = w => w, top = {}) => acceptanceEvidenceErrors({ milestone: 'M-0001', config: {}, candidate: { name: REV, kind: 'dir' }, records: { tasks: new Map() }, evidence: {
  schema: 'agent-workflow/acceptance-evidence@1', milestone: 'M-0001', candidate: REV, deferred: [], tests_changed: [], ...top,
  review: { reviewer: 'codex exec, fresh context', model: 'gpt-6.1-sol', revision: REV, report: 'https://github.com/o/r/pull/9#issuecomment-1' },
  walkthrough: edit({
    revision: REV, trial_environment: { address: 'HTTPS://Staging.Example.com:443/shop/', build: '1.4.0' }, address: 'https://staging.example.com/shop', build: ' 1.4.0 ',
    environment: 'Chromium 140, Playwright 1.56', walk_data: 'separate', first_load_seconds: 2.4,
    walker: 'trial-walker subagent', languages: ['en'], viewports: ['390x844'],
    unguided: [{ scenario: 'AC-001-1', outcome: 'A new shop is set up from Today', result: 'reached' }],
    steps: [{ step: '1. Open Today', scenario: 'AC-001-1', expected: 'the setup card', observed: 'the setup card', result: 'passed', screenshot: 'https://github.com/o/r/pull/9#step-1' }],
  }),
} });

test('MAINT-0020 P7(a): the walk is on the address and build the owner is given, and records the first load', () => {
  assert.deepEqual(walkErrors(), [], 'the same address and build, but for the scheme\'s and host\'s case, the default port, a trailing slash and spaces');
  for (const [k, v, given] of [['address', 'http://localhost:5173/shop', 'HTTPS://Staging.Example.com:443/shop/'], ['address', 'https://staging.example.com/Shop', 'HTTPS://Staging.Example.com:443/shop/'], ['address', 'https://staging.example.com:8443/shop', 'HTTPS://Staging.Example.com:443/shop/'], ['build', '1.4.1', '1.4.0']]) {
    assert.deepEqual(walkErrors(w => ({ ...w, [k]: v })), [`the walkthrough's ${k}, ${v}, is not trial_environment's, ${given}: the evidence must say the walk was on the ${k} the owner is given`], v);
  }
  for (const k of ['address', 'build', 'environment']) assert.deepEqual(walkErrors(({ [k]: _, ...w }) => w), [`the walkthrough needs its ${k}`], k);
  const needs = 'the walkthrough needs its trial_environment, the address and build the owner is given: { address, build }';
  for (const te of [undefined, 'https://staging.example.com, build 1.4.0', { address: 'https://staging.example.com' }, { address: ' ', build: '1.4.0' }]) assert.deepEqual(walkErrors(w => ({ ...w, trial_environment: te })), [needs], JSON.stringify(te));
  for (const bad of [undefined, null, '2.4', -1, Number.NaN]) assert.deepEqual(walkErrors(w => ({ ...w, first_load_seconds: bad })), ['the walkthrough needs first_load_seconds, the first page\'s load time the walker measured: a number, 0 or more'], String(bad));
  assert.deepEqual(walkErrors(({ first_load_seconds, ...w }) => w).length, 1, 'missing');
  assert.deepEqual(walkErrors(w => ({ ...w, first_load_seconds: 0 })), []);
  assert.deepEqual(walkErrors(w => ({ ...w, first_load_seconds: 31 }), { deferred: ['The first load takes 31 s (T-0038)'] }), [], 'a slow first load is a finding for the owner, not a failed walk');
  assert.deepEqual(walkErrors(() => ({ not_applicable: 'the project has no user interface' })), [], 'a walk that does not apply is unchanged');
  assert.match(walkErrors(() => ({ not_applicable: 'no user interface', first_load_seconds: 1 })).join(' | '), /a walkthrough that does not apply says only why, in not_applicable/);
});

test('MAINT-0020 P7(b): before the steps, each scenario they name is tried from its outcome alone; a stuck one has a note and fails nothing', () => {
  for (const u of [undefined, [], 'AC-001-1']) assert.deepEqual(walkErrors(w => ({ ...w, unguided: u })), ['the walkthrough lists no unguided entries: before the steps, try each scenario from its outcome sentence alone, from a fresh sign-in, and record reached or stuck'], String(u));
  const second = w => ({ ...w, steps: [...w.steps, { ...w.steps[0], step: '2. Add a product', scenario: 'AC-001-2' }] });
  assert.deepEqual(walkErrors(second), ['the walkthrough\'s steps name AC-001-2, with no unguided entry: try each from its outcome sentence alone first']);
  assert.deepEqual(walkErrors(w => ({ ...second(w), unguided: [...w.unguided, { scenario: ' AC-001-2 ', outcome: 'A product is added', result: 'reached' }] })), []);
  // v2.9.0 final review S4: every step names its scenario, so one unguided entry cannot stand for steps that name none.
  const unnamed = 'walkthrough step 2 names no scenario: each step names the scenario it walks, which unguided then lists';
  for (const scenario of [undefined, ' ', 7]) assert.deepEqual(walkErrors(w => ({ ...second(w), steps: [w.steps[0], { ...second(w).steps[1], scenario }] })), [unnamed], String(scenario));
  assert.deepEqual(walkErrors(w => ({ ...w, steps: w.steps.map(({ scenario, ...s }) => s), unguided: [{ scenario: 'a new shop', outcome: 'The owner sets up a new shop', result: 'reached' }] })), ['walkthrough step 1 names no scenario: each step names the scenario it walks, which unguided then lists']);
  // Two steps of one scenario need its one entry; a third scenario needs its own.
  const two = w => ({ ...w, steps: [w.steps[0], { ...w.steps[0], step: '2. Finish the setup' }] });
  assert.deepEqual(walkErrors(two), []);
  assert.deepEqual(walkErrors(w => ({ ...two(w), steps: [...two(w).steps, { ...w.steps[0], step: '3. Invite a person', scenario: 'AC-002-1' }] })), ['the walkthrough\'s steps name AC-002-1, with no unguided entry: try each from its outcome sentence alone first']);
  const stuck = extra => w => ({ ...w, unguided: [{ ...w.unguided[0], result: 'stuck', ...extra }] });
  const listed = { deferred: ['AC-001-1: a new shop\'s Today never leads to the setup'] };
  for (const note of [{}, { note: ' ' }]) assert.deepEqual(walkErrors(stuck(note), listed), ['unguided entry 1 got stuck: its note says where'], JSON.stringify(note));
  assert.deepEqual(walkErrors(stuck({ note: 'Today shows an empty list and no way to the setup' }), listed), [], 'stuck is a finding for the owner, not a failed walk');
  assert.deepEqual(walkErrors(w => ({ ...w, unguided: [{ ...w.unguided[0], note: '' }] })), ['unguided entry 1\'s note must be a non-empty text when given']);
  for (const bad of [{ scenario: 'AC-001-1', outcome: 'x', result: 'passed' }, { scenario: 'AC-001-1', result: 'reached' }, { scenario: 'AC-001-1', outcome: ' ', result: 'stuck', note: 'x' }]) {
    assert.deepEqual(walkErrors(w => ({ ...w, unguided: [bad] }), listed), ['unguided entry 1 needs scenario, outcome and a result, reached or stuck'], JSON.stringify(bad));
  }
});

test('MAINT-0020 P7: the walker, the procedure and the brief walk the owner\'s address and build, record the first load, and try each scenario without the steps first', t => {
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  const walker = read('templates/claude/agents/trial-walker.md');
  for (const [name, text] of [['trial-walker.md', walker], ['accept-release.md', read('procedures/accept-release.md')], ['the brief', helperLine(closing(t).out, 3)]]) {
    for (const said of [/the address and build the owner will be given/, /never a development server/, /the first page's load time/, /over 5 s,? is a finding/, /from its outcome (sentence )?alone, from a fresh sign-in/]) assert.match(text, said, name);
  }
  assert.match(read('templates/profile.md'), /the address and build the owner will be given, never a development server/, 'the profile\'s trial-walk line (record § 9)');
  const w = JSON.parse(read('templates/acceptance-evidence.json')).walkthrough;
  assert.deepEqual(Object.keys(w), ['revision', 'trial_environment', 'address', 'build', 'environment', 'walk_data', 'first_load_seconds', 'walker', 'languages', 'viewports', 'unguided', 'steps']);
  assert.deepEqual(Object.keys(w.trial_environment), ['address', 'build']);
  assert.deepEqual([Object.keys(w.unguided[0]), Object.keys(w.steps[0])], [['scenario', 'outcome', 'result', 'note'], ['step', 'scenario', 'expected', 'observed', 'result', 'screenshot']]);
  // v2.9.0 final review S4: each step names the scenario it walks, in the template and in what the walker records.
  assert.equal(w.steps[0].scenario, '<the scenario it walks, which unguided then lists>');
  assert.match(walker, /For each step record the step as written, the scenario it walks,/);
  // bin/wf-upgrade refreshes the walker where a project left it as its pinned release's copy, as for v2.7.0 (adapters/upgrade.mjs).
  assert.ok(INSTALLED.some(i => i.path === '.claude/agents/trial-walker.md' && i.template === 'templates/claude/agents/trial-walker.md'));
  const old = spawnSync('git', ['-C', root, 'show', 'v2.8.0:templates/claude/agents/trial-walker.md'], { encoding: 'utf8' });
  if (old.status === 0) assert.notEqual(old.stdout, walker, 'v2.8.0\'s copy differs, so an upgrade from it takes this one');
});

test('MAINT-0020 P3: the acceptance helper has its own role, roles.acceptance, Sonnet at medium unless the config says otherwise', t => {
  assert.deepEqual(DEFAULT_ROLES.acceptance, { model: 'sonnet', effort: 'medium' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'config.default.json'), 'utf8')).roles.acceptance, DEFAULT_ROLES.acceptance);
  assert.deepEqual(resolveRoles({ roles: { acceptance: { effort: 'high' } } }).acceptance, { model: 'sonnet', effort: 'high' });
  const rolesConfig = roles => {
    const dir = tempDir(t);
    fs.mkdirSync(path.join(dir, 'docs/workflow'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/workflow/config.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(root, 'config.default.json'), 'utf8')), roles }));
    return () => loadConfig(dirSource(dir)).roles;
  };
  assert.deepEqual(rolesConfig({ acceptance: { model: 'opus', effort: 'high' } })(), { acceptance: { model: 'opus', effort: 'high' } });
  assert.throws(rolesConfig({ acceptance: { effort: 'maximum' } }), /roles\.acceptance\.effort must be one of low, medium, high, xhigh, max/);
  assert.throws(rolesConfig({ acceptance: { model: 'opus 5' } }), /roles\.acceptance\.model must be a plain model name/);
  assert.match(helperLine(closing(t, { roles: { acceptance: { model: 'opus', effort: 'high' } } }).out, 2), /: model opus, effort high \(roles\.acceptance\)\.$/);
  assert.match(helperLine(closing(t, { roles: { paperwork: { model: 'opus', effort: 'max' } } }).out, 2), /: model sonnet, effort medium \(roles\.acceptance\)\.$/, 'roles.paperwork no longer sets it');
});

// v2.9.0 review fixes S3 (Codex, gpt-6.1-sol at high effort, of 450faa9).
test('v2.9.0 review S3-1: a milestone review carried over an owner-approved change of the second model is judged by its revision\'s config too', t => {
  const a = project(t, { configEdit: c => ({ ...c, acceptance_evidence: true, review: { second_model: { tool: 'codex', model: 'old-model' } } }) });
  a.git('checkout', '-q', '-b', 'accept');
  a.edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised', 'status: Accepted')); a.commit('Accept M-0001');
  // A config-only change the owner approved merges before the acceptance, and the acceptance pull request takes it in.
  a.git('checkout', '-q', 'main');
  a.edit('docs/workflow/config.json', x => JSON.stringify({ ...JSON.parse(x), review: { second_model: { tool: 'codex', model: 'new-model' } } }));
  const moved = a.commit('the owner moves review.second_model to new-model');
  a.git('checkout', '-q', 'accept'); a.git('merge', '-q', '--no-edit', 'main'); const head = a.git('rev-parse', 'HEAD');
  const accept = review => a.run(['ci', '--baseline', moved, '--candidate', head, '--task', 'T-0001'], { evidence: {
    schema: 'agent-workflow/acceptance-evidence@1', milestone: 'M-0001', candidate: a.baseline,
    review: { reviewer: 'codex exec, fresh context', revision: a.baseline, report: 'https://github.com/fixture/project/pull/9#issuecomment-1', ...review },
    walkthrough: { not_applicable: 'the fixture has no user interface' }, deferred: [], tests_changed: [],
  } });
  for (const model of ['old-model', 'new-model']) { const r = accept({ model }); assert.equal(r.status, 0, `${model}: ${r.stdout}${r.stderr}`); }
  const other = accept({ model: 'other-model' });
  assert.equal(other.status, 1, other.stdout);
  assert.match(other.out.findings.join(' | '), /acceptance evidence: the milestone review is by new-model or old-model \(review\.second_model\), or says in fallback why it could not be/);
  assert.equal(accept({ model: 'other-model', fallback: 'codex was signed out here' }).status, 0);
});

test('v2.9.0 review S3-3: the acceptance brief\'s wf usage command names its inputs, says where to find them, and runs once they are filled', t => {
  const { p, sha, out } = closing(t);
  const line = out.split('\n').find(l => l.startsWith('- wf usage '));
  const command = line.slice(2, line.indexOf('  ('));
  assert.equal(command, 'wf usage --milestone M-0001 --claude-session COORDINATOR_SESSION.jsonl --since AUTHORISED_AT');
  assert.match(line, /COORDINATOR_SESSION\.jsonl is your Claude Code session file, one --claude-session for each session that coordinated M-0001: ~\/\.claude\/projects\/<this checkout's path, each character but a letter or digit as ->\/<session ID>\.jsonl, whose folder of the same name holds its helpers'\./);
  const find = line.match(/ AUTHORISED_AT is when M-0001 was authorised: `([^`]+)`$/)?.[1];
  assert.equal(find, `git log --first-parent --diff-merges=first-parent --reverse -G'^status: Authorised' --format=%cI ${sha} -- docs/workflow/milestones/M-0001.md | head -1`, line);
  const since = spawnSync('sh', ['-c', find], { cwd: p.repo, encoding: 'utf8' }).stdout.trim();
  assert.equal(since, p.git('log', '-1', '--format=%cI', p.initial), 'the first commit with M-0001 Authorised, though it is Active now');
  // Filled as the brief says, it runs; as printed before, it stopped at once (exit 2).
  const dir = tempDir(t), env = { ...process.env, HOME: dir };
  const args = command.replace('COORDINATOR_SESSION.jsonl', claudeSession(dir)).replace('AUTHORISED_AT', since).split(' ').slice(1);
  const r = spawnSync(process.execPath, [cli, ...args, '--repo', p.repo], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Usage of \d+ agent\(s\)/);
  assert.equal(spawnSync(process.execPath, [cli, 'usage', '--milestone', 'M-0001', '--repo', p.repo], { encoding: 'utf8', env }).status, 2);
});

test('v2.9.0 review S3-4: wf next\'s acceptance action keeps the selected candidate in its brief command', t => {
  const p = project(t);
  p.edit('docs/workflow/milestones/M-0001.md', x => x.replace('status: Authorised', 'status: Active\ntasks: [T-0001]'));
  const ready = p.commit('M-0001 Active, T-0001 Ready');
  p.edit(taskPath, x => x.replace('status: Ready', 'status: Done'));
  const done = p.commit('T-0001 Done');
  p.git('checkout', '-q', ready); // the working tree is the baseline: only --candidate reaches the Done task
  const n = p.run(['next', '--baseline', ready, '--candidate', done]).out;
  const present = [n.next, ...n.also].find(a => a.kind === 'present');
  assert.deepEqual(present?.run, [`wf brief --acceptance --milestone M-0001 --baseline ${ready} --candidate ${done}  (the brief for the fresh helpers that close it; post their results)`], JSON.stringify(n, null, 2));
  const brief = spawnSync(process.execPath, [cli, ...present.run[0].slice(0, present.run[0].indexOf('  (')).split(' ').slice(1), '--repo', p.repo], { encoding: 'utf8' });
  assert.equal(brief.status, 0, brief.stderr);
  assert.ok(brief.stdout.split('\n').includes('- Planned tasks: T-0001 (Done)'), brief.stdout);
});

test('v2.9.0 review S3-5: the next milestone\'s draft is a Draft milestone already there, else the next free ID, never a removed one\'s', t => {
  const { p } = closing(t);
  const planner = rev => spawnSync(process.execPath, [cli, 'brief', '--acceptance', '--milestone', 'M-0001', '--repo', p.repo, '--baseline', rev], { encoding: 'utf8' }).stdout.match(/a fresh helper, `(M-\d{4}) plan`/)?.[1];
  const second = 'docs/workflow/milestones/M-0002.md';
  p.write(second, fs.readFileSync(path.join(p.repo, 'docs/workflow/milestones/M-0001.md'), 'utf8').replaceAll('M-0001', 'M-0002').replace(/^status: \w+$/m, 'status: Draft'));
  assert.equal(planner(p.commit('M-0002 drafted')), 'M-0002', 'the Draft one');
  p.edit(second, x => x.replace('status: Draft', 'status: Authorised'));
  assert.equal(planner(p.commit('M-0002 authorised')), 'M-0003', 'no Draft: the next free ID');
  fs.rmSync(path.join(p.repo, second));
  assert.equal(planner(p.commit('M-0002 removed')), 'M-0003', 'a removed milestone keeps its number');
});

// v2.9.0 review fixes S4 (a fresh Claude reviewer of b33f06a, standing in for the second model).
const doc = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const WALK_DATA = 'the walkthrough\'s walk_data is separate (the walker\'s own demo accounts and business, a fresh one for each unguided pass) or reset (the one shared dataset reset or reseeded after the last walk, before the owner is told), so the owner\'s trial starts cold';

test('v2.9.0 review S4-1: the walk leaves the owner\'s trial cold: its own demo accounts and business, or one shared dataset reset after it', t => {
  for (const bad of [undefined, '', 'shared', 'Separate']) assert.deepEqual(walkErrors(w => ({ ...w, walk_data: bad })), [WALK_DATA], String(bad));
  assert.deepEqual(walkErrors(w => ({ ...w, walk_data: 'reset' })), []);
  assert.deepEqual(walkErrors(() => ({ not_applicable: 'the project has no user interface' })), [], 'no walk, no walk data');
  for (const [name, text] of [['trial-walker.md', doc('templates/claude/agents/trial-walker.md')], ['accept-release.md', doc('procedures/accept-release.md')], ['the brief', closing(t).out]]) {
    for (const said of [/own demo accounts and (demo )?business/, /never those the owner will use/, /a fresh one for each unguided pass/, /resets or reseeds/, /after the last walk, before the owner is told the trial is ready/]) assert.match(text, said, name);
  }
});

test('v2.9.0 review S4-2, S4-3: the address and build walked agree with those the owner is given, read as a URL or trimmed; environment is free text', () => {
  const at = (given, walked, environment = 'Firefox 141 at 390x844') => walkErrors(w => ({ ...w, trial_environment: given, ...walked, environment }));
  for (const [given, walked] of [['https://x.com', 'https://x.com/'], ['https://x.com:443/a', 'HTTPS://X.COM/a'], ['http://x.com:80/', 'http://x.com'], ['https://x.com/a?b=1', 'https://x.com/a/?b=1'], ['file:///Applications/Mateen.app/', 'file:///Applications/Mateen.app'], ['Mateen.app', ' Mateen.app ']]) {
    assert.deepEqual(at({ address: given, build: '1.4.0' }, { address: walked, build: ' 1.4.0' }), [], `${given} | ${walked}`);
  }
  for (const [given, walked] of [['https://x.com/a', 'https://x.com/A'], ['https://x.com', 'https://x.com:8443'], ['https://x.com', 'http://x.com'], ['Mateen.app', 'Mateen Dev.app']]) {
    assert.deepEqual(at({ address: given, build: '1.4.0' }, { address: walked, build: '1.4.0' }), [`the walkthrough's address, ${walked}, is not trial_environment's, ${given}: the evidence must say the walk was on the address the owner is given`], `${given} | ${walked}`);
  }
  assert.deepEqual(at({ address: 'https://x.com', build: '1.4.0' }, { address: 'https://x.com', build: 'v1.4.0' }), ['the walkthrough\'s build, v1.4.0, is not trial_environment\'s, 1.4.0: the evidence must say the walk was on the build the owner is given']);
  // A consistency check only: both can name a development server, and the error does not claim to have told one apart.
  assert.deepEqual(at({ address: 'http://localhost:5173', build: 'dev' }, { address: 'http://localhost:5173/', build: 'dev' }), []);
  assert.doesNotMatch(at({ address: 'https://x.com', build: '1' }, { address: 'http://localhost:5173', build: '1' }).join(' | '), /development server/);
  assert.match(doc('SCHEMA.md'), /This is a consistency check: both can name a development server\. The defence against one is the profile's trial line, the walker's instructions and `first_load_seconds`\./);
});

test('v2.9.0 review S4-4: a local production build can be the trial environment, the acceptance helper keeps it running, and none to give is a blocker', t => {
  const texts = { walker: doc('templates/claude/agents/trial-walker.md'), procedure: doc('procedures/accept-release.md'), brief: closing(t).out, profile: doc('templates/profile.md') };
  for (const [name, text] of Object.entries(texts)) assert.match(text, /a local production build (is the trial environment|counts) when that is what the owner is given/i, name);
  for (const name of ['walker', 'procedure', 'brief']) for (const said of [/starts it and keeps it running for (you|the walker)/, /no environment the owner can be given/i]) assert.match(texts[name], said, name);
  for (const name of ['procedure', 'brief', 'profile']) assert.match(texts[name], /no environment the owner can be given, the walk is (unavailable, )?a blocker|No environment the owner can be given makes the walk unavailable, a blocker/, name);
  for (const name of ['procedure', 'brief', 'profile']) assert.match(texts[name], /the plan's question/, name);
});

test('v2.9.0 review S4-5: a scenario still stuck, and a first load over FIRST_LOAD_LIMIT, are listed in deferred for the owner', t => {
  assert.equal(FIRST_LOAD_LIMIT, 5);
  const stuck = w => ({ ...w, unguided: [{ ...w.unguided[0], result: 'stuck', note: 'Today shows no way to the setup' }, { ...w.unguided[0], result: 'stuck', note: 'again, from a second fresh business' }] });
  const owed = ['deferred must list each scenario the walk still got stuck on, for the owner: AC-001-1'];
  assert.deepEqual(walkErrors(stuck), owed);
  assert.deepEqual(walkErrors(stuck, { deferred: ['R-0001/N1: unrelated'] }), owed);
  assert.deepEqual(walkErrors(stuck, { deferred: ['AC-001-1: a new shop\'s Today never leads to the setup'] }), []);
  assert.deepEqual(walkErrors(), [], 'fixed, and re-walked: reached, nothing owed');
  assert.deepEqual(walkErrors(w => ({ ...w, first_load_seconds: FIRST_LOAD_LIMIT })), [], 'at the limit');
  assert.deepEqual(walkErrors(w => ({ ...w, first_load_seconds: 5.1 })), ['deferred must list the first load of 5.1 s, over 5 s, for the owner: a line naming the first load']);
  assert.deepEqual(walkErrors(w => ({ ...w, first_load_seconds: 5.1 }), { deferred: ['First load: 5.1 s on a phone'] }), []);
  assert.match(helperLine(closing(t).out, 3), new RegExp(`over ${FIRST_LOAD_LIMIT} s is a finding to report`));
  assert.match(JSON.parse(doc('templates/acceptance-evidence.json')).deferred[0], /each scenario still stuck \(by its name\) and a first load over 5 s \(naming the first load\)/);
  assert.match(doc('SCHEMA.md'), /over 5 \(`FIRST_LOAD_LIMIT`\) a `deferred` line naming the first load/);
});

test('v2.9.0 review S4-6: wf next\'s task hand-over keeps the selected candidate in the lead\'s brief command', t => {
  const p = project(t);
  p.git('checkout', '-q', '-b', 'claim');
  p.edit(taskPath, x => x.replace('title: Task T-0001', 'title: The title on its claim branch'));
  const claimed = p.commit('T-0001: the record on its claim branch');
  p.git('checkout', '-q', p.baseline); // the working tree is the baseline: only --candidate reaches the claim branch's record
  const n = p.run(['next', '--baseline', p.baseline, '--candidate', claimed]).out;
  const start = [n.next, ...n.also].find(a => a.item === 'T-0001');
  assert.equal(start?.run[1], `wf brief --lead --task T-0001 --baseline ${p.baseline} --candidate ${claimed}  (the task lead's brief)`, JSON.stringify(n, null, 2));
  const brief = spawnSync(process.execPath, [cli, ...start.run[1].slice(0, start.run[1].indexOf('  (')).split(' ').slice(1), '--repo', p.repo], { encoding: 'utf8' });
  assert.equal(brief.status, 0, brief.stderr);
  assert.match(brief.stdout, /^# T-0001: The title on its claim branch$/m);
  assert.equal(p.run(['next', '--baseline', p.baseline]).out.next.run[1], `wf brief --lead --task T-0001 --baseline ${p.baseline}  (the task lead's brief)`, 'the working tree: no --candidate');
});
