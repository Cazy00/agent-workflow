import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// `bin/wf-adopt --inspect` is read-only diagnostics before adoption. These tests use this checkout as the
// workflow source, so they need a Git checkout and skip without one.
const root = fileURLToPath(new URL('../..', import.meta.url));
const script = path.join(root, 'bin/wf-adopt');
const hasGit = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD']).status === 0;
const ID = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid'];

function tmp(t, prefix = 'wf-inspect-') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const git = (dir, ...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
const put = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
function commit(dir) { git(dir, 'add', '-A'); git(dir, ...ID, 'commit', '-qm', 'fixture', '--no-verify'); }
const inspect = (dir, ...extra) => spawnSync(process.execPath, [script, '--inspect', '--project', dir, '--workflow-repo', root, ...extra], { encoding: 'utf8', timeout: 60000 });
const report = (dir, ...extra) => { const r = inspect(dir, '--json', ...extra); assert.equal(r.status, 0, r.stdout + r.stderr); return { r, data: JSON.parse(r.stdout) }; };

// Every entry under the directory, including .git: type, size, mtime, content hash or link target.
function snapshot(dir) {
  const out = {};
  const walk = rel => {
    const abs = path.join(dir, rel);
    const st = fs.lstatSync(abs);
    const entry = { mode: st.mode, size: st.size, mtime: st.mtimeMs };
    if (st.isSymbolicLink()) entry.link = fs.readlinkSync(abs);
    else if (st.isFile()) entry.sha = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    out[rel || '.'] = entry;
    if (st.isDirectory()) for (const name of fs.readdirSync(abs).sort()) walk(path.join(rel, name));
  };
  walk('');
  return out;
}

test('inspection of a hostile repository executes nothing, reads no secret and changes nothing', { skip: !hasGit && 'not a Git checkout' }, t => {
  const dir = tmp(t), outside = tmp(t, 'wf-outside-'), markers = tmp(t, 'wf-markers-');
  git(dir, 'init', '-q', '-b', 'main');
  const marker = name => path.join(markers, name);
  put(outside, 'secret.json', '{"scripts":{"leak":"OUTSIDE-SECRET-VALUE"}}');
  put(dir, 'package.json', JSON.stringify({ scripts: { test: `node -e "require('fs').writeFileSync('${marker('script')}','x')"`, postinstall: `touch ${marker('postinstall')}`, 'evil\u001b[31m': '\u001b]0;title\u0007' } }));
  put(dir, 'packages/app/package.json', JSON.stringify({ scripts: { lint: 'eslint .' } }));
  put(dir, 'services/api/go.mod', 'module example.com/api\n');
  put(dir, '.env', 'API_TOKEN=DOTENV-SECRET-VALUE\n');
  put(dir, 'config/secrets.json', '{"scripts":{"x":"CONFIG-SECRET-VALUE"}}');
  put(dir, '.github/workflows/ci.yml', `name: ci\non: push\njobs:\n  build:\n    name: "Build \u001b[2J"\n    runs-on: ubuntu-latest\n    steps:\n      - run: touch ${marker('workflow')}\n  lint:\n    runs-on: ubuntu-latest\n`);
  put(dir, `evil\n\u001b[31mname.dart`, 'void main() {}\n');
  put(dir, 'lib/main.dart', 'void main() {}\n');
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.symlinkSync(path.join(outside, 'secret.json'), path.join(dir, 'tools/package.json'));
  fs.symlinkSync(outside, path.join(dir, 'linked'));
  put(dir, '.gitattributes', '*.dart filter=evil\n');
  commit(dir);
  // Filter drivers and an fsmonitor hook that would record their execution; a modified file invites the filter.
  git(dir, 'config', 'filter.evil.clean', `sh -c 'touch ${marker('filter')}; cat'`);
  git(dir, 'config', 'filter.evil.smudge', `sh -c 'touch ${marker('smudge')}; cat'`);
  put(markers, 'fsmonitor.sh', `#!/bin/sh\ntouch ${marker('fsmonitor')}\n`);
  fs.chmodSync(path.join(markers, 'fsmonitor.sh'), 0o755);
  git(dir, 'config', 'core.fsmonitor', path.join(markers, 'fsmonitor.sh'));
  fs.appendFileSync(path.join(dir, 'lib/main.dart'), '// edit\n');
  const before = snapshot(dir);

  const { r, data } = report(dir);
  const text = inspect(dir);
  assert.equal(text.status, 0, text.stderr);
  assert.deepEqual(snapshot(dir), before, 'no file, mtime, index or Git metadata changed');
  assert.ok(!fs.existsSync(path.join(dir, '.cache')));
  for (const m of ['script', 'postinstall', 'workflow', 'filter', 'smudge', 'fsmonitor']) assert.ok(!fs.existsSync(marker(m)), `${m} was executed`);
  for (const secret of ['OUTSIDE-SECRET-VALUE', 'DOTENV-SECRET-VALUE', 'CONFIG-SECRET-VALUE']) {
    assert.ok(!r.stdout.includes(secret) && !text.stdout.includes(secret), `${secret} was read`);
  }
  assert.doesNotMatch(r.stdout + text.stdout, /[\u0000-\u0008\u000b-\u001f\u007f]/, 'no raw control characters reach the output');
  assert.equal(data.authority, 'none');
  assert.equal(data.git.dirty, null, 'the working-tree comparison is skipped when filters are configured');
  assert.ok(data.warnings.some(w => /filter drivers/.test(w)));
  const tools = data.manifests.find(m => m.path === 'tools/package.json');
  assert.match(tools.skipped, /symbolic link/);
  assert.deepEqual(data.stack, ['go', 'node']);
  assert.ok(data.manifests.some(m => m.path === 'packages/app/package.json' && m.scripts[0].name === 'lint'), 'nested manifests are found');
  assert.ok(data.manifests.find(m => m.path === 'package.json').scripts.some(s => s.name.includes('\\u001b')), 'hostile names are escaped');
  assert.ok(data.suggested_required_checks.length && data.suggested_required_checks.every(s => s.verified === false));
  assert.ok(data.suggested_required_checks.some(s => s.name === 'Build \\u001b[2J'));
  assert.ok(data.suggested_required_checks.some(s => s.name === 'lint' && /job lint/.test(s.source)));
  assert.ok(data.suggested_production.some(s => s.glob === '**/*.dart' && s.covers === 2), 'the hostile file name is classified, not executed');
  assert.ok(data.suggested_production.some(s => s.glob === '**/go.mod'));
  assert.equal(data.adoption, null);
  assert.match(data.next, /^bin\/wf-adopt --project '/);
});

test('inspection reports a non-Git directory, a shallow clone and origin default branch without network or writes', { skip: !hasGit && 'not a Git checkout' }, t => {
  const plain = tmp(t);
  put(plain, 'package.json', '{"scripts":{"test":"x"}}');
  const before = snapshot(plain);
  const { data } = report(plain);
  assert.equal(data.git.repository, false);
  assert.ok(data.warnings.some(w => /not a Git working tree/.test(w)));
  assert.equal(data.classification, null, 'nothing is claimed about tracked paths');
  assert.deepEqual(snapshot(plain), before);

  const origin = tmp(t);
  git(origin, 'init', '-q', '-b', 'trunk');
  put(origin, 'src/a.ts', 'export {};\n'); commit(origin);
  put(origin, 'src/b.ts', 'export {};\n'); commit(origin);
  const parent = tmp(t);
  const clone = path.join(parent, 'clone');
  assert.equal(spawnSync('git', ['clone', '-q', '--depth', '1', `file://${origin}`, clone]).status, 0);
  const shallow = report(clone).data;
  assert.equal(shallow.git.shallow, true);
  assert.ok(shallow.warnings.some(w => /shallow clone/.test(w)));
  assert.equal(shallow.git.remote_default, 'trunk');
  assert.ok(shallow.warnings.some(w => /default branch is trunk, not main/.test(w)));
  assert.equal(shallow.git.dirty, false);
});

test('inspection of an adopted repository reports the adoption and collisions and leaves it untouched', { skip: !hasGit && 'not a Git checkout' }, t => {
  const dir = tmp(t);
  git(dir, 'init', '-q', '-b', 'main');
  put(dir, 'AGENTS.md', 'existing guide\n');
  put(dir, '.github/CODEOWNERS', '* @someone\n');
  const adopted = spawnSync(process.execPath, [script, '--project', dir, '--workflow-repo', root, '--rev', 'HEAD', '--repository', 'fixture/project', '--coordinator', 'owner'], { encoding: 'utf8' });
  assert.equal(adopted.status, 0, adopted.stdout + adopted.stderr);
  commit(dir);
  const before = snapshot(dir);
  const { data } = report(dir);
  assert.deepEqual(snapshot(dir), before);
  assert.equal(data.adoption.repository, 'fixture/project');
  assert.equal(data.adoption.approval_label, 'owner-merge', 'one owner adopts with owner-merge by default (MAINT-0010)');
  assert.match(data.adoption.workflow.revision, /^[0-9a-f]{40}$/);
  assert.ok(data.warnings.some(w => /already adopted/.test(w)));
  assert.equal(data.next, null);
  assert.ok(data.collisions.some(c => c.path === 'docs/workflow/config.json' && /refused/.test(c.effect)));
  assert.ok(data.collisions.some(c => c.path === 'AGENTS.md'));
  assert.ok(data.ownership.some(c => c.path === '.github/CODEOWNERS'));
  assert.deepEqual(data.classification.remaining_sample, [], 'every scaffold path, including the reviewer adapter, is classified');
});

test('suggestions never reclassify a classified or governing path, and adoption accepts them', { skip: !hasGit && 'not a Git checkout' }, t => {
  const dir = tmp(t);
  git(dir, 'init', '-q', '-b', 'main');
  put(dir, 'lib/main.dart', 'void main() {}\n');
  put(dir, 'pubspec.yaml', 'name: app\n');
  put(dir, 'requirements-dev.txt', 'pytest\n');
  put(dir, 'web/index.html', '<p>app</p>\n');
  put(dir, 'docs/site/page.html', '<p>docs</p>\n');
  put(dir, 'notes.xyz', 'unknown\n');
  commit(dir);
  const { data } = report(dir);
  const globs = data.suggested_production.map(s => s.glob);
  assert.deepEqual(globs.sort(), ['**/*.dart', '**/pubspec.yaml', '**/requirements*.txt']);
  assert.ok(data.warnings.some(w => /not suggesting \*\*\/\*\.html: it would reclassify docs\/site\/page\.html/.test(w)));
  assert.equal(data.classification.unclassified, 5);
  assert.equal(data.classification.unclassified_after_suggestions, 2);
  assert.deepEqual(data.classification.remaining_sample.sort(), ['notes.xyz', 'web/index.html']);
  assert.deepEqual(report(dir, ...globs.flatMap(g => ['--production', g])).data.suggested_production, [], 'given globs are part of the classification');
  const adopted = spawnSync(process.execPath, [script, '--project', dir, '--workflow-repo', root, '--rev', 'HEAD', '--repository', 'fixture/project', '--coordinator', 'owner', '--lane', 'existing', ...globs.flatMap(g => ['--production', g]), '--json'], { encoding: 'utf8' });
  assert.equal(adopted.status, 0, adopted.stdout + adopted.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'docs/workflow/config.json'), 'utf8'));
  for (const g of globs) assert.ok(config.paths.production.includes(g));
});

