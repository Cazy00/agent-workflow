// `wf attest` (procedures/approval-evidence.md *Attested evidence*): in manual mode the owner's machine, not the agent,
// produces the verification and integration evidence. It checks the candidate out of a verified mirror into a fresh
// directory, runs the setup and checks that the approved baseline's config names (`attest`), each inside the owner's
// sandbox and with a minimal environment, reads the per-test results from the reports the config names, and writes
// unsigned verification and integration payloads for the owner to sign. The candidate already contains the trusted tip,
// so this one run is the assembled candidate's rerun as well. It signs nothing and reads no key.
//
// What it does not prove: the checks are the candidate's own code (its package scripts, test runner and config), so a
// candidate can still report what it likes about itself. Independent review of that code and owner-approved acceptance
// tests (paths.acceptance_tests) carry that risk; attest removes the agent's hand from running and reporting.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitRunner, safeEnv } from './git.js';

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Variables a check may never receive, whatever the config asks: the owner's signing material and the gates' own.
const WITHHELD = /^(OWNER_SIGNING_|WF_|GIT_|SSH_AUTH_SOCK$|GPG_)/;
const REPORT = /^[A-Za-z0-9._-]+$/;
const FORMATS = ['junit', 'node-test'];
const text = v => typeof v === 'string' && v.trim() !== '';

// Throws on a malformed `attest` section; an absent one is valid (the project has not adopted attest).
export function validateAttestConfig(a) {
  if (a === undefined) return;
  const fail = m => { throw new Error(`attest: ${m}`); };
  if (!a || typeof a !== 'object' || Array.isArray(a)) fail('must be an object');
  const known = ['setup', 'checks', 'env', 'timeout_minutes'];
  for (const k of Object.keys(a)) if (!known.includes(k)) fail(`unknown field ${k} (the sandbox is the operator's, given with --sandbox, never the repository's)`);
  if (a.setup !== undefined && (!Array.isArray(a.setup) || a.setup.some(c => !text(c)))) fail('setup must be an array of commands');
  if (!Array.isArray(a.checks) || !a.checks.length) fail('checks must list at least one {name, run}');
  const names = new Set();
  for (const c of a.checks) {
    if (!c || typeof c !== 'object' || !text(c.name) || !text(c.run)) fail('each check needs a name and a run command');
    if (names.has(c.name)) fail(`check ${c.name} is listed twice`);
    names.add(c.name);
    for (const k of Object.keys(c)) if (!['name', 'run', 'report'].includes(k)) fail(`check ${c.name}: unknown field ${k}`);
    if (c.report !== undefined && (!c.report || !FORMATS.includes(c.report.format) || !REPORT.test(c.report.file ?? '') || c.report.file.startsWith('.'))) fail(`check ${c.name}: report must be {format: ${FORMATS.join('|')}, file: a plain file name in $WF_REPORT_DIR}`);
  }
  if (a.env !== undefined && (!Array.isArray(a.env) || a.env.some(n => !NAME.test(n ?? '') || WITHHELD.test(n)))) fail('env must list variable names to pass through; signing, WF_, GIT_, SSH agent and GPG variables are never passed');
  if (a.timeout_minutes !== undefined && (!Number.isInteger(a.timeout_minutes) || a.timeout_minutes < 1 || a.timeout_minutes > 240)) fail('timeout_minutes must be a whole number from 1 to 240');
}

const decode = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e] ?? String.fromCodePoint(e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10)));
const attributes = s => Object.fromEntries([...s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1], decode(m[2] ?? m[3])]));

