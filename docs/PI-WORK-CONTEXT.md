# Native Pi working context

The shipped `integrations/pi/extensions/mypi.ts` extension uses normal Pi lifecycle,
status and MCP APIs. It does not host an agent, replace the TUI/system prompt, create
requests/worktrees, initialize storage, warm up memory or manage its own sessions.
It requires the engine build; Pi loads the TypeScript extension separately from the
core strict build. No Pi SDK runtime dependency is added to the core.

## Native lifecycle

Context is a versioned `mypi.work-context` custom entry in the **current native
branch**. The last matching entry wins; an invalid last entry does not revive an
older valid one. Startup/resume/reload/fork and tree navigation reconstruct from
`getBranch()`. An absent, invalid or foreign-cwd entry clears the selection and
requests an explicitly unselected MCP configuration. A fork/clone inherits context
only when its native branch actually contains the entry. `/new` remains unselected.
Changing cwd requires a new Pi process; it is never simulated inside the extension.

A launch envelope is used only for a genuinely fresh startup: the native session
file does not exist, there is no parent session, and native entries contain only
model/thinking setup. `session_start` reason `startup` alone is insufficient: it
also opens existing `--session`/continue sessions. Existing files and ambiguous
startup entries never take a launch envelope as a silent fallback. Other extensions
may make freshness ambiguous; the status says so instead of guessing. A malformed
fresh envelope is visibly unselected and is not saved as valid context.

Pi 1.0.4 **does not persist an empty conversation** containing only custom entries.
The selection is available in memory, but closing before a real conversation begins
leaves no resumable file. This native limitation is accepted; there is no persistence
workaround. Once Pi saves an actual conversation, its custom context entry is saved
alongside it. `--no-session` remains ephemeral.

Native status shows the selection (or reason it is unselected) and MCP
`requested/unconfirmed`, never an assertion of active routing. Before an agent turn,
a short `mypi_work_context` prompt section describes the current branch selection,
cwd and ordinary workflow. It does not replace other prompt sections or enforce
write guards. Organization work needs a concrete project/worktree before changes;
base checkouts remain available for study. Supported guards belong to MP-9.

## Application/launcher contract

`src/app/pi-context.ts` has no Pi SDK imports:

- `PiContextData = { version: 1, cwd: string, context: WorkContext }`.
- `parsePiContext(value: unknown): PiContextData | undefined` validates known fields,
  project/organization spellings, selection consistency and absolute normalized paths;
  returns a detached frozen value. A worktree requires a selected project and must
  contain cwd. It does not claim registry membership or verify Git association.
- `encodePiContext(data): string` / `decodePiContext(envelope): PiContextData` use
  canonical base64url UTF-8 JSON. Decode throws `InputError` on malformed/noncanonical
  base64url, invalid UTF-8/JSON or invalid data. Encoding escapes Pi MCP `${...}`/`!`
  environment interpolation; it is neither encryption nor authentication.
- `selectPiContext(branch, cwd)` accepts native root-to-leaf entries and returns
  `{state:'selected',data}` or `{state:'absent'|'invalid'|'cwd-mismatch'}`.
- `PI_CONTEXT_ENTRY` names `mypi.work-context`; `MYPI_PI_CONTEXT` is the launch-only
  environment key. Launcher resolves project/repository/cwd first, then uses this
  codec. It must not set the server-only `MYPI_MCP_CONTEXT` key.

The extension does not rewrite a resumed session to match a conflicting launch
selection. Resume in the correct working directory or start a genuinely new process
and session with the desired selection. No automatic context switch or extra command
framework is provided.

## Terminal launcher

After building once, use `mypi pi` (or `mise exec -- pnpm pi` from the engine):

```sh
mypi pi --project org/project
mypi pi --project org/project --base /clones/project --cwd /clones/project--task
mypi pi --org org --cwd /clones
mypi pi --unrestricted
mypi pi -- --help
mypi pi --project org/project --cwd /clones/project--task -- --continue
```

`--project`, `--org` and `--unrestricted` are mutually exclusive. Without one,
context is **unselected**, not inferred from cwd and not implicitly unrestricted.
Launcher options cannot repeat. Everything after the first `--` is passed unchanged
to native Pi (including its help, session, tool and resource options).

