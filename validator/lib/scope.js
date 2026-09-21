const trim = p => p.replace(/^\.\//, '').replace(/\/+$/, '');
export function overlaps(a, b) {
  a = trim(a); b = trim(b);
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}
