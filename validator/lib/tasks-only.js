// MAINT-0026: a tasks-only change to a milestone record, and the plan revision the acceptance walks back to.
// Under approval.defer_to_acceptance the owner approves a task appended to an Authorised or Active milestone's `tasks:` at the
// milestone's acceptance, where the acceptance evidence lists it, not with a merge of its own. `tasksOnlyChange` is the one
// judge of that (wf ci, readiness); `lastPlanRevision` finds, for the acceptance, the trusted branch's last change of the
// record that was not one.
import { DIRS, list, loadAll } from './records.js';
import { parseFrontMatter } from './frontmatter.js';
import { classifyPaths } from './paths.js';
import { agentMerges, checkpointOf } from './checkpoint.js';

const ID = /^T-\d{4}$/;
const OPEN = ['Authorised', 'Active'];

// The one switch: the owner chose defer_to_acceptance, which only a checkpoint of milestone or plan allows.
export const deferring = config => config?.approval?.label === 'owner-merge' && config.approval.defer_to_acceptance === true && agentMerges(checkpointOf(config));
export const milestonePathOf = (rd, id) => `${rd}/${DIRS.milestone}/${id}.md`;
export const isMilestonePath = (rd, p) => new RegExp(`^${rd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${DIRS.milestone}/M-\\d{4}\\.md$`).test(p);

