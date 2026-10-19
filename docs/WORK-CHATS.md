# Independent work chats (MP-23)

Work chats are ordinary interactive Pi sessions in existing task worktrees, owned by
persistent Herdr. Nothing is sent to the model when a chat is opened. This is a
cooperative association, not an agent runner, task assignment, daemon, credential
isolation or worktree creator. See `mypi --help` for the exact CLI grammar. The
matching MCP operations are `work_chat_open`, `work_chat_resume`,
`work_chat_new_empty`, `work_chat_list`, `work_chat_show` and `work_chat_execute`.
The native `/model` command remains the per-chat selector.

Configure the *target* installation's Pi resources first. Set `XDG_STATE_HOME` to
its existing state directory, `MYPI_WORK_CHAT_PI` to the absolute Pi executable,
and `PI_CODING_AGENT_DIR` to the absolute directory containing its `settings.json`
with exactly one package entry for this installation's `integrations/pi`.
Run under Node 24 and persistent Herdr (`HERDR_ENV=1` and
`HERDR_WORKSPACE_ID`). The installation needs built mypi, and its user home
needs `USER-INSTRUCTIONS.md`. The registered project must have an independent
source clone and an existing task branch/worktree belonging to that clone;
registration or cloning is a separate operation. CLI/MCP return actionable errors
rather than silently creating defaults or a task checkout. To rebind a registered
project without managed work chats, use `mypi project update org/project
--expected-path /old/checkout --path /new/checkout` (or `--expected-unset` when
no checkout was registered). MCP `project_update` takes `identity`,
`expectedCheckoutPath` (absolute previous path or `null`) and `checkoutPath`.
The new path must be an existing absolute directory; it is stored canonically.
A stale previous path, another registration at that path, or any managed chat
for the project (including closed history) prevents a changed binding. The
operation does not move or rewrite requests, context or chat history.

Optional user-owned `home/pi/work-chats.json` selects *existing* Pi model IDs:

```json
{
  "default": { "provider": "provider-a", "model": "model-a" },
  "organizations": { "example": { "provider": "provider-b", "model": "model-b" } },
  "projects": { "example/project": { "provider": "provider-c", "model": "model-c" } }
}
```

These IDs are illustrative, not product defaults. Keys must be registered
identities. Each entry is a complete provider/model pair. New chats use explicit
invocation > project > organization > default. Resume uses explicit invocation >
selected model in the native active session branch > configured scopes only if
that valid history has no saved model. With no effective choice, set a pair in
the file or supply one on the invocation. For CLI use `--model provider/model-id`
(split at the first slash), or `--provider provider-id --model model-id` (model
ID verbatim, including slashes). MCP uses `model:{"provider":"...","model":"..."}`.
An explicit model and a saved model do not require reading the defaults file.
Provider credentials and model registration stay in Pi; this does not add MP-24
organization/customer credential isolation. Before starting Pi in `home/pi`, protect
its `auth.json` from the separate home Git repository with `home/pi/.gitignore`
containing `/auth.json` (the setup wizard creates or extends that rule). Verify
`git -C home check-ignore -v pi/auth.json` succeeds **before** using `/login`.
Pi can create an empty `auth.json` while listing models, even before login;
never commit credentials or copy them from another agent directory.

Example (replace all paths and IDs with the real, explicitly checked target):

```text
mypi work-chat open --project example/project --request-id 12 --source-clone /absolute/clone --worktree /absolute/task --model provider/model-id
mypi work-chat execute --preview '<exact JSON object returned by open>'
mypi work-chat list
mypi work-chat show <chat-id>
mypi work-chat resume <chat-id> [--model provider/model-id]
mypi work-chat execute --preview '<exact JSON object returned by resume>' [--focus]
```

`open`, `resume` and `new-empty` return previews, not launches. Inspect the
reported clone, cwd, scope, exact provider/model and source before explicitly
executing the returned preview JSON; stale previews are refused. Execute may
return `outcome:ready`, `outcome:auth-pending`, or `outcome:existing` (also for
an existing pending chat). When target credentials are absent, Pi opens in the
same managed worktree without a pinned model and without a work prompt. Use
`/login`, then `/model` **in that tab** to select the requested provider/model.
Run `work-chat show <chat-id>` or `work-chat list` to reconcile the same session:
only exact native process/session, model, scope and local auth observations
promote it to ready. Local readiness is not proof the credential works upstream;
no failed request is replayed. An unrelated authenticated default may be
selected at startup, but cannot satisfy a pending target. Because Pi hides
unauthorized models from `--list-models`, exact catalog validation for that
provider is deferred until authorization is configured; an unsupported model
may remain pending and needs an explicit corrected model on a closed resume.
`outcome:partial` is non-success (nonzero CLI exit / MCP `isError`); inspect its
chat ID, attempt, pane, PID and reason before any subsequent action. No blind
retry/cleanup. Resume of an already-live worker returns that pane without
another writer. A different
explicit model cannot be applied to an already-live worker: select `/model` in
that chat or close it and resume with the override. A pending chat retains its
requested target on a closed persisted resume even if another model was selected
there; only an explicit resume override changes it. A native manual model change
persists in its history, not in the defaults file. A missing/corrupt persisted
history is unavailable, never silently replaced. If a chat closed before any
history was persisted and native closure is positively proven, use
`work-chat new-empty <chat-id>` and explicitly execute its preview. History and
worktrees are not backed up by the SQLite metadata snapshot.

In ordinary Pi, `/work-chat help` describes the same CLI subcommands. For
`/work-chat execute --preview`, paste the exact returned JSON object directly:
spaces and escapes inside it remain part of one preview argument, and a standalone
`--focus` may appear before or after the preview. Other slash arguments are
whitespace-delimited; use CLI or MCP for other values with spaces. The extension
invokes the installed Node CLI and displays its actual JSON result. It does not
submit prompts or assign tasks.
