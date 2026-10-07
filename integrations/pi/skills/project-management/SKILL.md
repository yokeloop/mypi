---
name: project-management
description: Plan and carry out explicitly requested creation, initialization, registration in mypi, or maintenance of a project's identity, repository setup, and project documentation. Use when the user asks to create or manage a project, not for ordinary code changes within an existing project.
---

# Project management

Use this workflow only for the part of project setup or maintenance the user actually requested. A repository, a mypi project registration, and mypi's `home/` context are different things. Do not infer permission to create or update one from a request concerning another. Follow the applicable `AGENTS.md` and the user's instructions; this skill does not replace repository-specific Git rules. The workspace's [common project workflow](../../../../AGENTS.md#common-project-workflow) owns clone/worktree layout and the [instruction ownership rules](../../../../AGENTS.md#instruction-ownership) determine where maintained guidance belongs. Refer to these policies instead of copying them into this skill or personal prompts.

## Determine the scope

- Clarify whether the user means a new repository, initialization of an existing directory, registration of an existing checkout in mypi, or ongoing maintenance. Ask when ambiguous. For a new project, establish its purpose, location, desired stack and initial deliverables; ask only for missing decisions that affect the work.
- For mypi registration, confirm `org/project`, unique short code, and optional absolute existing checkout path. Do not assume every repository should be registered. Use the connected `mypi` MCP server: `project_list` with `{}` lists registrations; `project_add` takes `{"identity":"org/project","code":"CODE","checkoutPath":"/absolute/checkout"}` (omit `checkoutPath` if not needed). Registration writes the DB only: it neither creates a repository nor creates project files in `home/`.
- Distinguish documentation/metadata maintenance from feature work. Do not create a request record, journal entry, memory fact, or session workflow merely because a project exists.

## Inspect before writing

- Check target paths, existing project records (if registering), Git status and remotes of every repository that will be changed. Preserve existing files and unrelated dirty or staged changes; do not silently adopt, overwrite, reset, or reinitialize a repository.
- Arrange a push destination with the user before changing a Git repository that has no suitable remote. Follow that repository's branch/PR policy; never treat this skill as authorization to push `main` or publish private material.
- Treat `db init`, `bootstrap`, restore, migrations and other external writes as separate operations requiring applicable user authorization. Do not run them as a fallback for registration or setup.

## Execute only the agreed work

- For repository creation or initialization, build only the agreed minimum structure and configuration for the chosen stack. Avoid speculative scaffolding, services, CI, dependencies or licenses. For an existing repo, change only the requested pieces.
- For mypi registration, use the `mypi` MCP tool `project_list` first and `project_add` only when requested and absent; verify with `project_list` afterwards. Do not retry a write after an error, partial result or lost connection until checking actual DB and Git state. If the server is unavailable, stop and ask; do not silently switch to CLI, direct SQLite or filesystem writes. The DB and `home/` are separate from engine source: do not edit SQLite or managed history directly or relocate personal data.
- For explicitly requested project context in `home/`, use the `mypi` MCP tools, not direct edits: `warmup` with `{"scope":{"type":"project","key":"CODE"}}` for the scoped index, `context_read` with a home-relative path for a full existing file, `memory_show` before removing numbered facts, `memory_add` for a requested fact, `note_add` for a new note, and `journal_add` for a factual outcome. The latter three take a project scope `{"type":"project","key":"CODE"}`; `memory_add` and `journal_add` also take `text`, while `note_add` takes `title` and `body:{"text":"..."}`. Do not automatically create memory, notes, requests or journal entries when registering or working on a project. The write tools commit context changes but do not push; inspect `home/` Git status before writes and follow its separate commit/push policy afterwards. Never append twice after an uncertain result.
- Use normal file tools to search/read project Markdown and edit ordinary documents or user customizations in `home/pi/` and `home/USER-INSTRUCTIONS.md`. Never rewrite immutable source or append-only history this way. The ignored `.pi` link connects `home/pi/` to Pi; built-in resources belong to the engine's `integrations/pi/` package. Do not customize built-ins to implement personal preferences.
- For ongoing maintenance, update appropriate project-owned documentation and metadata when the user asks or when needed to keep the requested change accurate. Keep instructions factual and current; do not rewrite historical or immutable records. Ask before introducing a new tracking convention.

## Verify and report

- Check the created or updated files, registration result where applicable, and final Git status. Check MCP `status` (`ok`, `error`, or `partial`) and `saved`/`missing` fields before claiming success; a resolved tool call is not proof of a completed write. Run the relevant checks for changes made under the repository's isolation rules. Commit and publish only task changes under the applicable repository policy; report a missing remote or failed push rather than implying delivery.
- Report what was created or updated, where it lives, how it was verified, and any remaining decisions or blockers. Never report a project as registered merely because its directory exists.
