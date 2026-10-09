// `wf brief`: the owner's one page for a signing round (procedures/approval-evidence.md *Signing rounds*), rendered
// from the unsigned payload file itself, so what the owner reads is bound to what the owner signs: the file's digest
// heads the page. Every piece of payload or repository text appears only inside a code span, where Markdown renders no
// link, image, emphasis or HTML; nothing in it is followed. The brief approves nothing and replaces no evidence; it
// says where the owner's judgement is needed and refuses a file the gates would reject.
import { createHash } from 'node:crypto';

import { payloadProblems, readPayloads } from './payloads.js';
import { showPath } from './git.js';
import { pendingNote, pendingRun } from './acceptance.js';
export { payloadProblems, readPayloads, PURPOSES } from './payloads.js';

// In prose, control, format and default-ignorable characters are shown as escapes and other whitespace collapses to
// one space; paths are shown exactly, as printable ASCII with escapes (git.js showPath).
const flat = v => String(v ?? '').replace(/[\t\n\r]+/g, ' ').replace(/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, c => `\\u{${c.codePointAt(0).toString(16)}}`).replace(/\s+/g, ' ').trim();
const clip = (v, n) => { const s = flat(v); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
// A code span that stays one table cell: no backtick can close it and a pipe is escaped for the table parser.
const code = (v, n = 300) => { const s = clip(v, n).replaceAll('`', "'").replaceAll('|', '\\|'); return s ? `\`${s}\`` : '`?`'; };
const short = r => code(typeof r === 'string' ? r.slice(0, 12) : '?');
const whole = v => { const s = showPath(v ?? '').replaceAll('`', "'").replaceAll('|', '\\|'); return s ? `\`${s}\`` : '`?`'; }; // never shortened
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const checkList = p => (Array.isArray(p.checks) ? p.checks : []).map(c => `${code(c?.name, 80)} ${code(c?.result, 20)}`).join(', ');

function attests(p) {
  switch (p.purpose) {
    case 'baseline': return 'you approve the governing records at this revision as the base for the next work';
    case 'governing-change': case 'workflow-change':
      return `you approve these ${p.purpose === 'workflow-change' ? 'protected workflow' : 'governing'} paths as changed here: ${(Array.isArray(p.paths) ? p.paths : []).map(whole).join(', ')}`;
    case 'verification': {
      const tests = Array.isArray(p.execution?.tests) ? p.execution.tests : [];
      return `checks ${checkList(p)}; ${tests.filter(t => t?.status === 'passed').length} of ${plural(tests.length, 'test')} in the run passed; environment ${code(p.environment, 100)}`;
    }
    case 'integration': return `assembled-candidate checks ${checkList(p)}; environment ${code(p.environment, 100)}`;
    case 'review': {
      const f = Array.isArray(p.findings) ? p.findings : [];
      const accepted = f.filter(x => x?.status === 'accepted').length;
      return `independent review by ${code(p.reviewer, 80)} (implementer ${code(p.implementer, 80)}); ${plural(f.length, 'finding')}, ${f.length - accepted} resolved and ${accepted} accepted`;
    }
    case 'acceptance': return `you accept the product behaviour for ${(Array.isArray(p.scenarios) ? p.scenarios : []).map(x => code(x)).join(', ')}`;
    case 'release': return `you authorise releasing ${code(p.artifact)} (authority ${code(p.authority)})`;
    default: return 'unknown purpose: do not sign';
  }
}

// With a repository at hand, subject(revision) gives a commit subject, mapped(revision) the tests its acceptance map
// names (they must run once and pass; unmapped tests may be skipped), pending(revision) the scenarios whose mapped tests
// may still fail at that revision, or null (acceptance.js pendingIn, as cli.js works it out), requiredChecks the approved profile's required
// checks, and changes what the round changes from the baseline to its end that no payload covers, judged by category as
// a derived baseline judges it: `records` (task and feedback records, which ride along without a receipt) and
// `uncovered` ([path, what it needs]), or `unknown` with the reason they could not be listed.
// With `attest` in the approved config, verification and integration come from the owner's own `wf attest` run
// (procedures/approval-evidence.md *Attested evidence*): a round file the agent staged must not carry them.
export function renderBrief({ file, raw, now = Date.now(), subject = () => null, mapped = null, pending = null, requiredChecks = null, changes = null, attestConfigured = false }) {
  const digest = createHash('sha256').update(raw).digest('hex');
  let payloads;
  try { payloads = readPayloads(raw); } catch (e) { return { ok: false, digest, problems: [e.message], markdown: `# Signing brief\n\nThe file ${code(file)} cannot be read: ${code(e.message)}. Do not sign it.\n` }; }
  const problems = [];
  const waived = [];
  const seen = new Map();
  payloads.forEach((p, i) => {
    const at = `#${i + 1} ${flat(p?.purpose ?? '?')} at ${clip(p?.revision, 12)}`;
    for (const e of payloadProblems(p, { now })) problems.push(`${at}: ${e}`);
    if (['verification', 'integration'].includes(p?.purpose)) {
      for (const c of (Array.isArray(p.checks) ? p.checks : []).filter(c => c?.result !== 'passed')) problems.push(`${at}: check ${clip(c?.name, 80)} is ${clip(c?.result, 20)}; every check must pass`);
      for (const name of requiredChecks ?? []) if (!(Array.isArray(p.checks) ? p.checks : []).some(c => c?.name === name)) problems.push(`${at}: the profile's required check ${name} is missing`);
    }
    if (p?.purpose === 'verification' && mapped) {
      const tests = Array.isArray(p.execution?.tests) ? p.execution.tests : [];
      const required = mapped(p.revision);
      if (required === null) problems.push(`${at}: the acceptance map at this revision cannot be read`);
      for (const m of required ?? []) {
        const runs = tests.filter(t => t?.file === m?.file && t?.name === m?.name);
        if (runs.length === 1 && runs[0].status === 'passed') continue;
        const waiting = pending?.(p.revision)?.get(m?.acceptance);
        if (waiting && runs.length === 1) waived.push(`- **Pending acceptance test** at ${short(p.revision)}: ${code(pendingNote(pendingRun(m, runs, waiting)), 400)}. The gates refuse it in the round that delivers one of those tasks.`);
        else problems.push(`${at}: mapped test ${clip(m?.file, 80)} / ${clip(m?.name, 120)} ran ${runs.length} time(s)${runs.length === 1 ? `, ${clip(runs[0].status, 20)}` : ''}; ${waiting ? 'a pending test must still run once' : 'it must run once and pass'}`);
      }
    }
    if (attestConfigured && ['verification', 'integration'].includes(p?.purpose) && p.attested?.tool !== 'wf attest') problems.push(`${at}: this project runs wf attest, so verification and integration come from your own attest run, not from a payload the agent wrote`);
    const key = `${p?.purpose} ${p?.revision}`;
    if (seen.has(key)) problems.push(`#${i + 1} repeats #${seen.get(key)} (same purpose and revision): the gates reject both as ambiguous`);
    else seen.set(key, i + 1);
  });
  const repositories = [...new Set(payloads.map(p => p?.repository))];
  if (repositories.length > 1) problems.push(`the file names ${repositories.length} repositories`);
  const expiries = payloads.map(p => Date.parse(p?.expires_at)).filter(Number.isFinite).sort((a, b) => a - b);
  const lines = [];
  lines.push(`# Signing brief: ${code(file.split('/').pop(), 80)}`, '');
  lines.push('Rendered by `wf brief` from the payload file; it approves nothing. Sign only the file with this digest, after reading what it asks you to judge.', '');
  lines.push(`- **File:** ${code(file, 200)}`, `- **sha256:** \`${digest}\``, `- **Repository:** ${repositories.map(r => code(r, 80)).join(', ') || 'none'} · **Receipts:** ${payloads.length}${expiries.length ? ` · **Expire:** ${new Date(expiries[0]).toISOString().slice(0, 10)}${expiries.at(-1) !== expiries[0] ? ` to ${new Date(expiries.at(-1)).toISOString().slice(0, 10)}` : ''}` : ''}`, '');
  lines.push('## What you are signing', '', '| # | Purpose | Revision | Commit | What your signature says |', '|--:|---|---|---|---|');
  payloads.forEach((p, i) => lines.push(`| ${i + 1} | ${code(p?.purpose, 20)} | ${short(p?.revision)} | ${subject(p?.revision) ? code(subject(p.revision), 60) : '—'} | ${attests(p ?? {})} |`));
  lines.push('');
  const judge = [...waived];
  // Accepted findings above a note one by one; accepted notes on one line, with their resolutions beneath.
  for (const p of payloads.filter(p => p?.purpose === 'review')) {
    const accepted = (Array.isArray(p.findings) ? p.findings : []).filter(f => f?.status === 'accepted');
    const notes = accepted.filter(f => /^note\b/i.test(String(f.severity ?? '')));
    for (const f of accepted.filter(f => !notes.includes(f))) judge.push(`- **Accepted, not fixed** at ${short(p.revision)}: ${code(f.id, 30)} ${code(f.category ?? 'no category', 40)} ${code(f.severity ?? 'severity not given', 30)}: ${code(f.resolution)}`);
    if (notes.length) judge.push(`- **${plural(notes.length, 'note')} accepted** at ${short(p.revision)}: ${notes.map(f => code(f.id, 30)).join(', ')}`, ...notes.map(f => `  - ${code(f.id, 30)}: ${code(f.resolution, 200)}`));
  }
  for (const p of payloads.filter(p => p?.purpose === 'verification')) {
    const tests = Array.isArray(p.execution?.tests) ? p.execution.tests : [];
    const required = mapped ? mapped(p.revision) ?? [] : null;
    const other = tests.filter(t => t?.status !== 'passed' && !(required ?? []).some(m => m?.file === t?.file && m?.name === t?.name));
    if (other.length) judge.push(`- **${plural(other.length, 'test')} not passed** at ${short(p.revision)}${required ? ', none mapped to acceptance' : '; with `--repo` the brief checks whether any is mapped'}: ${other.slice(0, 5).map(t => code(`${flat(t?.name)}: ${flat(t?.status)}`, 120)).join(', ')}${other.length > 5 ? ` and ${other.length - 5} more` : ''}`);
  }
  for (const p of payloads.filter(p => ['verification', 'integration'].includes(p?.purpose) && p.attested?.tool === 'wf attest')) judge.push(`- **From \`wf attest\`** at ${short(p.revision)} (${p.purpose}): ${p.attested.sandbox ? `sandboxed by ${code(p.attested.sandbox.launcher, 60)}` : '**unsandboxed**, in an account that could not read the protected paths'}. Sign it only if you ran that attest yourself and this file is the one it wrote.`);
  for (const p of payloads.filter(p => ['governing-change', 'workflow-change'].includes(p?.purpose))) judge.push(`- **Protected paths** changed at ${short(p.revision)} (${p.purpose}): ${(Array.isArray(p.paths) ? p.paths : []).map(whole).join(', ')}. Read these diffs yourself.`);
  for (const p of payloads.filter(p => p?.purpose === 'acceptance')) judge.push(`- **Product acceptance** at ${short(p.revision)} for ${(Array.isArray(p.scenarios) ? p.scenarios : []).map(x => code(x)).join(', ')}: sign only after you have tried the scenarios or watched them demonstrated.`);
  if (changes?.unknown) judge.push(`- **Paths changed in the round** could not be listed: ${code(changes.unknown)}`);
  for (const c of changes?.records ?? []) judge.push(`- **Record change with no receipt of its own:** ${typeof c === 'string' ? code(c) : whole(c.path)}`);
  if (changes?.uncovered?.length) judge.push(`- **Changed with no payload covering it** (a derived baseline refuses these; cover each or leave it out): ${changes.uncovered.map(([f, why]) => `${whole(f)} (${why})`).join(', ')}`);
  lines.push('## Needs your judgement', '', ...(judge.length ? judge : ['Nothing beyond the evidence counts above.']), '');
  if (problems.length) lines.push('## Problems: do not sign until fixed', '', ...problems.map(p => `- ${code(p, 400)}`), '');
  lines.push('<sub>The evidence itself (logs, the full review, test lists) is inside the payloads; a signature attests that you assessed it, not that the brief is complete.</sub>');
  return { ok: problems.length === 0, digest, problems, count: payloads.length, markdown: `${lines.join('\n')}\n` };
}
