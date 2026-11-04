# Node CLI M1

From the engine checkout: `mise exec -- pnpm build`, then
`mise exec -- node dist/src/cli/main.js --help`. Results are JSON; error/partial means
nonzero exit and JSON on stderr, never a false success on stdout. Core does not call
an LLM or execute flow. Full command syntax is in help.

These are optional commands, not an agent startup or task-registration procedure.
The former mandatory workflow is [withdrawn](AGENT-WORKFLOW.md).

MCP exposes only agent operations. db init, bootstrap, backup (including --publish), restore, journal import, status list/add/rename/terminal/remove, context restore, project remove, org remove, home migrate-tasks and task worktree exist only in this CLI.

## Storage and context operations

DB: `$XDG_STATE_HOME/mypi/state.sqlite3` (fallback `~/.local/state/mypi/state.sqlite3`),
outside Git. Context: this checkout's `home/`, a separate Git repository. `db init`
initializes only DB; `bootstrap` initializes DB/context Git, without fetch/pull/push.
Use only with explicit intent; stop other writers for bootstrap/restore.

```text
project add org/project --code MP [--path /absolute/checkout] [--repository <git-url|local>]
project update org/project [(--expected-path <previous> | --expected-unset) --path <new-absolute-directory>] [(--expected-repository <previous> | --expected-repository-unset) --repository <git-url|local>]
project list [--org org]
project resolve /absolute/existing-directory
project flow MP|org/project
project remove org/project --expected-code MP
org remove org
memory add "fact" [-s org/project]
memory show [-s org/project]
memory remove 1 --expected-revision SHA256 [-s org/project]
capture "original text"
capture --file /path/to/utf8-source
note "title" "text" [-s org/project]
note "title" --file /path/to/text [-s org/project]
error org/project "error or dead end"
warmup [-s global | org | CODE | CODE-N] [--max-chars n]
session register --agent claude|pi --pid <pid> (--native-id <id> [--name <name>] [--fork] | --hook) [--socket <path>]
session unregister --pid <pid> | forget <key>
sessions
event emit --from <key> [--to <parent>] [--waiting] [--message text] | --waiting --hook --pid <pid>
turn end --pid <pid>
inbox [org | CODE | CODE-N | global | all]
send MP-12 "next step" | send MP-12 --file step.md
open MP MP-12 | open tb-ff | open MP-12 --message "next step"
```

