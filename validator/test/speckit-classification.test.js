import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyPaths } from '../lib/paths.js';
import { loadConfig } from '../lib/records.js';
import { dirSource } from '../lib/sources.js';
import { evaluateCi } from '../lib/ci.js';

const defaults = JSON.parse(fs.readFileSync(new URL('../../config.default.json', import.meta.url)));
const optIn = { name: 'speckit', compatibility_api: 1, feature_root: 'docs/specs' };
const enabled = () => ({ ...structuredClone(defaults), planning_frontend: { ...optIn } });
const category = (config, file) => classifyPaths(config, [file])[0].category;

test('Spec Kit opt-in protects instruction sources, locks and their generators', () => {
  for (const file of [
    '.specify/memory/constitution.md', '.specify/templates/spec-template.md',
    '.specify/scripts/python/common.py', '.specify/presets/registry.json',
    '.specify/extensions/agent-workflow/extension.yml', '.specify/overrides/plan.md',
    '.agents/skills/speckit-plan/SKILL.md', '.claude/skills/speckit-plan/SKILL.md',
    '.claude/settings.json', '.codex/config.toml', 'docs/workflow/speckit.lock.json',
    'integrations/speckit/preset/commands/speckit.plan.md',
    'integrations/speckit/python-requirements.lock', 'adapters/speckit.mjs', '.gitignore',
  ]) assert.equal(category(enabled(), file), 'enforcement', file);
});

test('canonical specs stay governing and executable contracts retain production precedence', () => {
  for (const suffix of ['spec.md', 'plan.md', 'data-model.md', 'contracts/order.json', 'contracts/order.yaml'])
    assert.equal(category(enabled(), `docs/specs/orders/${suffix}`), 'governing', suffix);
  for (const suffix of ['py', 'js', 'sh'])
    assert.equal(category(enabled(), `docs/specs/orders/contracts/validator.${suffix}`), 'production');
  assert.equal(category(enabled(), 'specs/orders/spec.md'), 'unclassified');
  assert.equal(category(enabled(), 'AGENTS.md'), 'governing');
  assert.equal(category(enabled(), 'CLAUDE.md'), 'governing');
  const noConfiguredGoverning = enabled(); noConfiguredGoverning.paths.governing = [];
  assert.equal(category(noConfiguredGoverning, 'docs/specs/orders/spec.md'), 'governing');
});

test('absent or null planning frontend preserves legacy classification', () => {
  const legacy = structuredClone(defaults); delete legacy.planning_frontend;
  const files = ['.claude/settings.json', '.specify/templates/spec.md', '.gitignore', 'src/a.js', 'docs/specs/a.md'];
  assert.deepEqual(classifyPaths({ ...legacy, planning_frontend: null }, files), classifyPaths(legacy, files));
  assert.equal(category(legacy, '.gitignore'), 'planning');
  assert.equal(category(legacy, '.specify/templates/spec.md'), 'unclassified');
});

test('invalid frontend settings fail closed, including unreviewed imported roots', () => {
  for (const planning_frontend of [false, [], 'speckit', {}, { ...optIn, name: 'other' },
    { ...optIn, compatibility_api: 2 }, { ...optIn, feature_root: 'specs' },
    { ...optIn, allowed_overrides: ['anything'] }]) {
    const config = { ...defaults, planning_frontend };
    assert.throws(() => loadConfig({ name: 'fixture', read: () => JSON.stringify(config) }), /planning_frontend/);
    assert.throws(() => classifyPaths(config, ['src/a.js']), /planning_frontend/);
  }
});

test('candidate configuration cannot turn off baseline Spec Kit protection', () => {
  const original = dirSource(new URL('../../fixtures/04a-accepted-decision-permits/baseline', import.meta.url).pathname);
  const config = JSON.parse(original.read('docs/workflow/config.json'));
  const baseline = { ...original, read: p => p === 'docs/workflow/config.json'
    ? JSON.stringify({ ...config, planning_frontend: optIn }) : original.read(p) };
  const result = evaluateCi({ baseline, candidate: original, changed: ['.claude/skills/speckit-plan/SKILL.md'] });
  assert.equal(result.classes[0].category, 'enforcement');
  assert.equal(result.verdict, 'fail');
  assert.match(result.findings.join('\n'), /workflow-change approval/);
  const unknown = evaluateCi({ baseline, candidate: original, changed: ['specs/orders/spec.md'] });
  assert.equal(unknown.verdict, 'fail');
  assert.match(unknown.findings.join('\n'), /unclassified/i);
});

import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitSource } from '../lib/sources.js';
test('adapter CI rejects tracked projections and runtime artifacts even outside the current diff', t => {
  const repo=fs.mkdtempSync(path.join(os.tmpdir(),'wf-speckit-tracked-'));t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));
  fs.cpSync(fileURLToPath(new URL('../../fixtures/04a-accepted-decision-permits/baseline',import.meta.url)),repo,{recursive:true});
  const cp=path.join(repo,'docs/workflow/config.json');fs.writeFileSync(cp,JSON.stringify({...JSON.parse(fs.readFileSync(cp)),planning_frontend:optIn}));
  const forbidden=['docs/specs/orders/tasks.md','docs/specs/orders/research.md','docs/specs/orders/analysis.md','docs/specs/orders/checklists/requirements.md','docs/specs/orders/.wf-speckit/recovery/a.md','.specify/feature.json','.specify/integration.json'];
  for(const p of forbidden){fs.mkdirSync(path.dirname(path.join(repo,p)),{recursive:true});fs.writeFileSync(path.join(repo,p),'temporary');}
  for(const args of [['init','-q'],['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','commit','-qm','fixture']])assert.equal(spawnSync('git',['-C',repo,...args]).status,0);
  const source=gitSource(repo,'HEAD'),result=evaluateCi({baseline:source,candidate:source,changed:[]});
  assert.equal(result.verdict,'fail');
  for(const p of forbidden)assert.ok(result.findings.some(f=>f.includes(`must not be tracked: ${p}`)),p);
});
