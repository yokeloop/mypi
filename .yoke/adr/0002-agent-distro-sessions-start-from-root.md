# ADR 0002: mypi is an agent distro; every Session starts from the engine root

Date: 2026-10-24
Status: accepted (supersedes the v1 user-layer wiring and the earlier "always
through a launcher" intent of this design round)

## Context

mypi v1 wired agents through a personal layer: `.pi` was an ignored symlink to
`home/pi`, the Pi package path lived in the user's settings, personal instructions
reached Pi through `APPEND_SYSTEM.md`, and nothing existed for Claude Code. Task
sessions were launched into worktrees with a fragile environment dance.

Reference projects (firstmate, yokemate) show a simpler model: the checkout itself
configures any supported agent through small tracked per-agent files
(`.claude/settings.json`, `.pi/extensions/*.ts`, `.mcp.json`), rules live in one
`AGENTS.md`, and the primary session is started by hand from the root.

Phase 0 of this round established: Claude Code reads `AGENTS.md` natively when no
`CLAUDE.md` exists; project hooks, `.mcp.json` and skills load only when the
session starts inside the engine checkout; Pi loads `.pi/extensions` after a
one-time project trust prompt.

## Decision

1. The engine repository is an agent distro. It tracks `AGENTS.md` (shared rules),
   `.claude/settings.json` (hooks calling `mypi`), `.mcp.json`, `.pi/extensions/mypi.ts`
   and shared skills. No `CLAUDE.md` is created.
2. Every Session, whatever its Scope and Agent, starts with the engine root as its
   working directory. The Main chat is simply `claude` or `pi` started in the root.
   `/open` starts child Sessions in Herdr tabs with the same cwd, passing only the
   Session key/scope (`MYPI_SCOPE`) and the Agent's session identifier.
3. A Task chat learns its worktree path from its warmup and performs Git operations
   there explicitly. The launcher creates the worktree when it is missing.
4. The personal layer is `home/USER-INSTRUCTIONS.md`, injected by each adapter
   (Claude: SessionStart hook; Pi: extension) into the system context. `.pi` is no
   longer a symlink and `home/pi` is no longer part of agent configuration.

## Alternatives rejected

- Always launching through `mypi open` with explicit `--settings/--mcp-config/-e`:
  one code path, but the operator must never start an agent by hand and nothing
  works without the launcher.
- Children starting inside their worktree: Git is naturally scoped, but engine
  hooks/MCP/skills do not load there, forcing a second configuration path.
- A root `CLAUDE.md` importing `AGENTS.md`: hides nested `AGENTS.md` and adds a
  second rules file.

## Consequences

- Bootstrap shrinks to creating `home/` and the database; no settings edits.
- A `git` command in a Task tab without `cd` hits the engine repository; the
  warmup states the worktree path and the rule. This is a soft boundary like all
  Scope boundaries.
- Claude asks once per clone to approve the project MCP server; Pi asks once for
  project trust.
