# ADR 0005: Organization session

Date: 2026-11-05
Status: accepted

Supplements ADR 0001, ADR 0003 and ADR 0004.

## Context

A session had three scopes: `global`, a project (`MP`) and a task (`MP-12`). An
organization existed only as a memory level and in registrations, with no session
of its own. A plan that spans several projects of one organization had no single
chat: the work went through each project chat in turn.

## Decision

1. A fourth scope. The key of an organization session is the bare lowercase slug
   of a registered organization (`tb-ff`). `global` and `all` stay reserved: `all`
   is `/inbox all`. `/open tb-ff` opens, focuses or resumes it in the Herdr tab
   `org-tb-ff` of the workspace `tb-ff`, in the engine root, with no clone and no
   worktree. An organization without registered projects is refused.
2. Two parents of a task. A task's parent is its project chat or its organization
   chat; either may send it a message. The parent of an organization chat, like
   that of a project chat, is the main chat. The structure never changes: a task
   belongs to one project, a project to one organization.
3. `turn_end` and `waiting` go to the sender of the parent message that started
   the turn, taken from its frame `[mypi: сообщение родительской сессии <sender>
   для <KEY>. …]`. A sender that is not a parent of the task (a forged or stale
   frame) gives way to the task's project.
4. A milestone goes to the parent that last sent the task a message, else to the
   task's project, exactly one per status change, and none when that recipient
   makes the change itself. A last sender that is no longer a parent gives way to
   the project.
5. Main chat to organization: the main chat writes to an organization chat as it
   writes to a project chat; turns it starts create no events.
6. `events` is not migrated: rows keep their `from_key` and `to_key`, so nothing is
   lost or duplicated when the hierarchy is read differently.
7. Migration 014 rebuilds `sessions` with the scope `org` and the column `org_id`
   (an organization row has `org_id` and no project or task) and recreates the
   trigger `used_project_code`.

## Consequences

- Schema 14: the installed engine needs `mypi db init` once after the update.
- `mypi sessions` shows the tree global → org → project → task; an organization
  without its own row is a node with no session.
- `org remove` refuses while an organization session or an event with its slug
  exists.
- Existing global, project and task sessions keep their keys and their routing.
