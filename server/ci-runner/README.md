# CI runners on the owner's machine (MAINT-0017)

A project's GitHub Actions jobs can run here instead of on GitHub's metered runners. **Private repositories only:** on a public repository, a pull request from a fork could run code on this machine. Each project gets two LXD containers, each registered as a runner for that repository only, under its own label and no default ones:

| Container | Profile | Runs | Has |
|---|---|---|---|
| `<project>-ci` | `ci-build` | the project's tests and deploys | Docker (containers, volumes and networks cleared after every job), sudo for the runner |
| `<project>-gate` | `ci-gate` | the workflow's own jobs: `wf ci`, `wf-status`, the client page | Git and `gh`; no Docker, no sudo |

**What the split does and doesn't do.** It keeps the project's tests, and the packages they install, out of the container that runs `wf ci`, so an accident in a dependency can't reach the check that decides who merges. It doesn't stop a person or agent who means to: the containers are persistent, and any account that can push can run code on either one. A pull request runs its own copy of the workflow files, and any branch can add a workflow that names a runner's label. What such a job leaves behind applies to later jobs, so until each job gets a fresh container (MAINT-0017 D1), `wf ci` on the gate is only as trustworthy as the accounts that can push. For the same reason, a job that holds deployment secrets stays on GitHub's runner until then.

## Once per host (Ubuntu with snapd, and ufw active)

```bash
bash install-host.sh
```

It stops if ufw isn't active, since the firewall rules would then protect nothing. It keeps the containers out of the LAN (`CI_LAN`, default 192.168.0.0/16).

## Once per project

```bash
sudo ci-runner create shop-ci build
sudo ci-runner create shop-gate gate
sudo ci-runner register OWNER/shop shop-ci:shop-ci shop-gate:shop-gate
```

`register` first checks that GitHub doesn't show the repository publicly, then asks once, hidden, for the registration token from the repository's *Settings → Actions → Runners → New self-hosted runner* (only an admin of the repository can make one). Then, in *Settings → Secrets and variables → Actions → Variables*, set `CI_RUNNER` = `shop-ci` and `WF_CI_RUNNER` = `shop-gate`. The project's own CI reads `CI_RUNNER` (`runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}`); the installed workflow files read `WF_CI_RUNNER`.

## When a runner is down

Jobs queue for it rather than fail, so merges stall. Cancel the waiting run, delete the variable to send those jobs to GitHub, then push again, or edit the pull request's description to rerun `wf ci`. A runner that has been offline for 14 days must be registered again (`register`). `sudo ci-runner status` lists the containers and their runner services.
