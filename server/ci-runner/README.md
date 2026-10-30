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
  - Only the installed gate workflow (`wf ci`, from the trusted branch) runs on `wf-gate`. A job that runs code from a pull request or its base runs on `wf-build`, however light it is, because the gate label is trusted.
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

It stops if ufw isn't active, since the firewall rules would then protect nothing. It also makes LXD's daemon start at every boot. The snap otherwise starts it only on demand, and after a power cut it left the containers stopped. `create` sets `boot.autostart` on each container itself; running it again on an existing container repairs one made by an older release. It keeps the containers out of the LAN (`CI_LAN`, default 192.168.0.0/16).

## Once per project

```bash
sudo ci-runner create shop-ci build
sudo ci-runner create shop-gate gate
sudo ci-runner register OWNER/shop shop-ci shop-gate
```

`register` first checks that GitHub doesn't show the repository publicly. Then it asks once, hidden, for the registration token from the repository's *Settings → Actions → Runners → New self-hosted runner* (only an admin of the repository can make one). Each runner is registered under its role's label, taken from its container: `wf-build` or `wf-gate`.

Then, in *Settings → Secrets and variables → Actions → Variables*, set `CI_BUILD` = `on` and `WF_GATE` = `on`. The project's own CI uses `runs-on: ${{ vars.CI_BUILD == 'on' && 'wf-build' || 'ubuntu-latest' }}` for its product jobs; the installed workflow files read `WF_GATE`. `templates/github/project-ci.yml` is a project CI in that shape: parallel jobs, the database in RAM, one run per pull request, and a push that reuses its pull request's result on an identical tree (`procedures/delivery.md`, *Faster CI*).

