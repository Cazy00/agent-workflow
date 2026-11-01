import { matchesBelow } from './glob.js';
const trim = p => p.replace(/^\.\//, '').replace(/\/+$/, '');
export function overlaps(a, b) {
  a = trim(a); b = trim(b);
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}
// The one test of a changed path against a task's scope, a list of path prefixes: readiness (a task's own changes) and the
// acceptance evidence (MAINT-0028, code after the milestone review) must read a scope the same way.
export const inTaskScope = (p, scopes) => scopes.some(s => p === s || p.startsWith(s.replace(/\/$/, '') + '/'));
// v2.8.0 review X3: a scope entry, a path prefix, overlaps a glob that pins a path below it (glob.js matchesBelow).
export const reachesBelow = (scope, glob) => matchesBelow(glob, trim(scope));
