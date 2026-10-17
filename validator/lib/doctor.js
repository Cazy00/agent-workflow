// `wf doctor` (MAINT-0018 B5): what this machine can do for the project's work, checked at the start of a session, so a gap
// reaches the owner in the first question rather than at the end. In M-0004 of mateen-systems the home server's missing
// access to staging was seen at 18:17 and reported at 04:44. Built-in checks cover the tools every project uses; the
// project's `preflight` list (docs/workflow/config.json) adds its own, such as ssh to its staging host. No gate reads it.
// MAINT-0020 P9: it also checks where the session started. In M-0005 the session started in the parent folder, so the
// project's reviewer and walker agents were "not registered" and ran as general-purpose agents with write tools.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { workTreeRoot } from './git.js';

// The project's own preflight commands run without the owner's signing material or the workflow's own secrets, as
// `wf attest` withholds them (lib/attest.js), from the config of the trusted branch the working tree's config names
// (cli.js), and still no sandbox (review S5 of MAINT-0018 Part B). The ssh agent stays: a preflight's usual job is to try
// ssh to the staging host, which `wf attest`, running candidate code, has no reason to do.
const WITHHELD = /^(OWNER_SIGNING_|WF_|GPG_)/;
const quiet = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !WITHHELD.test(k)));
const run = (cmd, args, timeout = 20000, env = process.env) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout, env: { ...env, GIT_TERMINAL_PROMPT: '0' } });
  return { ok: r.status === 0 && !r.error, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), missing: r.error?.code === 'ENOENT' };
};
const firstLine = s => String(s ?? '').split('\n').find(Boolean) ?? '';

const real = p => { try { return fs.realpathSync(p); } catch { return p; } };
export function evaluateDoctor({ config, repo, cwd = process.cwd() }) {
  const checks = [];
  const add = (name, ok, detail, neededFor) => checks.push({ name, ok, detail, needed_for: neededFor });
  if (repo) {
    const root = real(workTreeRoot(repo)), here = real(cwd);
    add('session started in the repository root', here === root, here === root ? `in ${root}` : `started in ${here}, not in the repository root ${root}: the project's agents and instructions (.claude/agents, CLAUDE.md, AGENTS.md) are not loaded from a parent folder, so its reviewer and walker agents are missing: start the session in ${root}`, "the project's agents and instructions");
  }
  const [major] = process.versions.node.split('.').map(Number);
  add('node 22 or later', major >= 22, `node ${process.versions.node}`, 'the validator');
  const git = run('git', ['--version']);
  add('git', git.ok, git.ok ? firstLine(git.out) : 'not found', 'every command');
  const ghVersion = run('gh', ['--version']);
  add('gh', ghVersion.ok, ghVersion.ok ? firstLine(ghVersion.out) : 'not found on PATH', 'pull requests, wf wait, auto-merge');
  if (ghVersion.ok) {
    // The signed-in account from the API, which every gh version answers the same way (`auth status` words it differently).
    const user = run('gh', ['api', 'user', '--jq', '.login']);
    const account = user.ok ? firstLine(user.out) : null;
    const agent = config.approval?.agent_identity || null;
    const wrong = agent && account && account !== agent;
    add('gh signed in', user.ok && !wrong && !(agent && !account), !user.ok ? 'gh cannot read the signed-in account: sign in with gh auth login' : wrong ? `as ${account}, but the agent's account is ${agent}: switch with gh auth switch --user ${agent}` : `as ${account}`, 'pull requests');
    if (config.repository) {
      const repo = run('gh', ['api', `repos/${config.repository}`]);
      let push = null;
      try { push = JSON.parse(repo.out).permissions?.push ?? null; } catch { push = null; }
      add(`push access to ${config.repository}`, repo.ok && push === true, repo.ok ? (push === true ? 'yes' : 'the signed-in account cannot push') : 'the repository could not be read', 'branches and pull requests');
    }
  }
  const second = config.review?.second_model;
  if (second?.tool) {
    const tool = run(second.tool, ['--version']);
    add(`${second.tool} (review.second_model)`, tool.ok, tool.ok ? firstLine(tool.out) : `not found on PATH: reviews take the next reviewer of another vendor, which review.fallback records, or stop at the gate`, 'deep and milestone reviews');
  }
  for (const p of config.preflight ?? []) {
    const r = run('bash', ['-c', p.run], 30000, quiet());
    add(p.name, r.ok, r.ok ? 'ok' : `failed: ${firstLine(r.out) || p.run}`, p.why ?? 'the project (preflight)');
  }
  const gaps = checks.filter(c => !c.ok).map(c => c.name);
  // MAINT-0020 P7(c): when planning, the plan's question, before authorisation (wf next prints doctor in the plan action).
  return {
    ok: !gaps.length, checks, gaps,
    next: gaps.length ? 'ask the owner about every gap in your next question (the plan\'s, when planning), and carry on with the work the gaps do not block' : 'nothing is missing',
    limitation: 'A check that passes says the tool or access answered now; it grants nothing and no gate reads it.',
  };
}
