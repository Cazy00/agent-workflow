// Globs: `**` crosses directories, `**/` matches zero or more leading directories, `*` and `?` stay
// within one segment, `{a,b}` alternates. SCHEMA.md "Path classification".
const escape = (s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&');

export function globToRegExp(glob) {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 3; continue; }
        re += '.*'; i += 2; continue;
      }
      re += '[^/]*'; i += 1; continue;
    }
    if (c === '?') { re += '[^/]'; i += 1; continue; }
    if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end !== -1) {
        re += '(?:' + glob.slice(i + 1, end).split(',').map((s) => escape(s.trim())).join('|') + ')';
        i = end + 1; continue;
      }
    }
    re += escape(c); i += 1;
  }
  return new RegExp('^' + re + '$');
}

export const matchGlob = (glob, path) => globToRegExp(glob).test(path);

// v2.8.0 review X3: whether a glob matches some path below the folder `dir` that it pins there: `dir` is matched by the glob's
// literal part, `*` or `?`, never by a `**`, and then a `/` and some rest may follow. `src` reaches `src/auth/**`, `src/*/auth/**`
// and `apps/**/x` below `apps`, but not `src/*.sql` below `src/billing`, nor `**/*numbering*` (by name anywhere, so below any
// folder) below `tests`. Read token by token by the rules above, each `{a,b}` alternative in turn. A state is 2i before token
// i, or 2i+1 inside the `.*` of a `**/` at i.
const variants = glob => {
  let lists = [[]];
  for (let i = 0; i < glob.length;) {
    let add;
    if (glob.startsWith('**/', i)) { add = [[{ k: 'dirs' }]]; i += 3; }
    else if (glob.startsWith('**', i)) { add = [[{ k: 'any' }]]; i += 2; }
    else if (glob[i] === '*' || glob[i] === '?') { add = [[{ k: glob[i] === '*' ? 'star' : 'one' }]]; i += 1; }
    else if (glob[i] === '{' && glob.indexOf('}', i) !== -1) { const end = glob.indexOf('}', i); add = glob.slice(i + 1, end).split(',').map(s => [...s.trim()].map(c => ({ c }))); i = end + 1; }
    else { add = [[{ c: glob[i] }]]; i += 1; }
    lists = lists.flatMap(l => add.map(a => [...l, ...a]));
  }
  return lists;
};
export function matchesBelow(glob, dir) {
  return variants(glob).some(toks => {
    const close = set => { for (const s of set) if (s % 2 === 0 && ['dirs', 'any', 'star'].includes(toks[s / 2]?.k)) set.add(s + 2); return set; };
    const step = (set, ch, free) => { // free: a `**` may take ch
      const next = new Set();
      for (const s of set) {
        const i = s >> 1, t = toks[i];
        if (!t) continue;
        if (s % 2 || t.k === 'dirs') { if (free) { next.add(2 * i + 1); if (ch === '/') next.add(2 * i + 2); } }
        else if ((t.k === 'any' && free) || (t.k === 'star' && ch !== '/')) next.add(s);
        else if ((t.k === 'one' && ch !== '/') || t.c === ch) next.add(s + 2);
      }
      return close(next);
    };
    return step([...dir].reduce((set, ch) => step(set, ch, false), close(new Set([0]))), '/', true).size > 0;
  });
}
