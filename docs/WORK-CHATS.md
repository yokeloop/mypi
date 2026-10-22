# Native work chats

Work chats are ordinary interactive Pi sessions in existing task worktrees.
**Pi owns conversation history, model selection and login; Herdr owns terminals
and native start; mypi owns the request/worktree/session association and a small
cooperative launch reservation.** Opening sends no prompt, task, replay or retry.
It does not assign work, create a worktree or authorize execution.

## One explicit opening action

```text
mypi work-chat open-request --project example/project --request-id 12
mypi work-chat open-request --project example/project --request-id 12 --chat-id <chosen-id>
```

`request-id` is the database request ID, not the project-local request number.
The MCP equivalent is `work_chat_open_request` with `identity`, `requestId`, and
optional `chatId`. Pi exposes the same CLI grammar as `/work-chat open-request`.
All three call the same application use case:

- A verified live conversation returns `outcome:existing` and focuses its current
  pane, including a rediscovered moved pane. No second Pi is launched.
- A positively dead previous writer can be reopened with **that exact saved
  native history** in its original checked worktree. Success is `outcome:opened`.
- Multiple associated chats return `outcome:choice-needed`, `chats` and a selection
  reason; choose `--chat-id` / MCP `chatId`. Nothing is selected silently.
- No chat and no supplied association returns `outcome:setup-needed` with a reason.
  Supply an **existing** registered independent source clone and task worktree:

```text
mypi work-chat open-request --project example/project --request-id 12 --source-clone /absolute/clone --worktree /absolute/task
```

For MCP, setup is `association:{"sourceClone":"/absolute/clone","worktree":"/absolute/task"}`.
Optional `--name` / `nameLabel` names a new chat. Optional `--no-focus` / `focus:false`
keeps it in the background. Ordinary opening focuses by default. These setup paths
are used only when no chat exists; they do not rebind a saved chat. Registration,
clone creation and task-worktree setup remain separate explicit operations.

`opened`/`existing` means verified native identity, **not** authorization or an
upstream credential guarantee. `partial` is non-success and preserves known chat,
pane/process and native references, with the failure in `observation.reason`.
Choice/setup also mean no
opening succeeded: CLI exits nonzero with `status:error`, MCP returns `isError`
and the structured choice/setup data. Other errors explain the refused action.
Slash displays the same result; it does not automatically choose, retry or prompt.

## Target installation and native Herdr setup

Configure the intended installation before opening:

- Node 24, a built mypi installation and its user `USER-INSTRUCTIONS.md`.
- `XDG_STATE_HOME`: canonical existing target state directory. Managed native
  histories use its `sessions/` directory; SQLite remains under `mypi/`.
