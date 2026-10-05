# MP-5 A1 — resource and launch contract

Status: implementation design under the engineer-approved A1 plan. This document is
not evidence of deployed enforcement. Only the disposable prototype has been exercised.
Product source changes await the agreed committed baseline incorporating MP-1/MP-4.
The current task session and its real MCP connections remain outside the proposed boundary.

## 1. Authority

- The engineer chooses/delegates the flow and authorizes launch. `/task` creates a card
  only. A model-created flow definition cannot create a grant or broaden an existing one.
- A trusted local component binds the authenticated connection to one request/run,
  workspace, session and resource set. Client-supplied project/request IDs, paths,
  `approved=true`, transcript messages and terminal titles are not authority.
- Discover registered project paths, Git baseline and current Herdr IDs at action time;
  do not introduce manual configuration for facts that can be derived and verified.
- Persist enough authoritative run state to reconcile partial effects, revoke rights
  and refuse duplicate live launches. Exact SQL/API design belongs to implementation
  after baseline reconciliation; this is not a second status database in Markdown.

## 2. Visible local resources

| Resource | Worker access | Trusted-side invariant |
|---|---|---|
| Assigned task worktree files | Useful read/write/edit/bash/codemode operations | Exact approved worktree and baseline; not another checkout or another task's working tree |
| Selected task/project context | Read; mutations through scoped mypi operations where authorized | Only task artifacts and permitted inherited context; no full shared `home/`, DB or global inbox |
| Runtime dependencies | Read-only pinned runtime and required OS/tool resources | Reviewed installation/image, not a bind of the user's home or global Pi configuration |
| Session and scratch files | Private read/write | Belong to this run; transcript is not a grant or task acceptance record |
| Reference checkouts | Only explicitly granted read-only reference resources | Never implicitly mount an entire checkout containing unrelated dirty/private files |
| Git metadata and credentials | No direct shared host access | Useful Git operations are mediated for the assigned worktree; no broad `.git`, SSH agent or auth files |
| Host control interfaces | None | No Herdr, systemd/D-Bus, container-manager sockets, host `/proc`, host device tree or other sessions |

The boundary is resources, not tool removal. A planning worker still needs useful tools
for authorized task artifacts. Implementation permission remains a separate assignment
gate; disabling shell/edit or all extensions is not the protection mechanism.

Path safety includes more than lexical `..` rejection. Before granting access, validate
resolved resource identity and mount ownership. A writable hardlink to an out-of-scope
inode must not become writable through the worktree. Symlinks, nested Git metadata,
path replacement and concurrent mutation must not bypass the grant. Unsafe layouts
must be rejected or materialized into a safe task-owned representation before use;
do not assume a pre-launch path check eliminates runtime races. The concrete adapter
must be proven with positive and negative cases before claiming this invariant.

## 3. Terminal boundary and process ownership

Launch/control must use Herdr. In the tested candidate, a command submitted through
Herdr starts a dedicated systemd service with its own PTY, then namespace-isolated Pi.
The trusted host component owns setup and cleanup; worker-controlled code never gets
an ordinary host-shell API or the service-manager socket.

The prototype found that layering `bwrap --new-session` over the service PTY detached
Pi from resize signals. PTY width changed but the renderer stayed at its old width.
Reacquiring that PTY with `setsid --ctty` failed with EPERM. The working candidate
preserves the dedicated service terminal session/process group instead:

1. Establish the dedicated service PTY outside worker control.
2. Verify it is a different terminal device/session from the Herdr host shell.
3. Preserve its terminal session through bwrap; retain mount/PID/network/user namespace
   separation, dropped capabilities, NoNewPrivileges, cgroup limits and reaping.
4. Do not reuse this launch shape with an ordinary inherited host-shell PTY. The
   prototype's caller-supplied numeric comparison is test instrumentation, not a
   production authorization API; the trusted launcher must establish the binding.
5. Verify actual PTY dimensions and Pi-renderer width, not just screenshots or `isTTY`.