test('inspection bounds its output and refuses adoption-only options, a missing project or an unresolvable pin', { skip: !hasGit && 'not a Git checkout' }, t => {
  const dir = tmp(t);
  git(dir, 'init', '-q', '-b', 'main');
  for (let i = 0; i < 60; i++) put(dir, `pkg${String(i).padStart(2, '0')}/package.json`, JSON.stringify({ scripts: { test: 'y'.repeat(5000), ...Object.fromEntries(Array.from({ length: 50 }, (_, j) => [`s${j}`, 'x'.repeat(500)])) } }));
  commit(dir);
  const { data } = report(dir);
  assert.equal(data.manifests.length, 40);
  assert.equal(data.manifests_truncated, 20);
  assert.equal(data.manifests[0].scripts.length, 30);
  assert.equal(data.manifests[0].scripts_truncated, 21);
  assert.equal(data.manifests[0].scripts[0].command, undefined, 'script bodies are never reported, even for checks');
  assert.equal(data.manifests[0].scripts[1].command, undefined, 'other commands are not reported');
  const { r } = report(dir);
  assert.ok(r.stdout.length < 200000, `bounded output, got ${r.stdout.length} bytes`);
  assert.ok(data.classification.unclassified_sample.length <= 20);

  const before = snapshot(dir);
  for (const extra of [['--repository', 'fixture/project'], ['--coordinator', 'owner'], ['--owner', 'a', '--owner', 'b'], ['--lane', 'existing'], ['--rev', 'no-such-ref']]) {
    const r = inspect(dir, ...extra);
    assert.equal(r.status, 2, `${extra.join(' ')}: ${r.stdout}${r.stderr}`);
  }
  assert.equal(spawnSync(process.execPath, [script, '--inspect', '--workflow-repo', root], { encoding: 'utf8' }).status, 2, '--project is required');
  assert.equal(inspect(path.join(dir, 'missing')).status, 2);
  assert.deepEqual(snapshot(dir), before);
  const normal = spawnSync(process.execPath, [script, '--project', dir, '--workflow-repo', root, '--rev', 'HEAD'], { encoding: 'utf8' });
  assert.equal(normal.status, 2, 'adoption still requires its options');
  assert.match(normal.stderr, /--repository is required/);
});
