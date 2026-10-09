# mypi MCP

Local stdio server in the same package, sharing the typed application API with CLI.
No HTTP daemon or session orchestrator. [Implementation evidence](MCP-CYCLE.md).
Development guidance: [AGENTS](../AGENTS.md). The former mandatory agent workflow
is [withdrawn](AGENT-WORKFLOW.md); the server supplies no workflow instructions.
The [original MCP plan](MCP-PLAN.html) is historical, including its user-global setup.
The [local mailbox](MAILBOX.md) documents `message_send/list/show/cleanup`, native
addressing, ordinary caller metadata and queued/uncertain/handoff limitations.

## Start

```sh
timeout --kill-after=5s 295s mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm build
mise exec -- node dist/src/mcp/main.js
```

The last command waits for JSON-RPC on stdin, not interactive input. Bin: `mypi-mcp`.
Node 24; exact dependency versions are in package.json and pnpm-lock.yaml.
DB uses the server's XDG_STATE_HOME (fallback ~/.local/state); home is inside the
engine clone. Neither location depends on the client cwd. Connect/tools/list do not
initialize storage. Bootstrap/restore require explicit intent and no other writers.

## Optional Pi connection

The [example](../integrations/pi/mcp.example.json) describes the mypi server only.
It does not install an agent workflow, memory warmup, task-registration requirement,
automatic logging, delegation or Herdr-tab rule. The former
[instruction template](../integrations/pi/mypi-instructions.md) is retired.

For an explicitly requested connection, the mypi entry can be merged into the
chosen Pi MCP configuration using absolute Node 24 and built entrypoint paths.
Unrelated servers/settings and existing credentials are not part of that change.
Project settings load after trust; a project entry replaces a global entry of the
same name. A second server is not needed to change metadata.

The example exposes project_resolve and warmup directly; other tools are available
through codemode. Exposure makes tools available, not mandatory. Connecting the
server neither creates storage nor launches work.

After an authorized configuration change, `/reload` reloads Pi context/settings;
`/mcp reconnect mypi` reconnects the server after rebuilding it. An existing
conversation can retain old instruction text; a fresh session avoids that stale
context. `pi mcp list` connects to all enabled servers and is not an isolated
verification command. See the installed Pi MCP/security documentation for setup.

## Tool and transport contract

43 tools are available through standard tools/list. Inspect live schemas for fields.
Arguments are strict, including nested fields. Context scopes: global/org/project;
request scope is supported for journal, not warmup or MEMORY. Journal read also accepts
explicit `"all"`. A project scope key is its code; request_create.project is org/project
or null (standalone REQ). Do not invent an org/request reassignment command.
TextInput is exactly `{text}` or `{file:absolutePath}`; BOM/CRLF are preserved.
Context paths are home-relative; progress artifact paths are request-directory-relative.

Policy diagnostics: `policy_validate {text}` and `policy_explain {guard,text?}`.
YAML v2 configures `outsideWorktreeWrite`, `baseCheckoutWrite` and `foreignMypiTarget`
as `warn` or `block`. MCP accepts text only, never a host policy file path. Validate
returns normalized settings; explain returns guard, behavior and message. Omitted
explain text uses defaults; empty/invalid/v1 text fails. Both results carry
`diagnostic:"cooperative"`, not a claim of intercepted operations or enforcement.
There is no separate preview or caller/profile/target interface. See
[implemented schema and examples](SCOPED-POLICY-CORE.md).

Session observations: `session_list {project?,all?,includeArchived?}` and
`session_show/session_archive {instanceKey,project?,all?}` use a selected concrete
project by default, or require an explicit project/all view. These cache-only
routes bypass DB/home and membership composition. They never read native history;
issues/truncation mean incomplete inventory, not absence of duplicates. Archive
hides only one instance and survives heartbeat. See [SESSION-CARDS](SESSION-CARDS.md).

Server construction may supply ordinary `WorkContext` out of band. Supported calls
use the cooperative membership/default checks below, not authentication. Diagnostics
never install configuration.

Native Pi composition uses the non-secret `MYPI_MCP_CONTEXT` environment envelope
from [Pi working context](PI-WORK-CONTEXT.md). It is canonical base64url UTF-8 JSON
containing version, Pi cwd and `WorkContext`, decoded once at server startup. Missing
env keeps legacy behavior; empty string explicitly clears selection. Any other
malformed supplied value fails startup instead of falling back. This does not change
stdio framing, storage locations or ordinary tool arguments. The extension requests
registration on native context changes; same-name user configuration still wins.
Registration is shown as unconfirmed, not as working routing or enforcement. Existing
server operations keep their original immutable context; Pi replacement can close
the old connection and does not promise completion or rollback of in-flight writes.

