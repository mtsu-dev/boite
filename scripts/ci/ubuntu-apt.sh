#!/usr/bin/env bash
# Installs packages from Ubuntu's own sources, independent of the runner's other feeds.
# Usage: bash scripts/ci/ubuntu-apt.sh [apt-get install option...] package...
# scripts/ci/linux-shell-dependencies.test.ts runs this file against a local signed archive.
set -euo pipefail

ubuntu_sources=/etc/apt/sources.list.d/ubuntu.sources
if [ ! -s "$ubuntu_sources" ]; then ubuntu_sources=/etc/apt/sources.list; fi
test -s "$ubuntu_sources"
apt_sources=(-o "Dir::Etc::sourcelist=$ubuntu_sources" -o "Dir::Etc::sourceparts=-")
update_log=$(mktemp)
set +e
sudo apt-get "${apt_sources[@]}" -o APT::Update::Error-Mode=any update 2>&1 | tee "$update_log"
update_status=${PIPESTATUS[0]}
set -e
if [ "$update_status" -ne 0 ]; then
  # The image's mirror list starts with Azure's mirror. On 2026-11-11 no ubuntu.com name
  # resolved on the runners for hours, archive.ubuntu.com included. Only a resolution
  # failure moves on, through Ubuntu mirrors on other domains; apt still checks every
  # index against Ubuntu's archive key, and a missing index or a bad signature fails.
  grep -Eq "Temporary failure resolving|Could not resolve" "$update_log" || exit "$update_status"
  # shellcheck source=/dev/null
  . /etc/os-release
  if [ "$(dpkg --print-architecture)" = amd64 ]; then
    mirrors=(https://mirrors.edge.kernel.org/ubuntu https://mirrors.mit.edu/ubuntu http://archive.ubuntu.com/ubuntu)
  else
    mirrors=(https://mirrors.mit.edu/ubuntu-ports https://mirrors.dotsrc.org/ubuntu-ports http://ports.ubuntu.com/ubuntu-ports)
  fi
  components='main restricted universe multiverse'
  updated=
  for mirror in "${mirrors[@]}"; do
    ubuntu_sources=$(mktemp --suffix=.list)
    for suite in "$VERSION_CODENAME" "$VERSION_CODENAME-updates" "$VERSION_CODENAME-backports" "$VERSION_CODENAME-security"; do
      echo "deb $mirror $suite $components"
    done > "$ubuntu_sources"
    apt_sources=(-o "Dir::Etc::sourcelist=$ubuntu_sources" -o "Dir::Etc::sourceparts=-")
    if sudo apt-get "${apt_sources[@]}" -o APT::Update::Error-Mode=any update; then updated=$mirror; break; fi
  done
  test -n "$updated"
fi
sudo apt-get "${apt_sources[@]}" install -y "$@"
