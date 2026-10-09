# Coordinated managed home writes

`executeCommand` (shared CLI/MCP dispatch) coordinates capture, note/error, memory
add/remove, journal append, and request create/status/title/progress. These calls
retain their successful result shapes, but now require an already configured,
private canonical home Git repository on `main`, with an existing HEAD equal to
the observed `origin/main` at its single configured push destination. Missing,
unborn, unpublished or divergent setup is refused, not initialized or repaired.

One Linux advisory lock covers declaration/preimage checks, existing mutation and
exact-path commit, and one bounded non-force publication attempt. Acquisition waits
at most one second. Participating Git processes inherit the open lock descriptor;
closing the caller's descriptor does not unlock a surviving Git process. The
persistent `.git/mypi-home.lock` inode must not be deleted. This coordinates
cooperating clients, not arbitrary subprocess trees or hostile direct writes.

Unexplained tracked changes, staged entries and nonignored untracked files prevent
writes. Unsupported index flags are refused, never cleared. Unrelated ignored
caches remain untouched; ignored declared targets are refused. Explicit source
adoption and progress references may include only their named regular files with
checked byte preimages. Existing immutable source/published artifacts and
append-only journal/error protections remain in force. Request source paths are
declared in the existing reserved-number callback, and a frozen operation clock
fixes the journal month before related effects.

SQLite/file/Git are **not** one transaction. Existing request phase boundaries and
`PartialError.saved`, `missing`, `paths`, and `requestId` remain authoritative.
Publication happens after SQLite transactions return. A partial/uncertain operation
retains a small `.git/mypi-home-pending.json` record and blocks further participating
home writes. CLI and MCP additionally serialize `home` containing `needsAttention`,
`pending`, `head`, `remoteHead`, and `remoteOutcome`. Remote outcomes are
`matches-local`, `different`, `missing`, or `unknown`; neither URLs nor transport
stderr are included. New publication failures report acknowledged database saves,
context and Git separately from unconfirmed publication. Never repeat an append or
request creation merely because a response was lost.

## Ordinary documents and operator inspection

Recommended coordinated route for an authorized ordinary home document change:

```sh
mypi home document-patch 'docs/literal[1].md' 'complete replacement text' --expected <SHA256>
mypi home status
mypi home reconcile
```

MCP exposes `home_document_patch {path,expected,text}`, `home_status {}` and
`home_reconcile {}`. `expected` is the lowercase SHA256 of the exact existing bytes,
not a Git blob hash. Read the document and obtain its byte hash before editing;
a stale preimage refuses without changing it. Paths are literal home-relative files,
not pathspecs. Replacement preserves supplied UTF-8 text, BOM and line endings;
empty text is valid. Atomic replacement preserves the existing ordinary POSIX rwx
permission bits (not ownership, ACLs or arbitrary metadata). Success returns `{path,commit}`; unchanged text returns the
current commit without creating another. The patch remains an ordinary file, not
a memory entry or journal event.

Only existing tracked regular UTF-8 files qualify. There is no creation, deletion,
file-input, append or diff syntax. Missing/untracked/ignored files, aliases and
unsupported file kinds are refused, not adopted. Immutable source/inbox, published
artifacts and append-only journal/errors cannot be patched. Managed `MEMORY.md`
and `notes/` at global and `projects/<org>[/<project>]/` roots are also excluded from
this ordinary route; use their managed operations. An ordinary path such as
`docs/notes/example.md` is not excluded merely by its name. These extra memory/notes
exclusions do not change explicit maintenance `context restore` compatibility.

All three commands are **home-wide operator routes**, deliberately outside project
membership/default guards, including when called from a scoped Pi. They infer no
project and are not project-scoped authority or an ACL. Use only for the requested
home operation, not as a substitute for guarded project work. Patch uses the same
writer and setup prerequisites as managed writes (including the existing DB).
Status/reconcile do not require or create a DB; they still require accessible home
Git and take the same lock. All three can contact the configured remote. MCP marks
status read-only; patch and reconcile are not read-only.

Status returns `{head,pending,remoteHead,remoteOutcome,needsAttention}`. Reconcile
adds `reconciled`; neither repeats a mutation, commit or push. A missing/unknown
remote observation is not successful publication. Inspect partial `home` details
and status first after a lost response; never replay the write automatically.

## Application API and maintenance boundary

`createHomeWriter(root).run(operation, scope => result)` is synchronous. Its scope
declares exact relative paths and expected SHA256 byte preimages (or null for
absence), records the first effect, acknowledges a committed DB save/request ID,
and records the exact context commit. All initially dirty paths must be explicitly
admitted as source/reference adoption before any effects. Callbacks must preserve
the supported synchronous SQLite transaction boundaries and must not return a
Promise. Pure preflight refusals leave no operation marker; ambiguous failures do.

`status()` observes local HEAD, pending state and the configured destination.
`reconcile()` only clears a publishing-phase marker when the same destination
already confirms that exact commit, local main is clean and the commit's changes
are confined to the declaration with the expected parent (or a no-op commit).
It returns `reconciled: boolean`; it does not append, commit or push. Unchanged
referenced artifacts need not appear in the commit diff. Incomplete mutation/DB
phases, changed destinations and uncertain observations require explicit operator
disposition rather than automatic recovery. The home status/reconcile commands
expose these same observations without opening the DB.

Reads and DB-only project/status/request-touch operations remain usable while home
needs attention. `context commit` and `context restore` remain **uncoordinated
operator maintenance**, with no new automatic push or pending-marker clearing.
Bare `createWorkspace` without a writer scope, raw domain/file/Git APIs, native
edit/write, shell and manual Git are also uncoordinated bypasses. Do not run them
concurrently with the helper. Checked manual completion must include publication
and explicit disposition of any unresolved marker; it is not implicit permission
to delete a marker or adopt unrelated edits. No background recovery, offline
accumulation, force push, settings repair or runtime activation is provided.
