# Node CLI M1

From the engine checkout: `mise exec -- pnpm build`, then
`mise exec -- node dist/src/cli/main.js --help`. Results are JSON; error/partial means
nonzero exit and JSON on stderr, never a false success on stdout. Core does not call
an LLM or execute flow. Full command syntax is in help.

These are optional commands, not an agent startup or task-registration procedure.
The former mandatory workflow is [withdrawn](AGENT-WORKFLOW.md).

MCP exposes only agent operations. db init, bootstrap, backup (including --publish), restore, journal import, status list/add/rename/terminal/remove, context restore, home migrate-tasks and task worktree exist only in this CLI.

## Storage and context operations

DB: `$XDG_STATE_HOME/mypi/state.sqlite3` (fallback `~/.local/state/mypi/state.sqlite3`),
outside Git. Context: this checkout's `home/`, a separate Git repository. `db init`
initializes only DB; `bootstrap` initializes DB/context Git, without fetch/pull/push.
Use only with explicit intent; stop other writers for bootstrap/restore.

```text
project add org/project --code MP [--path /absolute/checkout]
project list [--org org]
project resolve /absolute/existing-directory
memory add "fact" [-s org/project]
memory show [-s org/project]
memory remove 1 --expected-revision SHA256 [-s org/project]
capture "original text"
capture --file /path/to/utf8-source
note "title" "text" [-s org/project]
note "title" --file /path/to/text [-s org/project]
error org/project "error or dead end"
warmup [-s global | CODE | CODE-N] [--max-chars n]
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
the project list (global), open tasks (project) or task card and worktree (task).
Without -s it uses MYPI_SCOPE, else global. Unknown keys, REQ tasks without a project
and projects without a clone exit 1 with a JSON error. Over 64 KiB the oldest facts of
the farthest memory zone are hidden with a marker naming the MCP `memory` show call and,
in parentheses, `memory show -s …`. `--max-chars n` (1–21845) applies the same cut at n characters instead; the Claude Code hook uses 9500. `journal read` global remains global-only.
Task cards from task show and task list include worktreePath (null until a worktree is
recorded).
`project resolve` returns `{match:"project",identity,code,scope}` or `{match:"none"}`
or `{match:"ambiguous",projects}` using the registered checkout resolver; sibling
worktrees are not inferred.

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

These are independent syntax examples, not a mandatory sequence. Tasks belong to a
registered project; existing standalone REQ records remain readable.

`task worktree MP-1` works in the project's registered base clone: it fetches
`origin`, fast-forwards the main branch (`origin/HEAD`, else `main`) without
switching the clone's branch, creates `task/MP-1-<slug>` from it in
`<clone>--MP-1-<slug>` and records the path as the card's `worktreePath`. It prints
`{key,branch,worktreePath,created}`. A repeated call returns the recorded worktree
(`created: false`) without fetching. It refuses tasks without a project, projects
without a clone, a main branch that cannot be fetched or fast-forwarded, a branch
checked out in another worktree and a foreign directory at the path. It installs no
dependencies, writes no journal entry and has no MCP tool; removing worktrees and
branches stays manual.

Progress artifacts: JSON array `[{"path":"research/result.md","text":"new content"}]`;
omit text to reference an existing file. Paths are relative to the task directory;
journal stores home-relative references. New content is created without overwrite.
Read the DB status dictionary and choose explicitly; used status terminality cannot
change. Legacy REQ records keep their own numbering and task scope. Title does not rename the folder;
terminal tasks cannot reopen. Original source is immutable; additional material
can be stored separately.

Journal filters: global (default), org:slug, project:CODE, task:KEY; org/project
resolves through DB. Global is not the whole journal. Results are time-ordered; limit
selects the newest entries across the whole filtered selection. Do not duplicate
task progress by recording the same event in the project journal.

## Moving task folders

`home migrate-tasks [--dry-run]` moves every task folder from `requests/` to `tasks/`
(home root for legacy REQ records, `projects/<org>/<project>/` for project tasks) with
`git mv`, commits once in home as `Move task directories from requests/ to tasks/`, then
rewrites `context_dir`, file fingerprints and journal artifact paths of exactly those
folders in one SQLite transaction. `--dry-run` prints `{status:"preview",moves,rewrites}`
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

`context read path` does not create files; missing means error. `context restore path
--revision FULL_SHA` restores a mutable file (including a deleted one) from a saved
full Git revision in a new commit. Commit/restore take exact files, not directories.
Dirty/staged preimages are preserved; immutable source/inbox and append-only logs
cannot be rewritten this way. Git cannot restore data it never contained.

## Backup and restore

`backup /existing-parent/new-backup-directory` uses SQLite backup API, a separate Git
bundle and checksum manifest. Cooperating writers are locked; dirty context/broken
references need reconciliation. DB-only backup is allowed without home. Snapshots
are outside Git; the manifest is written last. Incomplete backup is not success.

`restore /backup-directory` targets a new installation with absent DB/home. It never
overwrites current data; repetition refuses without changes. It checks hashes,
schema/integrity/FKs, source and all artifact references. Preserve damaged data
separately before recovery; there is no automatic deletion or retention policy.

`backup --publish [--dry-run] [--file exact-relative-path ...]` previews or publishes
an SQLite snapshot and committed home baseline to the already configured home
`origin/main`. Repeat `--file` for additional exact files; registered source/artifact
files are selected automatically. Preview reports selected/excluded paths, unpushed
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

## Verification

`mise exec -- pnpm verify`: admission + fast + boundary under systemd/bubblewrap,
without personal home/network. Build changed source first; stale dist is rejected.
[M1-CYCLE](M1-CYCLE.md) and [MCP-CYCLE](MCP-CYCLE.md) record functional checks and
review/gate limits. Numeric budgets exist only in [TESTING](TESTING.md).
