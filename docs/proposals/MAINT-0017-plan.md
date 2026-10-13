# MAINT-0017 v2.5.0 (Part A, our own machines): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every job the workflow installs can run on the owner's own runners, and projects can fetch the workflow from a private repository. The client page stops rebuilding on every branch push, `wf paths` says when a change is planning-only, and the runner tooling ships in this repository.

**Architecture:**
- **Templates:** `templates/github/*.yml` gain the switch `runs-on: ${{ vars.WF_CI_RUNNER || 'ubuntu-latest' }}`, and an optional read-only token (`secrets.WF_READ_TOKEN`) seen only by the step that fetches the pinned workflow.
- **Validator:** `wf paths` gains one field, `planning_only`.
- **Server:** the LXD-based runner tooling, written and statically verified in the owner's home-server project 004 (numbered 003 when this plan was written), moves to `server/ci-runner/` as capability. Procedures gain a short CI-runners section.

**Tech Stack:** Node ≥ 22 built-ins only (`node --test`), Bash, GitHub Actions YAML, cloud-init, LXD 5.21.

**Spec:** `docs/proposals/MAINT-0017-own-machines-owner-assistant.md`, Part A (A1–A6). A4's publish target moved to D4; see the proposal.

> **Note, after execution (13 October):** the owner's home-server project this plan calls 003 was renumbered 004 (`projects/004-ci-runners`), because 003 was already taken. Its paths below are as they were when the plan ran.

## Global Constraints

- Names, exactly:
  - the variable `WF_CI_RUNNER` for the workflow's own jobs (`wf ci`, `wf-status`, the client page);
  - the variable `CI_RUNNER` for a project's own product jobs;
  - the secret `WF_READ_TOKEN`;
  - the labels `<project>-ci` and `<project>-gate`.
- **No variable, no secret:** behaviour is identical to v2.4.2, except the client page's triggers (Task 2).
- **No new dependencies.** Tests use `node:test`, `node:assert/strict`, `node:fs`, `node:child_process` and `bash`.
- **Every action stays pinned by a full commit hash.** No new action is added.
- **`WF_READ_TOKEN` appears only** as `WF_READ_TOKEN: ${{ secrets.WF_READ_TOKEN }}` in the `env:` of the fetch step. It reaches git only through `GIT_CONFIG_*` environment values, never argv, and is never echoed.
- **`procedures/execute.md` is not touched.** Other procedures grow by at most 250 words in total. Record the corpus size (39,204 words before this release, counted as `cat POLICY.md SCHEMA.md QUICKSTART.md procedures/*.md .agents/skills/workflow/SKILL.md $(git ls-files templates) | wc -w`) and after it.
- **Every change names the failure it prevents and the check that catches a recurrence** (`procedures/maintenance.md`).

## Review Focus

1. **Secret unset.** With `WF_READ_TOKEN` empty, as GitHub gives an unset secret, nothing is exported and the fetch is anonymous, as before (Task 3 test).
2. **A token with `_` or `-`.** The header is the base64 of `x-access-token:<token>` with no newline inside (Task 3 test).
3. **Someone edits the daily cron.** The build condition matches the daily schedule by its literal string. If the two drift apart, the daily build silently stops on GitHub's runner (Task 2 test: the literal in `if:` equals the first `cron:` entry).
4. **An empty or unclassified diff.** `planning_only` is false for an empty diff and for any unclassified path, so CI runs everything (Task 4 tests).
5. **A gate runner without `gh`.** `wf-status` and the client page call `gh`, so a gate container without it fails every status run (Task 5 test: the gate cloud-init installs `gh` and nothing Docker).

---

### Task 1: A runner switch in every installed workflow (A1)

Prevents: every gate stopping when GitHub's minutes run out (proposal § 2.1). Check: `runner-switch.test.js`.

**Files:**
- Modify: `templates/github/wf-ci.yml:5-6, 11, 29-31`
- Modify: `templates/github/wf-status.yml:8, 24-26`
- Modify: `templates/github/wf-client-page.yml:10, 35, 47, 78`
- Create: `validator/test/runner-switch.test.js`
- Modify: `validator/test/status-workflow.test.js:30`

**Interfaces:**
- Produces: the exact line `runs-on: ${{ vars.WF_CI_RUNNER || 'ubuntu-latest' }}` in every job (Tasks 2, 3, 5 and 6 rely on this name).

