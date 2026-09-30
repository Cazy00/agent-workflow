// Optional agent-operated routine delivery. It is off unless the baseline config sets delegation.routine.enabled,
// and it only adds requirements: readiness, protected-path approvals, test traceability and every other gate still
// run outside it and can still fail. When it is on, a production candidate needs either
//   (a) owner review: `ownerApproved` from the caller's authenticated exact-head approval collector, never from
//       evidence JSON; or
//   (b) the routine lane: a small change confined to the owner's routine paths, for named baseline-Ready tasks
//       without risks, decisions or deferred inputs, with agent-attested evidence bound to the exact candidate.
// The evidence is produced by the agent and is not authenticated; the owner opts into that limitation with
// evidence_assurance: agent-attested. Path rules are conservative heuristics, not semantic risk inference: a file in
// a routine path can still affect money or permissions. Product acceptance and release are never delegated.
import { list } from './records.js';

export const LIMITS = Object.freeze({ max_files: 500, max_changed_lines: 20000 });
const CONFIG_KEYS = ['enabled', 'paths', 'reserved_paths', 'max_files', 'max_changed_lines', 'evidence_assurance'];
const REVIEW_AREAS = ['scope', 'correctness', 'maintainability', 'security', 'regression', 'test-fidelity'];
const OWNER_CATEGORIES = ['governing', 'enforcement', 'generated', 'unclassified'];
const TASK_REFERENCES = ['milestone', 'owner', 'feature', 'design', 'feature_readiness', 'scope', 'governing', 'prerequisites', 'decisions', 'deferred_inputs', 'acceptance', 'risks'];
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const TASK_ID = /^T-\d{4}$/;
const SEGMENT = /^[A-Za-z0-9@_-][A-Za-z0-9@._-]*$/;

// Paths that always need the owner, whatever the routine list says: tests and acceptance mappings, dependency and
// build manifests, migrations and schemas, infrastructure and deployment, environment and tool configuration, and
// names suggesting authentication, security, money or stock.
const RESERVED_BASENAMES = /^(package(-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-(lock|workspace)\.yaml|bun\.lockb?|go\.(mod|sum)|Cargo\.(toml|lock)|requirements[\w.-]*\.txt|pyproject\.toml|poetry\.lock|uv\.lock|Pipfile(\.lock)?|setup\.(py|cfg)|Gemfile(\.lock)?|composer\.(json|lock)|pubspec\.(yaml|lock)|pom\.xml|(build|settings)\.gradle(\.kts)?|gradle\.properties|deno\.(json|lock)|packages\.lock\.json|[^/]+\.(csproj|sln)|Dockerfile[^/]*|(docker-)?compose[^/]*\.ya?ml|Makefile|Procfile|\.env[^/]*|tsconfig[^/]*\.json|[^/]+\.config\.[^/]+|vercel\.json|netlify\.toml|wrangler\.toml|fly\.toml|CODEOWNERS|acceptance-map\.json)$/i;
const RESERVED_EXTENSIONS = /\.(sql|prisma|tf|tfvars|pem|key|p12)$/i;
const TEST_FILE = /\.(test|spec)\.[^/]+$/i;
const RESERVED_SEGMENTS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'fixtures', 'migration', 'migrations', 'migrate', 'db', 'database',
  'schema', 'schemas', 'prisma', 'infra', 'infrastructure', 'terraform', 'deploy', 'deployment', 'deployments', 'k8s', 'kubernetes', 'helm', '.github',
  'scripts', 'docs']);
const RESERVED_WORDS = new Set(['auth', 'oauth', 'authn', 'authz', 'login', 'logout', 'signin', 'signup', 'session', 'sessions', 'permission', 'permissions',
  'rbac', 'acl', 'role', 'roles', 'admin', 'security', 'crypto', 'secret', 'secrets', 'token', 'tokens', 'password', 'passwords', 'credential',
  'credentials', 'payment', 'payments', 'billing', 'checkout', 'invoice', 'invoices', 'price', 'prices', 'pricing', 'stripe', 'wallet', 'money',
  'refund', 'refunds', 'tax', 'taxes', 'currency', 'stock', 'inventory', 'webhook', 'webhooks']);

