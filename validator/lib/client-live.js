// The client page's live reading (MAINT-0014): what the branches being worked on say about their own parts, on top of
// the trusted branch's records. A branch counts only for the task records it changed since it left the trusted
// branch (every branch carries copies of all of them), only for parts, and only forward: the trusted branch's Done
// always wins, and a branch's Done shows as in progress until it is merged. Branch names never reach the page.
import { gitRunner } from './git.js';
import { parseFrontMatter } from './frontmatter.js';

const DAY = 24 * 60 * 60 * 1000;
const PREFIX = 'refs/remotes/origin/';
// The states a branch may give a part; anything else leaves the trusted branch's.
const FORWARD = { Active: 'Active', Blocked: 'Blocked', Done: 'Active' };

export function readBranches({ repo, base, trustedBranch, recordsDir, pullRequests = null, now = Date.now(), maxAgeDays = 14 }) {
  const parts = new Map();
  const warnings = [];
  let newest = null;
  try {
    const git = gitRunner(repo, { maxBuffer: 16 * 1024 * 1024 });
    const refs = git('for-each-ref', '--format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)', PREFIX);
    if (refs.error || refs.status !== 0) throw new Error(refs.error?.message ?? (refs.stderr.trim() || 'git for-each-ref failed'));
    const open = new Map((pullRequests ?? []).filter(p => !p.isCrossRepository).map(p => [p.headRefName, p]));
    for (const line of refs.stdout.split('\n').filter(Boolean)) {
      const [ref, tip, date] = line.split('\0');
      const name = ref.slice(PREFIX.length);
      if (name === 'HEAD' || name === trustedBranch) continue;
      const pr = open.get(name);
      if (!pr && now - Date.parse(date) > maxAgeDays * DAY) continue;
      const fork = git('merge-base', base, tip);
      if (fork.status !== 0) { warnings.push(`live reading: a branch shares no history with ${trustedBranch}; skipped`); continue; }
      const changed = git('diff', '--name-only', '--no-renames', '-z', fork.stdout.trim(), tip, '--', `${recordsDir}/tasks/`);
      if (changed.status !== 0) { warnings.push('live reading: a branch could not be compared; skipped'); continue; }
      if (!newest || Date.parse(date) > Date.parse(newest)) newest = date;
      for (const file of changed.stdout.split('\0').filter(f => f.endsWith('.md'))) {
        const shown = git('show', `${tip}:${file}`);
        const record = shown.status === 0 ? parseFrontMatter(shown.stdout).data : null; // removed on the branch: nothing to show
        if (!record?.id) continue;
        const seen = parts.get(record.id);
        if (seen && Date.parse(seen.date) >= Date.parse(date)) continue; // the newer branch wins
        parts.set(record.id, { record, date, checking: Boolean(pr && !pr.isDraft) });
      }
    }
  } catch (e) {
    return { parts: new Map(), newest: null, warnings: [...warnings, `live reading skipped: ${e.message}`] };
  }
  return { parts, newest, warnings };
}

export function overlayTasks(tasks, parts, milestoneIds) {
  const ids = new Set(tasks.map(t => t.id));
  const moved = (t, b) => {
    const status = FORWARD[b.record.status];
    if (!status) return t;
    return { ...t, status, client_title: b.record.client_title ?? t.client_title, title: b.record.title ?? t.title, live: b.checking && status === 'Active' ? 'checking' : null };
  };
  const out = tasks.map(t => { const b = parts.get(t.id); return b && t.status !== 'Done' ? moved(t, b) : t; });
  for (const [id, b] of parts) {
    if (ids.has(id) || !milestoneIds.has(b.record.milestone)) continue;
    const added = moved({ id, milestone: b.record.milestone, status: 'Draft', title: null, client_title: null }, b);
    if (added.status !== 'Draft') out.push(added);
  }
  return out;
}