Project/organization selection requires an existing registry and validates membership.
A project's base is `--base` or its registered checkout path; default cwd is that
**chosen base**. `--base` requires `--project`. It explicitly associates an existing
independent clone with the registration; neither its remote/name nor registry path
proves ownership. Existing repository checks verify the chosen base and cwd share
Git metadata and exact worktree membership and do not use installed engine metadata.
Project `--cwd` must be an existing checkout/worktree **root**, not a subdirectory;
locked/detached/unavailable bindings are refused. No directory, branch or worktree
is created or repaired. Base checkout is available for study; MP-9 supplies supported
write guards/workspace preparation, not this launcher.

Organization, unrestricted and unselected starts use the current directory unless
`--cwd` selects another existing directory. Paths are canonicalized; unselected and
unrestricted launch do not open or initialize the DB. Organization context does not
silently select one of its projects. Choose a concrete project/worktree for changes.

The launcher runs installed `pi` from PATH without a shell, inherits terminal IO and
native exit status, and forwards termination signals. It explicitly loads the shipped
extension by its package-relative absolute path, without copying resources or changing
user/global settings. The package alias invokes already-built mypi; it does not build,
bootstrap or migrate. Normal native tools, TUI, history and user overrides remain Pi's.
Native Pi may save its own sessions/settings as usual; this is not an isolation layer.
Unselected launch clears inherited launch context; selected launch uses the shared
codec above, never the server-only environment key. A resumed branch remains authority
even if launcher selection differs. Changing cwd means starting another process.

## MCP composition and limitations

Each lifecycle selection requests the existing `mypi` registration with an immutable
`MYPI_MCP_CONTEXT` envelope. Empty string explicitly clears the selection, overriding
any inherited stale environment. Missing env in standalone MCP preserves legacy
behavior; every other malformed envelope fails startup. The existing `createServer`
receives the decoded `WorkContext` once, not a mutable reference to Pi state.

Pi owns connection/reconnection/shutdown. Re-registering changes the extension's
requested server, never the context captured by already-running server operations.
Native replacement may terminate/cancel a connection; no drain/rollback guarantee is
added. Inspect unknown write outcomes before retrying. A same-name user MCP entry,
including `enabled:false`, takes precedence. No user/global configuration is rewritten.
The public registration API exposes no effective connection/override confirmation,
so status stays unconfirmed even after registration returns. Use native `/mcp` for
actual connection diagnostics; registration failures are shown as errors. There is
no invented acknowledgement protocol, broker or security boundary.

## Acceptance evidence boundary

Parent-executed disposable Pi 1.0.4 RPC probes established native extension loading,
status requests, in-memory custom entries and orderly shutdown. The original no-model
probe established empty-session non-durability. One separately authorized real
provider turn established genuine custom-entry persistence and a no-prompt reopen.
No additional provider calls are part of the product test suite.

A subsequent parent-executed, network-free native RPC smoke loaded the actual built
candidate extension and sibling module. It observed fresh entry/status/registration,
33 connected MCP tools and native reconnect, reload retention, new/missing-entry
clearing, tree clearing/restoration, clone inheritance, and an earlier-user fork
correctly **excluding** the later product context. Separate `--session` startup
ignored conflicting launch context; a disabled user override stayed unchanged and
native MCP reported it disabled/overridden with no mypi tools. Context added to the
genuine disposable conversation through public `appendEntry` was fixture setup,
not launcher behavior or evidence of selected-context fork inheritance.

A separate parent-executed, network-free launcher PTY probe exercised the actual
built CLI and installed Pi: native help without a DB, native parser error exit 1,
project status in rendered terminal output, raw editor input without submitting a
prompt, and empty-editor Ctrl-D exit 0. The actual Pi child executable/cwd were
observed. SIGTERM sent only to the launcher reached Pi's graceful shutdown (native
exit 0); the Pi child was gone after both exits. This is rendered-output evidence,
not a full terminal-emulator screenshot or proof of arbitrary descendant cleanup or
abnormal-signal behavior. No provider call was made by the launcher probe.

Earlier probe revisions incorrectly expected a signal exit and then encountered
native first-start changelog bookkeeping; neither was a product regression failure.
The final probe preseeded the current changelog version and confirmed unchanged
registry, settings, MCP override, base HEAD and selected source hashes. Pi still owns
its ordinary session/settings writes. Prompt-section injection remains source-inspected;
no in-flight operation/drain behavior was exercised. Strict build and pure tables do
not substitute for these native observations.
