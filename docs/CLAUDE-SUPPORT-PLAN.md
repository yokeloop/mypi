# MP30: Claude Code support alongside Pi

Status: plan with phase 0 results. Implementation starts after operator approval
of the revised design below.

## Goal and boundaries

An operator starts either `mise exec -- pi` or `mise exec -- claude` from the same
engine checkout. Both agents receive the shared engine rules, the operator's personal
instruction layer, the mypi MCP tools, shared skills and scoped memory autoload.

- No database migration; `home/`, SQLite and backup formats stay unchanged.
- No global Pi or Claude settings are changed. A Claude Code plugin is rejected
  because it requires installation into user settings.
- Work chats remain Pi-only and are not changed by this task. From Claude they stay
  reachable through the `work_chat_open_request` MCP tool, which opens a Pi tab.
- Operator decisions: autoload through a Claude `SessionStart` hook; no Claude-only
  personal resources in `home/` (they would add symlinks that backup refuses);
  move shared skills to an agent-neutral `integrations/skills/`.

## Current Pi coupling

| Mechanism | Pi today | Source |
|---|---|---|
| Engine rules | Pi reads `AGENTS.md` | `AGENTS.md` wording is Pi-centred |
| Personal layer | `.pi/APPEND_SYSTEM.md -> home/USER-INSTRUCTIONS.md` | `src/app/setup-user-layer.ts` |
| MCP | `registerMcpServer` (codemode) | `src/app/startup-registration.ts` |
| Skills | `integrations/pi/package.json` -> `skills/` | Pi package |
| Autoload | `before_agent_start`: scope from flag/binding/cwd, `warmup`, prompt sections | `src/app/startup-registration.ts` |
| `/work-chat` | `registerCommand` | Pi only |
| Bootstrap | `.pi` link and package entry | `src/app/setup-user-layer.ts` |
| Home backup | Only `pi/APPEND_SYSTEM.md` may be a symlink | `src/app/backup.ts`, `src/infrastructure/git/context-git.ts` |

## Phase 0 results

Verified on 2026-10-24 with Claude Code 2.1.283 (headless runs against a synthetic
fixture with disposable state) and by reading Pi 1.0.4 package-manager source.

1. **A root `CLAUDE.md` breaks nested `AGENTS.md`.** Claude's built-in `agents-md`
   plugin is exclusive: when `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md`
   exists in the cwd ancestry it reads only those. With a root `CLAUDE.md` importing
   `@AGENTS.md`, the root rules loaded, but a managed project's
   `projects/<org>/<project>/AGENTS.md` was **not** loaded after reading its files.
   Without any `CLAUDE.md`, both the root and nested `AGENTS.md` loaded natively.
   The option to read both is honoured only from user, `--settings` or managed
   settings, never project settings. **Decision: the engine must not contain a
   root `CLAUDE.md` or `CLAUDE.local.md`.** A managed project's own `CLAUDE.md`
   is still loaded for that directory and takes precedence over its `AGENTS.md`.
2. Moot after (1): `@path` imports are not used.
3. **Symlinked skill directories work.** `.claude/skills/<name> -> ../../<shared>`
   was discovered and its description listed.
4. **Pi accepts manifest paths outside the package.** `collectFilesFromManifestEntries`
   resolves entries with `resolve(packageRoot, entry)` and no containment check
   (the containment guard applies only to managed install roots). The extension
   already imports `../../../dist`. To be confirmed in live acceptance.
5. **`SessionStart` hook works.** Plain stdout is injected as context
   (`SessionStart:startup hook success: ...`) and `$CLAUDE_PROJECT_DIR` is set.
   Re-injection on `resume`/`clear`/`compact` is to be confirmed in live acceptance.
6. **`${CLAUDE_PROJECT_DIR}` is not expanded in `.mcp.json`** (reported as a missing
   environment variable). A relative argument resolves against the launch cwd and
   works when Claude starts from the engine root; `mise.toml` then supplies Node 24.
7. **Claude must start from the engine root.** Started from a subdirectory, the
   project `.claude/settings.json` (hooks) and `.mcp.json` were not loaded, and a
   nested project's `CLAUDE.md` suppressed the root `AGENTS.md`. This matches the
   existing rule that the agent starts from this checkout.

## Revised target layout

