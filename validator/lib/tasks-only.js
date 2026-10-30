// MAINT-0026: a tasks-only change to a milestone record.
// Under approval.defer_to_acceptance the owner approves a task appended to an Authorised or Active milestone's `tasks:` at the
// milestone's acceptance, where the acceptance evidence lists it, not with a merge of its own. `tasksOnlyChange` is the one
// judge of that (wf ci, readiness). The ids the acceptance then owes are worked out in acceptance-evidence.js (`owedTasks`).
import { DIRS, loadAll } from './records.js';
import { parseFrontMatter } from './frontmatter.js';
import { classifyPaths } from './paths.js';
import { agentMerges, checkpointOf } from './checkpoint.js';

const ID = /^T-\d{4}$/;
const OPEN = ['Authorised', 'Active'];

// The one switch: the owner chose defer_to_acceptance, which only a checkpoint of milestone or plan allows, and the project checks
// the acceptance evidence, which is where the appended tasks are listed (review S2): without it nothing would ever list them.
export const deferring = config => config?.approval?.label === 'owner-merge' && config.approval.defer_to_acceptance === true && config.acceptance_evidence === true && agentMerges(checkpointOf(config));
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
// - defer_to_acceptance and acceptance_evidence are chosen and the record is governing (where it is not, the owner's merge stays the approval, as in
//   MAINT-0024), and the record is Authorised or Active on `base`: a Draft is the plan's own approval, a Verified or
//   Accepted one is past the build;
// - both sides parse, and the text without the `tasks` line is byte-identical, which covers the body, the status, every other
//   key and the comments and layout, and the parsed keys other than `tasks` are equal as the validator reads them;
// - `tasks` is a list of distinct T-NNNN ids on both sides (an inline list; the parser reads no block list), and the
//   candidate's keeps every trusted id in order and only appends;
// - each added id has a task record in the candidate whose `milestone:` is this one. Whether a scenario then waits on it is
//   not asked: under defer_to_acceptance `wf ci` defers that change already (ci.js `later`).
export function tasksOnlyChange({ config, rd = 'docs/workflow', base, cand, path, records = null }) {
  if (!deferring(config)) return { ok: false, why: 'approval.defer_to_acceptance and acceptance_evidence are not both chosen' };
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
