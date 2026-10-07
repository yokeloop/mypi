#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node -e 'if (process.versions.node.split(".")[0] !== "24") throw Error("Node 24 required")'
# Remove stale compiled tests too: discovery must not execute deleted source files.
[[ ! -L dist ]] || { echo "Refusing symlink dist" >&2; exit 2; }
mkdir -p dist
find dist -mindepth 1 -delete
# Bubblewrap hides cgroup discovery from V8. Bound its heap below the 1 GiB CI
# scope so declaration checking collects garbage before the kernel kills it.
node --max-old-space-size=768 node_modules/typescript/bin/tsc
mkdir -p dist/src/infrastructure/database/migrations
cp src/infrastructure/database/migrations/*.sql dist/src/infrastructure/database/migrations/
node scripts/build-state.mjs write