// JUnit XML as most runners write it (Vitest, Jest with jest-junit, pytest, Go via go-junit-report): one entry per
// <testcase>, its file from the `file` attribute or else `classname`, its name from `name`. A <failure> or <error> is
// failed and <skipped> skipped. Comments and CDATA (captured output) are removed first, so printed XML is not read.
export function readJunit(xml, root) {
  const body = String(xml).replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  if (!/<testsuites?\b/.test(body)) throw new Error('not a JUnit XML report');
  const tests = [];
  // Attributes are matched whole, so a `>` inside a quoted name (Vitest writes "suite > test") does not end the tag.
  for (const m of body.matchAll(/<testcase\b((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const a = attributes(m[1]);
    const inner = m[2] ?? '';
    const file = relativeFile(a.file ?? a.classname ?? '', root);
    if (!file || !text(a.name)) throw new Error('a test case is missing its file or name');
    tests.push({ file, name: a.name, status: /<(failure|error)\b/.test(inner) ? 'failed' : /<skipped\b/.test(inner) ? 'skipped' : 'passed' });
  }
  if (!tests.length) throw new Error('the report lists no test cases');
  return tests;
}
// node:test through the workflow's reporter (validator/reporters/node-test.js): leaf tests, suites left out.
export function readNodeTest(raw, root) {
  const tests = [];
  for (const line of String(raw).split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    if (!['test:pass', 'test:fail'].includes(r.type) || r.data?.details?.type === 'suite') continue;
    const file = relativeFile(r.data?.file ?? '', root);
    if (!file || !text(r.data?.name)) throw new Error('a test result is missing its file or name');
    tests.push({ file, name: r.data.name, status: r.data.skip || r.data.todo ? 'skipped' : r.type === 'test:pass' ? 'passed' : 'failed' });
  }
  if (!tests.length) throw new Error('the report lists no tests');
  return tests;
}
function relativeFile(f, root) {
  const s = String(f).replace(/^file:\/\//, '');
  if (!s) return null;
  const rel = path.isAbsolute(s) ? path.relative(root, s) : s;
  const posix = rel.split(path.sep).join('/').replace(/^\.\//, '');
  return !posix || posix === '..' || posix.startsWith('../') || path.isAbsolute(posix) ? null : posix;
}

// Long logs keep their head and tail; the digest names the whole log.
const LOG_LIMIT = 200 * 1024;
const clip = log => {
  if (Buffer.byteLength(log) <= LOG_LIMIT) return log;
  const digest = createHash('sha256').update(log).digest('hex');
  return `${log.slice(0, LOG_LIMIT / 2)}\n… [${Buffer.byteLength(log) - LOG_LIMIT} bytes left out; the whole log's sha256 is ${digest}] …\n${log.slice(-LOG_LIMIT / 2)}`;
};
const sha256 = data => createHash('sha256').update(data).digest('hex');

// The environment a check gets: the operator's basic settings, the names the approved config passes through, CI=true and
// the report directory. Nothing else, so no signing variable, token or Git setting reaches candidate code.
function checkEnv(names, reportDir) {
  const env = {};
  for (const k of ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TMP', 'TEMP', 'TERM', ...names]) if (process.env[k] !== undefined && !WITHHELD.test(k)) env[k] = process.env[k];
  return Object.assign(env, { CI: 'true', WF_REPORT_DIR: reportDir, WF_NODE_REPORTER: fileURLToPath(new URL('../reporters/node-test.js', import.meta.url)) });
}

// The protected paths must exist and be unreadable from inside the sandbox; otherwise the sandbox protects nothing.
export function probeSandbox({ sandbox, protect, env }) {
  const failures = [];
  for (const p of protect) {
    if (!fs.existsSync(p)) { failures.push(`${p} does not exist, so the probe would prove nothing`); continue; }
    const r = spawnSync(sandbox, ['/bin/sh', '-c', 'if [ -d "$1" ]; then ls -- "$1"; else head -c 1 -- "$1"; fi >/dev/null 2>&1', 'probe', p], { env, timeout: 30000 });
    if (r.status === 0) failures.push(`${p} is readable inside the sandbox`);
    else if (r.error) failures.push(`the sandbox could not run: ${r.error.message}`);
  }
  return failures;
}

export function runAttest({ mirror, baseline, candidate, repository, expiresAt, config, requiredChecks = [], sandbox = null, protect = [], unsandboxed = false, now = Date.now() }) {
  const a = config.attest;
  if (!a) throw new Error('the approved baseline config has no attest section: add one with a workflow change (SCHEMA.md *Attest*)');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || repository !== config.repository) throw new Error('--repository must name the approved project config\'s repository');
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now) throw new Error('--expires-at must be a future ISO time');
  const missing = requiredChecks.filter(n => !a.checks.some(c => c.name === n));
  if (missing.length) throw new Error(`the profile requires ${missing.join(', ')}, which attest.checks does not run`);
  if (!sandbox && !unsandboxed) throw new Error('give --sandbox FILE (a launcher outside every checkout) with --protect for each path it must hide, such as the signing key; or --unsandboxed to accept that candidate code can read everything you can');
  if (sandbox && !protect.length) throw new Error('--sandbox needs at least one --protect PATH to probe, such as the signing key, or the sandbox is untested');

  // The real path, as a test runner reports it (on macOS the temporary directory is reached through a link).
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wf-attest-')));
  const checkout = path.join(work, 'checkout');
  const reportDir = path.join(work, 'reports');
  fs.mkdirSync(reportDir);
  const started = new Date().toISOString();
  try {
    const env = checkEnv(a.env ?? [], reportDir);
    const sandboxDigest = sandbox ? sha256(fs.readFileSync(sandbox)) : null;
    if (sandbox) {
      const failures = probeSandbox({ sandbox, protect, env });
      if (failures.length) throw new Error(`the sandbox does not hide what it must: ${failures.join('; ')}`);
    }
    const inMirror = gitRunner(mirror);
    const resolve = rev => { const r = inMirror('rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`); if (r.status !== 0) throw new Error(`${String(rev).slice(0, 12)} is not on any branch or tag of the repository, so the verified mirror does not hold it`); return r.stdout.trim(); };
    const base = resolve(baseline), cand = resolve(candidate);
    if (inMirror('merge-base', '--is-ancestor', base, cand).status !== 0) throw new Error('the candidate must contain the approved baseline (the trusted tip): attest checks the assembled candidate');
    const cloneEnv = safeEnv(checkout, { protocols: 'file' });
    delete cloneEnv.GIT_WORK_TREE; // the clone makes its own work tree
    const clone = spawnSync('git', ['clone', '--quiet', '--no-checkout', '--no-hardlinks', '--', mirror, checkout], { encoding: 'utf8', env: cloneEnv, timeout: 600000 });
    if (clone.status !== 0) throw new Error(`git clone failed: ${(clone.stderr ?? '').trim()}`);
    const co = gitRunner(checkout)('checkout', '--quiet', '--detach', cand);
    if (co.status !== 0) throw new Error(`git checkout failed: ${co.stderr.trim()}`);
    // The acceptance map as committed, read before any candidate code runs.
    let mapped = [];
    try { const v = JSON.parse(fs.readFileSync(path.join(checkout, 'tests/acceptance-map.json'), 'utf8')); if (Array.isArray(v)) mapped = v; } catch { /* no map: nothing mapped */ }

    const timeout = (a.timeout_minutes ?? 30) * 60000;
    const run = command => {
      const argv = [...(sandbox ? [sandbox] : []), '/bin/sh', '-c', `exec 2>&1\n${command}`];
      const r = spawnSync(argv[0], argv.slice(1), { cwd: checkout, env, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 });
      const log = `$ ${command}\n${r.stdout ?? ''}${r.error ? `\n[wf attest: ${r.error.code === 'ETIMEDOUT' ? `stopped after ${a.timeout_minutes ?? 30} minutes` : r.error.message}]` : ''}\n[exit ${r.status ?? r.signal}]\n`;
      return { ok: r.status === 0 && !r.error, log };
    };
    const artifacts = {};
    let setupLog = '';
    for (const command of a.setup ?? []) {
      const r = run(command);
      setupLog += r.log;
      if (!r.ok) {
        artifacts['setup.log'] = clip(setupLog);
        return { ok: false, setupFailed: true, artifacts, summary: `setup failed: ${command}` };
      }
    }
    if (setupLog) artifacts['setup.log'] = clip(setupLog);
    const checks = [];
    const tests = [];
    const notes = [];
    for (const c of a.checks) {
      const r = run(c.run);
      const evidence = `${c.name.replace(/[^A-Za-z0-9._-]+/g, '-')}.log`;
      artifacts[evidence] = clip(r.log);
      let ok = r.ok;
      if (c.report) {
        const file = path.join(reportDir, c.report.file);
        try {
          const raw = fs.readFileSync(file, 'utf8');
          const found = c.report.format === 'junit' ? readJunit(raw, checkout) : readNodeTest(raw, checkout);
          tests.push(...found);
          artifacts[`${c.name.replace(/[^A-Za-z0-9._-]+/g, '-')}.${c.report.format === 'junit' ? 'xml' : 'ndjson'}`] = clip(raw);
          if (found.some(t => t.status === 'failed')) ok = false;
        } catch (e) { ok = false; notes.push(`${c.name}: its report ${c.report.file} could not be read (${e.message})`); }
      }
      checks.push({ name: c.name, result: ok ? 'passed' : 'failed', evidence });
    }
    for (const m of mapped) {
      const runs = tests.filter(t => t.file === m?.file && t.name === m?.name);
      if (runs.length !== 1 || runs[0].status !== 'passed') notes.push(`mapped test ${m?.file} / ${m?.name} (${m?.acceptance}) ran ${runs.length} time(s)${runs.length === 1 ? `, ${runs[0].status}` : ''}; it must run once and pass`);
    }
    const gitVersion = (spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout ?? '').trim();
    const environment = `${os.type()} ${os.release()} ${os.arch()}; Node ${process.version}; ${gitVersion}; wf attest: a fresh checkout of ${cand} from a verified mirror, run by the operator; ${sandbox ? `sandbox ${path.basename(sandbox)} (sha256 ${sandboxDigest.slice(0, 12)}) hiding ${protect.length} path(s)` : 'UNSANDBOXED: candidate code could read everything the operator can'}`;
    const attested = { tool: 'wf attest', baseline: base, sandbox: sandbox ? { launcher: path.basename(sandbox), sha256: sandboxDigest, protected: protect.length } : null, setup: a.setup ?? [], started_at: started, finished_at: new Date().toISOString() };
    const common = { repository, revision: cand, expires_at: new Date(Date.parse(expiresAt)).toISOString(), environment, checks, artifacts };
    const payloads = [
      { purpose: 'verification', ...common, execution: { revision: cand, tests }, attested },
      { purpose: 'integration', ...common, attested },
    ];
    return { ok: checks.every(c => c.result === 'passed') && !notes.length, payloads, checks, tests, notes, sandboxed: !!sandbox };
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* candidate code may leave files it protected; the operating system's temporary directory clears them */ }
  }
}
