// channel-audit v1: after a bad release, which merged pull requests did it judge? Read-only.
//
//   in : a revision (a full hash, or a prefix of at least 7), project repositories (owner/name), an optional `since`
//   out: per project, the merged pull requests whose head carries a `wf resolved` check run naming that revision
//        ({number, title, merged_at, head_sha, channel, version, resolved_at}), and per project any error
//
// The record is the check run the shared gate writes on the judged commit (.github/workflows/wf-gate.yml): its summary is
// a fenced JSON {channel, revision, version, seq?, resolved_at}. Only check runs made by GitHub Actions count; one any
// other app posts is not the gate's. The list is for the owner to recheck, never a verdict on its own: a pull request
// judged again later at another revision is listed with every revision that judged it (`judged_by`).
//
// `api(path)` returns the parsed JSON of a GitHub REST GET (bin/wf-channel-audit passes `gh api`); tests pass a fake.
const HEX = /^[0-9a-f]{7,64}$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const PAGE = 100;
const MAX_PAGES = 20;
export class AuditError extends Error {}

export function readRecord(checkRun) {
  if (checkRun?.name !== 'wf resolved' || checkRun?.app?.slug !== 'github-actions') return null;
  const m = String(checkRun.output?.summary ?? '').match(/```json\n([\s\S]*?)\n```/);
  if (!m) return null;
  try {
    const r = JSON.parse(m[1]);
    return typeof r?.revision === 'string' ? r : null;
  } catch { return null; }
}

export async function audit({ revision, repos, since, api }) {
  const rev = String(revision ?? '').toLowerCase();
  if (!HEX.test(rev)) throw new AuditError(`--revision ${revision} is not a revision hash (at least 7 hex characters)`);
  if (!repos?.length) throw new AuditError('name at least one project repository (owner/name)');
  for (const r of repos) if (!REPO.test(r)) throw new AuditError(`${r} is not owner/name`);
  const after = since ? Date.parse(since) : -Infinity;
  if (Number.isNaN(after)) throw new AuditError(`--since ${since} is not a date`);
  const projects = [];
  for (const repo of repos) {
    const found = [];
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const pulls = await api(`repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=${PAGE}&page=${page}`);
        if (!Array.isArray(pulls)) throw new AuditError(`repos/${repo}/pulls did not return a list`);
        for (const pr of pulls) {
          if (!pr.merged_at || Date.parse(pr.merged_at) < after) continue;
          // filter=all: GitHub's default (latest) drops a superseded run, and a head judged at X then again at Y was judged by both.
          const records = [];
          for (let q = 1; ; q++) {
            const runs = await api(`repos/${repo}/commits/${pr.head.sha}/check-runs?check_name=${encodeURIComponent('wf resolved')}&filter=all&per_page=${PAGE}&page=${q}`);
            const got = runs?.check_runs ?? [];
            records.push(...got.map(readRecord).filter(Boolean));
            if (got.length < PAGE || q >= MAX_PAGES) break;
          }
          const hit = records.find(r => r.revision.toLowerCase().startsWith(rev));
          if (hit) found.push({ number: pr.number, title: pr.title, merged_at: pr.merged_at, head_sha: pr.head.sha, channel: hit.channel, version: hit.version, resolved_at: hit.resolved_at ?? null, judged_by: [...new Set(records.map(r => r.revision))] });
        }
        // Sorted by update time, newest first: once a whole page was updated before `since`, nothing later merged after it.
        if (pulls.length < PAGE || pulls.every(pr => Date.parse(pr.updated_at) < after)) break;
        if (page === MAX_PAGES) throw new AuditError(`stopped after ${MAX_PAGES * PAGE} closed pull requests without reaching ${since ? `--since ${since}` : 'the oldest'}: the list is incomplete; narrow it with --since`);
      }
      projects.push({ repo, pull_requests: found.sort((a, b) => a.number - b.number) });
    } catch (e) { projects.push({ repo, pull_requests: found, error: e.message }); }
  }
  return { revision: rev, since: since ?? null, projects };
}

export function render(result) {
  const lines = [`Pull requests judged at ${result.revision.slice(0, 12)} and merged${result.since ? ` since ${result.since}` : ''}:`];
  for (const p of result.projects) {
    lines.push(`- ${p.repo}: ${p.error ? `could not read (${p.error})` : p.pull_requests.length ? '' : 'none'}`.trimEnd());
    for (const pr of p.pull_requests) lines.push(`  - #${pr.number} ${pr.title} (merged ${pr.merged_at}; ${pr.channel} ${pr.version}${pr.judged_by.length > 1 ? `; also judged at ${pr.judged_by.filter(r => !r.startsWith(result.revision)).map(r => r.slice(0, 12)).join(', ')}` : ''})`);
  }
  return `${lines.join('\n')}\n`;
}
