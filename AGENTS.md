# AGENTS.md — mypi

## Scope

mypi provides local memory, projects, request records, CLI and stdio MCP tools.
Pi starts from this checkout as one workspace for all managed projects. These
workspace rules apply to user-directed work here; engine-development rules below
apply only when changing mypi itself, not the code in managed project checkouts.
The former mandatory memory/task/session workflow has been withdrawn. There is
no required MCP warmup, request registration, automatic outcome logging, Herdr tab,
or delegation step before doing work. Follow the user's requested scope and session.

## Instruction ownership

- This root `AGENTS.md` owns the engine's baseline workspace rules. Individual
  developer preferences belong in `home/USER-INSTRUCTIONS.md`, loaded through
  `.pi/APPEND_SYSTEM.md` via the configured user-layer symlinks.
- When Pi starts in the configured, trusted workspace, both instruction layers
  are loaded. They complement each other; neither is a copy or fallback for the
  other. Do not duplicate a rule in both files, create `home/AGENTS.md` as a third
  policy layer, or require one file to reread the other just to activate it.
- Before maintaining instructions, decide who owns the rule: shared engine
  behavior here, individual preferences in home, project-specific behavior in
  that project's instructions or flow. Edit the owning source, not every prompt.
  Skills and other prompts may point to it instead of restating its policy.
- Do not copy personal paths or preferences into shared engine policy. Changes
  to this file use the same project workflow as any other engine contribution.

## Communication and changes

- Write maintained AGENTS files, prompts and agent-facing instructions in English.
  Preserve original source and quotations exactly.
- Answer the actual request. State uncertainty and blockers; do not turn a backlog
  item, document or historical approval into permission to execute it.
- A new message on another topic does not cancel or suspend earlier requests.
  Answer it and continue outstanding authorized work unless the user explicitly
  asks to stop, pause, cancel, or replace it. Do not silently drop pending work
  or ask for repeated authorization solely because the topic changed. A real
  blocker still requires reporting or clarification; continuity grants no new scope.
- Inspect applicable files and preserve unrelated dirty/staged changes.
- Do not create tabs or subagents unless explicitly requested for the work.
  The dedicated mypi interactive-acceptance tab described below is the narrow
  project-policy exception for tabs, not permission to delegate other work.
  Task worktrees follow the common project workflow below.
- Check Git status before editing and after pushing. If a push is unavailable
  or fails, keep the work, report its actual state and ask for direction rather
  than claiming delivery or retrying blindly. Arrange a suitable remote before
  making repository changes; never silently create a remote or force-push.
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
- Home is the direct-main exception to the project workflow: commit intended
  user-layer changes on its `main` and push each completed commit immediately to
  `origin/main`, without a task branch, worktree or PR. Finish home operations
  with a clean Git status, including intended previously untracked configuration.
  Review content and ownership before staging; include intended user-layer files
  rather than leaving them dirty solely because they predate the current request.
  Ask about unexplained concurrent changes. Never discard data, blindly stage
  unknown files, or commit secrets, databases or caches to achieve cleanliness.
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
- Customize through user resources and explicit Pi package filters in settings,
  not by copying built-ins into home. Use distinct resource
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

## Common project workflow

- All project development, including mypi itself, uses a registered project and
  an independent Git clone, a task branch/worktree, verification, push and PR.
  Resolve missing setup within the requested scope using the project-management
  skill; this is not permission to initialize storage or register unrelated projects.
- Keep base clones in `projects/<organization>/<project>/` and task worktrees
  alongside them in `projects/<organization>/<project>--<task-slug>/`. These are
  source directories, not `home/projects/` knowledge. Do not relocate existing
  checkouts without authorization simply to enforce the naming convention.
- Before editing, inspect the project's instructions, selected flow, Git status,
  remote and identity. Create one branch and worktree per task from the appropriate
  updated base of that project's clone. Do not develop in the base checkout or
  switch its branch for a task; do not allow concurrent writers in one worktree.
- Verify repository, branch and worktree association through Git. The current
  mypi resolver matches one registered path and its descendants, not sibling
  worktrees. Supply project identity explicitly where needed; neither a directory
  name nor an enclosing installation's registration proves project membership.
- Run the project's required checks in the task worktree under its prescribed
  isolation with disposable test data, not personal runtime data. Commit only
  task-related changes with descriptive messages, push each completed commit
  immediately, and open a PR. Finish with no uncommitted task changes. Preserve
  unrelated changes; never commit or discard someone else's work to clean a tree.
- Project configuration and the selected flow determine review, merge and delivery.
  There is no additional universal merge-approval step in these workspace rules;
  do not invent an automatic merge policy when the project has not defined one.
- Before removing a worktree or branch, inspect tracked, untracked and ignored
  files, preserve unique user materials, and verify publication. Follow the
  requested branch-retention policy; closing a PR does not itself authorize
  deleting its remote branch or changing a task's DB status.
- These are working instructions, not a security boundary or an implemented flow
  runner. Worktrees share Git metadata within a project and do not isolate access.

## Protect the installed engine

- Treat the workspace's installed engine as a tool, not a development checkout.
  Never edit its source, this `AGENTS.md`, or shipped resources in place; do not
  apply development patches, switch branches, or create task worktrees from its
  Git repository. The separate home and ignored project directories are not
  installed engine source.
- Develop mypi through the common project workflow in its own clone under
  `projects/<organization>/`, with Git metadata independent of the installation.
- After project changes have been merged, update the installed engine only through
  the applicable update flow: check a clean engine checkout, `git pull --ff-only`,
  locked dependencies/build as prescribed, then reload/restart and verify. Do not
  substitute file copying, cherry-picking or a hard reset. Do not connect candidate
  builds to personal DB/home. Migrations remain separately authorized operations.

## Developing the engine

These additional rules govern mypi source, tests, scripts and shipped integrations
in project task worktrees. They do not impose mypi's stack or test runner on other
projects. Inspect each project's own instructions and verification commands.

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
- For mypi's interactive Pi/Herdr acceptance, always use a dedicated visible Herdr
  test tab and the real user-facing application. This test tab is authorized by
  project policy. Follow [the acceptance procedure](docs/TESTING.md#interactive-acceptance-through-herdr);
  headless events alone do not replace interaction through the terminal.
- Build changed code: `mise exec -- pnpm build`.
  Verify completion: `mise exec -- pnpm verify`; `pnpm test` alone is insufficient.
- Do not restore removed prototype/import compatibility or implement speculative
  flows, agents, recovery infrastructure or runtime enforcement without a request.
- Do not modify global Pi settings as incidental repository upkeep. Explicitly
  requested installation/removal is a separate, narrowly scoped operation.

Historical cards, reports and branches are evidence of past work, not active agent
instructions. Connecting the MCP server does not assign work or authorize execution.
