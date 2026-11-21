#!/usr/bin/env bash
# Called by systemd in the bounded unit on Linux and by the supervisor scripts/bounded.mjs
# on macOS, never a substitute unbounded runner.
set -euo pipefail
root="$1"; node="$2"; profile="$3"
os="$(uname)"
start="$("$node" -p 'Date.now()')"
if [[ "$os" == Darwin ]]; then
  work="$(mktemp -d "${MYPI_BOUNDED_DIR:?bounded run directory required}/workspace.XXXXXXXX")"
  copy=(cp -a -c); clone=(cp -c)
else
  work="$(mktemp -d "${RUNTIME_DIRECTORY:?systemd runtime directory required}/workspace.XXXXXXXX")"
  copy=(cp -a --reflink=auto); clone=(cp --reflink=auto)
fi
trap 'rm -rf "$work"' EXIT
mkdir "$work/tools"
"${clone[@]}" "$node" "$work/tools/node"
"${copy[@]}" "$root"/{src,test,dist,scripts,integrations,.pi,node_modules,package.json,pnpm-lock.yaml,tsconfig.json,.dependency-cruiser.cjs,.dependency-cruiser.web.cjs,.mcp.json,web,pnpm-workspace.yaml,AGENTS.md,README.md,PLAN.md,CHANGELOG.md,mise.toml,docs,.github,.yoke} "$work/"
mkdir "$work/.claude" && "${copy[@]}" "$root"/.claude/{settings.json,agents,skills} "$work/.claude/"
mkdir "$work/tui" && "${copy[@]}" "$root"/tui/{Cargo.toml,Cargo.lock,rust-toolchain.toml,herdr-plugin.toml,src} "$work/tui/"
if [[ "$os" == Darwin ]]; then
  [[ "$PPID" == "${MYPI_BOUNDED_PID:-}" ]] || { echo "Missing bounded supervisor" >&2; exit 1; }
  mkdir -p "$work/tmp/home"
  (cd "$work" && env -i PATH="$work/tools:/usr/bin:/bin" HOME="$work/tmp/home" XDG_STATE_HOME="$work/tmp/state" TMPDIR="$work/tmp" \
    LANG=C.UTF-8 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null MYPi_CHECK_START="$start" MYPI_COST_FILE="$MYPI_BOUNDED_DIR/cost" \
    /usr/bin/sandbox-exec -f "$work/scripts/sandbox.sb" -D HOME_DIR="$HOME" -D READ="$work" -D TOOLS="$work/tools" \
    -D WRITE="$work/tmp" -D SCRATCH="$work/tmp" -D COST="$MYPI_BOUNDED_DIR/cost" \
    /bin/bash scripts/test-profile.sh "$profile")
  exit
fi
group="$(awk -F: '$1 == "0" { print $3 }' /proc/self/cgroup)"
[[ "$group" == */mypi-tests.service ]] || { echo "Missing bounded systemd unit" >&2; exit 1; }
bwrap --unshare-all --die-with-parent --new-session --cap-drop ALL --clearenv \
  --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --ro-bind /lib64 /lib64 \
  --proc /proc --dev /dev --tmpfs /tmp --dir /home --dir /home/test \
  --ro-bind "$work" /work --ro-bind "/sys/fs/cgroup$group" /limits \
  --setenv PATH /work/tools:/usr/bin --setenv HOME /home/test \
  --setenv XDG_STATE_HOME /tmp/state --setenv TMPDIR /tmp --setenv LANG C.UTF-8 \
  --setenv GIT_CONFIG_NOSYSTEM 1 --setenv GIT_CONFIG_GLOBAL /dev/null \
  --setenv MYPi_CHECK_START "$start" --chdir /work \
  /usr/bin/bash scripts/test-profile.sh "$profile"
