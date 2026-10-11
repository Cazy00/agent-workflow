// History for the client page (MAINT-0014). A task record is removed once its milestone is accepted, so a finished
// step's parts are read from the last commit that had them; a part's done date is the first commit on the trusted
// branch where its record read `status: Done`. The trusted branch is its first-parent history, so a part merged by a
// merge commit is dated by the merge. The tasks directory's history is read once, on first use: one `git log` lists
// every version of every record and one `git cat-file --batch` reads them, where a Git call per record took minutes
// for a few hundred. Without history (a shallow clone) a removed record is simply missing and a date is the oldest
// commit available (no warning: that is how the clone is). If Git fails, every answer is null and `warnings` says so once.
import { gitRunner } from './git.js';
import { parseFrontMatter } from './frontmatter.js';

const ID = /^T-\d{4,}$/;
const NONE = /^0+$/; // the object name Git shows for the side of a change where the file does not exist
const LIMIT = 256 * 1024 * 1024;

function readHistory(repo, revision, recordsDir, fail) {
  // id -> its versions, oldest first: { date, blob } where it was added or changed, { removed: blob } where it was removed.
  const versions = new Map();
  const texts = new Map();
  const prefix = `${recordsDir}/tasks/`;
  const log = gitRunner(repo, { maxBuffer: LIMIT })('log', '--reverse', '--first-parent', '--diff-merges=first-parent', '--no-renames', '--no-abbrev', '--raw', '-z', '--format=commit %H %cI', revision, '--', prefix);
  if (log.error || log.status !== 0) { fail(); return { versions, texts }; }
  // With -z: `commit <sha> <date>` NUL, then per file `:<modes> <before> <after> <status>` NUL `<path>` NUL.
  const tokens = log.stdout.split('\0');
  let date = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].replace(/^\n/, '');
    if (token.startsWith('commit ')) { date = token.split(' ')[2]; continue; }
    if (!token.startsWith(':')) continue;
    const file = tokens[++i] ?? '';
    const [, , before, after, status] = token.slice(1).split(' ');
    const id = file.startsWith(prefix) && file.endsWith('.md') ? file.slice(prefix.length, -3) : '';
    if (!ID.test(id) || !date) continue;
    if (!versions.has(id)) versions.set(id, []);
    versions.get(id).push(status === 'D' ? { removed: before } : { date, blob: after });
  }
  const blobs = [...new Set([...versions.values()].flat().map(v => v.blob ?? v.removed).filter(b => /^[0-9a-f]{40,64}$/.test(b) && !NONE.test(b)))];
  if (!blobs.length) return { versions, texts };
  // `<sha> blob <size>` LF, the bytes, LF; or `<sha> missing` LF.
  const cat = gitRunner(repo, { maxBuffer: LIMIT, encoding: 'buffer', input: Buffer.from(`${blobs.join('\n')}\n`) })('cat-file', '--batch');
  if (cat.error || cat.status !== 0) { fail(); return { versions, texts }; }
  const out = cat.stdout;
  for (let at = 0; at < out.length;) {
    const eol = out.indexOf(10, at);
    if (eol === -1) break;
    const [sha, type, size] = out.toString('utf8', at, eol).split(' ');
    at = eol + 1;
    if (type !== 'blob') continue;
    texts.set(sha, out.toString('utf8', at, at + Number(size)));
    at += Number(size) + 1;
  }
  return { versions, texts };
}

export function gitHistory(repo, revision, recordsDir) {
  let read = null;
  const warnings = [];
  const fail = () => { if (!warnings.length) warnings.push('history could not be read from Git; finished parts and Recently done may be missing'); };
  const history = () => (read ??= readHistory(repo, revision, recordsDir, fail));
  const of = id => (ID.test(id) ? history().versions.get(id) : null) ?? [];
  const text = blob => (blob && history().texts.get(blob)) ?? null;
  return {
    warnings, // filled when history is first read, for the caller to print once the page is built
    // The record as it read before its last removal.
    lastVersion: id => text(of(id).findLast(v => v.removed)?.removed),
    // Done as every other reader of the records decides it, by the front matter, so `status:  Done` counts.
    doneDate: id => of(id).find(v => v.blob && parseFrontMatter(text(v.blob) ?? '').data?.status === 'Done')?.date ?? null,
  };
}
