# MP-6: credential-free Linux command boundary

## Decision and scope

Candidate base: `52434fdacc29fdfe0ca07b399a845bb85b07dda5`. Runtime acceptance
requires the parent-owned build/verify and sensitivity evidence below; the design
alone is not acceptance. Dependent scoped-session work must stop if essential
namespace, credential separation or cleanup proof fails.

`src/infrastructure/execution/linux-sandbox.ts` implements one infrastructure
adapter: trusted configuration selects one owned workspace and immutable toolchain;
`run({ argv, stdin? })` returns bounded output and host-observed termination. No
CLI, MCP, DB, session runtime, dependency, installed integration, or test-runner
change is included. This is **not protection for stock Pi plus `mypi.ts`**.

## Boundary and preparation

The trusted caller supplies a canonical workspace, an absolute trusted bubblewrap
executable, an absolute trusted Node executable, explicit credential-free OS
runtime trees (`/usr`, `/lib`, `/lib64`), a deadline and a combined output bound.
These values are copied at construction; requests cannot select mounts, bwrap
flags, host environment, descriptors or host working directory. Node is mounted
at `/toolchain/node`, the writable workspace at `/workspace`. Toolchain reads are
read-only; they are not a host-root bind. No foreign checkout/common Git directory,
personal home, credential file, socket directory or host `/proc` is mounted.

Preparation is a trusted operation, not implemented as a model tool:

- Use an exclusively owned, disposable workspace. Do not bind a live checkout
  containing credentials, sockets, device nodes, external bind mounts or shared
  data. Copy selected content rather than sharing hardlinks. The preflight rejects
  multiply-linked regular files and special files outside masked Git metadata,
  but is not a concurrent filesystem adversary defense or mount inventory.
- Supply a `.git` placeholder, even for a non-Git workspace. Existing `.git`
  directories are covered with empty read-only mounts; `.git` files with a
  read-only `/dev/null` bind (empty or unreadable on nodev mounts). Nested metadata
  is masked too; metadata symlinks fail
  closed. These mountpoints cannot be renamed/unlinked by the command. Git
  publication/commit authority remains outside the child.
- Workspace symlinks are not followed by host helpers. They resolve against the
  isolated filesystem; a link to an unmounted foreign path cannot grant access.
  An existing hardlink is different: it already aliases an inode, so trusted
  preparation and the preflight prohibition are essential.
- No concurrent host writers, path replacement, toolchain updates or mount
  changes during validation/execution. Trusted paths and ancestors must remain
  controlled. Canonical path checks alone cannot enforce these assumptions.
- Audit runtime trees before trusting them: “read-only” does not make secrets or
  authority sockets safe to disclose. Do not use project-writable Node/bwrap or
  toolchain installations. The caller itself stays trusted.

Bubblewrap creates user, mount, PID, network, IPC and UTS namespaces, disables
further user namespaces, drops all capabilities, starts a new terminal session,
clears the environment and receives only new stdio pipes plus a diagnostic pipe.
The child gets private HOME/cache/tmp and minimal proc/dev. No provider or SSH
variables are forwarded. Root is remounted read-only. Missing facilities and
invalid preparation fail closed; there is no host execution fallback.

A small immutable Node PID1 shim spawns the requested command with descriptors
0/1/2 only. On command termination it exits; Linux then kills all remaining PID
namespace members, including descendants not in the original process group.
On timeout/output overflow the host kills bubblewrap; `--die-with-parent` kills
PID1 and its namespace. Completion waits for the actual subprocess `close` event,
not a child-supplied success message. Output is bounded jointly, stdin and argv
are bounded, and diagnostic input has a separate 1 KiB bound. The deadline is a
host event-loop timer; this adapter is not a cgroup CPU/memory/task quota manager
or a defense against kernel failure. The accepted external test resource limits
remain unchanged and are required for the fixture.

### Outcome integrity

`exited` reports the observed bubblewrap exit (including ordinary command failure).
`launch-failed` means host-side validation/spawn failed. `indeterminate` includes
sandbox setup failure, missing/malformed/inconsistent status, abnormal termination
and reported command spawn errors. It is not permission to retry. Deadline and
output-limit outcomes may have partial workspace effects.

The shim's fd3 report is **untrusted diagnostics**, not authenticated execution
attestation: assume same-uid code might access it through sandbox `/proc/1/fd/3`
(this is a conservative trust assumption, not a demonstrated attack). Reports must
contain exactly one recognized own key with a valid value; contradictory reports
are indeterminate. The channel conveys
no credential, host-read, publication or provider authority. It never replaces a
host-observed nonzero status/signal/timeout with success. No result establishes
that arbitrary command content was benign or did not perform effects. A missing
command's diagnostic alone does not prove “never executed” or safe-to-retry.

## Provider and Pi placement: future MP-8/9 contract

