import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compatibility, verifyManagedFiles } from '../../adapters/speckit/installation.mjs';
import { stageInstallation, applyStagedInstallation } from '../../adapters/speckit/staging.mjs';
import { sha256 } from '../../adapters/speckit/files.mjs';
import { verifyInstallation } from '../../adapters/speckit.mjs';
import { resolveFeatureContext } from '../../adapters/speckit/context.mjs';
import { assertCommandBoundary } from './helpers/speckit-command-contract.js';
import { activateIntegration, proposeAuthority } from '../../adapters/speckit/maintenance.mjs';
import { main } from '../../adapters/speckit.mjs';
import { taskProjection } from '../../adapters/speckit/operations.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const live = process.env.WF_SPECKIT_UPSTREAM === '1';
if (!live && (process.env.WF_SPECKIT_UPSTREAM || process.env.WF_SPECKIT_SOURCE || process.env.WF_SPECKIT_EXECUTABLE))
  throw new Error('live lane variables require WF_SPECKIT_UPSTREAM=1');

test('preset and extension advertise only shipped bounded entries and exact upstream pin', () => {
  for (const kind of ['preset', 'extension']) {
    const packageRoot = path.join(root, 'integrations/speckit', kind);
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, `${kind}.yml`)));
    assert.equal(manifest.requires.speckit_version, `==${compatibility.upstream.version}`);
    assert.equal(manifest[kind].id, 'agent-workflow');
    assert.equal(manifest.hooks, undefined);
    for (const entry of manifest.provides.templates ?? manifest.provides.commands) {
      assert.ok(!entry.file.includes('..') && !path.isAbsolute(entry.file));
      const text = fs.readFileSync(path.join(packageRoot, entry.file), 'utf8');
      assert.ok(text.trim().length > 20, entry.file);
      if (entry.type === 'command') assert.match(text, /Stop:/);
    }
  }
});
test('compatibility inventories are complete sorted distinct paths and fixed hashes', () => {
  assert.equal(compatibility.certified, false);
  assert.ok(compatibility.packaged_assets.length > 0);
  const paths = compatibility.packaged_assets.map(f => f.path);
  assert.deepEqual(paths, [...new Set(paths)].sort());
  assert.deepEqual(compatibility.managed_paths, [...new Set(compatibility.managed_paths)].sort());
  for (const f of compatibility.packaged_assets) assert.match(f.sha256, /^[a-f0-9]{64}$/);
  assert.equal(sha256(fs.readFileSync(path.join(root, 'integrations/speckit/python-requirements.lock'))), compatibility.dependency_lock_sha256);
});

