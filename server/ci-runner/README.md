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
