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
- Start a task branch before editing, commit only task-related changes with a
  descriptive message, push each completed commit immediately, and open a PR for
  review. Do not merge the PR or change/push `main` without explicit authorization
  from the engineer for that action. A one-off exception is not standing approval.
  Apply this workflow to every checkout/worktree touched by the task.
- Finish with no uncommitted task changes in any touched repository/worktree.
  Never include unrelated pre-existing changes in a commit or discard them to make
  a tree clean; stop and ask how to handle them. Check status before editing and
  after pushing. If a push is unavailable or fails, keep the commit, report the
  unpushed state and ask for direction rather than claiming completion or retrying
  blindly. In repositories without a push destination, arrange one with the user
  before making changes.
- Keep personal Pi instructions outside the shared project policy. Each checkout
  may use a local, Git-ignored `.pi/APPEND_SYSTEM.md` pointing to its user's private
  instruction file; Pi loads it only when the project is trusted. Configure each
  worktree separately. Do not commit the link or personal text to the engine repo,
  and do not automatically inject `MEMORY.md` into the system prompt.
- Releases, migrations, bootstrap, restore and other external writes still need
  applicable user authorization. Past one-off approval is not a standing grant for
  these operations or for changes outside the requested task.
- Preserve user data and historical artifacts. `home/` is a separate ignored context
  repository; the SQLite DB is outside both repositories. Neither is engine source.
  Do not relocate personal data or rewrite immutable source and append-only history.
- Partial operations or lost connections do not imply rollback. Inspect actual state
  before repeating a write; report verification and remaining limitations honestly.

## Developing the engine

- TypeScript strict, Node.js 24 LTS, ESM/tsc, pnpm, SQLite + better-sqlite3,
  SQL migrations without an ORM, node:test + node:assert/strict.
- Modular monolith, domain modules with Ports & Adapters and use cases.
  Read [M1-DESIGN](docs/M1-DESIGN.md) before structural/dependency changes.
- CLI and MCP share typed application commands. Keep adapters thin; fix every
  affected entry point. No domain logic in scripts or private cross-module imports.
- Read [TESTING](docs/TESTING.md) before changing tests or their execution. It is the
  single test-policy source. Use only disposable data under the approved isolation;
  if it is unavailable, stop rather than using an unsafe fallback.
- Build changed code: `mise exec -- pnpm build`.
  Verify completion: `mise exec -- pnpm verify`; `pnpm test` alone is insufficient.
- Do not restore removed prototype/import compatibility or implement speculative
  flows, agents, recovery infrastructure or runtime enforcement without a request.
- Do not modify global Pi settings as incidental repository upkeep. Explicitly
  requested installation/removal is a separate, narrowly scoped operation.

## References

- [Architecture](docs/ARCHITECTURE.md), [roadmap](PLAN.md): capabilities and direction.
- [CLI](docs/M1-CLI.md), [MCP](docs/MCP.md): optional tool/API reference.
- [Testing](docs/TESTING.md): isolation, budgets and verification.
- [Workflow withdrawal](docs/AGENT-WORKFLOW.md): previous policy is no longer active.

Historical cards, reports and branches are evidence of past work, not active agent
instructions. Connecting the MCP server does not assign work or authorize execution.
