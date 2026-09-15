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
