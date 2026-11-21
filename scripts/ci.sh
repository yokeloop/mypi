#!/usr/bin/env bash
# Ordinary CI: build the checked-out revision with its own installed dependencies.
set -euo pipefail
root="$(realpath "$(dirname "$0")/..")"
[[ "$#" == 0 ]] || { echo 'Usage: bash scripts/ci.sh' >&2; exit 2; }
[[ -d "$root/node_modules" && -d "$root/src" && -d "$root/test" && -d "$root/integrations" && -d "$root/web/node_modules" && -d "$root/tui/target/cargo-home/registry" ]]
[[ -z "$(find "$root/src" "$root/test" "$root/integrations" "$root/web/src" "$root/tui/src" -type l -print -quit)" ]] || { echo 'Symlink in source' >&2; exit 1; }
if [[ "$OSTYPE" == darwin* ]]; then
  work="$(mktemp -d /private/tmp/mypi-ci.XXXXXXXX)"
  copy=(cp -a -c); clone=(cp -c)
else
  work="$(mktemp -d "${RUNNER_TEMP:-/tmp}/mypi-ci.XXXXXXXX")"
  copy=(cp -a --reflink=auto); clone=(cp --reflink=auto)
fi
trap 'rm -rf "$work"' EXIT
"${copy[@]}" "$root"/{src,test,integrations,.pi,scripts,node_modules,package.json,pnpm-lock.yaml,tsconfig.json,.dependency-cruiser.cjs,.dependency-cruiser.web.cjs,.mcp.json,web,pnpm-workspace.yaml,AGENTS.md,README.md,PLAN.md,CHANGELOG.md,mise.toml,docs,.github,.yoke} "$work/"
# The Rust TUI: sources and the fetched crates, not the host build output.
mkdir -p "$work/tui/target"
"${copy[@]}" "$root"/tui/{Cargo.toml,Cargo.lock,rust-toolchain.toml,herdr-plugin.toml,src} "$work/tui/"
"${copy[@]}" "$root/tui/target/cargo-home" "$work/tui/target/"
mkdir "$work/.claude" && "${copy[@]}" "$root"/.claude/{settings.json,agents,skills} "$work/.claude/"
mkdir "$work/tools" "$work/dist"
"${clone[@]}" "$(command -v node)" "$work/tools/node"
if [[ "$OSTYPE" == darwin* ]]; then
  mkdir -p "$work/tmp/home"
  (cd "$work" && env TMPDIR=/private/tmp node scripts/bounded.mjs --name mypi-ci-build --time 58 --kill-after 2 --memory 1G --tasks 64 \
    -- env -i PATH="$work/tools:/usr/bin:/bin" HOME="$work/tmp/home" TMPDIR="$work/tmp" LANG=C.UTF-8 \
    /usr/bin/sandbox-exec -f "$work/scripts/sandbox.sb" -D HOME_DIR="$HOME" -D READ="$work" -D TOOLS="$work/tools" \
    -D WRITE="$work/dist" -D SCRATCH="$work/tmp" -D COST=/dev/null -D USER_TEMP="$(cd "$(getconf DARWIN_USER_TEMP_DIR)" && pwd -P)" /bin/bash scripts/build.sh)
else
# Compiler receives no credentials/home/network. Only generated output is writable;
# source, scripts and the installed dependency tree are mounted read-only.
systemd-run --user --wait --pipe --collect --unit=mypi-ci-build --service-type=exec \
  -p CPUQuota=200% -p MemoryMax=1G -p MemorySwapMax=0 -p TasksMax=64 \
  -p RuntimeMaxSec=58s -p TimeoutStopSec=2s -p KillMode=control-group \
  -p OOMPolicy=kill -p NoNewPrivileges=yes \
  bwrap --unshare-all --die-with-parent --new-session --cap-drop ALL --clearenv \
  --ro-bind /usr /usr --symlink usr/lib /lib --ro-bind /lib64 /lib64 \
  --proc /proc --dev /dev --tmpfs /tmp --dir /home --dir /home/test \
  --ro-bind "$work" /work --bind "$work/dist" /work/dist \
  --setenv PATH /work/tools:/usr/bin --setenv HOME /home/test --setenv LANG C.UTF-8 \
  --chdir /work /usr/bin/bash scripts/build.sh
fi
# Existing verify remains the sole test profile, with its own fixed unit, limits and cleanup.
(cd "$work" && PATH="$work/tools:$PATH" bash scripts/check.sh verify)