```
AGENTS.md                      shared rules, agent-neutral; read natively by Pi and Claude
.mcp.json                      mypi -> node dist/src/mcp/main.js (relative, engine root)
.claude/settings.json          SessionStart hooks: personal layer + mypi agent-context
.claude/skills/<name>          symlinks to ../../integrations/skills/<name>
integrations/skills/           shared skills (moved from integrations/pi/skills)
integrations/pi/               Pi package: extension; package.json skills -> ../skills
```

`.gitignore` adds `/CLAUDE.md`, `/CLAUDE.local.md` and `/.claude/settings.local.json`
so a personal file cannot silently disable nested `AGENTS.md` or be committed.

The personal layer reaches Claude through a `SessionStart` hook that prints
`home/USER-INSTRUCTIONS.md` when present. Pi keeps `APPEND_SYSTEM.md`. One source
file, two loaders; no new symlink in `home/`.

## Phases

### Phase 1. Agent-neutral startup context

- Application use case: inputs cwd, explicit scope, installation root; outputs the
  resolved scope and memory/context sections. Move the unregistered/ambiguous cwd
  handling, `warmup` call and `startupSections` formatting out of the Pi adapter.
- CLI `mypi agent-context [--scope X] [--cwd P] [--format text|json]`.
- The Pi extension calls the use case. Session binding, invalidation after memory
  tools and the `--mypi-scope` / `--mypi-no-autoload` flags are unchanged.
- Tests: use case in fast tests, CLI in boundary tests; the existing
  `test/fast/startup-extension.test.ts` must pass unchanged as the Pi regression.

### Phase 2. Claude adapter files

- `.mcp.json`, `.claude/settings.json`, skill symlinks, `.gitignore` entries.
- Scope for Claude: `MYPI_SCOPE` environment variable, otherwise cwd resolution.
- Documented limits: context is loaded at session start (and on compact if phase 5
  confirms it), not refreshed after each memory write; Claude exposes MCP tools
  directly (deferred loading) instead of Pi codemode.
- Fast consistency tests (file reads only): `.mcp.json` parses and targets the MCP
  entry; no root `CLAUDE.md`; every skill link resolves to a `SKILL.md`; hook
  commands target the built CLI.

### Phase 3. Skills and bootstrap

- Move `project-management` to `integrations/skills/`, point the Pi manifest at
  `../skills`, and reword the skill so it does not assume Pi tool naming.
- Bootstrap writes nothing for Claude; its summary lists both launch commands and
  notes the one-time project MCP approval. Backup and context Git are unchanged.

### Phase 4. Documentation and rules

- `AGENTS.md`: "the agent" instead of Pi where generic; split the user-layer section
  into shared, Pi and Claude parts; forbid root `CLAUDE.md`/`CLAUDE.local.md` with
  the reason; start agents from the engine root; "native subagents" means the
  executing agent's own subagents.
- README launch section; `docs/MCP.md` for both agents; Claude checklist in
  `docs/MANUAL-ACCEPTANCE.md`; `docs/WORK-CHATS.md` marked Pi-only; PLAN entry.

### Phase 5. Verification and delivery

- One task branch `task/mp30-claude-support`; `pnpm build`, `pnpm verify`,
  independent test-diff review, push, PR with these phase 0 results.
- Live acceptance in a disposable installation through Herdr:
  - Pi regression: autoload, MCP, skill from `integrations/skills`, `/work-chat help`.
  - Claude: `AGENTS.md` and personal layer present; MCP `project_list`; skill listed;
    memory context for a registered project and an explained absence for an
    unregistered cwd; nested project `AGENTS.md` loaded; hook after compact/resume.
- Merge, release v0.8.0 and the installed-engine update need operator authorization.

## Risks

| Risk | Mitigation |
|---|---|
| A personal or generated root `CLAUDE.md` hides nested `AGENTS.md` | Ignored path, consistency test, rule in `AGENTS.md` |
| Claude started outside the engine root | Documented launch command; hooks/MCP absent is visible in `/mcp` |
| Personal layer via hook is weaker than a system prompt | Accepted; matches Claude's context model |
| Pi regression while moving autoload logic | Unchanged Pi tests plus live Pi acceptance |
| Claude without mise picks another Node | Launch through `mise exec`; MCP fails with a visible error |
