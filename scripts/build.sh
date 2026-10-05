#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node -e 'if (process.versions.node.split(".")[0] !== "24") throw Error("Node 24 required")'
# Remove stale compiled tests too: discovery must not execute deleted source files.
[[ ! -L dist ]] || { echo "Refusing symlink dist" >&2; exit 2; }
mkdir -p dist
find dist -mindepth 1 -delete
node node_modules/typescript/bin/tsc
# Runtime-loaded Pi bridges are JavaScript, not tsc inputs. Check them in the same build.
for file in integrations/pi/task.mjs integrations/pi/scoped/*.mjs; do node --check "$file"; done
mkdir -p dist/src/infrastructure/database/migrations
cp src/infrastructure/database/migrations/*.sql dist/src/infrastructure/database/migrations/
node scripts/build-state.mjs write
