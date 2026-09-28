import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safePath } from '../../validator/lib/sources.js';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const digest = value => sha256(JSON.stringify(canonical(value)));
export function contained(root, relative) {
  safePath(relative);
  const base = fs.realpathSync(root);
  let current = base;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`symlink refused: ${relative}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return current;
}
export function inventory(root, prefix = '') {
  const directory = prefix ? contained(root, prefix) : fs.realpathSync(root);
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`symlink refused: ${rel}`);
    if (entry.isDirectory()) result.push(...inventory(root, rel));
    else if (entry.isFile()) result.push(rel);
    else throw new Error(`non-regular file refused: ${rel}`);
  }
  return result.sort();
}
export function read(root, rel) { return fs.readFileSync(contained(root, rel)); }
export function writeNew(root, rel, bytes) {
  const target = contained(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Exclusive creation protects an existing target, including a concurrent writer.
  fs.writeFileSync(target, bytes, { flag: 'wx' });
}