- Explicit caller `HOME`, `ZDOTDIR`, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` are
  passed to the new tab through Herdr `--env`. Unset roots remain inherited from
  Herdr; mypi does not forward the whole caller environment or credentials.
  State, agent resources and executable PATH remain pinned separately. Shell RC
  files can still change PATH, so the owned-shell resolution check remains mandatory.
- `PI_CODING_AGENT_DIR`: canonical absolute resource directory with `settings.json`
  containing exactly one package entry for this installation's `integrations/pi`.
  Keep its other packages, including pi-subagents, MCP, skills and instructions.
  Switching to a different agent-dir to obtain Herdr integration can lose these
  resources; mypi does not do that or edit global Pi/mise configuration.
- `MYPI_WORK_CHAT_PI`: absolute path to the **direct Linux ELF Pi executable**, not
  a shell wrapper (especially not one that changes global mise configuration).
- Persistent Herdr with native `agent list/get/start/focus` and stock Pi native
  session reporting. Set `HERDR_ENV=1`, `HERDR_WORKSPACE_ID`, and
  `HERDR_SOCKET_PATH` to the normalized absolute local socket path. A socket path
  is a locator, not a unique server-instance identity.
- The **installed stock** Herdr Pi integration is explicitly loaded with Pi `-e`.
  Default: `~/.pi/agent/extensions/herdr-agent-state.ts`; set
  `MYPI_WORK_CHAT_HERDR_EXTENSION` to its installed absolute path elsewhere.
  It must support native session reporting. Missing/wrong integration fails;
  mypi does not vendor, install or patch it as part of opening.

The native feasibility check used Pi 1.0.4, Herdr 0.8.2, stock integration v8.
The adapter uses one native `agent start --kind pi`, not a shell Pi launcher or
mypi readiness polling loop. A bounded `command -v pi` probe in the newly owned
shell first verifies routing after shell initialization; configured PATH alone
is insufficient. Herdr `pane run` acknowledges input by exit status (empty stdout
is valid), not command completion. The bounded `pane wait-output` JSON observation,
captured resolution and unchanged shell identity must all succeed before native
start. Structured list/get/start/process-info and focus responses still require JSON. Supported shells: bash/zsh/dash/sh. Alias/function, wrong binary,
unavailable shell or unsupported shell leaves an explicit partial result and the
known pane intact. Configure the target shell to resolve the same direct binary;
there is no wrapper fallback or automatic tab cleanup/recreation.

Herdr can initially report readiness at a trust dialog without session metadata.
Resolve trust explicitly in that tab, then explicitly inspect/open again; mypi
never approves it or treats readiness alone as identity. Native argv, procfs,
cwd/Git association, target installation/state/resources and native UUID/path
must agree. This is cooperative checking, **not OS or credential isolation**.
The shell and observation checks have ordinary same-user TOCTOU limits.

For an explicitly requested registry path change, `mypi project update org/project
--expected-path /old/checkout --path /new/checkout` (or `--expected-unset`) changes
only the registered path. Any managed chat, including closed history, prevents a
changed binding. It never relocates the request, worktree or history.

## Models and login belong to Pi

Without an explicit or configured new-chat preference, Pi chooses its own model.
Optional user-owned `home/pi/work-chats.json` supplies initial preferences only:

```json
{
  "default": { "provider": "provider-a", "model": "model-a" },
  "organizations": { "example": { "provider": "provider-b", "model": "model-b" } },
  "projects": { "example/project": { "provider": "provider-c", "model": "model-c" } }
}
```

These illustrative IDs are not product defaults. Keys must be registered identities;
each entry is a complete provider/model pair. New-chat precedence is invocation >
project > organization > default > native Pi choice. Use `--model provider/model-id`
(split on the first slash), or `--provider provider-id --model model-id` (model ID
verbatim). MCP uses `model:{"provider":"...","model":"..."}`.

Resume restores **Pi's saved model**, without current config overrides, even when
valid native history has no saved model. Only an invocation override passes model
flags on resume. Explicit/config preferences are not permanent strict targets:
native `/model` is authoritative and needs no mypi adoption. `adopt-model` is
removed and its legacy CLI/slash invocation reports migration guidance to `/model`,
not fake success. `sync-attempt` and internal chat flags are removed.

Missing credentials do not cause model flags to be silently dropped. Use `/login`
in the **same Pi session**, and `/model` there as needed. No model catalog/auth
subprocess or auth/readiness mirror is maintained. Syntax/resource validation
cannot prove registry membership: Pi's catalog can hide unauthenticated models.
The exact preference must be independently observed before it is reported applied;
fuzzy fallback, absent selection or delayed persistence yields a same-pane partial.
For an explicit resume override, an old equal model entry is insufficient; a fresh
active native model-change entry confirms application. A redundant same-model
override may therefore remain unconfirmed if Pi writes no new entry. Prefer a
plain resume when preserving the saved model. No artificial prompt/entry is sent
to force persistence. A different explicit preference cannot change an already-live
chat: use `/model` there, or close it and explicitly resume with the override.

Keep `auth.json` out of the separate home Git: verify the user-owned
`home/pi/.gitignore` contains `/auth.json` before `/login`. Do not copy credentials.
This feature does not implement MP-24 credential isolation or MP-27 startup warmup.
Independent scope binding, MCP registration and optional before-turn warmup/cache
invalidation remain; session startup does not secretly perform a new warmup flow.

## Read-only inspection and low-level compatibility

```text
mypi work-chat list
mypi work-chat show <chat-id>
mypi work-chat open --project example/project --request-id 12 --source-clone /absolute/clone --worktree /absolute/task
mypi work-chat resume <chat-id> [--model provider/model-id]
mypi work-chat execute --preview '<exact JSON returned by open or resume>' [--focus]
```

`list`, `show`, and low-level `open`/`resume`/`new-empty` previews are read-only.
They observe external state but never reconcile/write chat rows or launch Pi.
MCP retains `work_chat_list`, `work_chat_show`, `work_chat_open`, `work_chat_resume`,
`work_chat_new_empty`, and `work_chat_execute`, with matching read-only annotations.
`execute` and `open-request` are mutations. Low-level execute focuses only with
`--focus`; it is not a required extra step for ordinary `open-request`.

Use fresh preview JSON verbatim. Existing-chat previews require `priorAttempt`
and `priorRevision`; obsolete previews without revision are refused, not upgraded
implicitly. Optional `live.processBootId`/`live.herdrEndpoint` preserve observed
origin. Execution checks the row again under a short SQLite reservation and rejects
stale results. External Herdr operations run outside the DB transaction.

In `/work-chat execute --preview`, paste the JSON object directly (without shell
quotes); spaces/escapes inside it remain intact. One standalone `--focus` may
precede or follow the JSON. Other slash values are whitespace-delimited; use CLI
or MCP for other values containing spaces. `/work-chat help` describes the action.

## History, observations and uncertainty

A row's `phase`, including old `ready`/`auth-pending`, is a **historical launch fact**,
not current liveness, readiness or authorization. Inspect the separate current
`observation` (`live`, `dead`, `unknown`) and its reason. Missing pane/metadata,
unreachable Herdr, an ambiguous/reused PID or another server's empty list does not
prove death. Linux boot and process-start facts plus server/worktree checks are
used where available; legacy absent origin is not fabricated. Positive local
absence can establish death for legacy rows; uncertainty cannot authorize a writer.

A native switch/fork to another conversation is a conflict, never silent task
rebinding. A saved history that is missing, corrupt, foreign or in another cwd
cannot be replaced by an empty session. Dirty worktree contents are preserved;
changed branch/clone association is refused separately.

Pi may expose a native UUID/path before saving an empty conversation. That is an
unsaved reference, not a resumability promise. ENOENT or process death is not proof
of empty closure. The retained low-level `new-empty` requires positive native
continuity evidence; the current stock adapter cannot prove it and conservatively
refuses. Do not fabricate a history header or discard the uncertain association.
SQLite metadata backup does not back up worktrees or external Pi conversation files.

Deterministic launch prerequisites (direct executable, stock integration, endpoint,
scope and target resources) are prepared before reserving a new chat or replacing
saved launch provenance. A known setup error leaves the database unchanged: correct
the configuration and open again. Diagnostic reads and existing-live focus do not
require these launch-only prerequisites. Preparation does not lock configuration or
external resources: a later change/failure or a possibly dispatched tab/start still
leaves a conservative partial association, never automatic cleanup or retry.

Simultaneous managed openings use a conditional SQLite reservation: only the winner
launches, and stale results cannot overwrite a newer inspected association. On a
lost result, an explicit opening may attach an independently verified exact native
session; insufficient evidence returns an error without another launch. Known
partial panes remain intact. No launch retry, daemon, heartbeat, receipt/commit
marker watcher or attempt-history platform is provided. This is neither a global
history-file lock nor absolute exclusion of arbitrary manual writers. SQLite and
Herdr are not one transaction; a lost tab-create reply does not support an
exactly-once guarantee. Inspect uncertain outcomes before taking another action.

## Legacy data and schema-5 migration

No personal rollout is authorized by these instructions. Build/verify, disposable
migration checks and applicable authorization precede updating real installations.
Stop old managed writers before a coordinated rollout; old processes may still run
the removed protocol. Do not delete historical ack files or histories as cleanup.

The exact migration is
[`005-work-chat-process-origin.sql`](../src/infrastructure/database/migrations/005-work-chat-process-origin.sql),
registered as schema version 5 and applied by the existing immediate migration
transaction. It rebuilds the same `work_chats` table (no extra table of attempts):

1. Adds nullable `process_boot_id TEXT` and `herdr_endpoint TEXT`. All legacy rows
   retain NULL; no invented boot/server provenance.
2. Replaces paired-null session/history with `history_path IS NULL OR session_id IS
   NOT NULL`, permitting a UUID reserved **before** dispatch while its path is unknown.
   Historical `ready`/`auth-pending` still require ID, path, pane and process facts.
3. Copies every old column explicitly, including requested provider/model and all
   phases, IDs, request/project, Git/worktree/installation/state and history fields.
4. Recreates the occupied-worktree unique index and request index. Primary/foreign
   keys and unique native session/history/attempt constraints remain.

Existing migration tests use disposable SQLite and check full old-row preservation,
NULL origins and constraints. This does not migrate or prove resumability of any
personal chat. Legacy rows are evaluated with the same exact-history/ownership
checks, not rejected merely for old readiness or accepted merely for old success.
