#!/usr/bin/env bash
# install-host.sh: the one-time host setup for the owner's CI runners (MAINT-0017), on Ubuntu with snapd and ufw, run as
# an admin from this directory: install ci-runner and its files, LXD 5.21 and firewall rules for LXD's bridge, then the
# ci-build and ci-gate profiles. Safe to re-run. Nothing opens towards the LAN or the internet. CI_LAN is the private
# range the containers may not route into (default 192.168.0.0/16).
set -euo pipefail
cd "$(dirname "$0")"
CI_LAN="${CI_LAN:-192.168.0.0/16}"
# The rules below protect the LAN only while ufw is on: turn it on first, keeping SSH open (allow port 22 from your LAN,
# then enable it), and re-run.
if ! sudo ufw status | grep -q '^Status: active'; then
  echo "install-host: ufw is not active, so its rules would protect nothing. Turn it on first, keeping SSH open, then re-run." >&2
  exit 1
fi
sudo install -m 0755 ci-runner /usr/local/sbin/ci-runner
sudo install -d -m 0755 /usr/local/share/ci-runner
sudo install -m 0755 runner-setup /usr/local/share/ci-runner/runner-setup
sudo install -m 0644 ci-build.yaml ci-gate.yaml lxd-preseed.yaml /usr/local/share/ci-runner/
# the pool (ci-pool.contract.md): the service, its job and token source, the image builder and what runs inside a container
sudo install -m 0755 ci-pool ci-pool-github ci-pool-image /usr/local/sbin/
sudo install -m 0755 ci-pool-entrypoint /usr/local/share/ci-runner/ci-pool-entrypoint
sudo install -m 0644 ci-pool-runner.service ci-pool-build.yaml ci-pool-gate.yaml ci-pool.config.example.json /usr/local/share/ci-runner/
sudo install -m 0644 ci-pool.service /etc/systemd/system/ci-pool.service
sudo install -d -m 0700 /etc/ci-pool
snap list lxd >/dev/null 2>&1 || sudo snap install lxd --channel=5.21/stable
sudo /snap/bin/lxc network show lxdbr0 >/dev/null 2>&1 \
  || sudo /snap/bin/lxd init --preseed < /usr/local/share/ci-runner/lxd-preseed.yaml
# ufw, on LXD's bridge only: DHCP and DNS into the host (below), then out to the internet but never into the LAN (the deny is
# inserted first, since the first matching rule wins, whatever rules came before).
sudo ufw route insert 1 deny in on lxdbr0 to "$CI_LAN" comment 'CI containers: not the LAN'
sudo ufw route allow in on lxdbr0 comment 'CI containers: out to the internet'
sudo ufw route allow out on lxdbr0 comment 'CI containers: replies'
# Containers may not reach services on the host itself except DHCP and DNS: the deny is rule 1 and the two allows go in front
# of it, so they win and no broader allow further down can open the host. The three are deleted first so that a host set up
# by an older release (allows appended) ends in the same order.
sudo ufw delete allow in on lxdbr0 to any port 67 proto udp >/dev/null
sudo ufw delete allow in on lxdbr0 to any port 53 >/dev/null
sudo ufw delete deny in on lxdbr0 >/dev/null
sudo ufw insert 1 deny in on lxdbr0 comment 'CI pool containers: not the host itself'
sudo ufw insert 1 allow in on lxdbr0 to any port 53 comment 'LXD bridge: DNS for CI containers'
sudo ufw insert 1 allow in on lxdbr0 to any port 67 proto udp comment 'LXD bridge: DHCP for CI containers'
# LXD's snap starts its daemon only on demand, and its own boot check can decide it isn't needed (seen after a power
# cut): start it at every boot, so the containers' boot.autostart takes effect.
sudo tee /etc/systemd/system/ci-runner-lxd.service >/dev/null <<'UNIT'
[Unit]
Description=Start LXD at boot, for the CI runner containers (agent-workflow server/ci-runner)
After=snapd.service snap.lxd.activate.service
Wants=snapd.service

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl start snap.lxd.daemon

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable ci-runner-lxd.service
sudo /usr/local/sbin/ci-runner init
# The pool's profiles are made only where the pool's storage pool `ci` exists, and never overwritten (a host may have set
# limits); ci-pool refuses to start unless they pass `ci-pool check-profiles`. The unit is installed but left disabled until
# /etc/ci-pool/config.json and the token file exist (see README, "The pool").
sudo systemctl daemon-reload
if sudo /snap/bin/lxc storage show ci >/dev/null 2>&1; then
  for p in ci-pool-build ci-pool-gate; do
    sudo /snap/bin/lxc profile show "$p" >/dev/null 2>&1 \
      || { sudo /snap/bin/lxc profile create "$p" && sudo /snap/bin/lxc profile edit "$p" < "$p.yaml"; }
  done
else
  echo "install-host: no storage pool 'ci' yet, so the pool's profiles are not made (README, \"The pool\")." >&2
fi
echo "Host ready. For a project: see server/ci-runner/README.md."
