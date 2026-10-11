import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseFrontMatter } from '../lib/index.js';

// MAINT-0016: the agents a scaffold installs for Claude Code. The trial walker walks the owner's trial in a browser
// before the owner does and changes nothing; the reviewer is told its level and to review what the change can break.
const read = rel => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test('the trial walker is a fresh-context agent that walks every step as a person would and changes no tracked file', () => {
  const text = read('templates/claude/agents/trial-walker.md');
  assert.equal(parseFrontMatter(text).data.name, 'trial-walker');
  assert.match(text, /never modify a tracked file/i);
  assert.match(text, /Do not call the app's API or change its database to make a step pass/);
  assert.match(text, /an unavailable walkthrough is a blocker, not a pass/);
});

test('the independent reviewer is told its level and to review what the change can break', () => {
  const text = read('templates/claude/agents/independent-reviewer.md');
  assert.match(text, /`light`[\s\S]*`standard`[\s\S]*`deep`/);
  assert.match(text, /review the change and what it can break/);
});

test('a new scaffold asks for acceptance evidence, and the task template lists accepted findings', () => {
  assert.equal(JSON.parse(read('config.default.json')).acceptance_evidence, true);
  assert.match(read('templates/task.md'), /^accepted_findings: \[\]$/m);
  assert.match(read('templates/delivery-evidence.json'), /"level": /);
});
