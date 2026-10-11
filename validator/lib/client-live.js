// The client page's live reading (MAINT-0014): what the branches being worked on say about their own parts, on top of
// the trusted branch's records. A branch counts only for the task records it changed since it left the trusted
// branch (every branch carries copies of all of them), only for parts, and only forward: a branch speaks for a part
// the trusted branch has as Draft or Ready (or lacks), so the trusted Active, Blocked and Done stand, except that an open
// pull request shows a trusted Active part as being checked. A branch's Done shows as in progress until it is merged.
// Branch names never reach the page.
import { gitRunner } from './git.js';
import { parseFrontMatter } from './frontmatter.js';

const DAY = 24 * 60 * 60 * 1000;
const PREFIX = 'refs/remotes/origin/';
// The states a branch may give a part; anything else leaves the trusted branch's.
const FORWARD = { Active: 'Active', Blocked: 'Blocked', Done: 'Active' };
// The trusted states a branch may move a part out of.
const OPEN = new Set(['Draft', 'Ready']);

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
      const [ref, tip, stamp] = line.split('\0');
      const name = ref.slice(PREFIX.length);
      if (name === 'HEAD' || name === trustedBranch) continue;
      const pr = open.get(name);
      // A tip's date is whatever its committer's clock said: one in the future counts as now, so it neither outranks
      // every other branch nor dates the page later than it was built; one that does not parse counts as the oldest.
      const parsed = Date.parse(stamp);
      const at = Number.isNaN(parsed) ? 0 : Math.min(parsed, now);
      if (!pr && now - at > maxAgeDays * DAY) continue;
      const date = !at ? null : at < parsed ? new Date(at).toISOString() : stamp;
      const fork = git('merge-base', base, tip);
      if (fork.status !== 0) { warnings.push(`live reading: a branch shares no history with ${trustedBranch}; skipped`); continue; }
      const changed = git('diff', '--name-only', '--no-renames', '-z', fork.stdout.trim(), tip, '--', `${recordsDir}/tasks/`);
      if (changed.status !== 0) { warnings.push('live reading: a branch could not be compared; skipped'); continue; }
      if (date && (!newest || Date.parse(date) > Date.parse(newest))) newest = date;
      for (const file of changed.stdout.split('\0').filter(f => f.endsWith('.md'))) {
        const shown = git('show', `${tip}:${file}`);
        const record = shown.status === 0 ? parseFrontMatter(shown.stdout).data : null; // removed on the branch: nothing to show
        if (typeof record?.id !== 'string' || !/^T-\d{4,}$/.test(record.id)) continue; // front matter is anyone's: only a task ID is an id
        if (file !== `${recordsDir}/tasks/${record.id}.md`) continue; // only the record named for a task speaks for it
        const seen = parts.get(record.id);
        if (seen && seen.at >= at) continue; // the newer branch wins
        parts.set(record.id, { record, at, checking: Boolean(pr && !pr.isDraft) });
      }
    }
  } catch (e) {
    return { parts: new Map(), newest: null, warnings: [...warnings, `live reading skipped: ${e.message}`] };
  }
  return { parts, newest, warnings };
}

// A signed-off milestone (`finished`: Accepted or Released on the trusted branch) is closed to branches: they neither
// add a part to it nor move one of its parts, so the page never shows a branch's part as done or one moving there.
export function overlayTasks(tasks, parts, milestoneIds, finished = new Set()) {
  const ids = new Set(tasks.map(t => t.id));
  const moved = (t, b) => {
    const status = Object.hasOwn(FORWARD, b.record.status) ? FORWARD[b.record.status] : null; // not a prototype name like constructor
    if (!status) return t;
    return { ...t, status, client_title: b.record.client_title ?? t.client_title, title: b.record.title ?? t.title, live: b.checking && status === 'Active' ? 'checking' : null };
  };
  // Over a trusted Active part a branch changes nothing but the label: an open pull request shows it Being checked.
  const checked = (t, b) => (t.status === 'Active' && b.checking && Object.hasOwn(FORWARD, b.record.status) && FORWARD[b.record.status] === 'Active' ? { ...t, live: 'checking' } : t);
  const out = tasks.map(t => { const b = parts.get(t.id); return b && !finished.has(t.milestone) ? OPEN.has(t.status) ? moved(t, b) : checked(t, b) : t; });
  for (const [id, b] of parts) {
    if (ids.has(id) || !milestoneIds.has(b.record.milestone) || finished.has(b.record.milestone)) continue;
    const added = moved({ id, milestone: b.record.milestone, status: 'Draft', title: null, client_title: null }, b);
    if (added.status !== 'Draft') out.push({ ...added, branchOnly: true });
  }
  return out;
}
