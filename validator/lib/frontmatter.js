// Front matter: a leading `---` line, `key: value` lines, a closing `---`. SCHEMA.md "Front matter".
export function parseFrontMatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return { data: null, body: text, errors: [] };
  const end = lines.indexOf('---', 1);
  if (end === -1) return { data: null, body: text, errors: ['front matter is not closed with ---'] };
  const data = {};
  const errors = [];
  for (const raw of lines.slice(1, end)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) { errors.push(`unparseable front matter line: ${raw}`); continue; }
    if (Object.hasOwn(data, m[1])) { errors.push(`duplicate front matter key: ${m[1]}`); continue; }
    if (['__proto__', 'constructor', 'prototype'].includes(m[1])) { errors.push(`invalid front matter key: ${m[1]}`); continue; }
    data[m[1]] = parseValue(m[2]);
  }
  return { data, body: lines.slice(end + 1).join('\n'), errors };
}

function parseValue(v) {
  v = v.trim();
  if (v === '') return null;
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return v;
}
