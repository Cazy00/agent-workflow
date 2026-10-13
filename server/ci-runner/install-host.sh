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