const words = segment => segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
export function fixedReserved(path) {
  const segments = path.split('/');
  const base = segments.at(-1);
  if (RESERVED_BASENAMES.test(base) || RESERVED_EXTENSIONS.test(base) || TEST_FILE.test(base)) return true;
  if (segments.slice(0, -1).some(s => RESERVED_SEGMENTS.has(s.toLowerCase()))) return true;
  return segments.some(s => words(s).some(w => RESERVED_WORDS.has(w)));
}

// An exact path, or a directory followed by a terminal `/**`; at least two path components; nothing else.
export function patternError(pattern) {
  if (typeof pattern !== 'string' || !pattern) return 'must be a nonempty string';
  const body = pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern;
  const segments = body.split('/');
  if (segments.some(s => !SEGMENT.test(s) || s === '.' || s === '..')) return 'may contain only plain path components and a terminal /**';
  if (segments.length < 2) return 'needs at least two path components (no root-wide or top-level patterns such as src/**)';
  return null;
}
const matches = (pattern, path) => pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -2)) : path === pattern;
const within = (scope, path) => { const p = String(scope).replace(/\/+$/, ''); return path === p || path.startsWith(`${p}/`); };

function configErrors(routine) {
  const errors = [];
  if (typeof routine !== 'object' || routine === null || Array.isArray(routine)) return ['delegation.routine must be an object'];
  for (const k of Object.keys(routine)) if (!CONFIG_KEYS.includes(k)) errors.push(`delegation.routine has an unknown option ${k}`);
  for (const key of ['paths', 'reserved_paths']) {
    const v = routine[key];
    if (!Array.isArray(v) || !v.length) { errors.push(`delegation.routine.${key} must be a nonempty list`); continue; }
    for (const p of v) { const e = patternError(p); if (e) errors.push(`delegation.routine.${key} ${JSON.stringify(p)} ${e}`); }
  }
  for (const key of ['max_files', 'max_changed_lines']) {
    const v = routine[key];
    if (!Number.isInteger(v) || v < 1 || v > LIMITS[key]) errors.push(`delegation.routine.${key} must be an integer from 1 to ${LIMITS[key]}`);
  }
  if (routine.evidence_assurance !== 'agent-attested') errors.push('delegation.routine.evidence_assurance must be agent-attested: the owner accepts that routine evidence is produced by the agent and not authenticated');
  return errors;
}

// Why the candidate cannot use the routine lane. An empty list means it is eligible.
function ineligibility({ routine, baselineTasks, tasks, taskIds, classes, changedLines }) {
  const reasons = [];
  const production = classes.filter(c => c.category === 'production').map(c => c.path);
  for (const c of classes) if (OWNER_CATEGORIES.includes(c.category)) reasons.push(`${c.category} path ${c.path}`);
  for (const c of classes) {
    if (c.category === 'planning') continue;
    if (routine.reserved_paths.some(p => matches(p, c.path))) reasons.push(`reserved path ${c.path}`);
    else if (fixedReserved(c.path)) reasons.push(`path ${c.path} is a test, dependency, migration, infrastructure, configuration, authentication, security or money path`);
  }
  for (const p of production) if (!routine.paths.some(r => matches(r, p))) reasons.push(`production path ${p} is outside delegation.routine.paths`);
  if (classes.length > routine.max_files) reasons.push(`${classes.length} changed files exceed max_files ${routine.max_files}`);
  if (!Number.isInteger(changedLines) || changedLines < 0) reasons.push('changed lines are unknown (binary or unmeasured change)');
  else if (changedLines > routine.max_changed_lines) reasons.push(`${changedLines} changed lines exceed max_changed_lines ${routine.max_changed_lines}`);

  const ids = Array.isArray(taskIds) ? taskIds : [];
  if (!ids.length) reasons.push('no task is named for this candidate');
  if (new Set(ids).size !== ids.length) reasons.push('a task is named twice');
  const base = new Map(baselineTasks.filter(t => t?.id).map(t => [t.id, t]));
  const cand = new Map(tasks.filter(t => t?.id).map(t => [t.id, t]));
  const owners = new Set(), milestones = new Set();
  for (const id of ids) {
    if (!TASK_ID.test(id)) { reasons.push(`${JSON.stringify(id)} is not a task ID`); continue; }
    const b = base.get(id), c = cand.get(id);
    if (!b) { reasons.push(`${id} is not on the baseline`); continue; }
    if (!['Ready', 'Active'].includes(b.status)) reasons.push(`${id} is ${b.status} on the baseline, not Ready or Active`);
    if (!c) { reasons.push(`${id} is missing from the candidate`); continue; }
    if (!['Ready', 'Active', 'Done'].includes(c.status)) reasons.push(`${id} is ${c.status} in the candidate`);
    for (const f of TASK_REFERENCES) if (JSON.stringify(list(b[f])) !== JSON.stringify(list(c[f]))) reasons.push(`${id} changes its ${f} in the candidate`);
    for (const f of ['risks', 'decisions', 'deferred_inputs']) if (list(b[f]).length || list(c[f]).length) reasons.push(`${id} records ${f.replace('_', ' ')}`);
    owners.add(b.owner); milestones.add(b.milestone);
  }
  if (owners.size > 1) reasons.push('the named tasks have different owners');
  if (milestones.size > 1) reasons.push('the named tasks belong to different milestones');
  for (const p of production) if (!ids.some(id => list(base.get(id)?.scope).some(s => within(s, p)))) reasons.push(`production path ${p} is outside every named task's baseline scope`);
  return { reasons, owner: owners.size === 1 ? [...owners][0] : null };
}

