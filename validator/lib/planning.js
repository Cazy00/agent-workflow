// Optional planning frontend contract. This only adds protected paths: it grants
// no installation, readiness, execution, evidence or approval authority.
const SPECKIT_ENFORCEMENT = Object.freeze([
  '.specify/**', '.agents/**', '.claude/**', '.codex/**',
  'docs/workflow/speckit.lock.json', 'integrations/speckit/**',
  'adapters/**', '.gitignore',
]);

export function planningEnforcement(config) {
  const frontend = config.planning_frontend;
  if (frontend === undefined || frontend === null) return [];
  if (typeof frontend !== 'object' || Array.isArray(frontend) ||
      Object.keys(frontend).some(k => !['name', 'compatibility_api', 'feature_root'].includes(k)) ||
      frontend.name !== 'speckit' || frontend.compatibility_api !== 1 || frontend.feature_root !== 'docs/specs') {
    throw new Error('planning_frontend must be null or {name: "speckit", compatibility_api: 1, feature_root: "docs/specs"}; other roots or options require a reviewed adapter contract');
  }
  return SPECKIT_ENFORCEMENT;
}
