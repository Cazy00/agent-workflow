import { matchesBelow } from './glob.js';
const trim = p => p.replace(/^\.\//, '').replace(/\/+$/, '');
export function overlaps(a, b) {
  a = trim(a); b = trim(b);
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}
// v2.8.0 review X3: a scope entry, a path prefix, overlaps a glob that pins a path below it (glob.js matchesBelow).
export const reachesBelow = (scope, glob) => matchesBelow(glob, trim(scope));