if (live) {
  test('real pinned package stages both integrations, blocks tampering and materializes native command boundaries', t => {
    const source = process.env.WF_SPECKIT_SOURCE, executable = process.env.WF_SPECKIT_EXECUTABLE;
    assert.ok(source && executable, 'source checkout and isolated executable required in live lane');
    assert.ok(path.isAbsolute(source) && path.isAbsolute(executable), 'absolute live paths required');
    const revision = spawnSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    assert.equal(revision.status, 0, revision.stderr);
    assert.equal(revision.stdout.trim(), compatibility.upstream.revision);
    assert.equal(spawnSync('git', ['-C', source, 'diff', '--quiet', 'HEAD']).status, 0, 'upstream source must be unchanged');
    for (const file of compatibility.packaged_assets) {
      const rel = file.path.startsWith('specify_cli/core_pack/commands/') ? `templates/${file.path.slice('specify_cli/core_pack/'.length)}` :
        file.path.startsWith('specify_cli/core_pack/') ? file.path.slice('specify_cli/core_pack/'.length) : `src/${file.path}`;
      assert.equal(sha256(fs.readFileSync(path.join(source, rel))), file.sha256, rel);
    }
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-speckit-live-'));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const python = path.join(path.dirname(executable), 'python');
    const ownRevision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    assert.equal(ownRevision.status, 0, ownRevision.stderr);
    const staged = stageInstallation({ directory: path.join(temp, 'stage'), python, coreRevision: ownRevision.stdout.trim(), profileText:fs.readFileSync(path.join(root,'fixtures/04a-accepted-decision-permits/baseline/docs/workflow/profile.md'),'utf8') });
    assert.equal(verifyInstallation({ repo: staged.directory, lock: staged.lock, integration: 'codex', python }).ok, true);
    for (const tool of ['.agents', '.claude']) {
      for (const command of ['specify', 'clarify', 'plan', 'tasks', 'implement', 'constitution'])
        assertCommandBoundary(fs.readFileSync(path.join(staged.directory, tool, 'skills', `speckit-${command}`, 'SKILL.md'), 'utf8'), command, tool === '.agents' ? 'codex' : 'claude');
    }
    assert.match(fs.readFileSync(path.join(staged.directory, '.specify/memory/constitution.md'), 'utf8'), /not an independent constitution/);
    // Exercise the actual installed files with a synthetic adopted project.
    // This is a technical fixture, not owner approval or a real delivery pilot.
    const project=path.join(temp,'project');
    fs.cpSync(path.join(root,'fixtures/04a-accepted-decision-permits/baseline'),project,{recursive:true});
    applyStagedInstallation({stage:staged.directory,repo:project});
    const write=(rel,bytes)=>{fs.mkdirSync(path.dirname(path.join(project,rel)),{recursive:true});fs.writeFileSync(path.join(project,rel),bytes);};
    const git=(...args)=>{const r=spawnSync('git',['-C',project,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
    const configPath=path.join(project,'docs/workflow/config.json');
    const config=JSON.parse(fs.readFileSync(configPath));
    config.planning_frontend={name:'speckit',compatibility_api:1,feature_root:'docs/specs'};
    config.workflow={...config.workflow,revision:ownRevision.stdout.trim()};
    fs.writeFileSync(configPath,JSON.stringify(config));
    const taskPath=path.join(project,'docs/workflow/tasks/T-0001.md');
    const native=fs.readFileSync(taskPath,'utf8').replace('record: task','record: task\nfeature: docs/specs/orders')+'\n- [ ] Verify behavior\n';
    fs.writeFileSync(taskPath,native);
    write('docs/specs/orders/spec.md','AC-001-1: order behavior');write('docs/specs/orders/plan.md','Order design');
    write('.gitignore','.specify/integration.json\n.specify/feature.json\ndocs/specs/*/tasks.md\ndocs/specs/*/.wf-speckit/\n');
    git('init','-q');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','commit','-qm','synthetic adoption');
    const baseline=git('rev-parse','HEAD');
    const args={repo:project,baseline,feature:'docs/specs/orders',task:'T-0001',integration:'codex',python};
    const context=resolveFeatureContext(args);assert.equal(context.environment.SPECIFY_FEATURE_NO_PERSIST,'1');
    assert.match(context.source_digest,/^[a-f0-9]{64}$/);
    assert.equal(activateIntegration({...args,integration:'claude'}).changed,true);
    assert.equal(resolveFeatureContext({...args,integration:'claude'}).environment.SPECIFY_FEATURE_NO_PERSIST,'1');
    activateIntegration(args);
    assert.equal(git('diff','--name-only'),'', 'round-trip activation leaves no tracked shared-file diff');
    taskProjection({...args,write:true});assert.equal(taskProjection(args).ok,true);
    fs.appendFileSync(path.join(project,'docs/specs/orders/tasks.md'),'\nManual edit.');
    assert.deepEqual(taskProjection(args).reasons,['projection_modified']);
    assert.throws(()=>taskProjection({...args,write:true}),/explicitly regenerate/);
    const cli=['--repo',project,'--baseline',baseline,'--feature',args.feature,'--task',args.task,'--integration','codex','--python',python];
    assert.equal(main(['project',...cli]).code,1,'supported blocked projection state');
    assert.equal(main(['unknown']).code,2,'invalid input');
    const recovered=taskProjection({...args,write:true,regenerate:true});
    assert.match(fs.readFileSync(path.join(project,recovered.recovery),'utf8'),/Manual edit/);
    assert.equal(taskProjection(args).ok,true);assert.equal(fs.readFileSync(taskPath,'utf8'),native);
    write('docs/specs/orders/spec.md','AC-001-1: changed requirement');
    assert.deepEqual(taskProjection(args).reasons,['projection_stale']);
    // Proposed profile edits produce only external draft bytes until the
    // synthetic governing change is committed; no real approval is simulated.
    fs.appendFileSync(path.join(project,'docs/workflow/profile.md'),'\nProposed owner delegation.\n');
    assert.throws(()=>resolveFeatureContext(args),/authority pointer is stale/);
    const beforeProposal=git('diff');
    const proposal=proposeAuthority(args);assert.equal(proposal.authority,'proposal-only');assert.equal(proposal.changed,true);
    assert.equal(git('diff'),beforeProposal,'authority proposal does not write project bytes');
    for(const file of proposal.files)write(file.path,file.text);
    assert.throws(()=>resolveFeatureContext(args),/lock must match/);
    git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','commit','-qm','synthetic governing candidate');
    assert.ok(resolveFeatureContext({...args,baseline:git('rev-parse','HEAD')}).source_digest);
    // Exercise the optional scaffold from its exact pin, preserving native entries.
    const scaffold=path.join(temp,'scaffold');fs.mkdirSync(scaffold);
    const adoption=spawnSync(process.execPath,[path.join(root,'bin/wf-adopt'),'--project',scaffold,'--workflow-repo',root,'--rev',ownRevision.stdout.trim(),'--repository','fixture/scaffold','--coordinator','owner','--planning-frontend','speckit','--speckit-python',python,'--json'],{encoding:'utf8',timeout:60000});
    assert.equal(adoption.status,0,adoption.stdout+adoption.stderr);
    assert.equal(JSON.parse(adoption.stdout).planning_frontend.certified,false);
    const scaffoldLock=JSON.parse(fs.readFileSync(path.join(scaffold,'docs/workflow/speckit.lock.json')));
    assert.equal(verifyInstallation({repo:scaffold,lock:scaffoldLock,integration:'codex',python}).ok,true);
    assert.equal(scaffoldLock.authority.profile.sha256,sha256(fs.readFileSync(path.join(scaffold,'docs/workflow/profile.md'))));
    assert.ok(fs.existsSync(path.join(scaffold,'.claude/agents/independent-reviewer.md')));
    assert.match(fs.readFileSync(path.join(scaffold,'AGENTS.md'),'utf8'),/workflow/);
    assert.match(fs.readFileSync(path.join(scaffold,'.gitignore'),'utf8'),/docs\/specs\/\*\/tasks\.md/);
    for(const [name,relative,directory] of [['ignore-directory','.gitignore',true],['cache-file','.cache/agent-workflow',false],['cache-not-git','.cache/agent-workflow',true]]) {
      const incompatible=path.join(temp,name),target=path.join(incompatible,relative);fs.mkdirSync(path.dirname(target),{recursive:true});
      if(directory)fs.mkdirSync(target);else fs.writeFileSync(target,'preserve user content');
      const refused=spawnSync(process.execPath,[path.join(root,'bin/wf-adopt'),'--project',incompatible,'--workflow-repo',root,'--rev',ownRevision.stdout.trim(),'--repository','fixture/scaffold','--coordinator','owner','--planning-frontend','speckit','--speckit-python',python,'--json'],{encoding:'utf8',timeout:60000});
      assert.equal(refused.status,2,refused.stdout+refused.stderr);assert.equal(fs.existsSync(path.join(incompatible,'docs/workflow/config.json')),false);
      if(!directory)assert.equal(fs.readFileSync(target,'utf8'),'preserve user content');
    }

    fs.appendFileSync(path.join(staged.directory, '.claude/skills/speckit-plan/SKILL.md'), '\nTampered inactive entry.');
    const damaged = verifyManagedFiles({ repo: staged.directory, lock: staged.lock, integration: 'codex' });
    assert.equal(damaged.ok, false);
    assert.ok(damaged.mismatches.some(m => m.includes('.claude/skills/speckit-plan/SKILL.md')));
  });
}
