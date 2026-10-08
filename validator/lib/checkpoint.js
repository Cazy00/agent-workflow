// Owner-merge checkpoints (MAINT-0010, procedures/setup.md *Choose the arrangement*): where the agent stops for the
// owner. `change`: the owner merges every pull request. `milestone`: the agent merges a task's pull request once the
// gates pass, and stops when a milestone is finished until the owner accepts it. `plan`: as `milestone`, without the
// stop between authorised milestones. Without a checkpoint the owner merges every pull request and nothing is held,
// as before. The quality gates are the same in all of them; only the owner's stops differ.
export const CHECKPOINTS = ['change', 'milestone', 'plan'];
const OPEN = ['Authorised', 'Active', 'Blocked', 'Verified']; // authorised and not yet accepted

// The baseline config's checkpoint; only owner-merge has one (records.js refuses it elsewhere).
export const checkpointOf = config => (config?.approval?.label === 'owner-merge' ? config.approval.checkpoint ?? null : null);
// Whether the agent may merge a task's pull request at all under this checkpoint; the gate still decides each one.
export const agentMerges = checkpoint => checkpoint === 'milestone' || checkpoint === 'plan';

// With checkpoint change or milestone, only the earliest authorised milestone the owner has not accepted is open; the
// later ones wait for that acceptance. Returns that milestone and the held ones, or null when nothing is held.
export function milestoneHold({ checkpoint, milestones }) {
  if (checkpoint !== 'change' && checkpoint !== 'milestone') return null;
  const open = [...milestones.values()].map(r => r.data).filter(m => m?.id && OPEN.includes(m.status)).map(m => m.id).sort();
  if (open.length < 2) return null;
  return { first: open[0], held: new Set(open.slice(1)) };
}