- [ ] **Step 1: Write the failing test** (`validator/test/runner-switch.test.js`)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// MAINT-0017 A1: every job the scaffold installs runs on GitHub's runner unless the repository variable WF_CI_RUNNER
// names the project's gate runner (server/ci-runner). Deleting the variable is the way back, so no job names a
// runner any other way.
const SWITCH = "    runs-on: ${{ vars.WF_CI_RUNNER || 'ubuntu-latest' }}";
for (const file of ['wf-ci.yml', 'wf-status.yml', 'wf-client-page.yml']) {
  test(`${file}: every job runs on the WF_CI_RUNNER switch`, () => {
    const yml = fs.readFileSync(new URL(`../../templates/github/${file}`, import.meta.url), 'utf8');
    const jobs = yml.slice(yml.indexOf('\njobs:\n')).split(/\n  (?=[\w-]+:\n)/).slice(1);
    assert.ok(jobs.length > 0, 'jobs found');
    for (const job of jobs) assert.equal(job.match(/^ {4}runs-on: .*$/gm)?.join('\n'), SWITCH, job.split('\n')[0]);
  });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test validator/test/runner-switch.test.js`
Expected: 3 failures, each `'    runs-on: ubuntu-latest' !== "    runs-on: ${{ vars.WF_CI_RUNNER || 'ubuntu-latest' }}"`.

- [ ] **Step 3: Change the templates**

`templates/github/wf-ci.yml`:
- Lines 5–6: replace `(which\n# must be public: it is fetched without a token)` with `(without a token when it is\n# public; with the secret WF_READ_TOKEN when it is private, MAINT-0017)`.
- Line 11: replace `It runs with a read-only token and no secrets.` with `It runs with a read-only token, and no secret but WF_READ_TOKEN, which only the fetch step sees.`
- Replace lines 29–31 with:
```yaml
  ci:
    name: wf ci
    # GitHub's runner unless the repository variable WF_CI_RUNNER names the project's gate runner (MAINT-0017,
    # server/ci-runner): a container with no Docker and no sudo, where product code and its packages never run.
    runs-on: ${{ vars.WF_CI_RUNNER || 'ubuntu-latest' }}
```

`templates/github/wf-status.yml`:
- After line 8, add: `# It runs on GitHub's runner unless the repository variable WF_CI_RUNNER names the project's gate runner (MAINT-0017).`
- Line 26: replace `    runs-on: ubuntu-latest` with `    runs-on: ${{ vars.WF_CI_RUNNER || 'ubuntu-latest' }}`.

`templates/github/wf-client-page.yml`:
- After line 10, add: `# Its jobs run on GitHub's runner unless the repository variable WF_CI_RUNNER names the project's gate runner (MAINT-0017).`
- Lines 35, 47 and 78: replace `    runs-on: ubuntu-latest` with `    runs-on: ${{ vars.WF_CI_RUNNER || 'ubuntu-latest' }}`.

`validator/test/status-workflow.test.js` line 30, which allows only the token lines to hold expressions, becomes:
```js
  for (const line of text.split('\n').filter(l => l.includes('${{'))) assert.match(line, /^ {10}(GH_TOKEN|GH_REPO): \$\{\{ github\.(token|repository) \}\}$|^ {4}runs-on: \$\{\{ vars\.WF_CI_RUNNER \|\| 'ubuntu-latest' \}\}$/);
```

- [ ] **Step 4: Run the tests**

Run: `node --test validator/test/runner-switch.test.js validator/test/status-workflow.test.js validator/test/client-plan.test.js validator/test/agent-templates.test.js validator/test/checkpoints.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add templates/github validator/test/runner-switch.test.js validator/test/status-workflow.test.js
git commit -m "MAINT-0017 A1: every installed workflow job runs on WF_CI_RUNNER's runner, GitHub's otherwise"
```

### Task 2: The client page rebuilds less often (A4)

Prevents: about a third of the client page's runs, a dispatch job on every push to every branch (proposal § 1, § 2.2). Check: `client-plan.test.js`, whose expression evaluator now knows `vars`.

**Files:**
- Modify: `templates/github/wf-client-page.yml:12-22, 34, 46`
- Modify: `validator/test/client-plan.test.js:827-885`

**Interfaces:**
- Consumes: Task 1's switch line.
- Produces: the schedules `'17 3 * * *'` (daily, always) and `'*/15 * * * *'` (only with a gate runner).

- [ ] **Step 1: Write the failing tests**

In `validator/test/client-plan.test.js`, replace the test at line 827 with:
```js
test('the client page workflow rebuilds on the trusted branch, on pull request events and on schedules', () => {
  const yml = fs.readFileSync(path.join(root, 'templates/github/wf-client-page.yml'), 'utf8');
  assert.match(yml, /push:\n\s+branches: \[__TRUSTED_BRANCH__\]/);
  assert.doesNotMatch(yml, /branches: \['\*\*'\]/, 'no dispatch on every push to every branch (MAINT-0017)');
  assert.match(yml, /pull_request:\n\s+types: \[opened, reopened, ready_for_review, converted_to_draft, closed\]/);
  assert.match(yml, /schedule:\n\s+- cron: '17 3 \* \* \*'\n\s+- cron: '\*\/15 \* \* \* \*'/);
  // The build condition names the daily schedule by its literal; the two must not drift apart.
  const daily = yml.match(/- cron: '([^']+)'/)[1];
  assert.ok(yml.includes(`github.event.schedule == '${daily}'`), 'the build condition matches the first cron entry');
  assert.match(yml, /gh workflow run wf-client-page\.yml --ref __TRUSTED_BRANCH__/);
  assert.doesNotMatch(yml, /cancel-in-progress: true/);
  assert.match(yml, /fetch-depth: 0/);
  assert.match(yml, /scripts\/wf status --client --live --candidate "\$GITHUB_SHA" --pull-requests "\$RUNNER_TEMP\/pull-requests\.json"/);
  assert.doesNotMatch(yml, /uses: [^@\n]+@(?![0-9a-f]{40}\b)/, 'actions pinned by commit');
});
```

In the `expression` helper (line 842), add a `vars` translation, and give every context the value GitHub gives an unset variable:
```js
const expression = (yml, pattern) => {
  const text = yml.match(pattern)?.[1];
  assert.ok(text, `expression ${pattern} in the template`);
  const js = text.replace(/\$\{\{\s*|\s*\}\}/g, '').replaceAll('__TRUSTED_BRANCH__', 'main')
    .replace(/!=/g, '!==').replace(/([^!=])==/g, '$1===')
    .replace(/github(\.[A-Za-z_.]+)/g, (_, p) => `ctx${p.replace(/\./g, '?.')}`)
    .replace(/\bvars\.(\w+)/g, 'ctx.vars.$1');
  return ctx => new Function('ctx', `return (${js});`)({ vars: { WF_CI_RUNNER: '' }, ...ctx });
};
```

In the `cases` table (line 861), change and add:
```js
    ['push to a task branch', { event_name: 'push', ref: 'refs/heads/claude/T-0003', actor: 'alice', event: {} }, 'none'],
    ['daily schedule', { event_name: 'schedule', ref: 'refs/heads/main', actor: 'alice', event: { schedule: '17 3 * * *' } }, 'build'],
    ['15-minute schedule on GitHub\'s runner', { event_name: 'schedule', ref: 'refs/heads/main', actor: 'alice', event: { schedule: '*/15 * * * *' } }, 'none'],
    ['15-minute schedule on the gate runner', { event_name: 'schedule', ref: 'refs/heads/main', actor: 'alice', event: { schedule: '*/15 * * * *' }, vars: { WF_CI_RUNNER: 'shop-gate' } }, 'build'],
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test validator/test/client-plan.test.js`
Expected: FAIL. `push:\n\s+branches: \[__TRUSTED_BRANCH__\]` doesn't match, and 'push to a task branch' runs `dispatch`.

- [ ] **Step 3: Change the template**

Replace lines 12–22 of `templates/github/wf-client-page.yml` with:
```yaml
# A push to the trusted branch rebuilds. A pull request opening, closing unmerged or changing draft state asks for a
# rebuild there, since GitHub Pages deploys only from the trusted branch. Work moving on other branches shows at the
# next build: every 15 minutes with the project's own gate runner, where a run costs nothing, otherwise daily.
# (MAINT-0017; MAINT-0014 rebuilt on every push to every branch, which cost more GitHub minutes than wf ci.) The build
# reads the trusted branch's records and plan, then the parts moving on the branches (`--live`).
on:
  push:
    branches: [__TRUSTED_BRANCH__]
  pull_request:
    types: [opened, reopened, ready_for_review, converted_to_draft, closed]
  workflow_dispatch:
  schedule:
    - cron: '17 3 * * *'
    - cron: '*/15 * * * *'
```
Line 34 (the dispatch job's `if:`) becomes:
```yaml
    if: github.actor != 'dependabot[bot]' && github.event_name == 'pull_request' && !github.event.pull_request.merged && !github.event.pull_request.head.repo.fork
```
Line 46 (the build job's `if:`) becomes:
```yaml
    if: github.event_name != 'pull_request' && github.ref == 'refs/heads/__TRUSTED_BRANCH__' && (github.event_name != 'schedule' || github.event.schedule == '17 3 * * *' || vars.WF_CI_RUNNER != '')
```

- [ ] **Step 4: Run the tests**

Run: `node --test validator/test/client-plan.test.js validator/test/client.test.js validator/test/agent-templates.test.js validator/test/runner-switch.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add templates/github/wf-client-page.yml validator/test/client-plan.test.js
git commit -m "MAINT-0017 A4: the client page rebuilds on the trusted branch, pull request events, daily, and every 15 minutes on a gate runner"
```

### Task 3: Fetch the workflow from a private repository (A5)

Prevents: every project's CI breaking when this repository goes private (proposal § 2.3). Check: `private-fetch.test.js`.

**Files:**
- Modify: `templates/github/wf-ci.yml:42-46` (the fetch step)
- Modify: `templates/github/wf-status.yml` and `templates/github/wf-client-page.yml`: a new step before each render step
- Create: `validator/test/private-fetch.test.js`
- Modify: `validator/test/status-workflow.test.js:30` (one more allowed expression line)

**Interfaces:**
- Consumes: Task 1's templates.
- Produces: the step name `Fetch the pinned workflow`, which fills `.cache/agent-workflow`, the directory `scripts/wf` reads. Also the shell block below, identical in all three files, which Task 6's procedure text refers to.

The shell block (identical in all three templates):
```bash
          if [ -n "$WF_READ_TOKEN" ]; then
            export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader
            GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$WF_READ_TOKEN" | base64 | tr -d '\n')"
            export GIT_CONFIG_VALUE_0
          fi
```

- [ ] **Step 1: Write the failing test** (`validator/test/private-fetch.test.js`)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// MAINT-0017 A5: a private workflow repository is fetched with a read-only token in the secret WF_READ_TOKEN. Only the
// step that fetches sees it; git gets it through GIT_CONFIG_* values (never argv); nothing prints it.
const read = f => fs.readFileSync(new URL(`../../templates/github/${f}`, import.meta.url), 'utf8');
const ENV = '          WF_READ_TOKEN: ${{ secrets.WF_READ_TOKEN }}';
const FETCH = { 'wf-ci.yml': 'Fetch the validator pinned by the base branch', 'wf-status.yml': 'Fetch the pinned workflow', 'wf-client-page.yml': 'Fetch the pinned workflow' };

for (const [file, name] of Object.entries(FETCH)) {
  test(`${file}: only "${name}" sees WF_READ_TOKEN, and never prints it`, () => {
    const steps = read(file).split(/^ {6}- /m).slice(1);
    const holders = steps.filter(s => /WF_READ_TOKEN|GIT_CONFIG_/.test(s));
    assert.deepEqual(holders.map(s => s.match(/^name: (.*)$/m)?.[1]), [name]);
    assert.equal(holders[0].split('\n').filter(l => l.includes('secrets.')).join('\n'), ENV);
    assert.doesNotMatch(holders[0], /echo[^\n]*WF_READ_TOKEN|set -x|GIT_TRACE/);
    assert.doesNotMatch(holders[0], /git [^\n]*-c http/, 'no token in argv');
  });
}

test('the token becomes a basic authorization header, and an unset secret changes nothing', () => {
  const block = read('wf-ci.yml').match(/( *if \[ -n "\$WF_READ_TOKEN" \]; then\n[\s\S]*?\n *fi\n)/)[1];
  for (const f of ['wf-status.yml', 'wf-client-page.yml']) assert.ok(read(f).includes(block), `${f} has the same block`);
  const run = token => spawnSync('bash', ['-c', `set -euo pipefail\n${block}\nenv | grep '^GIT_CONFIG_' | sort || true`], { encoding: 'utf8', env: { PATH: process.env.PATH, WF_READ_TOKEN: token } });
  const set = run('ghp_abc-DEF_123');
  assert.equal(set.status, 0, set.stderr);
  assert.equal(set.stdout, `GIT_CONFIG_COUNT=1\nGIT_CONFIG_KEY_0=http.https://github.com/.extraheader\nGIT_CONFIG_VALUE_0=AUTHORIZATION: basic ${Buffer.from('x-access-token:ghp_abc-DEF_123').toString('base64')}\n`);
  const unset = run('');
  assert.equal(unset.status, 0, unset.stderr);
  assert.equal(unset.stdout, '');
});

test('the status and client page workflows fetch the pin into the cache scripts/wf reads, before rendering', () => {
  for (const f of ['wf-status.yml', 'wf-client-page.yml']) {
    const steps = read(f).split(/^ {6}- /m).slice(1).map(s => s.match(/^name: (.*)$/m)?.[1] ?? s.split('\n')[0]);
    assert.ok(steps.indexOf('Fetch the pinned workflow') >= 0 && steps.indexOf('Fetch the pinned workflow') < steps.findIndex(n => /^Render/.test(n)), f);
    assert.match(read(f), /git init -q \.cache\/agent-workflow\n\s+git -C \.cache\/agent-workflow fetch -q --depth 1 "https:\/\/github\.com\/\$REPO\.git" "\$REV"\n\s+git -C \.cache\/agent-workflow checkout -q --detach FETCH_HEAD/);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test validator/test/private-fetch.test.js`
Expected: FAIL. No step holds `WF_READ_TOKEN`; `match(...)` returns null in the header test.

- [ ] **Step 3: Change the templates**

`templates/github/wf-ci.yml`: the fetch step's `env:` and the start of its `run:` become:
```yaml
      - name: Fetch the validator pinned by the base branch
        env:
          BASE: ${{ github.event.pull_request.base.sha }}
          # A private workflow repository needs a read-only token for it in this secret (MAINT-0017); unset, the fetch
          # is anonymous.
          WF_READ_TOKEN: ${{ secrets.WF_READ_TOKEN }}
        run: |
          set -euo pipefail
          if [ -n "$WF_READ_TOKEN" ]; then
            export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader
            GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$WF_READ_TOKEN" | base64 | tr -d '\n')"
            export GIT_CONFIG_VALUE_0
          fi
          git show "$BASE:docs/workflow/config.json" > "$RUNNER_TEMP/config.json"
```
The rest of the step is unchanged.

`templates/github/wf-status.yml` and `templates/github/wf-client-page.yml`: insert before `- name: Render the status view` and before `- name: Render the client page` respectively:
```yaml
      - name: Fetch the pinned workflow
        # Into the cache scripts/wf reads. A private workflow repository needs a read-only token for it in the secret
        # WF_READ_TOKEN (MAINT-0017); this step alone sees it.
        env:
          WF_READ_TOKEN: ${{ secrets.WF_READ_TOKEN }}
        run: |
          set -euo pipefail
          if [ -n "$WF_READ_TOKEN" ]; then
            export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader
            GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$WF_READ_TOKEN" | base64 | tr -d '\n')"
            export GIT_CONFIG_VALUE_0
          fi
          pin="$(node -e '
            const w = JSON.parse(require("fs").readFileSync("docs/workflow/config.json", "utf8")).workflow ?? {};
            if (!/^[\w.-]+\/[\w.-]+$/.test(w.repo ?? "") || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(w.revision ?? "")) { console.error("wf: the config needs workflow.repo and a full workflow.revision"); process.exit(2); }
            console.log(w.repo, w.revision)')"
          read -r REPO REV <<< "$pin"
          git init -q .cache/agent-workflow
          git -C .cache/agent-workflow fetch -q --depth 1 "https://github.com/$REPO.git" "$REV"
          git -C .cache/agent-workflow checkout -q --detach FETCH_HEAD
```

`validator/test/status-workflow.test.js` line 30, as left by Task 1, gains the env line:
```js
  for (const line of text.split('\n').filter(l => l.includes('${{'))) assert.match(line, /^ {10}(GH_TOKEN|GH_REPO): \$\{\{ github\.(token|repository) \}\}$|^ {4}runs-on: \$\{\{ vars\.WF_CI_RUNNER \|\| 'ubuntu-latest' \}\}$|^ {10}WF_READ_TOKEN: \$\{\{ secrets\.WF_READ_TOKEN \}\}$/);
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all pass. The suite has to be run whole because `checkpoints.test.js` executes the wf-ci summary script from the template.

- [ ] **Step 5: Commit**

```bash
git add templates/github validator/test/private-fetch.test.js validator/test/status-workflow.test.js
git commit -m "MAINT-0017 A5: the installed workflows fetch the pinned workflow with WF_READ_TOKEN when it is set"
```

### Task 4: `wf paths` says when a change is planning-only (A3)

Prevents: a records-only change running every product step twice (proposal § 1: 30 of 72 pull requests, about 330 minutes). Check: three cases in `git-integration.test.js`.

**Files:**
- Modify: `validator/cli.js:376`
- Modify: `validator/test/git-integration.test.js` (append)
- Modify: `procedures/delivery.md:7` (append two sentences)
- Modify: `QUICKSTART.md` (the `paths` sentence in "Other commands")

**Interfaces:**
- Produces: `wf paths` JSON `{ ok: boolean, planning_only: boolean, classes: [...] }`. `planning_only` is true only when there is at least one changed path and every one is category `planning`.

- [ ] **Step 1: Write the failing tests** (append to `validator/test/git-integration.test.js`)

```js
// MAINT-0017 A3: a project's CI may skip expensive product steps when every changed path is planning (delivery.md).
// Exit 1 when a path is unclassified (ok: false); the JSON is printed either way.
const pathsOf = (p, from, to) => { const r = spawnSync(process.execPath, [cli, 'paths', '--repo', p.repo, '--baseline', from, '--candidate', to, '--json'], { encoding: 'utf8' }); assert.ok([0, 1].includes(r.status), r.stderr); return JSON.parse(r.stdout); };
test('MAINT-0017: wf paths says planning_only for a records-only change, and only then', t => {
  const p = setup(t);
  p.edit(taskPath, x => `${x}\n`); p.git('add', '.'); p.git('commit', '-qm', 'T-0001: record');
  const records = p.git('rev-parse', 'HEAD');
  assert.equal(pathsOf(p, p.candidate, records).planning_only, true, 'a task record alone');
  assert.equal(pathsOf(p, p.baseline, p.candidate).planning_only, false, 'production code');
  p.write('src/b.js', 'export const b = 2;\n'); p.edit(taskPath, x => `${x}\n`); p.git('add', '.'); p.git('commit', '-qm', 'T-0001: both');
  assert.equal(pathsOf(p, records, p.git('rev-parse', 'HEAD')).planning_only, false, 'records and code together');
});
test('MAINT-0017: an empty or unclassified diff is never planning_only', t => {
  const p = setup(t);
  assert.equal(pathsOf(p, p.candidate, p.candidate).planning_only, false, 'empty diff');
  p.write('mystery.bin', 'x'); p.git('add', '.'); p.git('commit', '-qm', 'unclassified');
  const r = pathsOf(p, p.candidate, p.git('rev-parse', 'HEAD'));
  assert.equal(r.ok, false); assert.equal(r.planning_only, false, 'unclassified');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-name-pattern=MAINT-0017 validator/test/git-integration.test.js`
Expected: FAIL with `undefined !== true`.

- [ ] **Step 3: Implement**

`validator/cli.js` line 376 becomes:
```js
  else if (cmd === 'paths') {
    const classes = classifyPaths(config, changed());
    // MAINT-0017 A3: a project's CI may skip its product steps on planning_only (delivery.md); empty or unclassified is never.
    result = { ok: !classes.some(c => c.category === 'unclassified'), planning_only: classes.length > 0 && classes.every(c => c.category === 'planning'), classes };
  }
```

Append to `procedures/delivery.md` line 7 (the paragraph that starts "Keep the required workflow check running"):
```
`wf paths --baseline B --candidate C` reports `planning_only`, true only when there are changed paths and every one is planning; run it from the base-pinned validator as `wf-ci.yml` fetches it, with the pull request's base and head, or a push's `before` and `after`. A missing field (an older pin) means run everything.
```

In `QUICKSTART.md`, the sentence starting `Other commands: \`paths\` classifies the actual diff;` becomes `Other commands: \`paths\` classifies the actual diff and says whether it is \`planning_only\`;`.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add validator/cli.js validator/test/git-integration.test.js procedures/delivery.md QUICKSTART.md
git commit -m "MAINT-0017 A3: wf paths reports planning_only, which a project's CI may use to skip product steps"
```

### Task 5: The CI runner tooling ships here (A2)

Prevents: each project, or each machine, rebuilding the runner setup by hand. The setup was written and statically verified for the owner's home server (project 003 in its admin folder). Check: `ci-runner.test.js`.

**Files:**
- Create: `server/ci-runner/README.md`, `server/ci-runner/ci-runner`, `server/ci-runner/runner-setup`, `server/ci-runner/ci-build.yaml`, `server/ci-runner/ci-gate.yaml`, `server/ci-runner/lxd-preseed.yaml`, `server/ci-runner/install-host.sh`
- Create: `validator/test/ci-runner.test.js`

**Interfaces:**
- Consumes: the labels from Global Constraints. Each runner registers under the label equal to its container's name (`<project>-ci`, `<project>-gate`).
- Produces: `server/ci-runner/README.md`, which Task 6's procedures link to.

- [ ] **Step 1: Write the failing test** (`validator/test/ci-runner.test.js`)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// MAINT-0017 A2: the owner's CI runners. A build container runs product code with Docker; a gate container runs only
// the workflow's own jobs, with no Docker and no sudo, so product code and its packages never reach the merge check.
const dir = new URL('../../server/ci-runner/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, dir), 'utf8');

test('the runner scripts parse as Bash', () => {
  for (const f of ['ci-runner', 'runner-setup', 'install-host.sh']) {
    const r = spawnSync('bash', ['-n', fileURLToPath(new URL(f, dir))], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test('the gate container has no Docker and no sudo for the runner, and has gh for the status jobs', () => {
  const gate = read('ci-gate.yaml');
  assert.match(gate, /^#cloud-config\n/);
  const config = gate.split('\n').filter(l => !l.trim().startsWith('#')).join('\n'); // the comments say "no Docker"
  assert.doesNotMatch(config, /docker/i);
  assert.doesNotMatch(config, /^\s+sudo:/m);
  assert.match(gate, /apt-get install -y git gh/);
});

test('the build container clears Docker after every job and at boot', () => {
  const build = read('ci-build.yaml');
  assert.match(build, /^#cloud-config\n/);
  assert.match(build, /path: \/opt\/ci-hooks\/clean-docker\.sh/);
  assert.match(build, /@reboot root sleep 30 && \/opt\/ci-hooks\/clean-docker\.sh/);
  assert.match(read('runner-setup'), /ACTIONS_RUNNER_HOOK_JOB_COMPLETED=\/opt\/ci-hooks\/clean-docker\.sh/);
});

test('the runner download is checked against its release checksum before it is unpacked', () => {
  const s = read('runner-setup');
  assert.ok(s.indexOf('sha256sum -c -') > 0 && s.indexOf('sha256sum -c -') < s.indexOf('tar xzf'), 'checksum before unpacking');
  assert.match(s, /BEGIN SHA linux-\$\{arch\}/);
});

test('the registration token is read hidden, passed on stdin, and never printed', () => {
  const c = read('ci-runner');
  assert.match(c, /read -rsp /);
  assert.match(c, /printf '%s\\n' "\$token" \| \$LXC exec/);
  assert.doesNotMatch(c, /echo[^\n]*\$token/);
  assert.match(read('runner-setup'), /^read -r token$/m);
});

test('install-host opens nothing towards the LAN or the internet', () => {
  const h = read('install-host.sh');
  for (const rule of h.match(/^sudo ufw .*$/gm)) assert.match(rule, / on lxdbr0 /, rule);
  assert.ok(h.indexOf('route deny in on lxdbr0') < h.indexOf('route allow in on lxdbr0'), 'the LAN deny comes first');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test validator/test/ci-runner.test.js`
Expected: FAIL with ENOENT for `server/ci-runner/...`.

- [ ] **Step 3: Create the files**

Copy verbatim from `~/Dev/home VPS/projects/003-ci-runners/files/` (that folder's commit `9d95c75`): `ci-runner`, `runner-setup`, `ci-build.yaml`, `ci-gate.yaml`, `lxd-preseed.yaml`. Then apply these exact edits.

In every copied file's header comment, replace `(project 003)` with `(MAINT-0017)`. In `lxd-preseed.yaml`, replace `on the home server (project 003)` with `on a CI host (MAINT-0017)`.

`ci-gate.yaml`: the header's last sentence becomes `It runs only the workflow's own jobs (wf ci, wf-status, the client page), apart from the build container where pull-request code and its packages run; gh is for the status jobs.` The `runcmd:` becomes:
```yaml
runcmd:
  - add-apt-repository -y ppa:git-core/ppa
  - install -m 0755 -d /etc/apt/keyrings
  - curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
  - chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  - [sh, -c, 'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list']
  - apt-get update
  - [sh, -c, 'DEBIAN_FRONTEND=noninteractive apt-get install -y git gh']
```

`ci-runner`: `SHARE=/usr/local/share/ci-runner` is unchanged.

Create `server/ci-runner/install-host.sh`, the host half of project 003's `install.sh` without the project's containers:
```bash
#!/usr/bin/env bash
# install-host.sh: the one-time host setup for the owner's CI runners (MAINT-0017), on Ubuntu with snapd and ufw, run as
# an admin from this directory: install ci-runner and its files, LXD 5.21 and firewall rules for LXD's bridge, then the
# ci-build and ci-gate profiles. Safe to re-run. Nothing opens towards the LAN or the internet. CI_LAN is the private
# range the containers may not route into (default 192.168.0.0/16).
set -euo pipefail
cd "$(dirname "$0")"
CI_LAN="${CI_LAN:-192.168.0.0/16}"
sudo install -m 0755 ci-runner /usr/local/sbin/ci-runner
sudo install -d -m 0755 /usr/local/share/ci-runner
sudo install -m 0755 runner-setup /usr/local/share/ci-runner/runner-setup
sudo install -m 0644 ci-build.yaml ci-gate.yaml lxd-preseed.yaml /usr/local/share/ci-runner/
snap list lxd >/dev/null 2>&1 || sudo snap install lxd --channel=5.21/stable
sudo /snap/bin/lxc network show lxdbr0 >/dev/null 2>&1 \
  || sudo /snap/bin/lxd init --preseed < /usr/local/share/ci-runner/lxd-preseed.yaml
# ufw, on LXD's bridge only: DHCP and DNS into the host, then out to the internet but never into the LAN (the deny goes
# in before the allow, since the first matching rule wins).
sudo ufw allow in on lxdbr0 to any port 67 proto udp comment 'LXD bridge: DHCP for CI containers'
sudo ufw allow in on lxdbr0 to any port 53 comment 'LXD bridge: DNS for CI containers'
sudo ufw route deny in on lxdbr0 to "$CI_LAN" comment 'CI containers: not the LAN'
sudo ufw route allow in on lxdbr0 comment 'CI containers: out to the internet'
sudo ufw route allow out on lxdbr0 comment 'CI containers: replies'
sudo /usr/local/sbin/ci-runner init
echo "Host ready. For a project: see server/ci-runner/README.md."
```

Create `server/ci-runner/README.md`:
````markdown
# CI runners on the owner's machine (MAINT-0017)

A project's GitHub Actions jobs can run here instead of on GitHub's metered runners. Each project gets two LXD containers, each registered as a runner for that repository only:

| Container | Profile | Runs | Has |
|---|---|---|---|
| `<project>-ci` | `ci-build` | the project's tests and deploys: pull-request code and its packages | Docker (cleared after every job), sudo for the runner |
| `<project>-gate` | `ci-gate` | the workflow's own jobs: `wf ci`, `wf-status`, the client page | Git and `gh`; no Docker, no sudo |

Product code never runs in the gate container, so it can't tamper with the check that decides who merges. A runner here is persistent, unlike GitHub's fresh machines: a later item (MAINT-0017 D1) gives each job a fresh container.

## Once per host (Ubuntu with snapd and ufw)

```bash
bash install-host.sh
```

## Once per project

```bash
sudo ci-runner create shop-ci build
sudo ci-runner create shop-gate gate
sudo ci-runner register OWNER/shop shop-ci:shop-ci shop-gate:shop-gate
```

`register` asks once, hidden, for the registration token from the repository's *Settings → Actions → Runners → New self-hosted runner* (only an admin of the repository can make one). Then, in *Settings → Secrets and variables → Actions → Variables*, set `CI_RUNNER` = `shop-ci` and `WF_CI_RUNNER` = `shop-gate`. The project's own CI reads `CI_RUNNER` (`runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}`); the installed workflow files read `WF_CI_RUNNER`.

## When a runner is down

Jobs wait for it rather than fail, so merges stall. Delete the variable to move those jobs back to GitHub, then re-run the waiting jobs. A re-run uses its run's own commit and workflow files: a pull request that changed its workflow files needs a new push. `sudo ci-runner status` lists the containers and their runner services.
````

- [ ] **Step 4: Run the tests**

Run: `node --test validator/test/ci-runner.test.js && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/ci-runner validator/test/ci-runner.test.js
git commit -m "MAINT-0017 A2: server/ci-runner, the owner's build and gate runners in LXD containers"
```

### Task 6: Procedures (A2, A6)

Prevents: a project not knowing the runners exist, and the stall when a runner is down being diagnosed from scratch. Check: `procedure-links.test.js` (paths named in procedures exist); corpus count.

**Files:**
- Modify: `procedures/setup.md:40` (step 6, owner-merge part)
- Modify: `procedures/operate.md` (new section after *Deployment*)

- [ ] **Step 1: Edit the text**

In `procedures/setup.md` step 6, after `…so the owner checks every change under \`.github/\` before merging.` insert:
```
**CI on the owner's machine**, in any mode (optional, MAINT-0017): `server/ci-runner/README.md` sets up a build and a gate runner per project; the repository variables `CI_RUNNER` and `WF_CI_RUNNER` then move the project's own jobs and the installed workflow files' jobs there, and deleting them moves the jobs back. Before this repository's workflow is fetched from a private repository, set the secret `WF_READ_TOKEN` to a read-only token for it.
```

In `procedures/operate.md`, after the *Deployment* section's two paragraphs, insert:
```markdown
## CI runners

A project whose variables `CI_RUNNER` and `WF_CI_RUNNER` name the owner's runners (`server/ci-runner/README.md`) depends on them: when one is down, jobs wait instead of failing, and merges stall. Deleting the variable moves its jobs back to GitHub; re-run the waiting jobs, or push again where a pull request changed its workflow files. The gate runner is persistent: `wf ci` there rests on product code never running on it, which the build/gate split provides and the owner accepted (MAINT-0017 A2).
```

- [ ] **Step 2: Run the tests and count**

Run: `npm test`
Expected: all pass.
Run: `wc -w procedures/setup.md procedures/operate.md procedures/delivery.md`
Expected: growth over 2,305 / 888 / 200 words totalling at most 250 words, Task 4's delivery sentences included.

- [ ] **Step 3: Commit**

```bash
git add procedures/setup.md procedures/operate.md
git commit -m "MAINT-0017 A2, A6: setup and operate name the owner's CI runners and what to do when one is down"
```

### Task 7: Release v2.5.0

**Files:**
- Modify: `package.json` (`"version": "2.5.0"`)
- Modify: `CHANGELOG.md` (new `## v2.5.0` above `## v2.4.2`)
- Modify: `upgrades.json` (new key `"v2.5.0"`)
- Modify: `docs/proposals/MAINT-0017-own-machines-owner-assistant.md` § 9

- [ ] **Step 1: Write the release entries**

`upgrades.json`, after the `v2.4.2` entry:
```json
  "v2.5.0": {
    "notes": [
      "Refresh .github/workflows/wf-ci.yml, wf-status.yml and, if installed, wf-client-page.yml (bin/wf-upgrade does it where a file is the old release's copy; a copy changed in the project takes the runs-on line and the fetch step by hand). An enforcement change for the owner.",
      "Optional: run the project's CI on the owner's machine (server/ci-runner/README.md), then set the repository variables CI_RUNNER and WF_CI_RUNNER; the project's own CI uses runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }} for its product jobs.",
      "Before the workflow repository becomes private: set the secret WF_READ_TOKEN to a read-only token for it. A project CI job of its own that fetches the validator (an acceptance job) takes the same GIT_CONFIG block as wf-ci.yml's fetch step.",
      "The client page now rebuilds on the trusted branch, on pull request events, daily, and every 15 minutes with a gate runner; it no longer rebuilds on every push to every branch.",
      "Optional: wf paths reports planning_only, which a project's CI may use to skip its product steps on records-only changes (procedures/delivery.md)."
    ]
  }
```

`CHANGELOG.md`, above `## v2.4.2`:
```markdown
## v2.5.0

MAINT-0017 Part A: our own machines. On 13 October GitHub Actions stopped on the owner's account when its included minutes ran out, and no pull request could merge, because `wf ci` ran only on GitHub's runners.
- **A runner switch** (A1): every installed workflow job runs on `runs-on: ${{ vars.WF_CI_RUNNER || 'ubuntu-latest' }}`. A project's own CI uses `CI_RUNNER` the same way.
- **The owner's runners** (A2): `server/ci-runner/` sets up a build container (Docker, the project's tests and deploys) and a gate container (no Docker or sudo; only the workflow's own jobs) per project, with LXD.
- **A private workflow repository** (A5): the installed workflows fetch the pin with the secret `WF_READ_TOKEN` when it is set. Only the fetch step sees it.
- **The client page** (A4) rebuilds on the trusted branch, on pull request events, daily, and every 15 minutes with a gate runner. The dispatch on every push to every branch is gone.
- **`wf paths` reports `planning_only`** (A3).
- **Procedures:** `setup.md` step 6 and `operate.md` *CI runners*.

Moving a project to this pin: `upgrades.json`.
```

`package.json`: `"version": "2.4.2"` becomes `"version": "2.5.0"`.

In the proposal's § 9, replace the line with `Shared corpus: 39,204 words before v2.5.0, <after> after (counted as \`cat POLICY.md SCHEMA.md QUICKSTART.md procedures/*.md .agents/skills/workflow/SKILL.md $(git ls-files templates) | wc -w\`). \`procedures/execute.md\` unchanged.`, with `<after>` the number from Step 2.

- [ ] **Step 2: Count and test**

Run: `cat POLICY.md SCHEMA.md QUICKSTART.md procedures/*.md .agents/skills/workflow/SKILL.md $(git ls-files templates) | wc -w`, and put the number in § 9.
Run: `npm test`
Expected: all pass, including `upgrade.test.js`, which reads `upgrades.json`.

- [ ] **Step 3: Commit**

```bash
git add package.json CHANGELOG.md upgrades.json docs/proposals/MAINT-0017-own-machines-owner-assistant.md
git commit -m "v2.5.0: MAINT-0017 Part A, our own machines"
```

### Task 8: Independent review, then the owner's merge

- [ ] **Step 1:** Push the branch and open the release pull request.
- [ ] **Step 2:** Run an independent review (`procedures/review.md`): a fresh context that receives the proposal, this plan and the diff, and not the implementer's conversation. Deep level: the change touches the merge check's runner and a secret.
- [ ] **Step 3:** Fix blocking findings. Record any accepted ones with their reasons on the pull request.
- [ ] **Step 4:** The owner merges. `release-tag.yml` tags `v2.5.0`.

## Adoption (after the release, outside this plan)

- **mateen-systems:** finishes M-0004 on v2.4.x with the project-local switches from Cazy00/mateen-systems#74. Moving to v2.5.0 is M-0005's first task, on the owner's server. `wf-upgrade` lists `wf-ci.yml` as changed by the project; its `runs-on` line already matches.
- **The owner's home server:** its admin folder (project 003) installs from `server/ci-runner/` from then on, and records what's installed.
