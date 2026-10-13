# CI runners on the owner's machine (MAINT-0017)

A project's GitHub Actions jobs can run here instead of on GitHub's metered runners. **Private repositories only:** on a public repository, a pull request from a fork could run code on this machine. Each project gets two LXD containers, each registered as a runner for that repository only, under its own label and no default ones:

| Container | Profile | Runs | Has |
|---|---|---|---|
| `<project>-ci` | `ci-build` | the project's tests and deploys | Docker (containers, volumes and networks cleared after every job), sudo for the runner |
| `<project>-gate` | `ci-gate` | the workflow's own jobs: `wf ci`, `wf-status`, the client page | Git and `gh`; no Docker, no sudo |

**What each runner trusts.**
- **The build container** runs whatever any account that can push sends it: a pull request's tests, and the packages they install, run there as root inside the container.
- **The gate** runs `wf ci` only for pull requests into the trusted branch; any other pull request's `wf ci` goes to GitHub's runner. It runs `wf-status` and the client page only on the trusted branch. Each job's first step checks the branch name exactly, because GitHub compares names in expressions ignoring case: a branch called `MAIN` would otherwise pass. The client page's dispatch job also runs there for any pull request, but it only runs a fixed `gh workflow run`. On the gate run:
  - the workflow files;
  - the validator pinned by the trusted branch's `docs/workflow/config.json` (at the pull request's base commit);
  - that branch's `scripts/wf`.

  So code reaches the gate from an account that can change workflow files, or that can get a change onto the trusted branch. A token needs the Workflows permission to change workflow files; an SSH key or the web needs only write access. In enforced mode, code-owner review guards the trusted branch. In owner-merge and manual modes, only the workflow's rules stop an account with write access from merging. **There, the gate is as trustworthy as every account with write access.**
- **Labels are fixed; variables are switches.**
  - The workflow files name the labels: `wf-gate` for the gate and `wf-build` for the build runner.
  - The repository variables `WF_GATE` and `CI_BUILD` only turn them `on`. Any write collaborator can set an Actions variable, so it may switch a runner off, which sends its jobs to GitHub's runner, but never sends a job to the other runner.
  - Changing a label means changing a workflow file.
- **The agents' credential** can change neither workflow files nor runners. Use one of:
  - a fine-grained token with Contents and Pull requests (and Issues, if needed) only;
  - a classic token with only the `repo` scope, for an account with write but not admin access. It can also start and re-run workflows; the exact branch checks contain that.

  No Workflows permission or `workflow` scope, no Administration permission, no SSH or deploy key with write access, and no app holding the Workflows permission. Push workflow-file changes (`wf-adopt`'s scaffold, `wf-upgrade`'s refreshes) from a session the owner attends. Keep the repository setting "Run workflows from fork pull requests" off. Before switching `WF_GATE` on, delete or update any branch whose `wf-ci.yml` predates v2.5.1 (v2.5.0's sent every pull request to the gate), and turn on "Automatically delete head branches".
- **Both containers are persistent,** and what a job leaves behind applies to later jobs. Until each job gets a fresh container (MAINT-0017 D1), `wf ci` on the gate is only as trustworthy as the accounts above. A job that holds deployment secrets stays on GitHub's runner. The exception is the client page's deploy job, which holds a short-lived token for that page alone.

**Size them for the host.** `init` creates the profiles and sets only the keys a profile lacks:
- build: 4 CPUs and 6 GiB;
- gate: 1 CPU and 1 GiB.

Change them with `sudo lxc profile set ci-build limits.memory=5GiB`; running `init` again leaves your values. The limits are per container, and they are ceilings, not reservations: each project adds 6 + 1 GiB. Keep the total, plus whatever else runs on the host, within its memory, or a shared peak wakes the host's out-of-memory killer, which can pick the SSH server. Protect remote access from it (`OOMScoreAdjust=` on those services).

**LXD's updates** reload its daemon, and running containers normally carry on; restarting LXD itself (`snap restart lxd`) stops them. To keep updates out of working hours anyway, give snapd a refresh window, `sudo snap set system refresh.timer=04:00-05:00` (it applies to every snap), or hold LXD with `sudo snap refresh --hold lxd` and update it by hand.

## Once per host (Ubuntu with snapd, and ufw active)

```bash
bash install-host.sh
```

It stops if ufw isn't active, since the firewall rules would then protect nothing. It keeps the containers out of the LAN (`CI_LAN`, default 192.168.0.0/16).

## Once per project

```bash
sudo ci-runner create shop-ci build
sudo ci-runner create shop-gate gate
sudo ci-runner register OWNER/shop shop-ci shop-gate
```

`register` first checks that GitHub doesn't show the repository publicly. Then it asks once, hidden, for the registration token from the repository's *Settings → Actions → Runners → New self-hosted runner* (only an admin of the repository can make one). Each runner is registered under its role's label, taken from its container: `wf-build` or `wf-gate`.

Then, in *Settings → Secrets and variables → Actions → Variables*, set `CI_BUILD` = `on` and `WF_GATE` = `on`. The project's own CI uses `runs-on: ${{ vars.CI_BUILD == 'on' && 'wf-build' || 'ubuntu-latest' }}` for its product jobs; the installed workflow files read `WF_GATE`.

Runners registered by v2.5.0 under other labels need these labels added (*Settings → Actions → Runners →* the runner *→* labels, an admin's step), or registering again.

## When a runner is down

Jobs queue for it rather than fail, so merges stall. Cancel the waiting run, set its switch (`CI_BUILD` or `WF_GATE`) to anything but `on` to send those jobs to GitHub, then push again, or edit the pull request's description to rerun `wf ci`. A runner that has been offline for 14 days must be registered again (`register`). `sudo ci-runner status` lists the containers and their runner services.