Pi 1.0.4's installed `docs/sdk.md` and `docs/security.md` were inspected. The SDK
factory otherwise supplies default discovery, settings, credentials and tools;
its `cwd` is not an access boundary. Pi's own security documentation explicitly
distinguishes tool-only isolation from isolating the entire agent.

Keep Pi `ModelRuntime`, provider credentials and provider networking in a trusted
host control plane. Send only authorized command arguments/input and bounded
results over stdio. Do not pass credentials or arbitrary host reads, build a new
socket broker/provider proxy, or put an unrestricted Pi inside the child and
then return networking/credentials to it.

MP-8/9 must use a launcher-owned SDK `ResourceLoader`, explicit settings and sealed
tools, not a removable extension. Every reachable effect, including nested
codemode calls, deferred tools and user bash, must route through guarded execution
or separately authorized gateways. Deny unknown effectful MCP/tools and executable
resource discovery from writable projects (extensions, settings/packages and
startup hooks). Reload/session replacement must reconstruct the sealed set or
stop; it must not restore stock host tools. Any trusted control-plane extension
still has host authority and must be explicitly audited. MP-6 implements none of
this session wiring and cannot yet claim protected model sessions.

## Minimal verification and evidence

The single boundary fixture is necessary because in-process mocks cannot prove
Linux mounts/namespaces or descendant lifetime. Existing tests did not exercise
this boundary. It creates disposable A/B workspaces, synthetic file/environment
credentials, an authority-path marker, shared Git marker, protected Git directory
and nested Git pointer. Parent-side positive reads prove the outer runner alone
cannot explain child denials. Real Node reads/edits A, consumes stdin and checks
an exact tiny build artifact. Direct/symlink foreign access, Git modification,
credential inheritance, host-process roots and writable toolchain access are
rejected, and external bytes are checked unchanged. HOME/tmp and PID/net/mount/
user/IPC isolation are observed without any socket/network call. Synchronized
live descendants exercise normal exit and deadline cleanup without sleeps or
detached processes. Missing executable, invalid configuration, failed loader
startup, ordinary nonzero exit and output truncation are checked.

Parent-owned commands: `mise exec -- pnpm build`, then `mise exec -- pnpm verify`
through the unchanged existing systemd/bubblewrap runner. Parent also performs a
single disposable sensitivity mutation exposing foreign B and requires failure
at the foreign-access assertion, not setup. Initial parent check on base plus the
three added files: build passed; verify reached the real inner canary but stopped
on `EACCES` reading the nested Git-file mask. The initial oracle incorrectly
required empty bytes; it now accepts only empty bytes or `EACCES`, while still
requiring denied writes and unchanged original metadata. No remaining assertions
or sensitivity were established by that first run. Facilities reported by parent:
Linux `7.2.5-3-omarchy`, bubblewrap `0.12.0`, Node `24.21.0`.

Parent's r1 build/verify passed: 14 fast + 16 boundary checks, no skips, wall
8642 ms, fast 150 ms, peak memory 433074176 bytes, peak tasks 50, new canary about
1000 ms. The disposable sensitivity copy added only a writable bind of sibling B
at its original absolute path. Mutant build passed; verify failed exactly at
`Missing expected exception: foreign read must be denied: .../B/data`; the other
29 checks passed. The candidate was untouched. Evidence logs:
`mp6-r1-build.log`, `mp6-r1-verify.log`, `mp6-sensitivity-build.log`,
`mp6-sensitivity-verify.log`, and `mp6-sensitivity.patch` in the parent's
`/tmp/mypi-scoped-epic-20261008/` collection, also preserved as immutable MP-6
`execution/` request artifacts.

A subsequent self-review tightened diagnostic parsing to reject contradictory
objects (exactly one recognized own key). No mount or fixture change was needed.
Parent's refined r2 build/verify both passed: 14 fast + 16 boundary checks, no
skips/failures; wall 8599 ms, fast 149 ms, peak memory 433344512 bytes, peak tasks
50. Logs: `mp6-r2-build.log` and `mp6-r2-verify.log` in the same collections.
The tested candidate was the base revision above plus these three new files;
source SHA-256: `e77acbe3e0538e73f4599728c4efb2b47617de43287eff37b44a6435eb01e65d`,
fixture SHA-256: `cf2413e9584d23eb8e4e576a6c9c593c6936ae086cb463edd316e66e40511936`.
The published implementation revision is recorded in the component handoff; the
source/fixture bytes were frozen between this check and publication. No separate
parser-specific sensitivity test is claimed. This establishes the minimal Linux
execution feasibility on the stated facilities, not independent review or final
scoped-session acceptance. No live Pi/model/network call or personal storage
activation is part of acceptance. Interactive Pi,
codemode and reload observations remain MP-8/9 requirements, not a waiver for
missing critical OS proof here.