Runners registered by v2.5.0 under other labels need these labels added (*Settings → Actions → Runners →* the runner *→* labels, an admin's step), or registering again.

## When a runner is down

Jobs queue for it rather than fail, so merges stall. Cancel the waiting run, set its switch (`CI_BUILD` or `WF_GATE`) to anything but `on` to send those jobs to GitHub, then push again, or edit the pull request's description to rerun `wf ci`. A runner that has been offline for 14 days must be registered again (`register`). `sudo ci-runner status` lists the containers and their runner services.

## The pool: a fresh container for every job (MAINT-0017 D1)

`ci-pool` replaces the two persistent containers per project with containers that live for one job. A project's `runs-on` lines do not change: the pool serves the same labels, `wf-build` and `wf-gate`. It is a root service on the host, one Python file with no dependencies.

Every 15 s or more (see the API budget below), for each repository on its list, it asks the **job source** for queued jobs. For a job whose label it serves, it asks the **JIT source** for a runner config that allows exactly one job, puts it into a container made from the label's image, and starts the container. The runner takes its job, exits, and the container powers off; the pool deletes it. Nothing is reused, so what a job leaves behind never reaches the next one.

- **Where jobs and tokens come from is a contract** (`ci-pool.contract.md`, v1), two commands in the config. `ci-pool-github` is the reference: a GitHub token in a root-only file (`/etc/ci-pool/github-token`, mode 0600 or tighter). A host that keeps its credentials elsewhere replaces the two commands and nothing else.
- **The token's permission, and its risk.** Creating a repository's just-in-time runners and deleting its runners needs the repository permission **Administration: write** (fine-grained token or GitHub App; plus **Actions: read** to list runs and jobs). GitHub has no narrower one for this. That permission also changes rulesets, branch protection and repository settings, so root on the host, or anyone who reads `/etc/ci-pool/github-token`, can lift the merge gate. Treat the file like a deploy key: root-only, never copied. Prefer a **GitHub App** installed on the listed repositories only, with a **short-lived installation token** (one hour) that a timer on the host renews into the file, over a personal token that lives until someone revokes it; with a personal token, use one per repository and an expiry date.
- **API budget.** The source calls the API about 6 times per repository per pass: the repository, three run listings (queued, in progress, waiting), one jobs listing per active run, and, while the repository has containers, the runs in progress and their jobs again. One token has 5,000 calls an hour, shared with everything else it does. The pool therefore never polls faster than `ceil(repositories × api_calls_per_repo_poll × 3600 / api_calls_per_hour)` seconds, with at least `poll_seconds` and 15 s: with the defaults (6 and 1,500 an hour) 1 repository polls every 15 s, 5 every 72 s, 10 every 144 s. The effective pause is in the `started` event.
- **Containers are launched by count, not by job id.** A runner takes any queued job with its label, not necessarily the job that made the pool start it. So for each repository and label the pool starts a container while queued jobs outnumber the containers whose runner has no job yet, up to the cap. A job's id names its container and is remembered (in the state file, before the container starts) only to keep a launch from repeating while that container lives, during its 2-minute retry pause after a failed launch, or for 10 s after it ended (a lagging listing). Queued jobs of a run that is already in progress are found too, as are `needs:` jobs once they are queued. A launch a crash left without a container is closed on the next pass and the job launched again.
- **Never kills a running job for room.** A container is deleted only when its runner has exited, after the hard timeout (2 h), or when no job was assigned to its runner within 5 min (the job was cancelled, or another runner took it). The runner is then unregistered first, and if GitHub refuses (it still holds a job) the container stays. Assignment is checked on every pass, so a container that came back after a host reboot without its JIT config stops holding a cap slot. If the job source does not answer, nothing is deleted.
- **Caps and admission.** Per label `cap` (start with 1 build and 2 gates). A container starts only while the label is under its cap, `MemAvailable` is at least 3 GiB, CPU pressure (`some`, avg60) is under 40 and memory pressure under 10; the check repeats at every start, with the memory limits of containers started in the last minute (this pass included) already taken off `MemAvailable`, since they have not used it yet. A missing reading refuses. A label may carry its own `admission` (the same three keys, overlaid on the global ones); the example gives `wf-gate` `"max_cpu_psi_avg60": 100`, which means CPU pressure does not hold gate jobs (`wf ci` needs git and node, no Docker) while the memory rules still apply. The 100 rule is for CPU only: `max_mem_psi_avg60` keeps `>=` at every value, so a memory pressure reading of exactly 100 still refuses. Only the installed gate workflow runs on `wf-gate`; a job that runs code from a pull request or its base runs on `wf-build`, however light it is. A refusal holds only its label for the rest of the pass, in every repository; the others still try. `ci-pool check-config --config FILE` validates a config without touching `lxc` (exit 0, or 2 with the reason). Containers have a hard memory limit and no swap.
- **A stopped spare per label** (`pool-<label>-spare`) is made from the image and not started, so it uses no memory; a job renames it, starts it, and a new spare is made. A spare of an older image is replaced.
- **Containers are `pool-<label>-<job id>`;** runners are `ci-pool-<label>-<last 8 of the job id>`. Each event is one JSON line on stdout (journald).
- **Private repositories only:** the pool ignores a repository the source does not report as private, and any repository not on its list.
- **Unprivileged.** The profiles `ci-pool-build` and `ci-pool-gate` set `security.privileged=false` and nothing that widens it: no `raw.lxc`, no `raw.idmap`, no devices but a root disk on the storage pool `ci` and a NIC on `lxdbr0`; build adds nesting and the mknod and setxattr intercepts for Docker. `ci-pool check-profiles` (also run at start) refuses a profile with any other key, device or value. The firewall rule from `install-host.sh` stops the containers reaching the host itself, except DNS and DHCP.

### Set up (admin, once per host)

1. `bash install-host.sh` installs the files, the firewall rule and the unit `ci-pool.service`, **disabled** (it will not start without `/etc/ci-pool/config.json`).
2. Create the storage pool `ci` (btrfs or zfs, so a container starts as a copy-on-write clone in seconds): `sudo lxc storage create ci btrfs size=60GiB`. Then re-run `install-host.sh`: it creates the two profiles where they are missing (and never overwrites ones a host tuned), or `lxc profile create` and `lxc profile edit` them from `ci-pool-build.yaml` and `ci-pool-gate.yaml`. Profiles must say `boot.autostart: "false"` (after a reboot LXD would otherwise bring job containers back without their one-time config); on a host that made them earlier: `sudo lxc profile set ci-pool-build boot.autostart false`, and the same for `ci-pool-gate`.
3. `sudo ci-pool-image build wf-build` and `sudo ci-pool-image build wf-gate`: Ubuntu 24.04 with the runner (checked against its published checksum), git, gh and Node; build adds Docker, Playwright's browsers and `postgres:18.6` pulled, and `/tmp` as tmpfs (2 GiB, counts against the container's memory). The image it replaces stays as `<alias>-prev` for rollback; the one before that is deleted, so a weekly rebuild does not fill the disk. Rebuild weekly (a timer) and on release.
4. `sudo cp /usr/local/share/ci-runner/ci-pool.config.example.json /etc/ci-pool/config.json`, list the repositories, put the token in `/etc/ci-pool/github-token` (`chmod 600`), check with `sudo ci-pool check-profiles`, then **check that `lxc` works under systemd's sandbox before enabling**: `sudo systemd-run --wait --pipe /snap/bin/lxc list` must print the instances (the unit sets no `ProtectHome` and no `NoNewPrivileges`, because `snap run` fails under either: add them to the command as `-p ProtectHome=true -p NoNewPrivileges=true` to see it fail). Then `sudo systemctl enable --now ci-pool` and `journalctl -u ci-pool -f`.

Moving a project: add it to `repos`, wait for its persistent runners to be idle, then remove them. The pool and a persistent runner with the same label share the queue until then. Stopping the service leaves running containers alone.
