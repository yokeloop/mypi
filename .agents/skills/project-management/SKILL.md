---
name: project-management
description: Plan and carry out explicitly requested creation, initialization, registration in mypi, or maintenance of a project's identity, repository setup, and project documentation. Use when the user asks to create or manage a project, not for ordinary code changes within an existing project.
---

# Project management

Use this workflow only for the part of project setup or maintenance the user actually requested. A repository, a mypi project registration, and mypi's `home/` context are different things. Do not infer permission to create or update one from a request concerning another. Follow the applicable `AGENTS.md` and the user's instructions; this skill does not replace repository-specific Git rules.

## Determine the scope

- Clarify whether the user means a new repository, initialization of an existing directory, registration of an existing checkout in mypi, or ongoing maintenance. Ask when ambiguous. For a new project, establish its purpose, location, desired stack and initial deliverables; ask only for missing decisions that affect the work.
- For mypi registration, confirm `org/project`, unique short code, and optional absolute checkout path. Do not assume every repository should be registered. Read this repository's `docs/M1-CLI.md` or the current CLI help for command syntax before using it.
- Distinguish documentation/metadata maintenance from feature work. Do not create a request record, journal entry, memory fact, or session workflow merely because a project exists.

## Inspect before writing

- Check target paths, existing project records (if registering), Git status and remotes of every repository that will be changed. Preserve existing files and unrelated dirty or staged changes; do not silently adopt, overwrite, reset, or reinitialize a repository.
- Arrange a push destination with the user before changing a Git repository that has no suitable remote. Follow that repository's branch/PR policy; never treat this skill as authorization to push `main` or publish private material.
- Treat `db init`, `bootstrap`, restore, migrations and other external writes as separate operations requiring applicable user authorization. Do not run them as a fallback for registration or setup.

## Execute only the agreed work

- For repository creation or initialization, build only the agreed minimum structure and configuration for the chosen stack. Avoid speculative scaffolding, services, CI, dependencies or licenses. For an existing repo, change only the requested pieces.
- For mypi registration, use the supported `project add` interface only when registration was requested. Verify whether a project already exists before adding it; reconcile partial results before retrying. The DB and `home/` are separate from engine source: do not edit their internals directly or relocate personal data.
- For ongoing maintenance, update the appropriate project-owned documentation and metadata when the user asks or when needed to keep the requested change accurate. Keep instructions factual and current; do not rewrite historical or immutable records. Ask before introducing a new tracking convention.

## Verify and report

- Check the created or updated files, registration result where applicable, and final Git status. Run the relevant checks for changes made, following the repository's test policy. Commit and publish only task changes under the applicable repository policy; report a missing remote or failed push rather than implying delivery.
- Report what was created or updated, where it lives, how it was verified, and any remaining decisions or blockers. Never report a project as registered merely because its directory exists.
