#!/usr/bin/env bash
# One-time preparation of an Oracle Linux VM (run as the default user, which has sudo):
#   bash setup-vm.sh
# Safe to run again. Adds swap, Docker, the firewall rules, automatic security updates and /opt/remio.
set -euo pipefail

# --- swap: a 1 GB machine otherwise runs out of memory during package installs and image pulls
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# --- firewall (Oracle Linux uses firewalld, not iptables rules by hand)
sudo systemctl enable --now firewalld
sudo firewall-cmd --permanent --add-service=http --add-service=https
sudo firewall-cmd --permanent --add-port=443/udp   # HTTP/3
sudo firewall-cmd --reload

# --- Docker
if ! command -v docker >/dev/null; then
  # dnf loads the metadata of every enabled repo, which is more than a 500 MB machine can hold.
  # Writing the repo file by hand and enabling only the three repos needed keeps it inside memory.
  sudo curl -fsSL https://download.docker.com/linux/centos/docker-ce.repo -o /etc/yum.repos.d/docker-ce.repo
  sudo sed -i 's/\$releasever/9/g' /etc/yum.repos.d/docker-ce.repo
  sudo systemctl stop oracle-cloud-agent 2>/dev/null || true   # frees ~100 MB for the install
  sudo dnf clean all
  sudo dnf install -y --setopt=install_weak_deps=False --disablerepo='*' \
    --enablerepo=ol9_baseos_latest --enablerepo=ol9_appstream --enablerepo=docker-ce-stable \
    docker-ce docker-ce-cli containerd.io docker-compose-plugin
  sudo systemctl start oracle-cloud-agent 2>/dev/null || true
fi
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

# --- automatic security updates
sudo dnf install -y --setopt=install_weak_deps=False --disablerepo='*' \
  --enablerepo=ol9_baseos_latest --enablerepo=ol9_appstream dnf-automatic
sudo sed -i 's/^apply_updates *=.*/apply_updates = yes/' /etc/dnf/automatic.conf
sudo systemctl enable --now dnf-automatic.timer

# --- app directory
sudo install -d -o "$USER" -g "$USER" -m 750 /opt/remio
echo
echo "Done. Next: put the production settings in /opt/remio/.env (chmod 600), then log out and in again."
