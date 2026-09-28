import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../integrations/speckit/',import.meta.url));
test('planning prompts compose upstream while replacing its authority, selector and handoff behavior',()=>{
 const manifest=JSON.parse(fs.readFileSync(root+'preset/preset.yml'));
 for(const command of ['specify','clarify','plan']) {
  const entry=manifest.provides.templates.find(e=>e.name===`speckit.${command}`),text=fs.readFileSync(root+'preset/'+entry.file,'utf8');
  assert.equal(entry.strategy,'wrap');assert.match(text,/strategy: wrap/);assert.match(text,/handoffs: \[\]/);
  assert.equal(text.split('{CORE_TEMPLATE}').length,2);
  assert.match(text,/Four reserved unknowns mean four retained decisions/);
  assert.match(text,/never create it, even if the embedded prompt explicitly asks/);
 }
});
test('execution and task entries replace upstream execution and retain native gates',()=>{
 for(const command of ['tasks','implement','constitution']) {
  const text=fs.readFileSync(root+`preset/commands/speckit.${command}.md`,'utf8');
  assert.doesNotMatch(text,/\{CORE_TEMPLATE\}|send: true/);assert.match(text,/handoffs: \[\]/);
 }
 const tasks=fs.readFileSync(root+'preset/commands/speckit.tasks.md','utf8');
 assert.match(tasks,/Required tests and independent review are never optional/);
 const implement=fs.readFileSync(root+'preset/commands/speckit.implement.md','utf8');
 assert.match(implement,/Require one explicit T-NNNN/);assert.match(implement,/never tick generated tasks\.md/);
 const prepare=fs.readFileSync(root+'extension/commands/speckit.agent-workflow.prepare.md','utf8');
 assert.match(prepare,/--integration __AGENT__/);assert.match(prepare,/check-projection/);
});
