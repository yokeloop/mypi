#!/usr/bin/env bash
# Invoked from the trusted base checkout, NEVER from the candidate checkout.
set -euo pipefail
base="$(realpath "$(dirname "$0")/..")"
candidate="$(realpath "${1:?candidate checkout required}")"
[[ "$base" != "$candidate" ]] || { echo 'Separate trusted base required' >&2; exit 2; }
# Changes to the gate/dependencies need explicit promotion of a reviewed base, not a PR override.
protected=(package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json .dependency-cruiser.cjs mise.toml docs/TESTING.md)
for file in "${protected[@]}"; do
  [[ -f "$candidate/$file" && ! -L "$candidate/$file" ]] && cmp "$base/$file" "$candidate/$file" || { echo "Trusted policy differs: $file" >&2; exit 1; }
done
diff -qr "$base/scripts" "$candidate/scripts"
diff -qr "$base/.github" "$candidate/.github"
[[ -d "$base/node_modules" && -d "$candidate/src" && -d "$candidate/test" && -d "$candidate/integrations" ]]
[[ -z "$(find "$candidate/src" "$candidate/test" "$candidate/integrations" -type l -print -quit)" ]] || { echo 'Symlink in candidate source' >&2; exit 1; }
work="$(mktemp -d "${RUNNER_TEMP:-/tmp}/mypi-ci.XXXXXXXX")"
trap 'rm -rf "$work"' EXIT
cp -a --reflink=auto "$candidate"/{src,test,integrations} "$work/"
cp -a --reflink=auto "$base"/{scripts,node_modules,package.json,pnpm-lock.yaml,tsconfig.json,.dependency-cruiser.cjs} "$work/"
mkdir "$work/tools" "$work/dist"
cp --reflink=auto "$(command -v node)" "$work/tools/node"
# Compiler receives no credentials/home/network. Only generated output is writable;
# source, policy and the approved dependency tree are mounted read-only.
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
