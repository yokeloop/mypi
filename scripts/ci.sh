#!/usr/bin/env bash
# Ordinary CI: build the checked-out revision with its own installed dependencies.
set -euo pipefail
root="$(realpath "$(dirname "$0")/..")"
[[ "$#" == 0 ]] || { echo 'Usage: bash scripts/ci.sh' >&2; exit 2; }
[[ -d "$root/node_modules" && -d "$root/src" && -d "$root/test" && -d "$root/integrations" ]]
[[ -z "$(find "$root/src" "$root/test" "$root/integrations" -type l -print -quit)" ]] || { echo 'Symlink in source' >&2; exit 1; }
work="$(mktemp -d "${RUNNER_TEMP:-/tmp}/mypi-ci.XXXXXXXX")"
trap 'rm -rf "$work"' EXIT
cp -a --reflink=auto "$root"/{src,test,integrations,scripts,node_modules,package.json,pnpm-lock.yaml,tsconfig.json,.dependency-cruiser.cjs} "$work/"
mkdir "$work/tools" "$work/dist"
cp --reflink=auto "$(command -v node)" "$work/tools/node"
# Compiler receives no credentials/home/network. Only generated output is writable;
# source, scripts and the installed dependency tree are mounted read-only.
systemd-run --user --wait --pipe --collect --unit=mypi-ci-build --service-type=exec \
  -p CPUQuota=200% -p MemoryMax=1G -p MemorySwapMax=0 -p TasksMax=64 \
  -p RuntimeMaxSec=55s -p TimeoutStopSec=5s -p KillMode=control-group \
  -p OOMPolicy=kill -p NoNewPrivileges=yes \
  bwrap --unshare-all --die-with-parent --new-session --cap-drop ALL --clearenv \
  --ro-bind /usr /usr --symlink usr/lib /lib --ro-bind /lib64 /lib64 \
  --proc /proc --dev /dev --tmpfs /tmp --dir /home --dir /home/test \
  --ro-bind "$work" /work --bind "$work/dist" /work/dist \
  --setenv PATH /work/tools:/usr/bin --setenv HOME /home/test --setenv LANG C.UTF-8 \
  --chdir /work /usr/bin/bash scripts/build.sh
# Existing verify remains the sole test profile, with its own fixed unit, limits and cleanup.
(cd "$work" && PATH="$work/tools:$PATH" bash scripts/check.sh verify)
