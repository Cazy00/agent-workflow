// Path classification with the precedence SCHEMA.md fixes. The config always comes from the baseline.
import { matchGlob } from './glob.js';
import { planningEnforcement } from './planning.js';

export const CATEGORIES = ['enforcement', 'production', 'generated', 'governing', 'planning'];

const patternOf = (g) => (typeof g === 'string' ? g : g.pattern);

export function classifyPaths(config, changed) {
  const cfg = config.paths ?? {};
  const frontendPaths = planningEnforcement(config);
  return changed.map((raw) => {
    const path = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (frontendPaths.some(g => matchGlob(g, path))) return { path, category: 'enforcement' };
    for (const category of CATEGORIES) {
      if (category === 'governing' && frontendPaths.length && matchGlob('docs/specs/**', path)) return { path, category };
      const hit = (cfg[category] ?? []).find((g) => matchGlob(patternOf(g), path));
      if (hit) return { path, category, producer: typeof hit === 'object' ? hit.producer : undefined };
    }
    return { path, category: 'unclassified' };
  });
}