Without -s, memory/notes are global. Managed MEMORY facts serialize as JSON strings
inside Markdown; multiline text is returned exactly. Other Markdown remains context,
not managed facts. `memory show` returns the exact file text and SHA-256 `revision`.
Removal requires the displayed number and that revision; stale/missing revisions refuse
without modifying files. Reread and retry deliberately, never reuse an old number.
Capture creates a separate immutable inbox/*.md original, not a SQL copy; no BOM/CRLF
stripping. It does not replace a task card or authorize execution. Notes never
silently overwrite another note with the same topic. `warmup` prints
Markdown, not JSON: personal instructions, role, how to work in mypi, zone memory, then
the project list (global), the organization's projects with their open tasks by status (organization),
open tasks (project) or task card and worktree (task).
Without -s it uses the session's registered key, else MYPI_SCOPE, else global. Unknown keys, REQ tasks without a project
and projects without a clone exit 1 with a JSON error. Over 64 KiB the oldest facts of
the farthest memory zone are hidden with a marker naming the MCP `memory` show call and,
in parentheses, `memory show -s …`. `--max-chars n` (1–21845) applies the same cut at n characters instead; the Claude Code hook uses 9500. `journal read` global remains global-only.
Task cards from task show and task list include worktreePath (null until a worktree is
recorded).
`project resolve` returns `{match:"project",identity,code,scope}` or `{match:"none"}`
or `{match:"ambiguous",projects}` using the registered checkout resolver; sibling
worktrees are not inferred.
`project remove` deletes a registration only when its code matches `--expected-code`
and no tasks, sessions, journal entries of the project or its tasks, or events
reference it; otherwise it exits 1 and lists each kind of reference with its count.
`org remove` deletes an organization without projects, sessions or events with its slug
(otherwise it exits 1 and lists each kind of reference with its count); an organization left empty by
`project remove` stays. Neither deletes `home/` folders. Result:
`{removed:{project}|{organization}, homeFolder}`, where `homeFolder` is the path of
the remaining folder or null.
`session register` writes the `sessions` row and the live record for one agent process (`--pid`, start time from /proc); `--hook` reads Claude's SessionStart input from stdin. Result: `{key, registered, displaced}`. `session unregister --pid` removes only that process's records; the row stays. `session forget <key>` deletes the row and reports `live`. `sessions` prints the tree. All need `XDG_RUNTIME_DIR`.
`event emit --from <key>` writes one event from a task key to `--to <parent>` when that is a parent of the task (its project or its organization), else to its project key (`turn_end`, or `waiting` with `--waiting`; `--message` is its text); `--waiting --hook --pid` reads Claude's Notification input from stdin instead and can write only for `permission_prompt` and `elicitation_dialog`, never for `idle_prompt`. `turn end --pid` reads Claude's Stop input from stdin and can write a `turn_end` event with `last_assistant_message`, none when `stop_hook_active` is set. Both hook forms resolve the key like `session register` and write only when the transcript entry (`transcript_path`) that opened the current turn has `turnOrigin` `peer` and carries the mypi parent-message frame, and address the sender of that frame as `--to`; `--hook` with `--to` is refused; a turn a person started, an unreadable transcript or a missing mark writes nothing. `--from` is not subject to this rule. A project or global key writes nothing. Result: `{"event":<number>}` or `{"event":null}`; errors exit 1, never 2. `inbox` prints the undelivered rows of a key as `{events: [{id, from, to, kind, createdAt, text}]}` with `text` in its frame, and marks them delivered: for a project or organization the events addressed to it and the main chat's messages to it, for a task its parent's messages (`kind` `message`), for `all` the events of all projects without messages, empty for global; without a key it resolves the key like `warmup`. `send <key> (text | --file source)` writes a parent message (`kind` `message`) from the calling session's key (resolved like `warmup`: registered key, else `MYPI_SCOPE`, else `global`, so an unresolved caller counts as global and may send only to projects and organizations) to its direct child (for a task its project or its organization) and sends it at once to a live child; any other caller is refused with the allowed parent's name. Result: `{"message":<id>,"delivered":true|false}`; a closed child gets it once at the next `open`. A project or organization `warmup` also shows and marks the undelivered events addressed to it and lists the last delivered `turn_end` of each open task.
`open <key...>` takes an organization slug (tb-ff), a project code (MP), CODE-N, org/project or org/project#N. An organization key opens the agent `org-<slug>` in the workspace labelled `<slug>`, with no clone or worktree; an organization without registered projects is refused. For each key it focuses a live session's Herdr agent (`herdr agent focus <key in lower case>`), or opens a new `--no-focus` tab with the engine root as cwd and `MYPI_SCOPE=<key>` in the workspace labelled with the key's project (`org/project`, the first match in `herdr workspace list`), and starts the agent there. Without that workspace it creates it (`--cwd` the engine root, `--env MYPI_SCOPE=<key>`), renames its first tab to the key in lower case and starts the agent in it; a task key does not start its project's session. The caller's `HERDR_WORKSPACE_ID` is not used. The agent is the saved session resumed with its own agent, or a new one. A project without a clone is first cloned from its registered `repository` (`local`: `git init` on `main` with one empty commit) into `<engine root>/projects/<org>/<project>`, verified (top level, `remote.origin.url`) and registered as its checkout path; an existing directory there is adopted only when it is that clone, otherwise the key is refused and nothing changes; the key's `notes` get `clone prepared: cloned|initialized|adopted <path>`. While cloning it writes progress lines prefixed "mypi: " to stderr (stdout keeps its JSON); SIGINT or SIGTERM stops git, removes the temporary clone and exits 130 or 143 with the JSON error "open cancelled while cloning <repository> into <path>; nothing was registered". A leftover .<project>.mypi-clone-<pid> directory of a process that is gone is removed by the next open; one of a running process makes open refuse. A task key creates its worktree first (as `task worktree`). `--agent` applies only to new sessions (default `defaultAgent` in home/settings.json, else claude); `--permission-mode` is passed to Claude only (default the calling session's mode). A started (not resumed or focused) session gets one start message in the frame `[mypi: стартовое сообщение для <key>. …]` through the same socket as events: for an organization the open tasks of each of its projects by status and the number of its undelivered events, for a project its open tasks by status and the number of undelivered events, for a task its status, worktree and the last journal entries with their artifacts; it is state, not an instruction, and creates no events. If it cannot be delivered, the key's `notes` get `start message not delivered: <reason>` and the command still succeeds; for Claude in `bypassPermissions` delivery is not promised. `--message <text>` (one key; the caller must be its parent; otherwise nothing opens) queues a parent message after the focus or start and delivers it live, after a resume, or in the same message as the start text. Result: `{opened: [{key, agent, action, workspaceId, tabId, worktreePath, notes, message}]}`; a failure after an opened key is partial. Without a running Herdr server, for a project without a clone and without a repository, for global, all, REQ and unknown keys it exits 1 with no tab, worktree or session rows; it never writes session rows itself.

## Tasks and journal

```text
task create --project org/project --title "Title" --status research --slug short-slug --file /path/to/source
task list [--project org/project] [--status code]
task show MP-1
task worktree MP-1
task status MP-1 review --reason "ready for review"
task title MP-1 "Better title" --reason "clarification"
task progress MP-1 "actual outcome" [--artifacts /path/to/artifacts.json]
status list
status add accepted --terminal
status rename accepted verified
status terminal unused-code true
status remove unused-code
journal add "outcome" -s org/project
journal add "checked current state" -s task:MP-1
journal read -s project:MP --from 2026-09-01T00:00:00Z --limit 10
journal read --all --type status_changed
```

These are independent syntax examples, not a mandatory sequence. `task status` to `review`, `blocked`, `merged` or a terminal status also queues one `milestone` event (inbox, warmup) for the parent that last sent the task a message, else the project chat, unless the caller is that recipient itself (its registered key, else `MYPI_SCOPE`, as for `warmup`); milestones are never sent live. Tasks belong to a
registered project; existing standalone REQ records remain readable.

`project flow MP` (or `org/project`) prints the project's branch flow from
`home/projects/<org>/<project>/flow.json`:
`{project,code,source,file,integration,taskBranch,prTarget,mergeMethod,release}`.
`source` is `file` or `default`. Without the file: `integration` is the clone's
`origin/HEAD` (read locally, no fetch), else `main`, and `main` without a clone;
`taskBranch` `task/{KEY}-{slug}`, `prTarget` the integration branch, `mergeMethod`
`merge`, `release` `null`. Fields not in the file take the same defaults. The file
accepts exactly these fields; an unknown field, a wrong type, an invalid branch name,
a template without `{KEY}` or with other placeholders, a merge method other than
`merge`, `squash` or `rebase`, or a release that is neither an https URL nor a path
relative to the clone is refused with `Invalid flow <absolute file>: <field> …`. An
unknown project is refused. It only reads.

`task worktree MP-1` works in the project's registered base clone: it fetches
`origin`, fast-forwards the integration branch of the project's flow (without
`integration`: `origin/HEAD`, else `main`) without switching the clone's branch,
creates the task branch by the flow's template (default `task/MP-1-<slug>`) from it
in `<clone>--MP-1-<slug>` and records the path as the card's `worktreePath`. It prints
`{key,branch,worktreePath,created,createdBranch}`. A repeated call returns the
recorded worktree (`created: false`) with its actual branch, whatever the flow says
now, without fetching. An invalid flow is refused before anything is created or
recorded. It refuses tasks without a project, projects without a clone, an
integration branch that cannot be fetched or fast-forwarded, a branch checked out in
another worktree and a foreign directory at the path. It installs no
dependencies, writes no journal entry and has no MCP tool; removing worktrees and
branches stays manual.

Progress artifacts: JSON array `[{"path":"research/result.md","text":"new content"}]`;
omit text to reference an existing file. Paths are relative to the task directory.
New content is created without overwrite. `progress` commits the named files in home
(it does not push) and the journal stores each as `{path, commit}` with the
home-relative path and the full commit SHA. The files stay editable; an entry reads
its own version with `context read <path> --revision <commit>`. Entries from before
schema 11 store plain paths; their files stay frozen by a fingerprint.
Read the DB status dictionary and choose explicitly; used status terminality cannot
change. Legacy REQ records keep their own numbering and task scope. Title does not rename the folder;
terminal tasks cannot reopen. `source.md` is editable; correct a card by editing it
and committing.

Journal filters: global (default), org:slug, project:CODE, task:KEY; org/project
resolves through DB. Global is not the whole journal. Results are time-ordered; limit
selects the newest entries across the whole filtered selection. Do not duplicate
task progress by recording the same event in the project journal.

## Moving task folders

`home migrate-tasks [--dry-run]` moves every task folder from `requests/` to `tasks/`
(home root for legacy REQ records, `projects/<org>/<project>/` for project tasks) with
`git mv`, commits once in home as `Move task directories from requests/ to tasks/`, then
rewrites `context_dir`, file fingerprints and plain journal artifact paths of exactly
those folders in one SQLite transaction; `{path, commit}` references keep the path of
their commit. `--dry-run` prints `{status:"preview",moves,rewrites}`
and changes nothing. A dirty home or an existing target folder refuses; a folder already
moved by hand gets only the DB rewrite; nothing left to do returns `{status:"noop"}`.
Never pushes. Run `backup` before and after.

## Partial: reconcile before retrying

1. Read the card and specific files; inspect Git status and journal.
2. If the entry exists, do not append again. Complete only a verified missing commit:
   `context commit journal/2026-10.jsonl projects/one/project/tasks/MP-1-slug/source.md --message "Finish checked partial"`.
3. If the SQL card is absent but source exists, a checked repeat create with
   `--adopt-source` is possible. Exact source is validated; changed numbering/path
   stops the operation. Never use adoption as an unchecked retry switch.
4. For uncertain transition history, record a factual note of observed state, not
   an invented status_changed event.
5. If progress artifacts/journal/Git are saved but activity timestamp is missing,
   explicitly complete it with `task touch KEY`.

`context read path [--revision FULL_SHA]` does not create files; missing means error;
with `--revision` it reads the file as committed there. `context restore path
--revision FULL_SHA` restores a mutable file (including a deleted one) from a saved
full Git revision in a new commit. Commit/restore take exact files, not directories.
Dirty/staged preimages are preserved; frozen plain-path artifacts of old entries,
`journal/`, `inbox/` and `errors.md` cannot be restored this way. Git cannot restore data it never contained.

## Backup and restore

`backup /existing-parent/new-backup-directory` uses SQLite backup API, a separate Git
bundle and checksum manifest. Cooperating writers are locked; dirty context/broken
references need reconciliation: every `{path, commit}` reference must resolve in the
saved home history (`Unresolvable artifact reference: <path>@<commit>`). DB-only
backup is allowed without home. Snapshots
are outside Git; the manifest is written last. Incomplete backup is not success.

`restore /backup-directory` targets a new installation with absent DB/home. It never
overwrites current data; repetition refuses without changes. It checks hashes,
schema/integrity/FKs, sources and that every artifact reference resolves in the
restored home history. Preserve damaged data
separately before recovery; there is no automatic deletion or retention policy.

`backup --publish [--dry-run] [--file exact-relative-path ...]` previews or publishes
an SQLite snapshot and committed home baseline to the already configured home
`origin/main`. Repeat `--file` for additional exact files; task `source.md` files and
old plain-path artifacts are selected automatically, and every `{path, commit}`
reference must resolve in the published history. Preview reports selected/excluded paths, unpushed
ancestor commits and destination without saving, committing or pushing. Publication
returns `preview`, `published` or `partial`, with `snapshotSaved`, optional `commit`,
`publicationConfirmed`, and error details. A partial result exits nonzero; inspect
the local commit and remote ref before retry, especially after an uncertain push.
The index and unrelated worktree changes are preserved. Credentials, token stores,
chat transcripts and caches are not automatically selected; review committed text
for secrets before publication. Previously unpushed ancestor commits are published
as part of the branch. `.mypi-backup/` contains the generated snapshot and manifest;
older binary snapshots remain in Git history and increase repository size. The live
DB remains outside home. Publication is not atomic across Git and SQLite and does
not save external project clones, native chats or unsaved machine state.

`restore --repository /absolute/local/clone --commit FULL_SHA` reads one immutable
published commit (including its snapshot) from an existing clone into absent home
and DB targets of the selected installation. It does not migrate or overwrite data,
restore external clones or provide missing credentials; checkout paths may require
manual reconfiguration. Stop other writers before restoring. The local-directory
`backup` and `restore` forms above remain available.

Context commits use the mypi identity, without user hooks/fsmonitor/signing; private
Git attributes preserve exact bytes without EOL/encoding/filter transformations.
These commands do not modify working clones, branches or remote synchronization.

## HTTP API server

```text
mypi serve [--listen <IP>] [--port <n>] (HTTP API in the foreground: 127.0.0.1:8737 by default; see docs/HTTP-API.md)
mypi token create <name> --permission read|write [--sender global|CODE] | list | revoke <name> (HTTP API tokens in $XDG_CONFIG_HOME/mypi/api-tokens.json; create prints the token once)
```

Routes, tokens, response shapes and change streams: [docs/HTTP-API.md](HTTP-API.md).

## Verification

`mise exec -- pnpm verify`: admission + fast + boundary under systemd/bubblewrap,
without personal home/network. Build changed source first; stale dist is rejected.
[M1-CYCLE](M1-CYCLE.md) and [MCP-CYCLE](MCP-CYCLE.md) record functional checks and
review/gate limits. Numeric budgets exist only in [TESTING](TESTING.md).
