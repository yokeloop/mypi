#!/usr/bin/env bash
# The Rust TUI (tui/): fetch its locked crates (network), check it offline in a
# bounded sandbox (part of pnpm verify), build tui/bin/mypi-tui.
set -euo pipefail
root="$(realpath "$(dirname "$0")/..")"
cmd="${1:-}"
[[ "$#" == 1 && ( "$cmd" == fetch || "$cmd" == check || "$cmd" == build ) ]] || { echo 'Usage: bash scripts/tui.sh fetch|check|build' >&2; exit 2; }
tui="$root/tui"; target="$tui/target"
want="$(sed -n 's/^channel = "\(.*\)"$/\1/p' "$tui/rust-toolchain.toml")"
hint="Rust $want required: mise install, then mise exec -- pnpm tui:$cmd"
command -v rustc >/dev/null || { echo "$hint" >&2; exit 2; }
sysroot="$(cd "$tui" && rustc --print sysroot)"
found="$("$sysroot/bin/rustc" --version)"
[[ "$found" == "rustc $want "* ]] || { echo "$hint (found $found)" >&2; exit 2; }
host="$("$sysroot/bin/rustc" -vV | sed -n 's/^host: //p')"
export PATH="$sysroot/bin:$PATH" RUSTC="$sysroot/bin/rustc"
export CARGO_HOME="$target/cargo-home" CARGO_TARGET_DIR="$target/build"
fetched() { [[ -d "$CARGO_HOME/registry" ]] || { echo 'Rust crates are not fetched: run mise exec -- pnpm tui:fetch (needs network) first' >&2; exit 2; }; }
case "$cmd" in
  fetch)
    mkdir -p "$target"
    exec cargo fetch --locked --manifest-path "$tui/Cargo.toml" --target "$host" ;;
  build)
    fetched
    node "$root/scripts/bounded.mjs" --time 55 --kill-after 5 -- cargo build --locked --offline --release --manifest-path "$tui/Cargo.toml"
    mkdir -p "$tui/bin"
    cp "$CARGO_TARGET_DIR/release/mypi-tui" "$tui/bin/.mypi-tui.tmp"
    mv -f "$tui/bin/.mypi-tui.tmp" "$tui/bin/mypi-tui" ;;
  check)
    fetched
    if [[ "$OSTYPE" == darwin* ]]; then
      [[ -x /usr/bin/sandbox-exec ]] || { echo "/usr/bin/sandbox-exec required (docs/TESTING.md §6)" >&2; exit 2; }
      mkdir -p "$CARGO_TARGET_DIR" "$target/tmp/home"
      cd "$tui"
      exec env -u MYPI_BOUNDED_PS TMPDIR=/private/tmp node "$root/scripts/bounded.mjs" --name mypi-tui-check --time 58 --kill-after 2 --memory 1G --tasks 64 \
        -- env -i PATH="$sysroot/bin:/usr/bin:/bin" HOME="$target/tmp/home" LANG=C.UTF-8 TMPDIR="$target/tmp" \
        CARGO_HOME="$CARGO_HOME" CARGO_TARGET_DIR="$CARGO_TARGET_DIR" CARGO_BUILD_JOBS=2 RUST_TEST_THREADS=2 \
        CARGO_INCREMENTAL=0 CARGO_TERM_COLOR=never RUSTC="$RUSTC" \
        /usr/bin/sandbox-exec -f "$root/scripts/sandbox.sb" -D HOME_DIR="$HOME" -D READ="$tui" -D TOOLS="$sysroot" \
        -D WRITE="$target" -D SCRATCH="$target/tmp" -D COST=/dev/null -D USER_TEMP="$(cd "$(getconf DARWIN_USER_TEMP_DIR)" && pwd -P)" \
        /bin/bash -c 'set -euo pipefail; cargo fmt --check; cargo clippy --locked --offline --all-targets -- -D warnings; cargo test --locked --offline; cargo build --locked --offline'
    fi
    for tool in systemd-run bwrap; do command -v "$tool" >/dev/null || { echo "$tool required (docs/TESTING.md §6)" >&2; exit 2; }; done
    mkdir -p "$CARGO_TARGET_DIR"
    # Build cost, not the measured test profile: its own fixed unit with the same
    # CPU/memory/task limits, no network, sources read-only, only tui/target writable.
    exec systemd-run --user --wait --pipe --collect --unit=mypi-tui-check --service-type=exec \
      -p CPUQuota=200% -p MemoryMax=1G -p MemorySwapMax=0 -p TasksMax=64 \
      -p RuntimeMaxSec=58s -p TimeoutStopSec=2s -p KillMode=control-group \
      -p OOMPolicy=kill -p NoNewPrivileges=yes \
      bwrap --unshare-all --die-with-parent --new-session --cap-drop ALL --clearenv \
      --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --ro-bind /lib64 /lib64 \
      --ro-bind-try /etc/alternatives /etc/alternatives \
      --proc /proc --dev /dev --tmpfs /tmp --dir /home --dir /home/test \
      --ro-bind "$sysroot" /rust --ro-bind "$tui" /work/tui --bind "$target" /work/tui/target \
      --setenv PATH /rust/bin:/usr/bin --setenv HOME /home/test --setenv LANG C.UTF-8 --setenv TMPDIR /tmp \
      --setenv CARGO_HOME /work/tui/target/cargo-home --setenv CARGO_TARGET_DIR /work/tui/target/build \
      --setenv CARGO_BUILD_JOBS 2 --setenv RUST_TEST_THREADS 2 --setenv CARGO_INCREMENTAL 0 \
      --setenv CARGO_TERM_COLOR never --chdir /work/tui \
      /usr/bin/bash -c 'set -euo pipefail; cargo fmt --check; cargo clippy --locked --offline --all-targets -- -D warnings; cargo test --locked --offline; cargo build --locked --offline' ;;
esac