Success: `{status:"ok",data:...}`. Tool error: `isError:true` and
`{status:"error",message}`. Partial includes status/message/saved/missing/paths and
requestId when known, plus `home` recovery observations for coordinated home partials
(see [HOME-WRITER](HOME-WRITER.md)). structuredContent equals parsed JSON in text content. The data
payload retains CLI JSON shapes, including the conditional warning result below.
Invalid JSON-RPC remains an SDK protocol error;
well-formed tools/call validation failures/unknown names use the application envelope.
Always check isError and structuredContent.status, not promise resolution alone.

Calls within one server are serial, including async backup. A queued cancellation
does not write; an active synchronous call does not promise rollback. EOF/SIGTERM
stop new work, cancel queued work and drain active work. Forced termination requires
reconciliation. CLI/MCP share interprocess transaction guards; a JSON-RPC ID is not
an idempotency key. Never blindly repeat create/append after an unknown outcome.

Scope is not an ACL. The server runs with local user permissions; file/checkout/backup
arguments can reference explicit external paths. No arbitrary SQL/shell tool is exposed.
Read-only hints are not authorization. Except for the idempotent cache-only
`session_archive`, writes are not declared idempotent; backup is not read-only.
Responses are not truncated by the server; session inventory explicitly reports
its bounded scan via `truncated` and `issues`.

## Cooperative application membership and defaults

No context (including an unselected Pi) and unrestricted context retain ordinary
operation semantics. A scoped consumer resolves registry project IDs and actual
request `Card.projectId`; spelling of a directory or request-code prefix does not
authorize membership. Organization members are observed afresh on each covered call.
Unknown/inconsistent selected projects fail covered calls without registration or
storage initialization. `selectedProject` chooses defaults inside an organization;
it does not exclude another explicit current member.

| Commands | Scoped behavior |
| --- | --- |
| `project_list`, `request_list` | Omitted filter selects the concrete selected project, otherwise current organization members. Explicit project/org filters keep their intent; foreign targets warn/block. An explicit own-org project list includes all organization members in organization context, only the own project in project context. |
| `warmup`, `memory_show` | Application/CLI omitted scope defaults to selected project, otherwise organization. Explicit global and own parent-org reads stay available, including inherited warmup memory; foreign scope warns/blocks. |
| `memory_add/remove`, `note_add`, `journal_add` | Same omitted default; target membership checked. Explicit global or parent-org writes from project context are foreign; own-org writes in organization context are allowed. Request journal scope uses actual card ownership. |
| `journal_read` | Same defaults and membership; global/own parent-org reads allowed. Explicit `all` is deliberately unguarded, not silently narrowed. |
| `request_create` | Application/CLI omitted project defaults to selected project. Organization without concrete selection must supply a project. Explicit null remains standalone and is foreign to scoped selection. No-context/unrestricted omission remains standalone. |
| `request_show/status/title/touch/progress` | Actual card owner must belong to the working scope; standalone is foreign to scoped selection. |
| `error_add`, `workspace_prepare/inspect/verify/commit/publish/cleanup_preview` | Explicit project's actual membership checked. Workspace mutations additionally require verified independent repository/worktree association. |
| `session_list/show/archive` | Selected-project default or explicit operator project/all observation filter; no registry membership lookup or ACL. |
| `home_document_patch`, `home_status`, `home_reconcile` | Explicit home-wide operator routes outside project membership/default guards; no inferred project or project-scoped authority. |
| `project_resolve`, `status_list`, `context_read`, policy diagnostics | Deliberately unguarded discovery/reads. |
| `project_add`, status mutations, `db_init`, `bootstrap`, `backup`, `restore`, `capture`, `context_commit/restore` | Deliberately unguarded global/maintenance operations; explicit operator discipline remains required. |

MCP retains **required** explicit scope fields and required nullable
`request_create.project`; omission is not accepted there. CLI/application omissions
remain distinguishable from explicit global/null, even though both historically
had the same no-context result. Existing explicit errors and partial outcomes remain.

`foreignMypiTarget` uses the same v2 `MYPI_GUARD_POLICY` absolute-file selector as
native write/edit. A scoped MCP consumer loads once at construction, retaining a
load error for covered calls rather than disabling discovery or unguarded calls.
Direct contextual application/CLI dispatch loads once per covered command unless
composition supplies a selected policy/error. An absent selector uses defaults;
an invalid explicit selector never does. No-context/unrestricted application calls
do not consume this selector. This differs intentionally from native write/edit,
where invalid policy also blocks unselected/unrestricted writes.

