// `wf doctor` (MAINT-0018 B5): what this machine can do for the project's work, checked at the start of a session, so a gap
// reaches the owner in the first question rather than at the end. In M-0004 of a client project the home server's missing
// access to staging was seen at 18:17 and reported at 04:44. Built-in checks cover the tools every project uses; the
// project's `preflight` list (docs/workflow/config.json) adds its own, such as ssh to its staging host. No gate reads it.
// MAINT-0020 P9: it also checks where the session started. In M-0005 the session started in the parent folder, so the
// project's reviewer and walker agents were "not registered" and ran as general-purpose agents with write tools.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { workTreeRoot } from './git.js';
import { lintWorkflow } from './ci-lint.js';

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

// MAINT-0023 P10: a warning is a gap that is not the machine's: the repository's rules may hold the agent's own pull requests
// back, which no tool on this machine fixes and which must not fail the exit code. A small copy of the pull_request and
// merge_queue logic of adapters/protect.mjs, which bin/wf does not ship (it extracts only validator/). Bypass lists need the
// owner's login to read, so the agent's account cannot see them and they are not used.
export function ruleWarnings({ rules, branch }) {
  const warnings = [];
  const warn = (name, detail, neededFor) => warnings.push({ name: `${name} on ${branch}`, detail, needed_for: neededFor });
  const prs = rules.filter(r => r?.type === 'pull_request').map(r => r.parameters ?? {});
  const count = Math.max(0, ...prs.map(x => Number(x.required_approving_review_count ?? 0)));
  const any = key => prs.some(x => x[key] === true);
  if (count > 0) warn('required approving reviews', `${branch} requires ${count} approving review(s), and the agent's account cannot approve its own pull request: its auto-merge waits for someone else's approval`, 'auto-merge');
  if (any('require_code_owner_review')) warn('code-owner review', `${branch} requires code-owner review: a pull request that touches a file with a code owner waits for that owner, which the agent's account is not`, 'auto-merge');
  if (any('require_last_push_approval')) warn('approval of the most recent push', `${branch} requires approval of the most recent push, which the agent's own pushes can never get from itself`, 'auto-merge');
  if (rules.some(r => r?.type === 'merge_queue')) warn('a merge queue', `${branch} uses a merge queue, which the agent's account cannot use to merge its own pull request`, 'auto-merge');
  return warnings;
}

// v2.14.0: the project's own workflows (`.github/workflows/*.yml`, the installed `wf-*` files left out), read from the working tree.
// Each finding is a warning that CI waits for no reason (lib/ci-lint.js); a repository whose privacy is unknown gets no runner warning.
function workflowWarnings({ repo, trustedBranch, privateRepo }) {
  let dir;
  try { dir = path.join(workTreeRoot(repo), '.github', 'workflows'); } catch { return []; }
  let names;
  try { names = fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f) && !f.startsWith('wf-')).sort(); } catch { return []; }
  return names.flatMap(name => lintWorkflow({ name, text: fs.readFileSync(path.join(dir, name), 'utf8'), trustedBranch, privateRepo }));
}

const real = p => { try { return fs.realpathSync(p); } catch { return p; } };
export function evaluateDoctor({ config, repo, cwd = process.cwd() }) {
  const checks = [];
  const add = (name, ok, detail, neededFor) => checks.push({ name, ok, detail, needed_for: neededFor });
  if (repo) {
    const root = real(workTreeRoot(repo)), here = real(cwd);
    add('session started in the repository root', here === root, here === root ? `in ${root}` : `started in ${here}, not in the repository root ${root}: the project's agents and instructions (.claude/agents, CLAUDE.md, AGENTS.md) are not loaded from a parent folder, so its reviewer and walker agents are missing: start the session in ${root}`, "the project's agents and instructions");
  }
  let privateRepo = null;
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
      try { const body = JSON.parse(repo.out); push = body.permissions?.push ?? null; privateRepo = typeof body.private === 'boolean' ? body.private : null; } catch { push = null; }
      add(`push access to ${config.repository}`, repo.ok && push === true, repo.ok ? (push === true ? 'yes' : 'the signed-in account cannot push') : 'the repository could not be read', 'branches and pull requests');
    }
  }
  // MAINT-0023 P10: only with auto_merge, where the agent's pull requests are meant to merge without the owner.
  const warnings = [];
  if (ghVersion.ok && config.approval?.auto_merge === true && /^[\w.-]+\/[\w.-]+$/.test(config.repository ?? '')) {
    const branch = config.trusted_branch ?? 'main';
    // A branch name keeps its slashes: the API takes them in the path as they are.
    const read = run('gh', ['api', `repos/${config.repository}/rules/branches/${branch}`]);
    let rules = null;
    try { rules = read.ok ? JSON.parse(read.out) : null; } catch { rules = null; }
    if (Array.isArray(rules) && !rules.length) {
      // Rulesets say nothing about classic branch protection, which holds pull requests the same way: read it when no rule came back.
      const classic = run('gh', ['api', `repos/${config.repository}/branches/${branch}/protection`]);
      let protection = null;
      try { protection = classic.ok ? JSON.parse(classic.out) : null; } catch { protection = null; }
      const reviews = protection?.required_pull_request_reviews;
      if (reviews) rules = [{ type: 'pull_request', parameters: { required_approving_review_count: reviews.required_approving_review_count, require_code_owner_review: reviews.require_code_owner_reviews, require_last_push_approval: reviews.require_last_push_approval } }];
      else if (!classic.ok && !/\b404\b|not protected/i.test(classic.out)) warnings.push({ name: `the branch protection on ${branch}`, detail: `no ruleset rule on ${branch}, and the classic branch protection could not be read (${firstLine(classic.out) || 'no usable answer'}): whether a review holds the agent's auto-merge back is unknown`, needed_for: 'auto-merge' });
    }
    if (Array.isArray(rules)) warnings.push(...ruleWarnings({ rules, branch }));
    else warnings.push({ name: `the rules on ${branch}`, detail: `could not read the rules on ${branch} (${firstLine(read.out) || 'no usable answer'}): whether a review or merge queue holds the agent's auto-merge back is unknown`, needed_for: 'auto-merge' });
  }
  // v2.14.0: where CI waits for no reason. Warnings: no gate reads them and they never change `ok`.
  if (repo) warnings.push(...workflowWarnings({ repo, trustedBranch: config.trusted_branch ?? 'main', privateRepo }));
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
    ok: !gaps.length, checks, gaps, warnings,
    next: (gaps.length ? 'ask the owner about every gap in your next question (the plan\'s, when planning), and carry on with the work the gaps do not block' : 'nothing is missing') + (warnings.length ? `; ${warnings.length} warning(s) do not fail this check but may hold the agent's pull requests back: put them in the same question` : ''),
    limitation: 'A check that passes says the tool or access answered now; it grants nothing and no gate reads it.',
  };
}
