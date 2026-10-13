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
snap list lxd >/dev/null 2>&1 || sudo snap install lxd --channel=5.21/stable
sudo /snap/bin/lxc network show lxdbr0 >/dev/null 2>&1 \
  || sudo /snap/bin/lxd init --preseed < /usr/local/share/ci-runner/lxd-preseed.yaml
# ufw, on LXD's bridge only: DHCP and DNS into the host, then out to the internet but never into the LAN (the deny is
# inserted first, since the first matching rule wins, whatever rules came before).
sudo ufw allow in on lxdbr0 to any port 67 proto udp comment 'LXD bridge: DHCP for CI containers'
sudo ufw allow in on lxdbr0 to any port 53 comment 'LXD bridge: DNS for CI containers'
sudo ufw route insert 1 deny in on lxdbr0 to "$CI_LAN" comment 'CI containers: not the LAN'
sudo ufw route allow in on lxdbr0 comment 'CI containers: out to the internet'
sudo ufw route allow out on lxdbr0 comment 'CI containers: replies'
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
echo "Host ready. For a project: see server/ci-runner/README.md."
