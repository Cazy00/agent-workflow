// `wf brief`: the owner's one page for a signing round (procedures/approval-evidence.md *Signing rounds*), rendered
// from the unsigned payload file itself, so what the owner reads is bound to what the owner signs: the file's digest
// heads the page. Payload text is untrusted: it is shown only in code spans or escaped cells, and nothing in it is
// followed. The brief approves nothing and replaces no evidence; it says where the owner's judgement is needed.
import { createHash } from 'node:crypto';

import { payloadProblems, readPayloads } from './payloads.js';
export { payloadProblems, readPayloads, PURPOSES } from './payloads.js';

const esc = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().replaceAll('|', '\\|').replaceAll('<', '&lt;');
const code = v => `\`${esc(v).replaceAll('`', "'")}\``;
const clip = (v, n) => { const s = esc(v); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const short = r => code(typeof r === 'string' ? r.slice(0, 12) : '?');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function attests(p) {
  switch (p.purpose) {
    case 'baseline': return 'you approve the governing records at this revision as the base for the next work';
    case 'governing-change': case 'workflow-change':
      return `you approve these ${p.purpose === 'workflow-change' ? 'protected workflow' : 'governing'} paths as changed here: ${(p.paths ?? []).map(code).join(', ')}`;
    case 'verification': {
      const tests = Array.isArray(p.execution?.tests) ? p.execution.tests : [];
      const passed = tests.filter(t => t?.status === 'passed').length;
      return `checks ${(p.checks ?? []).map(c => `${code(c?.name)} ${esc(c?.result)}`).join(', ')}; ${passed} of ${plural(tests.length, 'mapped test')} passed; environment ${code(p.environment)}`;
    }
    case 'integration': return `assembled-candidate checks ${(p.checks ?? []).map(c => `${code(c?.name)} ${esc(c?.result)}`).join(', ')}; environment ${code(p.environment)}`;
    case 'review': {
      const f = Array.isArray(p.findings) ? p.findings : [];
      const accepted = f.filter(x => x?.status === 'accepted').length;
      return `independent review by ${code(p.reviewer)} (implementer ${code(p.implementer)}); ${plural(f.length, 'finding')}, ${f.length - accepted} resolved and ${accepted} accepted`;
    }
    case 'acceptance': return `you accept the product behaviour for ${(p.scenarios ?? []).map(code).join(', ')}`;
    case 'release': return `you authorise releasing ${code(p.artifact)} (authority ${code(p.authority)})`;
    default: return 'unknown purpose: do not sign';
  }
}

// subject(revision) gives a commit subject when a repository is at hand; statusChanges lists records that change
// state in the round without a receipt of their own (planning paths), for the owner to see all the same.
export function renderBrief({ file, raw, now = Date.now(), subject = () => null, statusChanges = [] }) {
  const digest = createHash('sha256').update(raw).digest('hex');
  let payloads;
  try { payloads = readPayloads(raw); } catch (e) { return { ok: false, digest, problems: [e.message], markdown: `# Signing brief\n\nThe file ${code(file)} cannot be read: ${esc(e.message)}. Do not sign it.\n` }; }
  const problems = [];
  const seen = new Map();
  payloads.forEach((p, i) => {
    for (const e of payloadProblems(p, { now })) problems.push(`#${i + 1} ${p?.purpose ?? '?'} at ${short(p?.revision)}: ${e}`);
    const key = `${p?.purpose} ${p?.revision}`;
    if (seen.has(key)) problems.push(`#${i + 1} repeats #${seen.get(key)} (same purpose and revision): the gates reject both as ambiguous`);
    else seen.set(key, i + 1);
  });
  const repositories = [...new Set(payloads.map(p => p?.repository))];
  if (repositories.length > 1) problems.push(`the file names ${repositories.length} repositories`);
  const expiries = payloads.map(p => Date.parse(p?.expires_at)).filter(Number.isFinite).sort((a, b) => a - b);
  const lines = [];
  lines.push(`# Signing brief: ${esc(file.split('/').pop())}`, '');
  lines.push('Rendered by `wf brief` from the payload file; it approves nothing. Sign only the file with this digest, after reading what it asks you to judge.', '');
  lines.push(`- **File:** ${code(file)}`, `- **sha256:** \`${digest}\``, `- **Repository:** ${repositories.map(code).join(', ') || 'none'} · **Receipts:** ${payloads.length}${expiries.length ? ` · **Expire:** ${new Date(expiries[0]).toISOString().slice(0, 10)}${expiries.at(-1) !== expiries[0] ? ` to ${new Date(expiries.at(-1)).toISOString().slice(0, 10)}` : ''}` : ''}`, '');
  lines.push('## What you are signing', '', '| # | Purpose | Revision | Commit | What your signature says |', '|--:|---|---|---|---|');
  payloads.forEach((p, i) => lines.push(`| ${i + 1} | ${esc(p?.purpose)} | ${short(p?.revision)} | ${subject(p?.revision) ? code(clip(subject(p.revision), 60)) : '—'} | ${attests(p ?? {})} |`));
  lines.push('');
  const judge = [];
  for (const p of payloads.filter(p => p?.purpose === 'review')) {
    for (const f of (Array.isArray(p.findings) ? p.findings : []).filter(f => f?.status === 'accepted')) {
      judge.push(`- **Accepted, not fixed** at ${short(p.revision)}: ${code(f.id ?? '?')} ${esc(f.category ?? '')}${f.severity ? `, ${esc(f.severity)}` : ''}: ${clip(f.resolution, 300)}`);
    }
  }
  for (const p of payloads.filter(p => ['verification', 'integration'].includes(p?.purpose))) {
    for (const c of (Array.isArray(p.checks) ? p.checks : []).filter(c => c?.result !== 'passed')) judge.push(`- **Check not passed** at ${short(p.revision)}: ${code(c?.name)} is ${esc(c?.result)}`);
    const bad = (Array.isArray(p.execution?.tests) ? p.execution.tests : []).filter(t => t?.status !== 'passed');
    if (bad.length) judge.push(`- **Tests not passed** at ${short(p.revision)}: ${bad.slice(0, 10).map(t => code(`${t?.file} / ${t?.name}: ${t?.status}`)).join(', ')}${bad.length > 10 ? ` and ${bad.length - 10} more` : ''}`);
  }
  for (const p of payloads.filter(p => ['governing-change', 'workflow-change'].includes(p?.purpose))) judge.push(`- **Protected paths** changed at ${short(p.revision)} (${esc(p.purpose)}): ${(p.paths ?? []).map(code).join(', ')}. Read these diffs yourself.`);
  for (const p of payloads.filter(p => p?.purpose === 'acceptance')) judge.push(`- **Product acceptance** at ${short(p.revision)} for ${(p.scenarios ?? []).map(code).join(', ')}: sign only after you have tried the scenarios or watched them demonstrated.`);
  for (const c of statusChanges) judge.push(`- **Record changes with no receipt of their own:** ${code(c)}`);
  lines.push('## Needs your judgement', '', ...(judge.length ? judge : ['Nothing beyond the evidence counts below.']), '');
  if (problems.length) lines.push('## Problems: do not sign until fixed', '', ...problems.map(p => `- ${esc(p)}`), '');
  lines.push('<sub>The evidence itself (logs, the full review, test lists) is inside the payloads; a signature attests that you assessed it, not that the brief is complete.</sub>');
  return { ok: problems.length === 0, digest, problems, count: payloads.length, markdown: `${lines.join('\n')}\n` };
}
