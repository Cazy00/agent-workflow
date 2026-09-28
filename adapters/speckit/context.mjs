import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirSource, gitSource, safePath } from '../../validator/lib/sources.js';
import { loadAll, loadConfig } from '../../validator/lib/records.js';
import { governingInputs } from '../../validator/lib/freshness.js';
import { planningEnforcement } from '../../validator/lib/planning.js';
import { verifyInstallation } from './verify.mjs';
import { contained, inventory, read, digest, sha256 } from './files.mjs';
import { featurePath } from './task-plan.mjs';
import { readPinnedPolicy } from './authority.mjs';

export const runtimeFeaturePath = p => /^(tasks|research|analysis)\.md$/.test(p) || p.startsWith('checklists/') || p.startsWith('.wf-speckit/');
function gitFiles(repo, revision, prefix) {
  safePath(prefix);
  const r = spawnSync('git', ['--literal-pathspecs', '-C', repo, 'ls-tree','-r','-z','--name-only',revision,'--',prefix], { encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024 });
  if (r.status !== 0) throw new Error('cannot enumerate baseline dependencies');
  return r.stdout.split('\0').filter(Boolean);
}

// Reuse the core closure for current local planning AND the immutable baseline.
// Additional seeds let a proposed breakdown name its milestone before IDs exist.
export function collectFeatureSources({ repo, baseline, feature, milestone, seeds = [] }) {
  featurePath(feature);
  const local = dirSource(repo), approved = gitSource(repo, baseline);
  const all = loadAll(local, 'docs/workflow'), old = loadAll(approved, 'docs/workflow');
  if (all.errors.length || old.errors.length) throw new Error(`invalid native records: ${[...all.errors,...old.errors].join('; ')}`);
  // A local edit can remove feature membership or an old governing reference.
  // Seed both closures with both versions of every matching feature task.
  const ids = new Set([...all.tasks.values(),...old.tasks.values()].filter(t => t.data?.feature === feature).map(t => t.data.id));
  const tasks = [...ids].flatMap(id => [all.tasks.get(id)?.data,old.tasks.get(id)?.data]).filter(Boolean);
  const seed = { feature, milestone, feature_readiness: `${feature}/spec.md`, design: `${feature}/plan.md`, governing: [`${feature}/contracts`] };
  const current = governingInputs(local, 'docs/workflow', [seed,...tasks,...seeds]);
  const prior = governingInputs(approved, 'docs/workflow', [seed,...tasks,...seeds]);
  const paths = new Set([...current.paths,...prior.paths]);
  for (const task of tasks) paths.add(`docs/workflow/tasks/${task.id}.md`);
  // Full feature sources, including new contracts. Temporary output is excluded.
  for (const p of inventory(repo, feature)) if (!runtimeFeaturePath(p.slice(feature.length+1))) paths.add(p);
  const result = new Map();
  const save = (path, text, version = 'working') => result.set(`${version}:${path}`, {path,text,version});
  const capture = (rel, baselineOnly = false) => {
    safePath(rel);
    const target = contained(repo, rel);
    if (!baselineOnly && fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      for (const p of inventory(repo, rel)) if (!p.startsWith(feature + '/') || !runtimeFeaturePath(p.slice(feature.length+1))) capture(p);
    }
    if (!baselineOnly && fs.existsSync(target) && fs.statSync(target).isFile()) save(rel, fs.readFileSync(target,'utf8'));
    // Include the baseline copy separately so edits cannot hide old dependencies.
    const oldPaths = gitFiles(repo, baseline, rel);
    for (const p of oldPaths) if (!p.startsWith(feature + '/') || !runtimeFeaturePath(p.slice(feature.length+1))) save(p, approved.read(p), 'baseline');
  };
  for (const p of paths) {
    // Missing contract directory is ordinary for a new feature; a declared
    // missing file is still visible as a sentinel rather than silently omitted.
    if (p.startsWith(feature + '/') && runtimeFeaturePath(p.slice(feature.length+1))) throw new Error('temporary projection/output cannot be a governing source');
    capture(p);
    if (!fs.existsSync(contained(repo,p)) && !approved.exists(p)) save(p, '[missing canonical source]');
  }
  const acceptanceIds = new Set([...current.acceptance,...prior.acceptance]);
  const relevantAcceptance = input => [...input.definitions.values()].filter(e => acceptanceIds.has(e.id)).sort((a,b) => a.id.localeCompare(b.id));
  save('docs/workflow/acceptance.json', JSON.stringify({examples:relevantAcceptance(current)}));
  save('docs/workflow/acceptance.json', JSON.stringify({examples:relevantAcceptance(prior)}), 'baseline');
  return [...result].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([,source]) => source);
}

