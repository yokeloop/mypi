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
- Commits, pushes, releases, migrations, bootstrap, restore and external writes need
  applicable user authorization. Past one-off approval is not a standing grant.
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
