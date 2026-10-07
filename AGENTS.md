# AGENTS.md — mypi

## Scope

mypi provides local memory, projects, request records, CLI and stdio MCP tools.
Pi starts from this checkout as one workspace for all managed projects. These
workspace rules apply to user-directed work here; engine-development rules below
apply only when changing mypi itself, not the code in managed project checkouts.
The former mandatory memory/task/session workflow has been withdrawn. There is
no required MCP warmup, request registration, automatic outcome logging, Herdr tab,
or delegation step before doing work. Follow the user's requested scope and session.

## Communication and changes

- Write maintained AGENTS files, prompts and agent-facing instructions in English.
  Respond in the user's language; preserve original source and quotations exactly.
- Answer the actual request. State uncertainty and blockers; do not turn a backlog
  item, document or historical approval into permission to execute it.
- Inspect applicable files and preserve unrelated dirty/staged changes.
- Do not create tabs, worktrees or subagents unless explicitly requested for the work.
- For the engine repository, start a task branch before editing, commit only
  task-related changes with a descriptive message, push each completed commit
  immediately, and open a PR for review. Do not merge the PR or change/push `main`
  without explicit authorization from the engineer for that action. Apply this
  workflow to every engine checkout/worktree touched by the task; one-off approval
  is not standing permission for another direct-main change.
- The separate `home/` context repository is a standing exception: work on its
  `main` directly, commit task-related changes with a descriptive message, and
  push immediately to `origin/main`, without a task branch or PR. This exception
  does not authorize direct-main changes in the engine repository.
- Finish with no uncommitted task changes in any touched repository/worktree.
  Never include unrelated pre-existing changes in a commit or discard them to make
  a tree clean; stop and ask how to handle them. Check status before editing and
  after pushing. If a push is unavailable or fails, keep the commit, report the
  unpushed state and ask for direction rather than claiming completion or retrying
  blindly. In repositories without a push destination, arrange one with the user
  before making changes.
- Keep personal instructions and resources in the ignored user layer, never in
  shared engine policy.
- Releases, migrations, bootstrap, restore and other external writes still need
  applicable user authorization. Past one-off approval is not a standing grant for
  these operations or for changes outside the requested task.
- Preserve user data and historical artifacts. `home/` is a separate ignored context
  repository; the SQLite DB is outside both repositories. Neither is engine source.
  Do not relocate personal data or rewrite immutable source and append-only history.
- Partial operations or lost connections do not imply rollback. Inspect actual state
  before repeating a write; report verification and remaining limitations honestly.

## User layer: ownership and operation

- Engine resources live in `integrations/pi/`, a local Pi package maintained and
  updated with mypi. User resources live in `home/pi/`; `.pi` is an ignored local
  symlink to `home/pi`. Never start tracking `.pi`, `home/` or `projects/` in the
  engine repository, including in future updates.
- `home/` is its own Git repository. Personal instructions belong in
  `home/USER-INSTRUCTIONS.md`; `home/pi/APPEND_SYSTEM.md` links to that file.
  User settings, MCP configuration, skills, extensions, prompts and themes belong
  under `home/pi/`. Use normal file tools for these and other ordinary documents;
  use mypi operations for managed memory, DB records and append-only history.
- `mise exec -- pnpm bootstrap` builds and opens an Ink confirmation dialog. It
  creates missing user-layer resources and a separate home Git on main, connects
  the built-in package, installs the links, and initializes SQLite if its file is
  absent. The preview shows the database path; confirmation authorizes creation.
  Existing databases are left unchanged, not reset or migrated. Bootstrap does not
  commit, push, create remotes or change global Pi settings. Run it only when asked.
- Bootstrap previews changes, preserves existing personal text and MCP configuration,
  and adds only a missing package entry to settings, saving the original beside it
  as `settings.json.before-bootstrap`. Existing package filters remain unchanged.
  A repeated configured run is a no-op. Conflicts or stale previews require explicit
  reconciliation; do not delete user configuration to make bootstrap pass.