Block throws the common useful diagnostic before mutation or source-file adoption.
Warn permits the operation, but **only a successful warned operation** returns the
application/CLI shape `{data:<normal result>,warnings:[{behavior:"warn",
guard:"foreignMypiTarget",message:...}]}`. MCP wraps that unchanged shape as
`{status:"ok",data:{data:<normal result>,warnings:[...]}}`. Normal allowed results
are unchanged. Errors/partials are never wrapped as successes and retain their
recovery fields; inspect the actual outcome rather than blindly retrying.

These are cooperative checks, not an ACL, a home-writer lock or an assertion that
shared home writes are concurrency-safe. Ordinary no-context CLI remains an explicit
operator route. Direct module calls, raw context paths, shell, foreign MCP and disabled
extensions are not covered; do not infer universal protection from a guarded call.

## Coordinated home tools

- `home_document_patch {path,expected,text}` replaces one existing tracked ordinary
  UTF-8 file using its lowercase SHA256 byte preimage. All fields are required;
  `text` may be empty. Returns `{path,commit}`; unchanged text makes no new commit.
  Paths are literal home-relative names. No creation/deletion, implicit adoption,
  memory conversion or immutable/append-only history rewrite is provided.
- `home_status {}` returns `{head,pending,remoteHead,remoteOutcome,needsAttention}`.
- `home_reconcile {}` adds `reconciled:boolean`, clearing only an exactly proven
  published pending marker without repeating mutation, commit or push.

All three are home-wide operator routes, even in scoped Pi. Only status is marked
read-only; all three have `openWorldHint:true` because they observe/publish to the
configured remote. Status/reconcile need no DB. Patch uses the same writer/setup
requirements as participating managed commands. See [HOME-WRITER](HOME-WRITER.md)
for target exclusions, prerequisites, partial fields and manual maintenance limits.
These hints and descriptions are not authorization or runtime activation.

## Explicit workspace tools

The six tools share [CLI semantics and partial-outcome rules](M1-CLI.md#explicit-git-workspace-helpers):

| Tool | Arguments (all required except `?`) |
| --- | --- |
| `workspace_prepare` | `project`, `baseRoot?`, `worktreeRoot`, `branch`, `startPoint` |
| `workspace_inspect` | `project`, `baseRoot?`, `worktreeRoot?` |
| `workspace_verify` | `project`, `baseRoot?`, `worktreeRoot`, `branch` |
| `workspace_cleanup_preview` | `project`, `baseRoot?`, `worktreeRoot`, `branch`, `remote?` |
| `workspace_commit` | `project`, `baseRoot?`, `worktreeRoot`, `branch`, `paths: string[]`, `message` |
| `workspace_publish` | `project`, `baseRoot?`, `worktreeRoot`, `branch`, `remote` |

Project is an explicit registered `org/project`, never a remote/directory identity.
Base defaults only to the registered checkout and is independently verified.
Prepare returns branch/worktree, pinned start/head and binding. Inspect returns
observations plus `mutationUnavailable`/`statusUnavailable` diagnostics. Commit
returns before/head, declared paths and `changed`; unrelated staged entries remain.
Publish returns head, remote name, full ref, confirmed `remoteHead` and separate
`push` outcome (`not-needed`, `exited-zero`, or `failed-or-uncertain`). Unconfirmed
post-push state is **partial**, not success, even when the push process exits zero.
Inspect and cleanup-preview are annotated read-only/idempotent; verify, publish
and cleanup-preview are open-world (preview may observe an explicitly selected
remote). Preview returns bounded inventory, publication and reduced advisory card
hints, diagnostics, `decision:"manual-review"` and `deletionAuthorized:false`.
It requires no check cache and never performs cleanup; omitted remote means no
publication contact. No credentials/URLs are returned. Only explicit verify runs
project checks; no automatic requests, branch switching, retries or Git cleanup.
See the [owning helper route](PI-WORK-CONTEXT.md#explicit-workspace-operations).

## Rollback

For a local setup, remove only its mypi entry/installed instruction block, then reload.
Do not remove global settings without permission. This does not delete DB/home.
Revert code with its matching lockfile and rebuild if authorized; saved user data does
not roll back automatically. See [M1-CLI](M1-CLI.md) for partial reconciliation.