export function verifyAdoptedInstallation({ repo, baseline, integration, python }) {
  if (!/^[a-f0-9]{40}$/.test(baseline)) throw new Error('exact baseline required');
  const source = gitSource(repo, baseline), config = loadConfig(source);
  if (!planningEnforcement(config).length || (config.records_dir ?? 'docs/workflow') !== 'docs/workflow') throw new Error('baseline has not adopted the supported planning contract');
  const lockPath = 'docs/workflow/speckit.lock.json';
  const baselineLock = source.read(lockPath);
  if (!baselineLock || !read(repo,lockPath).equals(Buffer.from(baselineLock))) throw new Error('installation lock must match the explicit baseline');
  const lock = JSON.parse(baselineLock);
  if (lock.core.revision !== config.workflow?.revision) throw new Error('adapter/core adoption pins differ');
  const installed = verifyInstallation({repo,lock,integration,python});
  if (!installed.ok) throw new Error(installed.mismatches.join('; '));
  if (sha256(readPinnedPolicy(lock.core.revision)) !== lock.authority?.policy?.sha256) throw new Error('authority pointer differs from pinned core policy');
  if ((loadAll(source,'docs/workflow').profile?.data?.owners?.length ?? 0) >= 2) throw new Error('Spec Kit adapter currently supports one owner only');
  const profile = source.read('docs/workflow/profile.md');
  if (profile === null || sha256(profile) !== lock.authority?.profile?.sha256 || !read(repo,'docs/workflow/profile.md').equals(Buffer.from(profile)))
    throw new Error('authority pointer is stale for the baseline/current profile; propose the pointer and lock with the governing change');
  return {config,lock,installed};
}

export function resolveFeatureContext({ repo, baseline, feature, integration, python, milestone, seeds = [] }) {
  if (!/^[a-f0-9]{40}$/.test(baseline)) throw new Error('exact baseline required');
  featurePath(feature);
  if (milestone !== undefined && !/^M-\d{4}$/.test(milestone)) throw new Error('invalid native milestone');
  const {installed}=verifyAdoptedInstallation({repo,baseline,integration,python});
  if (fs.existsSync(contained(repo,'.specify/feature.json'))) throw new Error('persistent feature selector is unsupported; inspect and remove it explicitly');
  const featureDirectory = contained(repo, feature);
  const sources = collectFeatureSources({repo,baseline,feature,milestone,seeds});
  const sourceDigest = digest({baseline,feature,milestone:milestone ?? null,lock:installed.lock_digest,sources});
  return { baseline_revision:baseline,feature_path:feature,spec_path:`${feature}/spec.md`,plan_path:`${feature}/plan.md`,
    environment:{SPECIFY_FEATURE_DIRECTORY:featureDirectory,SPECIFY_FEATURE_NO_PERSIST:'1'}, source_digest:sourceDigest,
    lock_digest:installed.lock_digest, sources, native_tasks: sources.filter(s=>s.version !== 'baseline' && /^docs\/workflow\/tasks\/T-\d{4}\.md$/.test(s.path)).map(s=>s.path),
    authority:'planning-only' };
}
