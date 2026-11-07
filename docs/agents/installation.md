# Installing and updating mypi

Read when: running bootstrap, updating the installed engine, moving personal Pi settings, or backing up or restoring home.

## Bootstrap

- `mise exec -- pnpm bootstrap` builds and opens an Ink confirmation dialog. It
  creates a missing `home/` with a separate Git on main, `home/USER-INSTRUCTIONS.md`
  and `home/settings.json`, and initializes SQLite if its file is absent. The
  preview shows the database path; confirmation authorizes creation. Existing
  files and databases are left unchanged, not reset or migrated. Bootstrap does
  not touch agent settings (`.pi/`, `~/.pi/agent/` or Claude settings), commit,
  push or create remotes. A repeated run is a no-op. Conflicts or stale previews
  require explicit reconciliation; do not delete user files to make bootstrap
  pass. Run it only when asked.

## Home Git and backups

- Existing home commits and Git configuration are preserved by setup; configure synchronization
  explicitly. Context backup requires a clean committed home; symlinks in home are
  rejected, except the one instruction link that homes created by earlier versions
  may contain. Managed context writes never follow links.

## Updating the installed engine

- After project changes have been merged, update the installed engine only through
  the applicable update flow: check a clean engine checkout, `git pull --ff-only`,
  locked dependencies/build as prescribed, then reload/restart and verify. Do not
  substitute file copying, cherry-picking or a hard reset. Do not connect candidate
  builds to personal DB/home. Migrations remain separately authorized operations.
- The first update to a version with the tracked `.pi/` directory replaces the
  local `.pi` of earlier versions, and Pi stops loading `home/pi/`. Before that
  update, move personal Pi settings (settings, MCP servers, installed packages and
  resources) from `home/pi/` to `~/.pi/agent/`, and remove the old built-in package
  entry from `~/.pi/agent/settings.json` if present. Moving them is a separate,
  operator-authorized step of the update, not part of an engine PR.