Observed fixture transition: 188 → 113 → 188 columns for both PTY and renderer,
with SIGWINCH delivered. Selected file/API denials and useful tools still passed.
This does not prove all terminal attacks (including terminal escape/control protocols)
are safe; independent review of the replacement boundary is still required.

A run owns a service/cgroup independently of Herdr's foreground-agent heuristic.
`unknown`/`idle`, a closed tab, exit 0 or a footer marker never establish acceptance.
Stopping must revoke external grants and terminate/reconcile the owned process group.
Signal observations so far cover normal Pi exit/keyboard exit, a real deadline-triggered
TERM and an explicit KILL of the service's main process. Observed descendants were
cleaned up. Routine manager-stop, host crash recovery and grant revocation were not
all independently verified and must not be inferred from those cases.

## 4. External resources

| Adapter | Permit | Deny/mediate |
|---|---|---|
| mypi | Authorized request card/history/artifacts and selected project/inherited memory | Foreign scope/path, journal-all, arbitrary `TextInput.file` host path, direct DB access, unauthorized bootstrap/restore/status administration |
| Derive | Authorized report templates, task-linked artifact IDs, permitted publication/version/comment operations | Workspace-wide bearer tokens, arbitrary `derive_code`, unrestricted uploads/capability URLs, unrelated artifact/resource IDs |
| Git/PR | Authorized worktree status/diff/commit and explicitly authorized repository/branch delivery | Shared metadata access; host execution of worktree hooks/config/filters; merge against a revision other than the approved one |
| Provider | Bounded configured-provider requests and streaming through a specific channel | Real refresh/access credentials in the worker; generic HTTP/CONNECT proxy; silent provider changes |
| Herdr | Trusted orchestration for this run's actual topology | Arbitrary worker `pane.run`, another pane/session, full socket access |

A listener/run credential is bound to resources on the trusted side. Every nested tool
call and MCP resource operation must receive the same authorization checks as direct
calls. Tool schemas, exposure flags and client-provided scopes are not ACLs.
No unrestricted network/host-localhost path may bypass these adapters.

Provider compatibility (including OAuth refresh/abort) remains a separate integration
risk. Fixtures do not establish it; live paid probes still need explicit conditions and
cost authorization. Dependency installation likewise needs an authorized scoped channel,
not an emergency broad-network fallback.

## 5. Readiness, partial effects and recovery

A fresh run is ready only after independent launch-boundary verification and matching
Pi session identity. Distinguish an allocated session ID from a persisted transcript:
slash-only activity did not materialize a session file in the observed Pi version.

Readiness observations must be tied to the current attempt. Do not consume stale
`ready.json`, an old transcript marker, or a marker merely echoed in a shell command.
The prototype now removes its old ready file; a production handshake requires stronger
attempt/connection ownership. Shell control commands must disable pagers and fail
closed on readiness errors. Verify actual state after sending a signal.

After timeout/connection loss, inspect the owned service, cgroup, session, worktree and
external-operation receipts. Do not blindly create a second run or retry an append.
A dead service can leave a Unix socket pathname; the prototype observed this and only
removed it after verifying cleanup. Existence of a path is not proof of a live server.
A simple InvocationID comparison is useful diagnostic protection, not a proof of atomic
stop authorization against arbitrary concurrent actors or unit-name reuse.

## 6. Remaining product verification

Use the accepted TESTING.md policy and preserve the resource limits. Extend cheap
component tables for grants/path/resource rules; reserve real process checks for
terminal, namespace, cgroup, Git and restart boundaries that cannot be mocked.

Required cases include useful in-scope operations plus hardlink/symlink/path races,
mutable worker configuration, `/proc`/socket/network escapes, foreign MCP resources,
valid-scope forbidden operations, revocation, cross-run credential substitution,
Git hooks/config/filters, spoofed approvals, stale readiness, duplicate/partial launch
and abnormal cleanup. A positive-and-negative fixture pair is not the entire suite.

No independent test-diff or security review has yet been performed. Do not label
self-review, this contract or a passing prototype as independent acceptance.
