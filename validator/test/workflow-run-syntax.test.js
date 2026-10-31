import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseYaml } from '../lib/ci-lint.js';

// v2.15.1: v2.14.0 put an ASCII apostrophe into the single-quoted `node -e '…'` script of the "Run the gate" step of
// templates/github/wf-ci.yml; it closed the quote and the step failed with a shell syntax error on every pull request. Every `run:`
// script of the templates and of the repository's own workflows must parse as bash once each `${{ … }}` is a word, and the body of
// each `node -e '…'` in it must hold no ASCII apostrophe (two of them re-balance the shell quoting) and pass `node --check`.
// A step whose effective shell is not bash or sh (`shell:` on the step, the job's or the workflow's `defaults.run.shell`) is skipped.
const dirs = ['../../templates/github/', '../../.github/workflows/'].map(d => new URL(d, import.meta.url));
const files = dirs.flatMap(d => readdirSync(d).filter(f => /\.ya?ml$/.test(f)).map(f => ({ name: d.pathname.split('/').slice(-3, -1).join('/') + '/' + f, url: new URL(f, d) })));

// The `run:` scripts that bash reads, as { where, script }.
function bashScripts(text) {
  const workflow = parseYaml(text);
  const out = [];
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    for (const [i, step] of (job.steps ?? []).entries()) {
      if (typeof step.run !== 'string') continue;
      const shell = String(step.shell ?? job.defaults?.run?.shell ?? workflow.defaults?.run?.shell ?? 'bash').trim().split(/\s+/)[0];
      if (!['bash', 'sh'].includes(shell)) continue;
      out.push({ where: `${jobName} step ${i + 1} (${step.name ?? step.run.split('\n')[0]})`, script: step.run.replace(/\$\{\{[\s\S]*?\}\}/g, 'PLACEHOLDER') });
    }
  }
  return out;
}

// What is wrong with the bash scripts of a workflow, one line each.
function problems(text) {
  const found = [];
  for (const { where, script } of bashScripts(text)) {
    const r = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
    if (r.status !== 0) found.push(`${where}: ${r.stderr.trim()}`);
    // A body ends at the first quote followed by white space, `)` or the end; an apostrophe inside a word never does.
    for (const m of script.matchAll(/node -e '([\s\S]*?)'(?=\s|\)|$)/g)) {
      if (m[1].includes("'")) { found.push(`${where}: an ASCII apostrophe inside node -e '…'`); continue; }
      const c = spawnSync('node', ['--check', '-'], { input: m[1], encoding: 'utf8' });
      if (c.status !== 0) found.push(`${where}: node -e body does not parse: ${c.stderr.trim().split('\n').slice(0, 4).join(' | ')}`);
    }
  }
  return found;
}

test('there are workflow files to check', () => {
  assert.ok(files.length >= 6, files.map(f => f.name).join(', '));
});

for (const f of files) {
  test(`every run: script of ${f.name} is valid bash`, () => {
    const text = readFileSync(f.url, 'utf8');
    assert.ok(bashScripts(text).length > 0, 'no bash run: step found, so nothing was checked');
    assert.deepEqual(problems(text), []);
  });
}

test('the reader returns the whole "Run the gate" script of wf-ci.yml', () => {
  const gate = bashScripts(readFileSync(new URL('../../templates/github/wf-ci.yml', import.meta.url), 'utf8')).find(s => s.where.includes('Run the gate'));
  assert.ok(gate?.script.includes('Records only'), 'the script is truncated or missing');
  assert.ok(gate.script.trimEnd().endsWith('fi'), 'the script is truncated at the end');
});

const wrap = (run, extra = '') => `name: t\non: push\n${extra}jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - name: s\n        run: |\n${run.split('\n').map(l => '          ' + l).join('\n')}\n`;

test('the v2.15.0 line (one ASCII apostrophe in node -e) is caught', () => {
  const text = wrap(`node -e '\nconst lines = [];\nlines.push("**Records only:** a project's own CI may skip its product jobs");\n' "$F" || true`);
  assert.notEqual(spawnSync('bash', ['-n'], { input: bashScripts(text)[0].script }).status, 0);
  assert.ok(problems(text).length > 0);
});

test('two ASCII apostrophes, which bash -n accepts, are caught', () => {
  const text = wrap(`node -e '\n// it's here\n// that's all\n' || true`);
  assert.equal(spawnSync('bash', ['-n'], { input: bashScripts(text)[0].script }).status, 0);
  assert.ok(problems(text).some(p => p.includes('apostrophe')));
});

test('a node -e body that does not parse is caught', () => {
  assert.ok(problems(wrap(`node -e '\nconst = ;\n' || true`)).some(p => p.includes('does not parse')));
  assert.deepEqual(problems(wrap(`node -e '\nconsole.log(1);\n' || true`)), []);
});

test('a step whose effective shell is not bash or sh is skipped', () => {
  const python = 'import sys\nprint("it\'s", file=sys.stderr)\nif True:\n  print(1)';
  assert.deepEqual(problems(wrap(python).replace('        run: |', '        shell: python\n        run: |')), []);
  assert.deepEqual(problems(wrap(python, 'defaults:\n  run:\n    shell: pwsh\n')), []);
  assert.deepEqual(problems(wrap(python).replace('    runs-on: ubuntu-latest', '    runs-on: ubuntu-latest\n    defaults:\n      run:\n        shell: python')), []);
  assert.ok(problems(wrap(python)).length > 0, 'the same script as bash is not valid');
});
