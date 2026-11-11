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
  # The image's mirror list starts with Azure's mirror, whose name can stop resolving
  # for hours. Only that failure retries, once, on Ubuntu's own archive for this
  # release; a missing index or a bad signature still fails here.
  grep -Eq "Temporary failure resolving|Could not resolve" "$update_log" || exit "$update_status"
  # shellcheck source=/dev/null
  . /etc/os-release
  if [ "$(dpkg --print-architecture)" = amd64 ]; then
    archive=http://archive.ubuntu.com/ubuntu security=http://security.ubuntu.com/ubuntu
  else
    archive=http://ports.ubuntu.com/ubuntu-ports security=http://ports.ubuntu.com/ubuntu-ports
  fi
  components='main restricted universe multiverse'
  ubuntu_sources=$(mktemp --suffix=.list)
  {
    for suite in "$VERSION_CODENAME" "$VERSION_CODENAME-updates" "$VERSION_CODENAME-backports"; do
      echo "deb $archive $suite $components"
    done
    echo "deb $security $VERSION_CODENAME-security $components"
  } > "$ubuntu_sources"
  apt_sources=(-o "Dir::Etc::sourcelist=$ubuntu_sources" -o "Dir::Etc::sourceparts=-")
  sudo apt-get "${apt_sources[@]}" -o APT::Update::Error-Mode=any update
fi
sudo apt-get "${apt_sources[@]}" install -y "$@"
