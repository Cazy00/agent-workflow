// The GitHub protections of procedures/setup.md step 5, applied and read back through the owner's own `gh` login
// (bin/wf-protect). One ruleset on the trusted branch, shaped by the approval mode, so the owner runs one command
// instead of clicking through settings; the read-back replaces the disposable-repository test as the default
// evidence before a switch to enforced mode (step 9). Settings read back show how GitHub is configured, not how it
// behaves: the live approval-path test stays available as stronger, optional evidence. Nothing here grants approval.
import { spawnSync } from 'node:child_process';
import { dirSource, gitSource, list, loadAll, loadConfig } from '../validator/lib/index.js';

export const ACTIONS_APP = 15368; // GitHub Actions: a required check must come from it, not from any app or token
export const RULESET = 'agent-workflow';
export const TARGETS = ['manual', 'owner-merge', 'enforced'];
const UPGRADE = /upgrade to github (pro|team)|make this repository public/i;
const OWNERSHIP = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

// The approved configuration: config and profile from the local trusted branch, never the working tree.
export function readProject(project) {
  let branch = 'main';
  try { branch = loadConfig(dirSource(project)).trusted_branch ?? 'main'; } catch { /* the branch's own config decides below */ }
  let source;
  try { source = gitSource(project, `refs/heads/${branch}`); } catch { throw new Error(`no local ${branch} branch: commit the scaffold to it and push it first`); }
  if (source.read('docs/workflow/config.json') == null) throw new Error(`docs/workflow/config.json is not on ${branch}: commit the scaffold to it and push it first`);
  const config = loadConfig(source);
  if ((config.trusted_branch ?? 'main') !== branch) throw new Error(`the config on ${branch} names ${config.trusted_branch} as the trusted branch`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(config.repository ?? '')) throw new Error('docs/workflow/config.json names no OWNER/REPOSITORY');
  const profile = loadAll(source, config.records_dir ?? 'docs/workflow').profile?.data ?? {};
  return { branch, config, revision: source.name, owners: list(profile.owners), requiredChecks: list(profile.required_checks) };
}

// What the ruleset must say for a target mode. Manual mode moves the trusted branch by the owner's fast-forward after
// closeout, so its ruleset only stops deletion and rewriting. The pull-request modes require a pull request and the
// `wf ci` check plus every required check, from GitHub Actions, on an up-to-date branch, with stale reviews
// dismissed and nobody able to bypass. Code-owner review needs a second account: GitHub never lets the author approve
// their own pull request, so with one account it would block every merge, and enforced mode is unavailable.
export function plan({ config, owners = [], requiredChecks = [], branch, target }) {
  if (!TARGETS.includes(target)) throw new Error(`--target must be one of ${TARGETS.join(', ')}`);
  const shared = owners.length >= 2;
  const approver = config.approval?.approver ?? '', worker = config.approval?.agent_identity ?? '';
  const oneAccount = !shared && (!worker || worker.toLowerCase() === approver.toLowerCase());
  if (target === 'enforced' && oneAccount) throw new Error('enforced mode needs a worker account other than the owner\'s (approval.agent_identity): GitHub never lets you approve your own pull request, so with one account use manual or owner-merge');
  if (target === 'enforced' && !shared && !approver) throw new Error('enforced mode needs approval.approver, the owner\'s GitHub username');
  if (target === 'owner-merge' && shared) throw new Error('owner-merge mode is for one owner: with several, whose merge counts is undefined, so a shared project uses manual or enforced mode (procedures/shared.md)');
  const rules = [{ type: 'deletion' }, { type: 'non_fast_forward' }];
  const pullRequests = target !== 'manual';
  const codeOwners = pullRequests && (shared || target === 'enforced');
  const checks = [...new Set(['wf ci', ...requiredChecks])];
  if (pullRequests) {
    rules.push({ type: 'pull_request', parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: true, require_code_owner_review: codeOwners, require_last_push_approval: codeOwners && shared, required_review_thread_resolution: false } });
    rules.push({ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: checks.map(context => ({ context, integration_id: ACTIONS_APP })) } });
  }
  // Auto-merge: on for one owner in enforced mode, where code-owner review holds back everything but records; off in
  // owner-merge mode, where it would let the agent's pull requests merge on their checks alone, and in manual mode,
  // where the trusted branch moves only by the owner's closeout and a pull request with nothing pending would merge at
  // once; a shared project's code-owner review holds every pull request, so its setting is left alone.
  const autoMerge = target === 'enforced' && !shared ? true : !shared ? false : null;
  // Ownerless CODEOWNERS lines a single owner may keep: the records that merge on their checks alone.
  const rd = (config.records_dir ?? 'docs/workflow').replace(/^\/+|\/+$/g, '');
  const unowned = shared ? [] : [`/${rd}/tasks/`, `/${rd}/feedback/`];
  return {
    target, shared, oneAccount, approver, worker, branch, pullRequests, codeOwners, checks, autoMerge, unowned,
    ruleset: { name: RULESET, target: 'branch', enforcement: 'active', bypass_actors: [], conditions: { ref_name: { include: [`refs/heads/${branch}`], exclude: [] } }, rules },
  };
}

