# AGENTS.md — mypi

## Scope

mypi provides local memory, projects, request records, CLI and stdio MCP tools.
This file governs development in this repository, not unrelated Pi sessions.
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
- Keep personal Pi instructions outside the shared project policy. The tracked
  `.pi/APPEND_SYSTEM.md` symlink points to `../home/USER-INSTRUCTIONS.md` in each
  checkout; only the link is committed, not its private target. Each user supplies
  their own ignored `home/` repository or local link in every worktree. Pi loads
  the target only when the project is trusted. Do not commit personal text to the
  engine repo or automatically inject `MEMORY.md` into the system prompt.
- Releases, migrations, bootstrap, restore and other external writes still need
  applicable user authorization. Past one-off approval is not a standing grant for
  these operations or for changes outside the requested task.
- Preserve user data and historical artifacts. `home/` is a separate ignored context
  repository; the SQLite DB is outside both repositories. Neither is engine source.
  Do not relocate personal data or rewrite immutable source and append-only history.
- Partial operations or lost connections do not imply rollback. Inspect actual state
  before repeating a write; report verification and remaining limitations honestly.

## Project setup and maintenance

- For explicitly requested creation, initialization, registration or maintenance of
  a project, use the [project-management skill](.agents/skills/project-management/SKILL.md).
  Clarify whether the user means a repository or a mypi registration; neither
  implies the other. Do not register projects, initialize storage, or start a
  project-tracking workflow automatically.

## Developing the engine

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
  Do not weaken admission or mandatory checks.
- Build changed code: `mise exec -- pnpm build`.
  Verify completion: `mise exec -- pnpm verify`; `pnpm test` alone is insufficient.
- Do not restore removed prototype/import compatibility or implement speculative
  flows, agents, recovery infrastructure or runtime enforcement without a request.
- Do not modify global Pi settings as incidental repository upkeep. Explicitly
  requested installation/removal is a separate, narrowly scoped operation.

Historical cards, reports and branches are evidence of past work, not active agent
instructions. Connecting the MCP server does not assign work or authorize execution.
