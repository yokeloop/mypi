#!/usr/bin/env bash
# Called by systemd in the bounded unit, never a substitute unbounded runner.
set -euo pipefail
root="$1"; node="$2"; profile="$3"
start="$(date +%s%N)"
work="$(mktemp -d "${RUNTIME_DIRECTORY:?systemd runtime directory required}/workspace.XXXXXXXX")"
trap 'rm -rf "$work"' EXIT
mkdir "$work/tools"
cp --reflink=auto "$node" "$work/tools/node"
cp -a --reflink=auto "$root"/{src,test,dist,scripts,integrations,node_modules,package.json,pnpm-lock.yaml,tsconfig.json,.dependency-cruiser.cjs} "$work/"
group="$(awk -F: '$1 == "0" { print $3 }' /proc/self/cgroup)"
[[ "$group" == */mypi-tests.service ]] || { echo "Missing bounded systemd unit" >&2; exit 1; }
bwrap --unshare-all --die-with-parent --new-session --cap-drop ALL --clearenv \
  --ro-bind /usr /usr --symlink usr/lib /lib --ro-bind /lib64 /lib64 \
  --proc /proc --dev /dev --tmpfs /tmp --dir /home --dir /home/test \
  --ro-bind "$work" /work --ro-bind "/sys/fs/cgroup$group" /limits \
  --setenv PATH /work/tools:/usr/bin --setenv HOME /home/test \
  --setenv XDG_STATE_HOME /tmp/state --setenv TMPDIR /tmp --setenv LANG C.UTF-8 \
  --setenv GIT_CONFIG_NOSYSTEM 1 --setenv GIT_CONFIG_GLOBAL /dev/null \
  --setenv MYPi_CHECK_START "$start" --chdir /work \
  /usr/bin/bash scripts/test-profile.sh "$profile"
