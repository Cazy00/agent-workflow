import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Rules move between procedures when one is restructured (IDEA-16); a pointer left behind sends a
// session to a file or section that no longer holds the rule. Every `procedures/NAME.md` named in the
// shared corpus or the scaffold, every bare `NAME.md` a procedure names, and every *Section* named
// right after one of them must exist.
const root = fileURLToPath(new URL('../..', import.meta.url));
const procedures = path.join(root, 'procedures');
const corpus = ['AGENTS.md', 'README.md', 'QUICKSTART.md', 'SCHEMA.md', '.agents/skills/workflow/SKILL.md', 'bin/wf-adopt',
  'templates/claude/agents/independent-reviewer.md',
  ...fs.readdirSync(path.join(root, 'templates')).filter(f => f.endsWith('.md')).map(f => `templates/${f}`),
  ...fs.readdirSync(procedures).map(f => `procedures/${f}`)];
const headings = file => new Set([...fs.readFileSync(path.join(procedures, file), 'utf8').matchAll(/^#+ (.+)$/gm)].map(m => m[1].trim()));

// Returns every dangling reference as "file: target".
export function danglingProcedureLinks() {
  const out = [];
  for (const rel of corpus) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    const inProcedure = rel.startsWith('procedures/');
    const refs = /(?<![\w/.-])(procedures\/)?([a-z][a-z-]*\.md)\\?`(?:,\s*\*([^*]+)\*|\s*\(\*([^*]+)\*\))?/g;
    for (const m of text.matchAll(refs)) {
      if (!m[1] && !inProcedure) continue;
      const file = m[2];
      if (!m[1] && !fs.existsSync(path.join(procedures, file))) {
        if (!fs.existsSync(path.join(root, file))) out.push(`${rel}: ${file}`);
        continue;
      }
      if (!fs.existsSync(path.join(procedures, file))) { out.push(`${rel}: procedures/${file}`); continue; }
      const section = m[3] ?? m[4];
      if (section && !headings(file).has(section)) out.push(`${rel}: ${file}, *${section}*`);
    }
  }
  return out;
}

test('procedure pointers and the sections they name exist', () => {
  assert.deepEqual(danglingProcedureLinks(), []);
});