const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const reference = v => {
  if (typeof v !== 'string' || /\s/.test(v)) return false;
  try { const u = new URL(v); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; } catch { return false; }
};
const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && new Set(a).size === a.length && b.every(x => a.includes(x));
const EVIDENCE_KEYS = ['schema', 'candidate', 'assurance', 'tasks', 'verification', 'integration', 'review'];

// Agent-attested evidence for the exact candidate. Every problem is an error; nothing becomes `unverified`.
export function evidenceErrors({ evidence, revision, taskIds, owner, requiredChecks }) {
  const errors = [];
  if (!isObject(evidence)) return ['delivery evidence is missing'];
  for (const k of Object.keys(evidence)) if (!EVIDENCE_KEYS.includes(k)) errors.push(`delivery evidence has an unknown field ${k}`);
  if (evidence.schema !== 'agent-workflow/delivery-evidence@1') errors.push('delivery evidence schema must be agent-workflow/delivery-evidence@1');
  if (evidence.candidate !== revision) errors.push('delivery evidence is not for this candidate revision');
  if (evidence.assurance !== 'agent-attested') errors.push('delivery evidence assurance must be agent-attested');
  if (!sameSet(evidence.tasks, taskIds)) errors.push('delivery evidence must name exactly the candidate\'s tasks');
  if (!requiredChecks.length) errors.push('the profile names no required checks');
  for (const stage of ['verification', 'integration']) {
    const s = evidence[stage];
    if (!isObject(s)) { errors.push(`${stage} evidence is missing`); continue; }
    if (s.revision !== revision) errors.push(`${stage} evidence is not for this candidate revision`);
    if (typeof s.environment !== 'string' || !s.environment.trim()) errors.push(`${stage} evidence needs its environment`);
    if (!Array.isArray(s.checks) || !s.checks.length) { errors.push(`${stage} evidence has no checks`); continue; }
    if (new Set(s.checks.map(c => c?.name)).size !== s.checks.length) errors.push(`${stage} contains duplicate check names`);
    for (const c of s.checks) if (!isObject(c) || typeof c.name !== 'string' || !c.name.trim() || c.result !== 'passed' || !reference(c.reference)) errors.push(`${stage} check ${JSON.stringify(c?.name)} did not pass or has no https reference`);
    for (const name of requiredChecks) if (!s.checks.some(c => c?.name === name && c.result === 'passed')) errors.push(`${stage}: required check ${name} did not pass`);
  }
  const r = evidence.review;
  if (!isObject(r)) return [...errors, 'independent review evidence is missing'];
  if (typeof r.reviewer !== 'string' || !r.reviewer.trim()) errors.push('review needs a reviewer');
  if (r.implementer !== owner) errors.push('review implementer must be the tasks\' owner');
  if (typeof r.reviewer === 'string' && [r.implementer, owner].some(v => typeof v === 'string' && r.reviewer.trim().toLowerCase() === v.trim().toLowerCase())) errors.push('reviewer must differ from the implementer');
  if (r.separate_context !== true) errors.push('review must be in a separate context');
  const x = r.context;
  if (!isObject(x)) errors.push('review context is missing');
  else {
    for (const k of ['provider', 'context_id']) if (typeof x[k] !== 'string' || !x[k].trim()) errors.push(`review context needs ${k}`);
    if (x.inherited_context !== false) errors.push('review context must not inherit the implementer\'s context');
    if (x.candidate !== revision) errors.push('review was not of this candidate revision');
    if (!reference(x.launch_evidence)) errors.push('review context needs an https launch_evidence reference');
  }
  for (const area of REVIEW_AREAS) if (!Array.isArray(r.coverage) || !r.coverage.includes(area)) errors.push(`review did not cover ${area}`);
  if (!Array.isArray(r.findings)) errors.push('review findings are missing');
  else for (const f of r.findings) if (!isObject(f) || f.status !== 'resolved' || typeof f.resolution !== 'string' || !f.resolution.trim()) errors.push(`review finding ${JSON.stringify(f?.id)} is not resolved (accepted risks need the owner)`);
  if (!sameSet(r.tasks, taskIds)) errors.push('review must cover exactly the candidate\'s tasks');
  if (!reference(r.report)) errors.push('review needs an https reference to its report');
  return errors;
}

