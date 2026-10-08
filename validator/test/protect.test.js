import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ACTIONS_APP, applyProtection, checkProtection, plan, readProject } from '../../adapters/protect.mjs';
import { fakeExecutable } from './helpers.js';

// bin/wf-protect (MAINT-0007): the owner's GitHub protections from setup step 5 in one command, shaped by the approval
// mode, and the read-back that step 9 accepts before a switch to enforced mode. GitHub is faked: these tests show what
// the script asks for and how it judges what GitHub reports, not GitHub's behaviour.
const root = fileURLToPath(new URL('../..', import.meta.url));
const config = (label, approver = 'owner', worker = '') => ({ repository: 'fixture/project', trusted_branch: 'main', approval: { label, approver, agent_identity: worker } });
const b64 = text => ({ encoding: 'base64', content: Buffer.from(text).toString('base64') });

// A GitHub that reports the ruleset it was given, or a state the test sets.
function github({ rules, bypass = [], autoMerge = false, codeowners = '* @owner\n/docs/workflow/tasks/\n/docs/workflow/feedback/\n', ci = true, existing = [], upgrade = false } = {}) {
  const calls = [];
  const api = (method, endpoint, body) => {
    calls.push({ method, endpoint, body });
    const fail = (message, status) => { const e = new Error(message); e.status = status; throw e; };
    if (upgrade && /rules/.test(endpoint)) fail('Upgrade to GitHub Pro or make this repository public to enable this feature.', 403);
    if (method === 'GET' && endpoint === 'repos/fixture/project') return { allow_auto_merge: autoMerge };
    if (method === 'GET' && endpoint.startsWith('repos/fixture/project/rulesets?')) return existing;
    if (method === 'GET' && endpoint === 'repos/fixture/project/rules/branches/main') return (rules ?? []).map(r => ({ ...r, ruleset_id: 7 }));
    if (method === 'GET' && endpoint === 'repos/fixture/project/rulesets/7') return { id: 7, name: 'agent-workflow', bypass_actors: bypass };
    if (method === 'GET' && endpoint.startsWith('repos/fixture/project/codeowners/errors')) return codeowners == null ? fail('Not Found', 404) : { errors: [] };
    if (method === 'GET' && endpoint.startsWith('repos/fixture/project/contents/.github/CODEOWNERS')) return codeowners == null ? fail('Not Found', 404) : b64(codeowners);
    if (method === 'GET' && endpoint.startsWith('repos/fixture/project/contents/.github/workflows/wf-ci.yml')) return ci ? b64('name: wf') : fail('Not Found', 404);
    if (method === 'GET' && endpoint.startsWith('repos/fixture/project/contents/')) fail('Not Found', 404);
    if (['POST', 'PUT', 'PATCH'].includes(method)) return { id: 7 };
    fail(`unexpected ${method} ${endpoint}`, 500);
  };
  return { api, calls };
}
const failing = r => r.items.filter(i => i.ok === false).map(i => i.name);

test('each approval mode gets its own ruleset: manual only stops deletion and rewriting', () => {
  const manual = plan({ config: config('manual'), branch: 'main', target: 'manual' });
  assert.deepEqual(manual.ruleset.rules.map(r => r.type), ['deletion', 'non_fast_forward'], 'the closeout fast-forward must still push');
  assert.deepEqual([manual.ruleset.bypass_actors, manual.ruleset.conditions.ref_name.include, manual.autoMerge], [[], ['refs/heads/main'], false], 'a pull request with nothing pending would auto-merge before any receipt');
  const merge = plan({ config: config('owner-merge'), requiredChecks: ['test', 'wf ci'], branch: 'main', target: 'owner-merge' });
  const pr = merge.ruleset.rules.find(r => r.type === 'pull_request').parameters;
  assert.deepEqual([pr.require_code_owner_review, pr.required_approving_review_count, pr.dismiss_stale_reviews_on_push], [false, 0, true], 'one account can never approve its own pull request');
  const checks = merge.ruleset.rules.find(r => r.type === 'required_status_checks').parameters;
  assert.equal(checks.strict_required_status_checks_policy, true);
  assert.deepEqual(checks.required_status_checks, [{ context: 'wf ci', integration_id: ACTIONS_APP }, { context: 'test', integration_id: ACTIONS_APP }]);
  assert.equal(merge.autoMerge, false, 'auto-merge would let the agent merge on checks alone');
  const enforced = plan({ config: config('owner-merge', 'owner', 'agent-bot'), branch: 'main', target: 'enforced' });
  const epr = enforced.ruleset.rules.find(r => r.type === 'pull_request').parameters;
  assert.deepEqual([epr.require_code_owner_review, epr.required_approving_review_count, epr.require_last_push_approval, enforced.autoMerge], [true, 0, false, true]);
  assert.throws(() => plan({ config: config('owner-merge', '', ''), owners: ['alice', 'bob'], branch: 'main', target: 'owner-merge' }), /owner-merge mode is for one owner/);
  const shared = plan({ config: config('manual', '', ''), owners: ['alice', 'bob'], branch: 'main', target: 'enforced' });
  const spr = shared.ruleset.rules.find(r => r.type === 'pull_request').parameters;
  assert.deepEqual([spr.require_code_owner_review, spr.require_last_push_approval, shared.autoMerge, shared.unowned], [true, true, null, []]);
});

