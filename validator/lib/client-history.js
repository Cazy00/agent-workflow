// History for the client page (MAINT-0014). A task record is removed once its milestone is accepted, so a finished
// step's parts are read from the last commit that had them; a part's done date is the first commit on the trusted
// branch where its record read `status: Done`. Every answer is read once. Without history (a shallow clone), a removed
// record is simply missing and a date is the oldest commit available.
import { gitRunner } from './git.js';

const ID = /^T-\d{4,}$/;
export function gitHistory(repo, revision, recordsDir) {
  const git = gitRunner(repo, { maxBuffer: 16 * 1024 * 1024 });
  const cache = new Map();
  const once = (key, read) => { if (!cache.has(key)) cache.set(key, read()); return cache.get(key); };
  const file = id => `${recordsDir}/tasks/${id}.md`;
  return {
    lastVersion: id => once(`record ${id}`, () => {
      if (!ID.test(id)) return null;
      const removed = git('log', '-1', '--format=%H', '--diff-filter=D', revision, '--', file(id));
      const commit = removed.status === 0 ? removed.stdout.trim() : '';
      if (!commit) return null;
      const before = git('show', `${commit}^:${file(id)}`);
      return before.status === 0 ? before.stdout : null;
    }),
    doneDate: id => once(`done ${id}`, () => {
      if (!ID.test(id)) return null;
      const r = git('log', '--reverse', '--format=%H %cI', '-S', 'status: Done', revision, '--', file(id));
      for (const line of r.status === 0 ? r.stdout.split('\n').filter(Boolean) : []) {
        const [commit, date] = line.split(' ');
        const at = git('show', `${commit}:${file(id)}`);
        if (at.status === 0 && /^status:\s*Done\s*$/m.test(at.stdout)) return date;
      }
      return null;
    }),
  };
}