- An old `.pi` containing only the former instruction symlink, or an empty `.pi`,
  can be converted by the wizard. Other existing `.pi` directories must be reviewed
  and reconciled by the user first; do not silently move arbitrary relative links.
- `integrations/` is not a special Pi directory. Bootstrap adds the absolute
  `integrations/pi` path to `packages` in `.pi/settings.json` (stored in home).
  Pi reads the package's `package.json` manifest, which declares extensions and
  skills. After project trust, their discovery is automatic: skill descriptions
  are visible to the agent, full instructions are loaded when needed, and the
  extension connects MCP tools. Without the package entry it is not auto-loaded.
  Start with `mise exec -- pi` so child MCP processes find Node 24. The package's
  extension registers `mypi`; a same-name entry in `home/pi/mcp.json` overrides it,
  including `enabled: false`. Shell `pi mcp list` does not load extension servers.
- Update built-ins in the engine, not by copying them into home. Customize through
  user resources and explicit Pi package filters in settings. Use distinct resource
  names; do not rely on duplicate-name discovery order. After updating/rebuilding,
  reload or restart Pi. Inspect diagnostics before claiming an integration works.
- User settings contain the absolute local package path. If a checkout moves, review
  that entry before rerunning bootstrap; it does not remove unrelated/stale entries.
  Secrets belong in environment variables or credential storage, not committed JSON.
- Inspect Git status separately for engine, home and each checkout. Existing home
  commits and Git configuration are preserved by setup; configure synchronization
  explicitly. Context backup requires a clean committed home and supports only the
  exact `pi/APPEND_SYSTEM.md -> ../USER-INSTRUCTIONS.md` configuration symlink;
  arbitrary symlinks remain forbidden. Managed context writes never follow links.

## Project setup and maintenance

- For explicitly requested creation, initialization, registration or maintenance of
  a project, use the [project-management skill](integrations/pi/skills/project-management/SKILL.md).
  Clarify whether the user means a repository or a mypi registration; neither
  implies the other. Do not register projects, initialize storage, or start a
  project-tracking workflow automatically.

## Developing the engine

These rules govern mypi source, tests, scripts and shipped integrations only. For
work in `projects/<checkout>`, inspect that repository's own instructions, Git state
and verification commands. This layout does not authorize parallel writers in one
checkout or implement a task/subagent runner.

- TypeScript strict, Node.js 24 LTS, ESM/tsc, pnpm, SQLite + better-sqlite3,
  SQL migrations without an ORM, node:test + node:assert/strict.
- Modular monolith, domain modules with Ports & Adapters and use cases.
  Before structural/dependency changes, inspect current module boundaries and
  contracts; preserve the separation of domain, application and adapters.
- CLI and MCP share typed application commands. Keep adapters thin; fix every
  affected entry point. No domain logic in scripts or private cross-module imports.
- Before changing tests or their execution, inspect existing tests and their
  runner. Protect observable behavior at the cheapest reliable level; do not add
  redundant tests, new runners or higher resource limits just to get green. Use
  only disposable data under the approved isolation (2 CPU, 1 GiB, 64 tasks,
  60-second external deadline, one suite run at a time; no network or personal
  home); if unavailable, stop rather than using an unsafe fallback. Fast tests
  must not spawn subprocesses; boundary tests may use isolated CLI/Git processes.
  Do not weaken admission or mandatory checks. CI tests the proposed revision
  with its own locked dependencies and scripts; changes to package.json, lockfiles
  or build scripts do not require promoting a separate trusted base.
- Build changed code: `mise exec -- pnpm build`.
  Verify completion: `mise exec -- pnpm verify`; `pnpm test` alone is insufficient.
- Do not restore removed prototype/import compatibility or implement speculative
  flows, agents, recovery infrastructure or runtime enforcement without a request.
- Do not modify global Pi settings as incidental repository upkeep. Explicitly
  requested installation/removal is a separate, narrowly scoped operation.

Historical cards, reports and branches are evidence of past work, not active agent
instructions. Connecting the MCP server does not assign work or authorize execution.
