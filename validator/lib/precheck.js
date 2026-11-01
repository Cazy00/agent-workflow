// MAINT-0027: `wf precheck`, the project's fast lane run locally before the first push of a task's pull request (procedures/execute.md).
// It runs the shell commands the project's own docs/workflow/config.json lists under `checks.fast` (`checks.full` with --full), one after
// another in the repository root, and stops at the first failure with that command's exit code. It grants nothing and no gate reads it.
import { spawnSync } from 'node:child_process';
import { WfError } from './records.js';
import { quiet } from './doctor.js';

export const CHECK_LISTS = ['fast', 'full'];

// The commands to run, or a WfError saying what to add to the config.
export function precheckCommands(config, full = false) {
  const key = full ? 'full' : 'fast';
  const commands = config.checks?.[key];
  if (commands === undefined) throw new WfError(`wf precheck: docs/workflow/config.json has no checks.${key}. Add it as a list of shell commands, for example "checks": { "${key}": ["npm run lint", "npm test"] }${full ? '' : ' (the project\'s quick checks: lint, types, the unit tests; checks.full is for the slow ones)'}`);
  if (!commands.length) throw new WfError(`wf precheck: checks.${key} in docs/workflow/config.json is empty; list at least one shell command`);
  return { key, commands };
}

// Runs them, printing each command and its seconds through `write`, with the environment `wf doctor`'s preflight gets: the owner's signing
// variables and WF_* are withheld (doctor.js quiet). { ok, code, ran } with the failing command's exit code.
export function runPrecheck({ config, root, full = false, write = s => process.stdout.write(s), spawn = spawnSync, clock = () => Date.now(), env = quiet() }) {
  const { key, commands } = precheckCommands(config, full);
  let ran = 0;
  for (const [i, command] of commands.entries()) {
    write(`wf precheck (checks.${key} ${i + 1}/${commands.length}): ${command}\n`);
    const started = clock();
    const r = spawn('sh', ['-c', command], { cwd: root, stdio: 'inherit', env });
    const seconds = ((clock() - started) / 1000).toFixed(1);
    ran++;
    const code = typeof r.status === 'number' ? r.status : 1; // a signal or a command that could not start
    if (code !== 0) {
      write(`wf precheck: FAILED after ${seconds} s with exit code ${code}: ${command}\n`);
      return { ok: false, code, ran };
    }
    write(`wf precheck: ok, ${seconds} s\n`);
  }
  write(`wf precheck: checks.${key} passed (${ran} command${ran === 1 ? '' : 's'})\n`);
  return { ok: true, code: 0, ran };
}