export function evaluateDelegation({ config, baselineTasks = [], tasks = [], taskIds = [], classes = [], revision, changedLines = null, evidence = null, requiredChecks = [], ownerApproved = false }) {
  const routine = config?.delegation?.routine;
  const off = { enabled: false, approval_basis: 'owner-review', ok: true, errors: [], unverified: [], reasons: ['routine delegation is not enabled in the baseline config; ordinary approval applies'] };
  if (config?.delegation === undefined || routine === undefined || (isObject(routine) && routine.enabled === false)) return off;
  const result = { enabled: true, approval_basis: 'owner-review', ok: false, errors: [], unverified: [], reasons: [] };
  if (!isObject(config.delegation) || Object.keys(config.delegation).some(k => k !== 'routine')) result.errors.push('delegation may only hold routine');
  if (isObject(routine) && routine.enabled !== true) result.errors.push('delegation.routine.enabled must be true or false');
  result.errors.push(...configErrors(routine));
  if (typeof revision !== 'string' || !SHA.test(revision)) result.errors.push('the exact candidate revision (full commit hash) is required');
  if (result.errors.length) return result; // misconfiguration blocks, even with owner approval

  if (!classes.some(c => c.category !== 'planning')) {
    result.ok = true; result.approval_basis = 'records-only';
    result.reasons.push('planning records only; routine delegation adds nothing');
    return result;
  }
  const { reasons, owner } = ineligibility({ routine, baselineTasks, tasks, taskIds, classes, changedLines });
  if (!reasons.length) {
    const errors = evidenceErrors({ evidence, revision, taskIds, owner, requiredChecks: list(requiredChecks) });
    if (!errors.length) {
      result.ok = true; result.approval_basis = 'delegated-routine';
      result.reasons.push('eligible for the routine lane with complete agent-attested evidence for this candidate');
      result.unverified.push('delivery evidence is agent-attested and unauthenticated; the owner did not review this candidate', 'product acceptance and release are not delegated');
      return result;
    }
    if (ownerApproved === true) { result.ok = true; result.reasons.push('routine evidence incomplete; owner approval of the exact head applies', ...errors); return result; }
    result.errors.push(...errors);
    return result;
  }
  result.reasons.push(...reasons);
  if (ownerApproved === true) { result.ok = true; result.reasons.push('owner approval of the exact head applies'); return result; }
  result.errors.push(`owner approval of the exact head is required: ${reasons.join('; ')}`);
  return result;
}
