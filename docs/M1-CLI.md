# Node CLI M1

From the engine checkout: `mise exec -- pnpm build`, then
`mise exec -- node dist/src/cli/main.js --help`. Data-command results are JSON;
error/partial means nonzero exit and JSON on stderr, never a false success on stdout.
Core does not call an LLM or execute flow. Full command syntax is in help.

## Managed home write prerequisites

Capture, note/error, memory add/remove, journal add and request create/status/title/
progress now coordinate their mutation → exact commit → bounded non-force push to
configured origin/main. Home must already be a private repository on published
`main`; unrelated dirty/staged state is refused, not adopted. Unrelated ignored
caches remain untouched. An uncertain operation preserves its pending record and
adds `home` recovery observations to partial JSON; never replay an append blindly.
DB-only operations remain independent. `context commit`/`context restore` and
manual edits/Git are uncoordinated maintenance, not automatic pending recovery or
publication. See [HOME-WRITER](HOME-WRITER.md) for exact boundaries and the typed
application status/reconcile API (no new CLI command names in this increment).

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

## Explicit Git workspace helpers

```sh
mypi workspace prepare /clones/project--task --project org/project --base /clones/project --branch task/example --start refs/heads/main
mypi workspace inspect /clones/project--task --project org/project --base /clones/project
mypi workspace commit src/example.ts 'test/literal[1].ts' --project org/project --base /clones/project --worktree /clones/project--task --branch task/example --message 'Implement example'
mypi workspace publish --project org/project --base /clones/project --worktree /clones/project--task --branch task/example --remote origin
```

These examples are explicit operations, not an automatic workflow or authorization
for a network push. All require an existing registered `org/project`. Optional
`--base` overrides the registered checkout exactly as for `mypi pi`; actual Git
root/common-directory/worktree association is verified, not inferred from a name,
remote or installation descendant. The installed engine and its shared metadata
cannot be selected. No DB/home/request initialization occurs.

- **Prepare:** new short local branch and absent target directly under an existing
  parent, outside existing worktrees/metadata, including the installed engine's
  canonical Git common directory (also through ordinary symlinks). Independent
  worktrees nested elsewhere under the installation remain supported. `--start`
  accepts a full local `refs/heads/...`, `refs/tags/...` or full commit ID, resolved
  once before creation.
  No fetch, upstream setup or base branch switch; dirty base files are preserved.
- **Inspect:** omitted path selects base. Reports real HEAD, branch, porcelain
  status, known worktrees (including locked/prunable entries) and operation state.
  An unusable selected binding is marked as unsuitable for mutation; unsupported
  configured filters make status unavailable rather than executing them. This is
  neither an ownership registry nor a lock/cleanliness guarantee.
- **Commit:** requires an associated linked non-base worktree and its explicit
  current branch. Paths are distinct normalized relative literal **files**, not
  recursive directories/pathspecs; quote shell metacharacters. Regular files,
  new nonignored files and tracked deletions are supported. Symlink components,
  submodules/special files, unfinished Git operations/conflicts, declared paths with
  assume-unchanged/skip-worktree flags, and declared staged content differing from
  working content are refused before staging or reporting a no-op. Helpers never
  clear these index flags. Native exact `add`/`commit --only` preserves unrelated
  staged object IDs/modes and working,
  untracked and ignored bytes (not byte-identical index bookkeeping). Only a real
  declared-difference observation yields a no-op. No add-all/reset/stash occurs.
- **Publish:** explicit configured remote name, one push destination, current
  branch only. URL rewrite/mirror/multiple-destination or remote-name ambiguity
  is refused. Observes the exact remote ref, then at most one non-force push of
  the observed local commit to that same branch; no tags/upstream changes. An
  already equal ref returns `push:"not-needed"`. Otherwise post-observation must
  equal the target: `push:"exited-zero"` or `"failed-or-uncertain"` records the
  command outcome separately from the confirmed destination. The latter does not
  claim this process caused that state. No automatic retry, merge or rebase.

Helpers disable hooks, fsmonitor, signing and recursive submodule operations.
Prepare/commit refuse configured executable Git filters; ordinary text/encoding
attributes still apply. Commit uses normal configured identity. Only explicit
publish uses ordinary remote credentials/transport; errors do not echo destination
URLs or authentication output. Each Git subprocess is bounded to 3 seconds and
1 MiB output, so slow/unavailable remotes may produce an uncertain result.

Preflight refusals are ordinary errors. Once an effect starts, failure returns
`partial` with known branch/path/HEAD/status or remote-ref observations in `saved`,
missing confirmation and affected `paths`. Declared index entries may remain staged
when commit fails. Prepare failure may leave a branch/worktree. Inspect local
HEAD/status/worktrees and, for publish, the exact remote ref **before any later
action**; no rollback or safe replay is implied. No concurrent-writer or race
containment is promised. Run your approved checks separately before commit/publish.

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

## Cooperative contextual application calls

Ordinary shell CLI calls have no implicit Pi context and remain the explicit operator
route. A caller supplying `WorkContext` to shared CLI/application dispatch gets the
[application membership/default table](MCP.md#cooperative-application-membership-and-defaults).
Omitted scope/project is preserved until dispatch: without context it still means
global memory/journal or standalone request; with scoped context it selects the
concrete project or organization default. An organization without selected project
must supply a project to create a request. Explicit global/null intent is never
silently retargeted. Existing context CLI `--scope global` still denotes an organization
named `global`, not the typed global scope; journal `--scope global` denotes global.
For compatibility, explicit journal `--scope ''` also denotes global, not an omitted
selection; explicit empty memory/context scope remains invalid.

Allowed results retain their original JSON. A successful warn-mode operation instead
returns `{data:<original result>,warnings:[{behavior:"warn",guard:"foreignMypiTarget",
message:...}]}`. Blocks and partial failures retain the existing non-success routes.
Global maintenance/raw context operations remain deliberately unguarded; this is not
an ACL or a guarantee of safe concurrent home writes.
