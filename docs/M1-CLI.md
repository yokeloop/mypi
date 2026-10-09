# Node CLI M1

From the engine checkout: `mise exec -- pnpm build`, then
`mise exec -- node dist/src/cli/main.js --help`. Data-command results are JSON;
error/partial means nonzero exit and JSON on stderr, never a false success on stdout.
Core does not call an LLM or execute flow. Full command syntax is in help.

## Native Pi terminal exception

`mypi pi [--project org/project | --org org | --unrestricted] [--cwd directory]
[--base clone] [-- native Pi arguments...]` launches installed Pi with inherited
terminal IO and exit status, not a JSON result wrapper. For example:

```sh
mise exec -- pnpm pi --project org/project --cwd /clones/project--task
mypi pi -- --help
mypi pi --project org/project -- --continue
```

The alias uses the existing build only. Project cwd must be an existing checkout/
worktree root; the chosen base (`--base` or registered checkout) is the default cwd.
Project/org selection requires existing registration. No selection is unselected;
unrestricted/unselected do not require a DB. No automatic initialization, request,
worktree, branch switching or settings installation occurs. Native Pi still owns
its usual resources/history and can invoke a model when asked. See
[working context](PI-WORK-CONTEXT.md#terminal-launcher) for exact selection, native
resume, extension-loading and non-enforcement semantics.

These are optional commands, not an agent startup or task-registration procedure.
The former mandatory workflow is [withdrawn](AGENT-WORKFLOW.md).

## Storage and context operations

DB: `$XDG_STATE_HOME/mypi/state.sqlite3` (fallback `~/.local/state/mypi/state.sqlite3`),
outside Git. Context: this checkout's `home/`, a separate Git repository. `db init`
initializes only DB; `bootstrap` initializes DB/context Git, without fetch/pull/push.
Use only with explicit intent; stop other writers for bootstrap/restore.

```text
project add org/project --code MP [--path /absolute/checkout]
project list [--org org]
memory add "fact" [-s org/project]
memory show [-s org/project]
memory remove 1 [-s org/project]
capture "original text"
capture --file /path/to/utf8-source
note "title" "text" [-s org/project]
note "title" --file /path/to/text [-s org/project]
error org/project "error or dead end"
warmup [-s org | org/project]
```

Without -s, memory/notes are global. Managed MEMORY facts serialize as JSON strings
inside Markdown; multiline text is returned exactly. Other Markdown remains context,
not managed facts. Reread memory show before removing a current numbered item.
Capture creates a separate immutable inbox/*.md original, not a SQL copy; no BOM/CRLF
stripping. It does not replace a request card or authorize execution. Notes never
silently overwrite another note with the same topic. Scoped warmup excludes global
inbox/unrelated projects; read full artifacts rather than treating its index as memory.

## Requests and journal

```text
request create --project org/project --title "Title" --status research --slug short-slug --file /path/to/source
request create --title "Unassigned" --status new --slug short-slug "source"
request list [--project org/project] [--status code]
request show MP-1
request status MP-1 review --reason "ready for review"
request title MP-1 "Better title" --reason "clarification"
request progress MP-1 "actual outcome" [--artifacts /path/to/artifacts.json]
status list
status add accepted --terminal
status rename accepted verified
status terminal unused-code true
status remove unused-code
journal add "outcome" -s org/project
journal add "checked current state" -s request:MP-1
journal read -s project:MP --from 2026-09-01T00:00:00Z --limit 10
journal read --all --type status_changed
```

These are independent syntax examples, not a mandatory sequence. Both project-linked
requests and standalone REQ records are supported by the API.

Progress artifacts: JSON array `[{"path":"research/result.md","text":"new content"}]`;
omit text to reference an existing file. Paths are relative to the request directory;
journal stores home-relative references. New content is created without overwrite.
Read the DB status dictionary and choose explicitly; used status terminality cannot
change. REQ has its own numbering and request scope. Title does not rename the folder;
terminal requests cannot reopen. Original source is immutable; additional material
can be stored separately.

Journal filters: global (default), org:slug, project:CODE, request:KEY; org/project
resolves through DB. Global is not the whole journal. Results are time-ordered; limit
selects the newest entries across the whole filtered selection. Do not duplicate
request progress by recording the same event in the project journal.

## Partial: reconcile before retrying

1. Read the card and specific files; inspect Git status and journal.
2. If the entry exists, do not append again. Complete only a verified missing commit:
   `context commit journal/2026-10.jsonl requests/REQ-1-slug/source.md --message "Finish checked partial"`.
3. If the SQL card is absent but source exists, a checked repeat create with
   `--adopt-source` is possible. Exact source is validated; changed numbering/path
   stops the operation. Never use adoption as an unchecked retry switch.
4. For uncertain transition history, record a factual note of observed state, not
   an invented status_changed event.
5. If progress artifacts/journal/Git are saved but activity timestamp is missing,
   explicitly complete it with `request touch KEY`.

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

Context commits use the mypi identity, without user hooks/fsmonitor/signing; private
Git attributes preserve exact bytes without EOL/encoding/filter transformations.
These commands do not modify working clones, branches or remote synchronization.

## Verification

`mise exec -- pnpm verify`: admission + fast + boundary under systemd/bubblewrap,
without personal home/network. Build changed source first; stale dist is rejected.
[M1-CYCLE](M1-CYCLE.md) and [MCP-CYCLE](MCP-CYCLE.md) record functional checks and
review/gate limits. Numeric budgets exist only in [TESTING](TESTING.md).