test('enforced mode is refused with one account, and an unknown target is refused', () => {
  assert.throws(() => plan({ config: config('manual'), branch: 'main', target: 'enforced' }), /worker account other than the owner's/);
  assert.throws(() => plan({ config: config('manual', 'owner', 'OWNER'), branch: 'main', target: 'enforced' }), /worker account/);
  assert.throws(() => plan({ config: config('manual'), branch: 'main', target: 'strict' }), /--target must be one of/);
});

test('apply creates the ruleset once, updates it afterwards, and sets auto-merge for the mode', () => {
  const p = plan({ config: config('owner-merge', 'owner', 'agent-bot'), branch: 'main', target: 'enforced' });
  const fresh = github();
  assert.deepEqual(applyProtection({ api: fresh.api, repository: 'fixture/project', plan: p }), ['created ruleset agent-workflow (7)', 'auto-merge allowed']);
  assert.deepEqual(fresh.calls.filter(c => c.method !== 'GET').map(c => [c.method, c.endpoint]), [['POST', 'repos/fixture/project/rulesets'], ['PATCH', 'repos/fixture/project']]);
  assert.deepEqual(fresh.calls[1].body, p.ruleset);
  assert.deepEqual(fresh.calls[2].body, { allow_auto_merge: true });
  const again = github({ existing: [{ id: 42, name: 'agent-workflow', source_type: 'Repository' }] });
  applyProtection({ api: again.api, repository: 'fixture/project', plan: plan({ config: config('manual'), branch: 'main', target: 'manual' }) });
  assert.deepEqual(again.calls.filter(c => c.method !== 'GET').map(c => [c.method, c.endpoint, c.body?.allow_auto_merge]), [['PUT', 'repos/fixture/project/rulesets/42', undefined], ['PATCH', 'repos/fixture/project', false]], 'manual mode turns auto-merge off');
  assert.throws(() => applyProtection({ api: github({ upgrade: true }).api, repository: 'fixture/project', plan: p }), /public repository or a GitHub Pro or Team plan/);
});

test('the read-back passes when GitHub reports what the mode needs', () => {
  const p = plan({ config: config('owner-merge', 'owner', 'agent-bot'), requiredChecks: ['test'], branch: 'main', target: 'enforced' });
  const r = checkProtection({ api: github({ rules: p.ruleset.rules, autoMerge: true }).api, repository: 'fixture/project', plan: p });
  assert.deepEqual(failing(r), []);
  assert.equal(r.ok, true);
  assert.equal(r.ready_for_enforced, true);
  assert.ok(r.items.some(i => i.name === 'CODEOWNERS names no worker (agent-bot)' && i.ok));
  const m = plan({ config: config('owner-merge'), branch: 'main', target: 'owner-merge' });
  assert.equal(checkProtection({ api: github({ rules: m.ruleset.rules }).api, repository: 'fixture/project', plan: m }).ok, true);
  // The checkpoints carve-out a single owner may already have (IDEA-18), and a records_dir of the project's own.
  const ops = plan({ config: { ...config('manual', 'owner', 'agent-bot'), records_dir: 'ops/wf' }, branch: 'main', target: 'enforced' });
  assert.deepEqual(failing(checkProtection({ api: github({ rules: ops.ruleset.rules, autoMerge: true, codeowners: '# who approves\n* @owner\n/ops/wf/tasks/   # records\n/ops/wf/feedback/\n/ops/wf/checkpoints/\n' }).api, repository: 'fixture/project', plan: ops })), []);
  // A shared project names no worker in its config: each person verifies their own (shared.md), so the read-back passes.
  const shared = plan({ config: config('manual', '', ''), owners: ['alice', 'bob'], branch: 'main', target: 'enforced' });
  const sharedRead = checkProtection({ api: github({ rules: shared.ruleset.rules, codeowners: '* @alice @bob\n' }).api, repository: 'fixture/project', plan: shared });
  assert.deepEqual([sharedRead.ok, failing(sharedRead)], [true, []]);
  assert.deepEqual(failing(checkProtection({ api: github({ rules: shared.ruleset.rules, codeowners: '* @alice @bob\n/docs/workflow/tasks/\n' }).api, repository: 'fixture/project', plan: shared })), ['CODEOWNERS leaves no path unowned'], 'a shared project keeps every path owned');
});

test('the read-back fails on a bypass, an unbound check, an impossible review, auto-merge in owner-merge, or a missing plan', () => {
  const p = plan({ config: config('owner-merge', 'owner', 'agent-bot'), branch: 'main', target: 'enforced' });
  assert.deepEqual(failing(checkProtection({ api: github({ rules: p.ruleset.rules, autoMerge: true, bypass: [{ actor_type: 'RepositoryRole', actor_id: 5 }] }).api, repository: 'fixture/project', plan: p })), ['ruleset agent-workflow has no bypass']);
  const unbound = p.ruleset.rules.map(r => r.type === 'required_status_checks' ? { ...r, parameters: { ...r.parameters, required_status_checks: [{ context: 'wf ci' }] } } : r);
  assert.deepEqual(failing(checkProtection({ api: github({ rules: unbound, autoMerge: true }).api, repository: 'fixture/project', plan: p })), ['required check "wf ci" from GitHub Actions']);
  assert.deepEqual(failing(checkProtection({ api: github({ rules: p.ruleset.rules, autoMerge: true, codeowners: '* @agent-bot @owner\n' }).api, repository: 'fixture/project', plan: p })), ['CODEOWNERS names no worker (agent-bot)']);
  // MAINT-0007 review B1: a later ownerless line un-owns its paths, so only the records carve-out may have none.
  for (const codeowners of ['* @owner\n/docs/workflow/\n', '* @owner\n/docs/workflow/config.json\n/docs/workflow/profile.md\n/.github/\n']) {
    const r = checkProtection({ api: github({ rules: p.ruleset.rules, autoMerge: true, codeowners }).api, repository: 'fixture/project', plan: p });
    assert.deepEqual([r.ok, r.ready_for_enforced, failing(r)], [false, false, ['CODEOWNERS leaves no path unowned except task, feedback and checkpoint records']], codeowners);
  }
  const m = plan({ config: config('owner-merge'), branch: 'main', target: 'owner-merge' });
  const review = m.ruleset.rules.map(r => r.type === 'pull_request' ? { ...r, parameters: { ...r.parameters, required_approving_review_count: 1 } } : r);
  assert.deepEqual(failing(checkProtection({ api: github({ rules: review, autoMerge: true }).api, repository: 'fixture/project', plan: m })), ['no review is required that you cannot give', 'auto-merge off']);
  const none = checkProtection({ api: github({ upgrade: true }).api, repository: 'fixture/project', plan: m });
  assert.equal(none.ok, false);
  assert.match(none.items.at(-1).detail, /manual and owner-merge modes work without them/);
});

test('wf-protect reads the approved config from the trusted branch and talks to GitHub through gh', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-protect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'project'); fs.mkdirSync(path.join(repo, 'docs/workflow'), { recursive: true });
  const git = (...args) => assert.equal(spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).status, 0);
  git('init', '-q', '-b', 'main');
  const configured = { ...JSON.parse(fs.readFileSync(path.join(root, 'config.default.json'), 'utf8')), ...config('owner-merge') };
  fs.writeFileSync(path.join(repo, 'docs/workflow/config.json'), JSON.stringify(configured));
  const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/wf-protect'), '--project', repo, ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` } });
  const uncommitted = cli();
  assert.equal(uncommitted.status, 2);
  assert.match(uncommitted.stderr, /commit the scaffold/);
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'adopt');
  const p = plan({ config: configured, branch: 'main', target: 'owner-merge' });
  // The fake gh answers as GitHub would after --apply, and logs each call.
  fakeExecutable(path.join(dir, 'gh'), `
    const fs = require('fs'); const args = process.argv.slice(2);
    fs.appendFileSync(${JSON.stringify(path.join(dir, 'calls.log'))}, args.slice(0, 4).join(' ') + '\\n');
    const endpoint = args[3];
    const reply = v => { process.stdout.write(JSON.stringify(v)); process.exit(0); };
    if (args[2] !== 'GET') reply({ id: 7 });
    if (endpoint === 'repos/fixture/project') reply({ allow_auto_merge: false });
    if (endpoint.startsWith('repos/fixture/project/rulesets?')) reply([]);
    if (endpoint === 'repos/fixture/project/rules/branches/main') reply(${JSON.stringify(p.ruleset.rules.map(r => ({ ...r, ruleset_id: 7 })))});
    if (endpoint === 'repos/fixture/project/rulesets/7') reply({ name: 'agent-workflow', bypass_actors: [] });
    if (endpoint.includes('wf-ci.yml')) reply({ encoding: 'base64', content: '' });
    process.stdout.write(JSON.stringify({ message: 'Not Found' })); process.stderr.write('gh: Not Found (HTTP 404)'); process.exit(1);
  `);
  const applied = cli('--apply', '--json');
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  const out = JSON.parse(applied.stdout);
  assert.deepEqual([out.ok, out.target, out.applied], [true, 'owner-merge', ['created ruleset agent-workflow (7)', 'auto-merge turned off']]);
  assert.match(fs.readFileSync(path.join(dir, 'calls.log'), 'utf8'), /^api --method POST repos\/fixture\/project\/rulesets$/m);
  const enforced = cli('--target', 'enforced');
  assert.equal(enforced.status, 2);
  assert.match(enforced.stderr, /worker account/);
});

