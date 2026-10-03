#!/usr/bin/env bash
# bootstrap mypi home/ — clone from MYPY_HOME_REMOTE or create fresh
set -euo pipefail

echo "legacy bootstrap retired; use mise exec -- node dist/src/cli/main.js bootstrap (no automatic network sync)" >&2
exit 2

# Historical implementation below is intentionally unreachable.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="$ROOT/home"

if [ -d "$HOME_DIR" ]; then
  echo "home/ already exists at $HOME_DIR"
  if [ -n "${MYPY_HOME_REMOTE:-}" ] && [ -d "$HOME_DIR/.git" ]; then
    echo "syncing from remote..."
    git -C "$HOME_DIR" pull --ff-only 2>/dev/null || echo "warn: pull failed, local state kept"
  fi
  exit 0
fi

if [ -n "${MYPY_HOME_REMOTE:-}" ]; then
  echo "cloning home/ from $MYPY_HOME_REMOTE"
  git clone "$MYPY_HOME_REMOTE" "$HOME_DIR"
else
  echo "MYPY_HOME_REMOTE not set — creating fresh home/"
  mkdir -p "$HOME_DIR"/{journal,notes,knowledge}
  cat > "$HOME_DIR/inbox.md" <<'EOF'
# Inbox

## Drafts

EOF
  cat > "$HOME_DIR/projects.json" <<'EOF'
{}
EOF
  git -C "$HOME_DIR" init -q
  git -C "$HOME_DIR" add -A
  git -C "$HOME_DIR" commit -q -m "init home" --no-verify -q || true
  echo "created fresh home/ (local git only, no remote)"
fi