// The record's text without the front matter line for `key`, found as the parser finds it, so what is compared byte for byte is
// every other line: comments, layout and body. Null when there is no readable front matter or the key is not exactly one line.
function without(raw, key) {
  if (typeof raw !== 'string') return null;
  const lines = raw.split('\n');
  const bare = l => l.replace(/\r$/, '');
  if (bare(lines[0]) !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && bare(l) === '---');
  if (end === -1) return null;
  const at = lines.map((l, i) => (i > 0 && i < end && l.trim().match(/^([A-Za-z_][\w-]*):/)?.[1] === key ? i : -1)).filter(i => i >= 0);
  if (at.length > 1) return null;
  return at.length ? lines.filter((_, i) => i !== at[0]).join('\n') : raw;
}
const parsed = raw => { const p = parseFrontMatter(raw ?? ''); return p.data && !p.errors.length ? p.data : null; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isIds = v => Array.isArray(v) && v.every(x => ID.test(x)) && new Set(v).size === v.length;

// Whether `cand` changes milestone record `path` from `base` (the trusted side) by appending task ids to `tasks:` and by nothing
// else. { ok: true, added } or { ok: false, why }. A change qualifies only when all of these hold:
// - defer_to_acceptance is chosen and the record is governing (where it is not, the owner's merge stays the approval, as in
//   MAINT-0024), and the record is Authorised or Active on `base`: a Draft is the plan's own approval, a Verified or
//   Accepted one is past the build;
// - both sides parse, and the text without the `tasks` line is byte-identical, which covers the body, the status, every other
//   key and the comments and layout, and the parsed keys other than `tasks` are equal as the validator reads them;
// - `tasks` is a list of distinct T-NNNN ids on both sides (an inline list; the parser reads no block list), and the
//   candidate's keeps every trusted id in order and only appends;
// - each added id has a task record in the candidate whose `milestone:` is this one. Whether a scenario then waits on it is
//   not asked: under defer_to_acceptance `wf ci` defers that change already (ci.js `later`).
export function tasksOnlyChange({ config, rd = 'docs/workflow', base, cand, path, records = null }) {
  if (!deferring(config)) return { ok: false, why: 'approval.defer_to_acceptance is not chosen' };
  if (!isMilestonePath(rd, path)) return { ok: false, why: `${path} is not a milestone record` };
  if (classifyPaths(config, [path])[0]?.category !== 'governing') return { ok: false, why: `${path} is not governing in the trusted config` };
  const [was, now] = [base.read(path), cand.read(path)];
  if (was == null) return { ok: false, why: `${path} is not on the trusted branch` };
  if (now == null) return { ok: false, why: `${path} is removed` };
  const [b, c] = [parsed(was), parsed(now)];
  if (!b || !c) return { ok: false, why: 'the front matter does not parse' };
  if (!OPEN.includes(b.status)) return { ok: false, why: `${b.id ?? path} is ${b.status ?? 'without a status'} on the trusted branch; only an Authorised or Active milestone takes tasks` };
  const [rest, restNow] = [without(was, 'tasks'), without(now, 'tasks')];
  if (rest == null || restNow == null) return { ok: false, why: 'the tasks entry is not a single front matter line' };
  const { tasks: bt, ...bRest } = b, { tasks: ct, ...cRest } = c;
  if (rest !== restNow || !same(bRest, cRest)) return { ok: false, why: 'it changes more than the tasks entry (status, scope, acceptance, limits, found_tasks, the body or the layout)' };
  if (!isIds(bt) || !isIds(ct)) return { ok: false, why: 'tasks is not a list of task ids' };
  if (ct.length < bt.length || !bt.every((id, i) => ct[i] === id)) return { ok: false, why: 'it drops or reorders planned tasks' };
  const added = ct.slice(bt.length);
  if (added.length) {
    const tasks = (records ?? loadAll(cand, rd)).tasks;
    const stray = added.filter(id => tasks.get(id)?.data?.milestone !== c.id);
    if (stray.length) return { ok: false, why: `${stray.join(', ')} has no task record naming ${c.id} as its milestone in the candidate` };
  }
  return { ok: true, added };
}

// A bare status move Authorised to Active: the tasks start, the plan does not change.
const statusMove = (was, now) => {
  const [b, c] = [parsed(was), parsed(now)], [rest, restNow] = [without(was, 'status'), without(now, 'status')];
  return !!b && !!c && b.status === 'Authorised' && c.status === 'Active' && rest != null && rest === restNow;
};

// The ids a milestone's acceptance must list as deferred: the ids in its `tasks:` now that its last plan revision did not hold.
// `trusted` is the trusted branch at the acceptance's base. Its first-parent history of the record is walked back, newest first;
// each change (a commit against its first parent) is judged by tasksOnlyChange or is a bare status move. The first change that is
// neither is the plan's last revision: a creation, a re-plan, any other edit. Fails closed ({ error }) when the history cannot be
// read or no plan revision is found.
export function lastPlanRevision({ config, rd = 'docs/workflow', trusted, milestone }) {
  const path = milestonePathOf(rd, milestone);
  if (trusted?.kind !== 'git') return { error: 'the trusted branch is not a Git history' };
  try {
    if (trusted.isShallow()) return { error: 'the clone is shallow' };
    for (const c of trusted.firstParentVersions(path)) {
      const at = trusted.atRevision(c), parent = at.parents()?.[0];
      if (!parent) return { revision: c, tasks: list(parsed(at.read(path))?.tasks) };
      const before = trusted.atRevision(parent);
      if (!before.exists(path)) return { revision: c, tasks: list(parsed(at.read(path))?.tasks) };
      if (tasksOnlyChange({ config, rd, base: before, cand: at, path }).ok || statusMove(before.read(path), at.read(path))) continue;
      return { revision: c, tasks: list(parsed(at.read(path))?.tasks) };
    }
    return { error: `the trusted branch's history shows no revision that planned ${milestone}` };
  } catch (e) {
    return { error: `the trusted branch's history of ${path} cannot be read (${e.message})` };
  }
}

// The deferred lines owed for `milestone`, or the reason they cannot be computed.
export function owedTasks({ config, rd = 'docs/workflow', trusted, milestone, now }) {
  const current = list(now?.tasks);
  if (!deferring(config) || !current.length) return { ids: [] };
  const plan = lastPlanRevision({ config, rd, trusted, milestone });
  if (plan.error) return { error: plan.error };
  return { ids: current.filter(id => !plan.tasks.includes(id)), revision: plan.revision };
}
