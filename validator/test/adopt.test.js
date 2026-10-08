import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirSource, loadConfig, validateRecords } from '../lib/index.js';

// bin/wf-adopt is the model-free scaffold from procedures/setup.md step 3. These tests use this
// checkout as the workflow source, so they need a Git checkout and skip without one.
const root = fileURLToPath(new URL('../..', import.meta.url));
const script = path.join(root, 'bin/wf-adopt');
const head = () => { const r = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-adopt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['-C', dir, 'init', '-q']).status, 0);
  return dir;
}
const adopt = (dir, ...extra) => spawnSync(process.execPath, [script, '--project', dir, '--workflow-repo', root, '--rev', 'HEAD', '--repository', 'fixture/project', '--coordinator', 'owner', ...extra], { encoding: 'utf8' });

test('wf-adopt scaffolds an adoption pinned to a full hash, and the result validates and runs', t => {
  const rev = head(); if (!rev) return t.skip('not a Git checkout');
  const dir = project(t);
  const r = adopt(dir, '--production', '**/*.dart', '--lane', 'existing', '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).revision, rev);
  const source = dirSource(dir);
  const config = loadConfig(source);
  assert.equal(config.workflow.revision, rev);
  assert.equal(config.repository, 'fixture/project');
  assert.ok(config.paths.production.includes('**/*.dart'));
  assert.ok(config.paths.production.includes('src/**'), 'defaults are kept');
  assert.deepEqual(validateRecords(source, 'docs/workflow').errors, []);
  const profile = fs.readFileSync(path.join(dir, 'docs/workflow/profile.md'), 'utf8');
  assert.match(profile, /^project: project$/m);
  assert.match(profile, /^approval_label: manual$/m);
  assert.equal(config.approval.label, 'manual');
  if (spawnSync('git', ['-C', root, 'cat-file', '-e', 'HEAD:templates/claude/agents/independent-reviewer.md']).status === 0) {
    assert.match(fs.readFileSync(path.join(dir, '.claude/agents/independent-reviewer.md'), 'utf8'), /^name: independent-reviewer$/m);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'docs/workflow/acceptance.json'), 'utf8')), { examples: [] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'tests/acceptance-map.json'), 'utf8')), []);
  for (const d of ['milestones', 'tasks', 'decisions', 'feedback/inbox', 'inbox/done']) assert.ok(fs.statSync(path.join(dir, 'docs/workflow', d)).isDirectory(), d);
  const setup = fs.readFileSync(path.join(dir, 'docs/workflow/setup.md'), 'utf8');
  assert.match(setup, /Owner steps/); assert.match(setup, /Existing repository/); assert.ok(setup.includes(rev));
  assert.match(setup, /7\. \*\*Define the checks and acceptance tests\.\*\* The profile's `required_checks` \(readiness fails while it is empty\)/);
  // MAINT-0007: the GitHub steps are optional and scripted, and the checklist follows the arrangement: one account and
  // manual approval here, so no worker step, no enforced switch, a key made by wf-sign and a ruleset that only stops
  // the trusted branch being deleted or rewritten (the owner's closeout fast-forward must still push).
  assert.match(setup, /Arrangement: one GitHub account \(`owner`\)/);
  assert.doesNotMatch(setup, /^- \[ \] 2\./m, 'one account has no worker to verify');
  assert.doesNotMatch(setup, /^- \[ \] 9\./m, 'enforced mode needs a worker account');
  assert.doesNotMatch(setup, /^- \[ \] 10\./m, 'central reporting is not a default step');
  assert.match(setup, /^- \[ \] 5\. \*\*Protect the main branch \(optional\)\.\*\* Only on a public repository or a GitHub Pro or Team plan\. .*wf-protect --project \. --apply.* never deleted or rewritten/m);
  assert.match(setup, /^- \[ \] 6\. \*\*Make your signing key\.\*\* .*bin\/wf-sign --keygen DIR.* passphrase/m);
  assert.match(setup, /^- \[ \] 11\. \*\*Watch the first milestone\.\*\* It is the pilot/m);
  assert.match(setup, /usage per step: scaffolded \d{4}-\d{2}-\d{2}; lane existing; one account; approval manual/);
  assert.equal(fs.readFileSync(path.join(dir, '.github/CODEOWNERS'), 'utf8').split('\n').filter(l => l && !l.startsWith('#')).join('\n'), '* @owner\n/docs/workflow/tasks/\n/docs/workflow/feedback/', 'a single owner gets the records carve-out');
  if (spawnSync('git', ['-C', root, 'cat-file', '-e', 'HEAD:templates/github/wf-ci.yml']).status === 0) assert.match(fs.readFileSync(path.join(dir, '.github/workflows/wf-ci.yml'), 'utf8'), /name: wf ci/);
  assert.deepEqual([config.approval.approver, config.approval.agent_identity], ['owner', '']);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Never turn on auto-merge \(it could merge before the owner signs\), and never approve, merge, sign or bypass a rule yourself/, 'manual mode moves the trusted branch only by closeout');
  assert.match(agents, /you work with the owner's own GitHub account, so GitHub will let you do these things: the rule is yours to keep/);
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /session \| status \| brief \| closeout`/);
  // MAINT-0006: the scaffold's CLAUDE.md carries the section in templates/claude/compact-instructions.md.
  const claude = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /^## Compact Instructions$/m);
  assert.match(claude, /Mark as unverified any claim of work done, tested, reviewed or approved/);
  assert.match(claude, /run `scripts\/wf next` \(with the trust options when you have them\) and check `git status` and `git log`/);
  if (spawnSync('git', ['-C', root, 'cat-file', '-e', 'HEAD:templates/github/wf-status.yml']).status === 0) {
    const workflow = fs.readFileSync(path.join(dir, '.github/workflows/wf-status.yml'), 'utf8');
    assert.match(workflow, /branches: \[main\]/); assert.match(workflow, /refs\/heads\/main'/); assert.doesNotMatch(workflow, /__TRUSTED_BRANCH__/);
    assert.match(setup, /\*\*Pin the status issue \(optional\)\.\*\* Pin the \*Project status\* issue/);
  }
  assert.ok(fs.statSync(path.join(dir, 'scripts/wf')).mode & 0o111, 'launcher is executable');
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^\.cache\/$/m);
  assert.equal(spawnSync('git', ['-C', path.join(dir, '.cache/agent-workflow'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), rev);
  // The local launcher runs the pinned validator against the fresh scaffold without touching the network.
  const wf = spawnSync('bash', [path.join(dir, 'scripts/wf'), 'records'], { cwd: dir, encoding: 'utf8' });
  assert.equal(wf.status, 0, wf.stdout + wf.stderr);
  assert.equal(JSON.parse(wf.stdout).ok, true);
});

test('an existing AGENTS.md alone gets the pointer hint, and the new CLAUDE.md already carries the section', t => {
  const rev = head(); if (!rev) return t.skip('not a Git checkout');
  const dir = project(t);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'existing guide\n');
  const r = adopt(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /An adapter already existed/);
  assert.doesNotMatch(r.stdout, /compact-instructions\.md/);
  assert.match(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /^## Compact Instructions$/m);
});

test('wf-adopt never overwrites an existing file and refuses a second adoption', t => {
  const rev = head(); if (!rev) return t.skip('not a Git checkout');
  const dir = project(t);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'existing guide\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'existing adapter\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/');
  const first = adopt(dir);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'existing adapter\n');
  assert.match(first.stdout, /copy \.cache\/agent-workflow\/templates\/claude\/compact-instructions\.md into CLAUDE\.md/);
  assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), 'existing guide\n');
  assert.match(first.stdout, /Left as they were[\s\S]*AGENTS\.md/);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'node_modules/\n.cache/\n');
  const before = fs.readFileSync(path.join(dir, 'docs/workflow/config.json'), 'utf8');
  const second = adopt(dir);
  assert.equal(second.status, 2);
  assert.match(second.stderr, /already exists/);
  assert.equal(fs.readFileSync(path.join(dir, 'docs/workflow/config.json'), 'utf8'), before);
});

test('wf-adopt scaffolds manual approval by default, owner-merge on request, and never enforced', t => {
  const rev = head(); if (!rev) return t.skip('not a Git checkout');
  const dir = project(t);
  const r = adopt(dir, '--json', '--worker', 'agent-bot');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const config = loadConfig(dirSource(dir));
  assert.deepEqual([config.approval.label, config.approval.mechanism, config.approval.approver, config.approval.agent_identity], ['manual', 'manual-signed-receipts', 'owner', 'agent-bot']);
  const profile = fs.readFileSync(path.join(dir, 'docs/workflow/profile.md'), 'utf8');
  assert.match(profile, /^approval_label: manual$/m);
  assert.match(profile, /^approval_mechanism: manual-signed-receipts$/m);
  const setup = fs.readFileSync(path.join(dir, 'docs/workflow/setup.md'), 'utf8');
  assert.match(setup, /Arrangement: owner `owner`, worker `agent-bot`/);
  assert.match(setup, /^- \[ \] 2\. \*\*Check the two GitHub accounts\.\*\* Verify the owner and worker GitHub usernames/m);
  assert.match(setup, /^- \[ \] 9\. \*\*Switch to enforced mode \(optional\)\.\*\* Where.*--target enforced --apply.*switch .*enforced.* in one code-owner-reviewed pull request/m);
  const other = project(t);
  const enforced = adopt(other, '--approval', 'enforced');
  assert.equal(enforced.status, 2, 'enforced is never scaffolded');
  assert.match(enforced.stderr, /manual or owner-merge/);
  assert.ok(!fs.existsSync(path.join(other, 'docs/workflow')));
  for (const [args, message] of [[['--worker', 'owner'], /other than the owner's/], [['--worker', 'not a name'], /not a GitHub username/], [['--worker', 'bot', '--owner', 'alice', '--owner', 'bob'], /for one owner/], [['--approval', 'owner-merge', '--owner', 'alice', '--owner', 'bob'], /owner-merge is for one owner/]]) {
    const refused = project(t);
    const result = adopt(refused, ...args);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, message);
    assert.ok(!fs.existsSync(path.join(refused, 'docs/workflow')), 'nothing is written');
  }
  // Owner-merge: one account, the owner's own merge as the approval, stated as a limit, and no auto-merge.
  const merge = project(t);
  assert.equal(adopt(merge, '--approval', 'owner-merge').status, 0);
  const mergeConfig = loadConfig(dirSource(merge));
  assert.deepEqual([mergeConfig.approval.label, mergeConfig.approval.mechanism], ['owner-merge', 'owner-merge']);
  assert.match(fs.readFileSync(path.join(merge, 'docs/workflow/profile.md'), 'utf8'), /^approval_label: owner-merge$/m);
  const mergeSetup = fs.readFileSync(path.join(merge, 'docs/workflow/setup.md'), 'utf8');
  assert.match(mergeSetup, /^- \[ \] 6\. \*\*Nothing to set up for approval\.\*\* Your own review and merge of each pull request is the approval/m);
  assert.match(mergeSetup, /Approval: owner-merge, chosen by the owner: .*No protection shows that the owner, not the agent, merged/);
  assert.match(mergeSetup, /ruleset requiring pull requests, with the `wf ci` check/);
  const mergeAgents = fs.readFileSync(path.join(merge, 'AGENTS.md'), 'utf8');
  assert.match(mergeAgents, /never turn on auto-merge, and never approve, merge, sign or bypass a rule yourself/);
  assert.doesNotMatch(mergeAgents, /turn it on as you open/);
  assert.deepEqual(validateRecords(dirSource(merge), 'docs/workflow').errors, []);
});

test('wf next works on a scaffold that is not committed yet, and says to commit it', t => {
  const rev = head(); if (!rev) return t.skip('not a Git checkout');
  // Both a repository without commits and one whose main predates the adoption.
  for (const existing of [false, true]) {
    const dir = project(t);
    if (existing) {
      fs.writeFileSync(path.join(dir, 'README.md'), '# project\n');
      for (const args of [['checkout', '-q', '-b', 'main'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'existing']]) assert.equal(spawnSync('git', ['-C', dir, ...args]).status, 0);
    }
    assert.equal(adopt(dir).status, 0);
    const next = spawnSync(process.execPath, [path.join(root, 'validator/cli.js'), 'next', '--repo', dir], { encoding: 'utf8' });
    assert.equal(next.status, 0, next.stdout + next.stderr);
    assert.match(next.stdout, /^Note: the adoption is not on main yet, so this reads the working tree: commit the scaffold/);
    assert.match(next.stdout, /Next: Do the next unchecked agent step in the setup record/);
  }
});

test('wf-adopt leaves an existing CODEOWNERS alone and gives a shared project every path owned', t => {
  const rev = head(); if (!rev) return t.skip('not a Git checkout');
  const dir = project(t);
  fs.writeFileSync(path.join(dir, 'CODEOWNERS'), '* @someone-else\n');
  const r = adopt(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!fs.existsSync(path.join(dir, '.github/CODEOWNERS')));
  assert.match(r.stdout, /CODEOWNERS exists: check it/);
  const shared = project(t);
  assert.equal(adopt(shared, '--owner', 'alice', '--owner', 'bob').status, 0);
  assert.equal(fs.readFileSync(path.join(shared, '.github/CODEOWNERS'), 'utf8').split('\n').filter(l => l && !l.startsWith('#')).join('\n'), '* @alice @bob');
  const named = project(t);
  assert.equal(spawnSync(process.execPath, [script, '--project', named, '--workflow-repo', root, '--rev', 'HEAD', '--repository', 'fixture/project', '--coordinator', 'Owner Name'], { encoding: 'utf8' }).status, 0);
  assert.ok(!fs.existsSync(path.join(named, '.github/CODEOWNERS')), 'no CODEOWNERS without a GitHub username');
});

test('wf-adopt refuses a workflow revision that lacks its templates before writing anything', t => {
  const rev = head(); if (!rev) return t.skip('not a Git checkout');
  if (spawnSync('git', ['-C', root, 'rev-parse', '--verify', 'v1.0.0^{commit}']).status !== 0) return t.skip('v1.0.0 tag not present');
  const dir = project(t);
  const r = spawnSync(process.execPath, [script, '--project', dir, '--workflow-repo', root, '--rev', 'v1.0.0', '--repository', 'fixture/project', '--coordinator', 'owner'], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /not present at/);
  assert.ok(!fs.existsSync(path.join(dir, 'docs/workflow')));
});

test('wf-adopt rejects an unresolvable pin and malformed options without writing anything', t => {
  const rev = head(); if (!rev) return t.skip('not a Git checkout');
  const dir = project(t);
  const bad = spawnSync(process.execPath, [script, '--project', dir, '--workflow-repo', root, '--rev', 'no-such-ref', '--repository', 'fixture/project', '--coordinator', 'owner'], { encoding: 'utf8' });
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);
  assert.equal(adopt(dir, '--repository').status, 2, 'missing value');
  assert.equal(adopt(dir, '--lane', 'unattended').status, 2, 'unknown lane');
  assert.equal(spawnSync(process.execPath, [script, '--project', dir, '--workflow-repo', root, '--rev', 'HEAD', '--repository', 'not-a-slug', '--coordinator', 'owner'], { encoding: 'utf8' }).status, 2);
  assert.ok(!fs.existsSync(path.join(dir, 'docs/workflow')));
});

test('wf-adopt sets up a shared project with --owner and refuses one owner, a bad name or a revision without support', t => {
  const rev = head(); if (!rev) return t.skip('not a Git checkout');
  const refused = (...extra) => { const dir = project(t); const r = adopt(dir, ...extra); assert.equal(r.status, 2, r.stdout + r.stderr); assert.ok(!fs.existsSync(path.join(dir, 'docs/workflow')), 'nothing is written'); return r; };
  assert.match(refused('--owner', 'alice').stderr, /two or more/);
  assert.match(refused('--owner', 'alice', '--owner', 'not a name').stderr, /not a GitHub username/);
  assert.match(refused('--owner', 'alice', '--owner', 'alice').stderr, /twice/);
  // A workflow revision whose profile template has no `owners` line: built here, so the check never depends on tags.
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-old-'));
  t.after(() => fs.rmSync(old, { recursive: true, force: true }));
  for (const rel of ['config.default.json', 'templates/profile.md', 'templates/setup.md']) {
    fs.mkdirSync(path.dirname(path.join(old, rel)), { recursive: true });
    fs.writeFileSync(path.join(old, rel), fs.readFileSync(path.join(root, rel), 'utf8').replace(/^owners:.*\n/m, ''));
  }
  const g = (...args) => assert.equal(spawnSync('git', ['-C', old, ...args]).status, 0);
  g('init', '-q'); g('add', '.'); g('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'old workflow');
  const target = project(t);
  const unsupported = spawnSync(process.execPath, [script, '--project', target, '--workflow-repo', old, '--rev', 'HEAD', '--repository', 'fixture/project', '--coordinator', 'alice', '--owner', 'alice', '--owner', 'bob'], { encoding: 'utf8' });
  assert.equal(unsupported.status, 2, unsupported.stdout + unsupported.stderr);
  assert.match(unsupported.stderr, /no shared-project support/);
  assert.ok(!fs.existsSync(path.join(target, 'docs/workflow')), 'nothing is written');
  const dir = project(t);
  const r = adopt(dir, '--owner', 'alice', '--owner', 'bob', '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).owners, ['alice', 'bob']);
  assert.match(fs.readFileSync(path.join(dir, 'docs/workflow/profile.md'), 'utf8'), /^owners: \[alice, bob\]$/m);
  assert.match(fs.readFileSync(path.join(dir, 'docs/workflow/setup.md'), 'utf8'), /^- \[ \] \*\*Set up the shared project\.\*\* .*`CODEOWNERS` assigns every path \(`\*`\) to alice, bob and no worker, and the ruleset requires code-owner review and approval of the most recent push;.* step 9 also shows that a worker's approval cannot merge/m);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'docs/workflow/setup.md'), 'utf8'), /unowned/, 'a shared project keeps every path owned');
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /auto-merge/, 'no auto-merge instruction without the single-owner settings');
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /work only on tasks whose `owner` is the person you work for, and claim each one before starting/);
  assert.deepEqual(validateRecords(dirSource(dir), 'docs/workflow').errors, []);
  const solo = project(t);
  assert.equal(adopt(solo).status, 0, 'a one-owner adoption needs no --owner');
  assert.doesNotMatch(fs.readFileSync(path.join(solo, 'docs/workflow/setup.md'), 'utf8'), /^- \[ \] \*\*Set up the shared project/m);
  assert.doesNotMatch(fs.readFileSync(path.join(solo, 'AGENTS.md'), 'utf8'), /Several people share/);
});

test('Spec Kit scaffold options refuse unsupported inputs before project writes',t=>{
 for(const args of [
  ['--planning-frontend','unknown'],['--planning-frontend','speckit'],['--speckit-python','/tmp/python'],
  ['--planning-frontend','speckit','--speckit-python','relative/python'],
  ['--planning-frontend','speckit','--speckit-python','/tmp/python','--owner','alice','--owner','bob']
 ]) {
  const dir=project(t),r=adopt(dir,...args);assert.equal(r.status,2,r.stdout+r.stderr);
  assert.equal(fs.existsSync(path.join(dir,'docs/workflow')),false);
 }
});
