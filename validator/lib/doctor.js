// `wf doctor` (MAINT-0018 B5): what this machine can do for the project's work, checked at the start of a session, so a gap
// reaches the owner in the first question rather than at the end. In M-0004 of mateen-systems the home server's missing
// access to staging was seen at 18:17 and reported at 04:44. Built-in checks cover the tools every project uses; the
// project's `preflight` list (docs/workflow/config.json) adds its own, such as ssh to its staging host. No gate reads it.
import { spawnSync } from 'node:child_process';

const run = (cmd, args, timeout = 20000) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return { ok: r.status === 0 && !r.error, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), missing: r.error?.code === 'ENOENT' };
};
const firstLine = s => String(s ?? '').split('\n').find(Boolean) ?? '';

export function evaluateDoctor({ config }) {
  const checks = [];
  const add = (name, ok, detail, neededFor) => checks.push({ name, ok, detail, needed_for: neededFor });
  const [major] = process.versions.node.split('.').map(Number);
  add('node 22 or later', major >= 22, `node ${process.versions.node}`, 'the validator');
  const git = run('git', ['--version']);
  add('git', git.ok, git.ok ? firstLine(git.out) : 'not found', 'every command');
  const ghVersion = run('gh', ['--version']);
  add('gh', ghVersion.ok, ghVersion.ok ? firstLine(ghVersion.out) : 'not found on PATH', 'pull requests, wf wait, auto-merge');
  if (ghVersion.ok) {
    const auth = run('gh', ['auth', 'status']);
    const account = auth.out.match(/account (\S+)/)?.[1] ?? null;
    const agent = config.approval?.agent_identity || null;
    add('gh signed in', auth.ok, auth.ok ? `as ${account ?? 'an account'}${agent && account && account !== agent ? `, but the agent's account is ${agent}: switch with gh auth switch --user ${agent}` : ''}` : 'gh auth status failed: sign in with gh auth login', 'pull requests');
    if (auth.ok && agent && account && account !== agent) checks.at(-1).ok = false;
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
    add(`${second.tool} (review.second_model)`, tool.ok, tool.ok ? firstLine(tool.out) : `not found on PATH: deep reviews fall back to a fresh reviewer of your own tool, which review.fallback records`, 'deep and milestone reviews');
  }
  for (const p of config.preflight ?? []) {
    const r = run('bash', ['-c', p.run], 30000);
    add(p.name, r.ok, r.ok ? 'ok' : `failed: ${firstLine(r.out) || p.run}`, p.why ?? 'the project (preflight)');
  }
  const gaps = checks.filter(c => !c.ok).map(c => c.name);
  return {
    ok: !gaps.length, checks, gaps,
    next: gaps.length ? 'ask the owner about every gap in your first question, and carry on with the work the gaps do not block' : 'nothing is missing',
    limitation: 'A check that passes says the tool or access answered now; it grants nothing and no gate reads it.',
  };
}
