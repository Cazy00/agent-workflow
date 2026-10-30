// MAINT-0025 (v2.14.0): what `wf doctor` warns about in a project's own GitHub Actions workflows, each a way CI waits for no reason
// (procedures/delivery.md, "Faster CI"). Warnings only: they never fail `wf doctor` and no gate reads them. The workflow files are
// parsed with a small reader for the YAML GitHub's own examples use (block maps and lists, flow lists of scalars, block scalars,
// quoted strings); a file it cannot read is skipped, never guessed at. The installed `wf-*.yml` files are the workflow's own and
// already follow every rule here.

const strip = line => {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
};
const unquote = s => (/^"(.*)"$/s.test(s) || /^'(.*)'$/s.test(s)) ? s.slice(1, -1) : s;
function scalar(s) {
  s = s.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^\[.*\]$/s.test(s)) return s.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean).map(x => unquote(x));
  if (/^\{.*\}$/s.test(s)) return s;
  return unquote(s);
}
const keyOf = text => {
  const m = /^("[^"]*"|'[^']*'|[^\s'"#][^:]*?)\s*:(?:\s+(.*)|)$/s.exec(text);
  return m ? { key: unquote(m[1]), rest: m[2] ?? '' } : null;
};

export function parseYaml(source) {
  const raw = String(source).replace(/\r/g, '').split('\n').map(l => l.replace(/\t/g, '  '));
  let i = 0;
  const indentOf = l => l.length - l.trimStart().length;
  const skip = () => { while (i < raw.length && strip(raw[i]).trim() === '') i++; };
  function block(parent, header) {
    const out = [];
    while (i < raw.length) {
      if (raw[i].trim() !== '' && indentOf(raw[i]) <= parent) break;
      out.push(raw[i++]);
    }
    const inner = out.filter(l => l.trim() !== '');
    const base = inner.length ? Math.min(...inner.map(indentOf)) : 0;
    const text = out.map(l => l.slice(Math.min(base, indentOf(l)))).join('\n');
    return header.startsWith('|') ? text.replace(/\n+$/, header.includes('-') ? '' : '\n') : text.replace(/\n(?!\n)/g, ' ').trim();
  }
  function node(minIndent) {
    skip();
    if (i >= raw.length || indentOf(raw[i]) < minIndent) return null;
    const ind = indentOf(raw[i]);
    return /^\s*-(\s|$)/.test(raw[i]) ? seq(ind) : map(ind);
  }
  function seq(ind) {
    const out = [];
    for (skip(); i < raw.length && indentOf(raw[i]) === ind && /^\s*-(\s|$)/.test(raw[i]); skip()) {
      const rest = strip(raw[i]).trimStart().slice(1);
      const col = ind + 1 + (rest.length - rest.trimStart().length);
      if (rest.trim() === '') { i++; out.push(node(ind + 1)); continue; }
      if (keyOf(rest.trim())) { raw[i] = ' '.repeat(col) + rest.trim(); out.push(map(col)); continue; }
      i++; out.push(scalar(rest));
    }
    return out;
  }
  function map(ind) {
    const out = {};
    for (skip(); i < raw.length && indentOf(raw[i]) === ind && !/^\s*-(\s|$)/.test(raw[i]); skip()) {
      const kv = keyOf(strip(raw[i]).trim());
      if (!kv) throw new Error(`line ${i + 1}: not a mapping entry`);
      i++;
      const rest = kv.rest.trim();
      if (/^[|>][+-]?$/.test(rest)) out[kv.key] = block(ind, rest);
      else if (rest !== '') out[kv.key] = scalar(rest);
      else { skip(); out[kv.key] = i < raw.length && (indentOf(raw[i]) > ind || (indentOf(raw[i]) === ind && /^\s*-(\s|$)/.test(raw[i]))) ? node(ind) : null; }
    }
    return out;
  }
  const result = node(0);
  skip();
  if (i < raw.length) throw new Error(`line ${i + 1}: unexpected indentation`);
  return result ?? {};
}

