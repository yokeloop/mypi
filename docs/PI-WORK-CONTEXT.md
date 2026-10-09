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
write guards itself. Organization work needs a concrete project/worktree before changes;
base checkouts remain available for study. The supported native hook below handles write/edit.

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
is created or repaired. Base checkout is available for study; the native hook supplies
supported write guards, not this launcher.

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

## Cooperative native write/edit guards

The `tool_call` hook reads the **current branch selection on every call**. It does
not replace tools. With a scoped selection it observes real local Git metadata,
primary base identity and exact usable worktree membership. Directory names, remote
URLs and lexical installation descendants do not establish repository identity.
The selected project association comes from MP-8 launch selection, not a new DB
lookup in this hook. This is cooperative guidance, not authentication of branch entries.

| Condition | Response |
| --- | --- |
| Valid selected task, target inside it (even task nested under base) | Allow |
| Selected primary/base checkout | `baseCheckoutWrite` |
| Task selected, target outside task but inside its observed base | `baseCheckoutWrite` |
| Other target, or scoped missing/unusable worktree/path observation | `outsideWorktreeWrite` |
| Absent/invalid/cwd-mismatch selection | Ordinary unselected Pi; existing context warning |
| Unrestricted selection | No project path restriction |
| Read/search or tools other than native `write`/`edit` | No path guard |

For Linux Pi 1.0.4 the adapter matches write/edit path spelling: leading `@`, `~`
and `~/`, `file://` URLs, and Pi's Unicode-space normalization. It then canonicalizes
the existing target or nearest existing ancestor of a new path, following ordinary
symlinks. Dangling links or unavailable observations yield the configured unusable
response. No race, mount or hardlink containment is promised.

Set optional **absolute file path** `MYPI_GUARD_POLICY=/path/to/policy.yaml` in the
launch environment to select MP-7 YAML version 2. With no selector all three guards
default to `block`. `warn` displays a native warning and permits the operation;
`block` returns a tool-call refusal with guidance. Empty/relative/missing/invalid
explicit configuration never falls back: native setup reports an error and blocks
write/edit even in unselected/unrestricted mode, leaving reads and other tools usable.
Fix the file/selector and reload. Policy is loaded once at extension setup; native
`/reload` re-reads it. Scoped application/MCP membership checks use the same selector:
see the [supported/default/unguarded command table](MCP.md#cooperative-application-membership-and-defaults).
MCP loads once per scoped consumer setup (restart/reconnect to re-read), independently
of Pi's loaded policy; direct contextual application/CLI dispatch loads per covered
command. Invalid application policy fails covered calls, not discovery/unguarded calls;
no-context/unrestricted application calls retain ordinary behavior. The absolute selector is inherited normally, not added to the
context codec. There is no watcher, atomic revision or confirmation protocol; a user
MCP override may provide a different environment.

Pi 1.0.4 documents nested `ctx.executeTool` calls (including codemode orchestration)
as passing through the same tool-call hook. Only nested calls actually dispatched to
native write/edit are covered, not arbitrary foreign MCP IO. Shell, direct custom-tool
IO, normal Git, disabled extensions, later input-changing extensions and user overrides
remain outside this guidance. This is not a sandbox or concurrent home-write guarantee.

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

For MP-9, a separately authorized parent-executed Pi 1.0.4 RPC probe used exactly one
real provider request to invoke a disposable orchestration tool. Its genuine
`ExtensionToolContext.executeTool` calls exercised the actual candidate hook: own
write and edit produced the expected bytes; a base edit was refused with unchanged
bytes; `@~/` foreign and ordinary-symlink writes were refused with absent targets.
Refusals included the specific mypi diagnostics, not merely arbitrary tool errors.
The driver independently rechecked file effects and unchanged base HEAD. The fixture
aborted the active turn and returned `terminate: true`; one request callback, one
HTTP 200 response, one invocation/turn, settled state and normal shutdown were
observed, with no retry or follow-up provider request. Source/build/fixture hashes
stayed unchanged and the parent removed the disposable credential copy.

This bounded native probe complements the 27 fast and 17 boundary checks; it is not
part of the network-free product suite, rendered-TUI evidence or adversarial
containment. Other spelling/policy cases have core-table coverage, not additional
native smoke claims. Command contexts and RPC have no public tool-execution API:
the abandoned no-model command proposal was not executed or counted as acceptance.
No further provider request is authorized by this evidence.