export function ghApi(method, endpoint, body) {
  const args = ['api', '--method', method, endpoint, '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28'];
  if (body !== undefined) args.push('--input', '-');
  const r = spawnSync('gh', args, { input: body === undefined ? undefined : JSON.stringify(body), encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw new Error(r.error.code === 'ENOENT' ? 'gh is not installed: install the GitHub CLI and log in with your own account (gh auth login)' : `gh: ${r.error.message}`);
  let data = null;
  try { data = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { /* not JSON */ }
  if (r.status !== 0) {
    const error = new Error(data?.message ?? (r.stderr.trim() || `gh api ${endpoint} failed`));
    error.status = Number(r.stderr.match(/HTTP (\d{3})/)?.[1] ?? 0) || null;
    throw error;
  }
  return data;
}

const unavailable = e => UPGRADE.test(e.message) ? 'rulesets are not available for this repository: they need a public repository or a GitHub Pro or Team plan for a private one. Skip step 5 and record that in the setup record; manual and owner-merge modes work without them' : null;

export function applyProtection({ api = ghApi, repository, plan: p }) {
  const done = [];
  let existing;
  try { existing = api('GET', `repos/${repository}/rulesets?includes_parents=false`) ?? []; }
  catch (e) { throw new Error(unavailable(e) ?? e.message); }
  const mine = existing.find(r => r.name === RULESET && r.source_type !== 'Organization');
  try {
    if (mine) { api('PUT', `repos/${repository}/rulesets/${mine.id}`, p.ruleset); done.push(`updated ruleset ${RULESET} (${mine.id})`); }
    else { const made = api('POST', `repos/${repository}/rulesets`, p.ruleset); done.push(`created ruleset ${RULESET}${made?.id ? ` (${made.id})` : ''}`); }
  } catch (e) { throw new Error(unavailable(e) ?? e.message); }
  if (p.autoMerge !== null) { api('PATCH', `repos/${repository}`, { allow_auto_merge: p.autoMerge }); done.push(`auto-merge ${p.autoMerge ? 'allowed' : 'turned off'}`); }
  return done;
}

const decode = file => file?.encoding === 'base64' ? Buffer.from(file.content ?? '', 'base64').toString('utf8') : file?.content ?? '';
const notFound = e => e.status === 404 || /not found/i.test(e.message);

export function checkProtection({ api = ghApi, repository, plan: p }) {
  const items = [];
  const item = (name, ok, detail = '') => items.push({ name, ok, ...(detail ? { detail } : {}) });
  const result = () => ({ ok: items.every(i => i.ok !== false), repository, branch: p.branch, target: p.target, items, ready_for_enforced: p.target === 'enforced' && items.every(i => i.ok !== false) });
  let repo;
  try { repo = api('GET', `repos/${repository}`); } catch (e) { item('repository readable', false, e.message); return result(); }
  let rules;
  try { rules = api('GET', `repos/${repository}/rules/branches/${encodeURIComponent(p.branch)}`) ?? []; }
  catch (e) { item('rulesets available', false, unavailable(e) ?? e.message); return result(); }
  if (!rules.length) item(`rules on ${p.branch}`, null, 'none apply: run --apply with your own gh login (rulesets need a public repository or a GitHub Pro or Team plan)');
  const of = type => rules.filter(r => r.type === type);
  item(`${p.branch} cannot be deleted`, of('deletion').length > 0);
  item(`${p.branch} cannot be force-pushed`, of('non_fast_forward').length > 0);
  if (p.pullRequests) {
    const prs = of('pull_request').map(r => r.parameters ?? {});
    item('changes reach the trusted branch only by pull request', prs.length > 0);
    if (prs.length) {
      const any = key => prs.some(x => x[key] === true);
      const count = Math.max(...prs.map(x => Number(x.required_approving_review_count ?? 0)));
      item('stale approvals are dismissed by a new push', any('dismiss_stale_reviews_on_push'));
      if (p.codeOwners) item('code-owner review is required', any('require_code_owner_review'));
      else if (p.oneAccount && (any('require_code_owner_review') || count > 0)) item('no review is required that you cannot give', false, 'with one account you can never approve your own pull request, so a required review (code-owner or a count above 0) blocks every merge');
      if (p.shared) item('approval of the most recent push is required', any('require_last_push_approval'));
      else if (p.codeOwners) {
        item('records-only pull requests can merge on their checks', count === 0 && !any('require_last_push_approval'), count === 0 && !any('require_last_push_approval') ? '' : 'set 0 required approvals and turn off approval of the most recent push (procedures/setup.md step 5)');
      }
    }
    const required = of('required_status_checks').map(r => r.parameters ?? {});
    const contexts = required.flatMap(x => x.required_status_checks ?? []);
    item('branches must be up to date before merging', required.some(x => x.strict_required_status_checks_policy === true));
    for (const name of p.checks) {
      const found = contexts.filter(c => c.context === name);
      const bound = found.some(c => c.integration_id === ACTIONS_APP);
      item(`required check "${name}" from GitHub Actions`, bound, !found.length ? 'not required' : bound ? '' : 'required, but not bound to GitHub Actions, so any app or token could report it');
    }
  }
  // Bypass lists are visible only to someone who can edit the ruleset: run this with the owner's login.
  for (const id of [...new Set(rules.map(r => r.ruleset_id).filter(Boolean))]) {
    let ruleset = null;
    try { ruleset = api('GET', `repos/${repository}/rulesets/${id}`); } catch (e) { item(`ruleset ${id} has no bypass`, false, e.message); continue; }
    if (!Array.isArray(ruleset?.bypass_actors)) item(`ruleset ${ruleset?.name ?? id} has no bypass`, false, 'cannot see its bypass list: run this with the repository owner\'s gh login');
    else item(`ruleset ${ruleset.name ?? id} has no bypass`, ruleset.bypass_actors.length === 0, ruleset.bypass_actors.length ? `bypass: ${ruleset.bypass_actors.map(a => `${a.actor_type}${a.actor_id ? ` ${a.actor_id}` : ''}`).join(', ')}` : '');
  }
  if (p.autoMerge !== null) item(`auto-merge ${p.autoMerge ? 'allowed' : 'off'}`, repo?.allow_auto_merge === p.autoMerge, p.autoMerge ? 'a records-only pull request then merges by itself after its checks' : p.target === 'manual' ? 'in manual mode the trusted branch moves only by your closeout; auto-merge could merge a pull request first' : 'in owner-merge mode auto-merge would let the agent\'s pull requests merge on their checks alone');
  if (p.codeOwners) {
    try {
      const errors = api('GET', `repos/${repository}/codeowners/errors?ref=${encodeURIComponent(p.branch)}`)?.errors ?? [];
      item('CODEOWNERS has no errors', errors.length === 0, errors.map(e => `line ${e.line}: ${e.message ?? e.kind}`).join('; '));
    } catch (e) { item(`CODEOWNERS on ${p.branch}`, false, notFound(e) ? 'none: bin/wf-adopt writes .github/CODEOWNERS' : e.message); }
    let text = null;
    for (const rel of OWNERSHIP) {
      try { text = decode(api('GET', `repos/${repository}/contents/${rel}?ref=${encodeURIComponent(p.branch)}`)); break; } catch (e) { if (!notFound(e)) throw e; }
    }
    if (text != null) {
      const lines = text.split(/\r?\n/).map(l => l.replace(/#.*/, '').trim()).filter(Boolean).map(l => l.split(/\s+/));
      // A later line without owners takes its paths out of code-owner review (the last matching line wins), so only the
      // records carve-out may be ownerless; anything else could un-own the config, the profile or this file.
      const ownerless = lines.filter(l => l.length === 1 && !p.unowned.includes(l[0])).map(l => l[0]);
      item('CODEOWNERS leaves no path unowned except task and feedback records', ownerless.length === 0, ownerless.length ? `ownerless: ${ownerless.join(', ')}` : '');
      const everything = lines.filter(l => l[0] === '*').at(-1) ?? [];
      const listed = everything.slice(1).map(n => n.replace(/^@/, '').toLowerCase());
      if (p.shared) item('CODEOWNERS assigns every path (*) to people', listed.length > 0, listed.length ? '' : 'no * line with owners');
      else item(`CODEOWNERS assigns every path (*) to ${p.approver}`, listed.includes(p.approver.toLowerCase()));
      if (p.worker) item(`CODEOWNERS names no worker (${p.worker})`, !lines.some(l => l.slice(1).some(n => n.replace(/^@/, '').toLowerCase() === p.worker.toLowerCase())));
    }
  }
  if (p.target === 'enforced') item('owner and worker are different accounts', !!p.approver && !!p.worker && p.approver.toLowerCase() !== p.worker.toLowerCase());
  if (p.pullRequests) {
    try { api('GET', `repos/${repository}/contents/.github/workflows/wf-ci.yml?ref=${encodeURIComponent(p.branch)}`); item('.github/workflows/wf-ci.yml reports wf ci', true); }
    catch (e) { if (!notFound(e)) throw e; item('.github/workflows/wf-ci.yml reports wf ci', null, `not on ${p.branch}: another job must report "wf ci" by running the pinned validator from protected configuration`); }
  }
  return result();
}

export function renderProtection(r, applied = []) {
  const mark = ok => ok === true ? '✓' : ok === false ? '✗' : '·';
  const lines = [`${r.repository} · ${r.branch} · target ${r.target} mode`, ...applied.map(a => `  applied: ${a}`), ...r.items.map(i => `  ${mark(i.ok)} ${i.name}${i.detail ? `: ${i.detail}` : ''}`), ''];
  if (!r.ok) lines.push('Fix the ✗ items (rerun with --apply, using your own gh login) and check again.');
  else if (r.target === 'enforced') lines.push('The protections enforced mode needs are in place. Record this read-back in docs/workflow/setup.md, then switch approval.label (config) and approval_label (profile) to enforced in one code-owner-reviewed pull request. The live approval-path test (procedures/setup.md step 9) remains optional, stronger evidence.');
  else lines.push(`The protections match ${r.target} mode. Record this read-back in docs/workflow/setup.md.`);
  lines.push('These are the settings GitHub reports; they grant no approval.');
  return `${lines.join('\n')}\n`;
}
