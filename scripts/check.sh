#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
profile="${1:-verify}"
[[ "$#" -le 1 && ( "$profile" == fast || "$profile" == verify ) ]] || { echo "Use fast or verify" >&2; exit 2; }
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 24 ]] || { echo "Node 24 required (mise exec -- pnpm verify)" >&2; exit 2; }
if [[ "$OSTYPE" == darwin* ]]; then
  [[ -x /usr/bin/sandbox-exec ]] || { echo "/usr/bin/sandbox-exec required (docs/TESTING.md §6)" >&2; exit 2; }
  [[ "$profile" != verify ]] || bash scripts/tui.sh check
  # On macOS the lock /private/tmp/mypi-tests.lock keeps one run per machine; the 73 s limit
  # is the 70 s macOS profile budget plus 3 s (docs/TESTING.md §6).
  exec env TMPDIR=/private/tmp node scripts/bounded.mjs --name mypi-tests --time 73 --kill-after 2 --memory 1G --tasks 64 \
    -- /bin/bash "$PWD/scripts/test-sandbox.sh" "$PWD" "$(command -v node)" "$profile"
fi
[[ "$OSTYPE" == linux* ]] || { echo "Checks run on Linux or macOS" >&2; exit 2; }
for tool in systemd-run bwrap; do command -v "$tool" >/dev/null || { echo "$tool required (docs/TESTING.md §6)" >&2; exit 2; }; done
# The Rust TUI first, in its own bounded offline unit, outside the measured test profile (docs/TESTING.md §6).
[[ "$profile" != verify ]] || bash scripts/tui.sh check
# A fixed unit rejects overlapping runs. No fallback to unbounded node --test.
exec systemd-run --user --wait --pipe --collect --unit=mypi-tests --service-type=exec \
  -p CPUQuota=200% -p MemoryMax=1G -p MemorySwapMax=0 -p TasksMax=64 \
  -p MemoryAccounting=yes -p TasksAccounting=yes \
  -p RuntimeMaxSec=58s -p TimeoutStopSec=2s -p KillMode=control-group \
  -p OOMPolicy=kill -p NoNewPrivileges=yes \
  -p RuntimeDirectory=mypi-tests -p RuntimeDirectoryMode=0700 \
  /usr/bin/bash "$PWD/scripts/test-sandbox.sh" "$PWD" "$(command -v node)" "$profile"
