# CI runners on the owner's machine (MAINT-0017)

A project's GitHub Actions jobs can run here instead of on GitHub's metered runners. **Private repositories only:** on a public repository, a pull request from a fork could run code on this machine. Each project gets two LXD containers, each registered as a runner for that repository only, under its own label and no default ones:

| Container | Profile | Runs | Has |
|---|---|---|---|
| `<project>-ci` | `ci-build` | the project's tests and deploys | Docker (containers, volumes and networks cleared after every job), sudo for the runner |
| `<project>-gate` | `ci-gate` | the workflow's own jobs: `wf ci`, `wf-status`, the client page | Git and `gh`; no Docker, no sudo |

**What each runner trusts.**
- **The build container** runs whatever any account that can push sends it: a pull request's tests, and the packages they install, run there as root inside the container.
- **The gate** runs only two things: the repository's workflow files, and `scripts/wf` from the trusted branch (for `wf-status` and the client page). A pull request runs its own copy of the workflow files, and any branch can add a workflow that names a runner's label. So code reaches the gate only from an account that can change workflow files, or one that can merge to the trusted branch. A token needs the **Workflows permission** to change workflow files; an SSH key or the web needs only write access.
- **Give unattended agents a fine-grained token without the Workflows permission,** and push workflow-file changes (`wf-adopt`'s scaffold, `wf-upgrade`'s refreshes) from a session the owner attends.
- **Both containers are persistent,** and what a job leaves behind applies to later jobs. Until each job gets a fresh container (MAINT-0017 D1), `wf ci` on the gate is only as trustworthy as the accounts above, and a job that holds deployment secrets stays on GitHub's runner.

**Size them for the host.** `init` creates the profiles only when they're missing:
- build: 4 CPUs and 6 GiB;
- gate: 1 CPU and 1 GiB.

Change them with `sudo lxc profile set ci-build limits.memory=5GiB`; running `init` again leaves them as you set them. The limits are ceilings, not reservations. Keep their sum, plus whatever else runs on the host, within its memory, or a shared peak wakes the host's out-of-memory killer, which can pick the SSH server. Protect remote access from it (`OOMScoreAdjust=` on those services).

**LXD updates restart the containers,** and a job running at that moment fails. Either give snapd a refresh window outside working hours, `sudo snap set system refresh.timer=04:00-05:00` (it applies to every snap), or hold LXD with `sudo snap refresh --hold lxd` and update it by hand.

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