// bin/wf-sign: the owner's key and round signing, replacing the snippets copied from approval-evidence.md.
test('wf-sign makes a passphrase-protected key outside any checkout and signs rounds the validator accepts', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-sign-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sign = (args, passphrase = 'correct horse') => spawnSync(process.execPath, [path.join(root, 'bin/wf-sign'), ...args], { encoding: 'utf8', cwd: dir, env: { ...process.env, OWNER_SIGNING_PASSPHRASE: passphrase } });
  const inside = sign(['--keygen', path.join(root, 'no-keys-here')]);
  assert.equal(inside.status, 2);
  assert.match(inside.stderr, /inside a Git checkout/);
  assert.ok(!fs.existsSync(path.join(root, 'no-keys-here')), 'nothing is created in the checkout');
  assert.match(sign(['--keygen', path.join(dir, 'weak')], 'short').stderr, /at least 8 characters/);
  const made = sign(['--keygen', path.join(dir, 'keys')]);
  assert.equal(made.status, 0, made.stdout + made.stderr);
  const secret = path.join(dir, 'keys/owner-signing-key.pem');
  assert.match(fs.readFileSync(secret, 'utf8'), /ENCRYPTED PRIVATE KEY/);
  assert.equal(fs.statSync(secret).mode & 0o777, 0o600);
  assert.equal(sign(['--keygen', path.join(dir, 'keys')]).status, 2, 'never replaces a key');
  const revision = 'a'.repeat(40);
  const round = path.join(dir, 'round.json');
  fs.writeFileSync(round, JSON.stringify([{ purpose: 'baseline', repository: 'fixture/project', revision, expires_at: '2099-01-01T00:00:00Z' }]));
  const digest = (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(round)).digest('hex');
  const receipts = path.join(dir, 'receipts.json');
  fs.writeFileSync(receipts, JSON.stringify([{ payload: { purpose: 'baseline', revision }, signature: 'old' }, { payload: { purpose: 'review', revision }, signature: 'kept' }]));
  assert.equal(sign([round, 'b'.repeat(64), '--key', secret, '--receipts', receipts]).status, 1, 'a different file is refused');
  const broken = path.join(dir, 'broken.json'); fs.writeFileSync(broken, '{not json');
  const bad = sign([round, digest, '--key', secret, '--receipts', broken]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /^wf-sign: .*broken\.json: /);
  assert.equal(fs.readFileSync(broken, 'utf8'), '{not json', 'a malformed receipts file is left as it was');
  assert.equal(sign([round, digest, '--key', secret, '--receipts', receipts], 'wrong passphrase').status, 1);
  const signed = sign([round, digest, '--key', secret, '--receipts', receipts]);
  assert.equal(signed.status, 0, signed.stdout + signed.stderr);
  const all = JSON.parse(fs.readFileSync(receipts, 'utf8'));
  assert.deepEqual(all.map(r => r.payload.purpose), ['review', 'baseline'], 'the old receipt for the same purpose and revision is replaced');
  const { createTrust } = await import('../lib/trust.js');
  const trust = createTrust({ publicKey: fs.readFileSync(path.join(dir, 'keys/owner-public-key.pem'), 'utf8'), repository: 'fixture/project', envelopes: all });
  assert.equal(trust.allows('baseline', revision), true);
});
