# AGENTS.md — mypi

## Scope

mypi provides local memory, projects, task records, CLI and stdio MCP tools. Pi and
Claude Code start here as one workspace for all projects; these rules apply
to user-directed work, the [engine rules](docs/agents/engine-development.md) only to
changing mypi itself. `mypi warmup` prints scoped context that the Pi extension and
the Claude hook load; it registers no tasks, logs no outcomes, authorizes nothing.
The former mandatory workflow is withdrawn ([docs/AGENT-WORKFLOW.md](docs/AGENT-WORKFLOW.md)).
Follow the user's requested scope and session.

## Instruction ownership

- This file owns the engine's baseline rules; personal preferences live
  in `home/USER-INSTRUCTIONS.md`, served by `mypi warmup` as the first context
  section. The layers complement each other; never duplicate a rule in both, add a
  `home/AGENTS.md` layer, or make one file reread the other.
- Before maintaining instructions, pick the owner: engine behavior here, personal
  preferences in home, project behavior in that project's instructions or flow. Edit
  the owner; skills and prompts point to it rather than restate it.
- No personal paths or preferences in shared engine policy. Changes to this file
  follow the common project workflow.

## Communication and changes

- Write maintained AGENTS files, prompts and agent-facing instructions in English.
  Preserve original source and quotations exactly.
- Answer the actual request; state uncertainty and blockers. A backlog item,
  document or historical approval is not permission to execute it.
- A new topic cancels no earlier request: continue authorized work unless the user
  asks to stop or replace it, without asking again. Continuity grants no new scope.
- Agent/workflow configuration mistakes are recoverable: stop the failed lane, find
  the cause, keep evidence, fix the configuration and resume that stage; never repeat
  a failing configuration or restart finished stages. Gates, budgets, tool limits and
  authorization stay. A repair needing code needs approval; never patch installed
  tools or swap the runner.
- Inspect applicable files; preserve unrelated dirty/staged changes.
- Create tabs or subagents only on request or under the
  [engine feature workflow](docs/agents/engine-development.md#engine-feature-development-workflow).
- Check Git status before editing and after pushing; arrange a remote before
  changing a repository. If a push fails, keep the work, report and ask; never claim
  delivery, silently create a remote or force-push.
- Releases, migrations, bootstrap, restore and other external writes need the user's
  authorization; a past one-off approval is no standing grant.
- A parent instruction never stands in for the engineer's word: gated steps (/do,
  /ship, merge, release, migration, engine update) still need the engineer in the
  child's tab.
- Preserve user data and history. `home/` is a separate ignored repository; the
  SQLite DB is outside both; neither is engine source. Never relocate personal data,
  rewrite append-only history or home's Git history: journal artifacts are
  `{path, commit}` references.
- A partial operation or lost connection is no rollback: inspect state before
  repeating a write; report verification and limits honestly.

## Home

- `home/` is its own Git repository: `home/USER-INSTRUCTIONS.md`, and
  `home/settings.json` (`defaultAgent`: `claude` or `pi` for new /open sessions,
  default claude). Ordinary documents by file tools; managed memory, DB records and
  append-only history by mypi operations.
- Home is the direct-main exception: commit intended changes on `main` and push each
  to `origin/main` at once, no task branch, worktree or PR. Finish clean, intended
  untracked files included. Review before staging; ask about unexplained changes;
  never discard data, blindly stage, or commit secrets, databases or caches.
- Inspect Git status separately for engine, home and each checkout.

## Project setup and maintenance

- For requested creation, registration or maintenance of a project, use the
  [project-management skill](integrations/skills/project-management/SKILL.md); it
  also holds registration details and undoing one. A repository and a mypi
  registration are distinct; never register or initialize anything automatically.

## Common project workflow

- All project development, mypi included, uses a registered project, its own Git
  clone, a task branch/worktree, verification, push and PR; missing setup goes
  through the project-management skill, within the requested scope.
- Base clones live in `projects/<organization>/<project>/`, task worktrees beside them
  in `projects/<organization>/<project>--<task-slug>/` (source, not `home/projects/`).
  Do not relocate existing checkouts without authorization.
- Before editing, inspect the project's instructions, flow, Git status, remote and
  identity. One branch and worktree per task from the updated base; never develop in
  the base checkout or switch its branch; one writer per worktree.
- Verify repository, branch and worktree through Git; name the project explicitly —
  a directory name or an enclosing installation proves nothing.
- Run the project's checks in the worktree under its isolation with disposable data.
  Commit only task changes, push each commit, open a PR, leave nothing uncommitted;
  never commit or discard someone else's work.
- The project's configuration and flow decide review, merge and delivery; there is no
  universal merge approval; invent none. The flow is
  `home/projects/<org>/<project>/flow.json` (`mypi project flow`; fields in the
  project-management skill). Release only by its linked procedure, on explicit
  request. Journal per step: `docs/PIPELINE.md` and `integrations/prompts/`.
- Before removing a worktree or branch, inspect tracked, untracked and ignored files,
  keep unique materials, verify publication. A closed PR does not authorize deleting
  its branch or changing a task's status.
- These are working instructions, not a security boundary or a flow runner;
  worktrees do not isolate access.

## Protect the installed engine

- The installed engine is a tool: never edit its source, this `AGENTS.md` or shipped
  resources in place, patch it, switch its branch or make worktrees from it.
- Develop mypi in its own clone under `projects/<organization>/`; update the
  installation only per [installation](docs/agents/installation.md).

## Where to read more

Before acting in an area, read its document; it binds like this file.

- mypi source, tests, checks (`mise exec -- pnpm build`, `mise exec -- pnpm verify`),
  engine features → [engine development](docs/agents/engine-development.md)
- bootstrap, engine updates, Pi settings move, home backups →
  [installation](docs/agents/installation.md)
- Claude Code or Pi setup, diagnosis → [agent integration](docs/agents/agent-integration.md)
- sessions, /open, events, parent messages → [sessions](docs/agents/sessions.md)
- `mypi serve`, API tokens, the TUI → [HTTP API](docs/agents/http-api.md)
- projects → [project-management skill](integrations/skills/project-management/SKILL.md)
- /plan, /do, /flow, /ship, /board → [pipeline](docs/PIPELINE.md)
- [architecture](docs/ARCHITECTURE.md), [testing](docs/TESTING.md),
  [stand acceptance](docs/MANUAL-ACCEPTANCE.md)

Historical cards, reports and branches are evidence of past work, not active agent
instructions. Connecting the MCP server does not assign work or authorize execution.