const asList = v => v == null ? [] : Array.isArray(v) ? v : [v];
const triggers = on => {
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map(x => [x, null]));
  return on && typeof on === 'object' ? on : {};
};
const DB = /(?:^|[\s\/])(postgres|postgis|timescaledb|pgvector|mysql|mariadb)(?=[:@\s"']|$)/i;
const dbOf = text => DB.exec(String(text))?.[1]?.toLowerCase().replace(/^(postgis|timescaledb|pgvector)$/, 'postgres') ?? null;
const DEPLOY = /deploy|release|publish|promote|rollout/i;

export function lintWorkflow({ name, text, trustedBranch = 'main', privateRepo = null }) {
  let wf;
  try { wf = parseYaml(text); } catch { return []; }
  if (!wf || typeof wf !== 'object' || typeof wf.jobs !== 'object' || !wf.jobs) return [];
  const out = [];
  const warn = (what, detail) => out.push({ name: `${what} in ${name}`, detail, needed_for: 'CI time' });
  const on = triggers(wf.on);
  const jobs = Object.entries(wf.jobs).filter(([, j]) => j && typeof j === 'object');

  for (const [id, job] of jobs) {
    for (const [sid, svc] of Object.entries(job.services ?? {})) {
      const db = dbOf(svc?.image);
      if (db === 'postgres') warn('a database on disk', `job ${id}: the service container ${sid} (${svc.image}) takes no command, so Postgres cannot start with fsync off, and its data is on disk. Start it in a step with docker run --tmpfs /var/lib/postgresql -e … postgres -c fsync=off -c synchronous_commit=off -c full_page_writes=off (templates/github/project-ci.yml); on a large suite that is a third faster`);
      else if (db && !/--tmpfs\b/.test(svc?.options ?? '')) warn('a database on disk', `job ${id}: the service container ${sid} (${svc.image}) keeps its data on disk; add --tmpfs for its data directory to its options`);
    }
    for (const step of asList(job.steps)) {
      const run = String(step?.run ?? '');
      if (!/\b(docker|podman)\s+run\b/.test(run)) continue;
      const db = dbOf(run.slice(run.search(/\b(docker|podman)\s+run\b/)));
      if (!db) continue;
      const missing = [!/--tmpfs\b/.test(run) && 'a --tmpfs for its data directory', db === 'postgres' && !/fsync\s*=\s*off/.test(run) && '-c fsync=off (and synchronous_commit=off, full_page_writes=off)'].filter(Boolean);
      if (missing.length) warn('a database on disk', `job ${id}: a ${db} container started in a step lacks ${missing.join(' and ')}`);
    }
  }

  // A `needs:` with nothing taken from the job it waits for is a serial chain that could run side by side. Deploys and jobs that gate on
  // results (`needs.X.result`, an `if:` on it) wait on purpose; an artifact the earlier job uploads and this one downloads is data.
  const uploads = id => JSON.stringify(wf.jobs[id] ?? {}).includes('upload-artifact');
  for (const [id, job] of jobs) {
    const body = JSON.stringify({ ...job, needs: undefined });
    for (const dep of asList(job.needs)) {
      if (typeof dep !== 'string' || !wf.jobs[dep]) continue;
      const q = dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`needs\\.${q}(?![\\w-])|needs\\[\\\\?['"]${q}\\\\?['"]\\]`).test(body)) continue;
      if (uploads(dep) && /download-artifact/.test(body)) continue;
      if (DEPLOY.test(id) || DEPLOY.test(String(job.name ?? '')) || job.environment != null) continue;
      warn('a serial chain', `job ${id} needs ${dep} but uses nothing from it (no needs.${dep} output or result, no artifact): they could run in parallel, so drop the needs: and let a final job gate on both if one result is wanted`);
    }
  }

  if (on.pull_request !== undefined || on.pull_request_target !== undefined) {
    const own = jobs.some(([, j]) => j.concurrency != null);
    const c = wf.concurrency;
    if (c == null && !own) warn('no concurrency', 'a push to a pull request starts a new run while the old one keeps going; add concurrency: {group: ci-${{ github.event.pull_request.number || github.ref }}, cancel-in-progress: ${{ github.event_name == \'pull_request\' }}} so each pull request has one run in flight');
    else if (c != null && (typeof c !== 'object' || c['cancel-in-progress'] == null || c['cancel-in-progress'] === false)) warn('no cancel-in-progress', 'concurrency is set but does not cancel the run a newer push replaces: set cancel-in-progress (true, or an expression that is true for pull requests only)');
  }

  const push = on.push;
  if (push !== undefined && on.pull_request !== undefined) {
    const branches = asList(push?.branches);
    const hitsTrunk = !push || !branches.length || branches.some(b => b === trustedBranch || b === '**' || b === '*');
    if (hitsTrunk && !/\bwf reuse\b/.test(text)) warn('a full rerun on push', `every push to ${trustedBranch} runs the pull request's checks again on code the pull request already tested; reuse the pull request's result when the pushed tree is the tree its checks passed on (wf reuse, templates/github/project-ci.yml), and keep deploy jobs running always`);
  }

  if (privateRepo === true) {
    for (const [id, job] of jobs) {
      for (const label of asList(job['runs-on']).filter(x => typeof x === 'string' && !x.includes('${{'))) {
        if (/^(ubuntu|windows|macos)-/.test(label)) warn('GitHub-hosted runner on a private repository', `job ${id} runs on ${label}, which is billed in minutes on a private repository; run it on the project's runner: runs-on: \${{ vars.CI_BUILD == 'on' && 'wf-build' || '${label}' }}`);
      }
    }
  }
  return out;
}
