# MP-5 A1 — offline feasibility prototype

This is disposable experimental code, **not a product launcher, alternate test suite,
or production authorization boundary**. Do not install it globally or accept untrusted
launcher arguments. The implementation plan is approved and proceeds on the current
MP-5 branch, independently of other tasks. See [status](../../docs/MP-5-STATUS.md) and the
[resource contract](../../docs/MP-5-RESOURCE-CONTRACT.md).

## Scope and prerequisites

The prototype exercises standard interactive Pi behind Herdr → systemd PTY → nested
bubblewrap. Native tools, Pi's dispatcher/codemode/MCP pipeline, PTY and namespaces are
real; external resources and provider responses are fixtures. It performs no real model
inference or external trial writes and needs no real credentials.

Observed versions: Pi 1.0.0, Node 24.21.0, Herdr 0.8.2/protocol 20, bubblewrap 0.12.0,
systemd 261.2 with the user manager, cgroup v2 and unprivileged user namespaces.
Use the pinned Pi binary directly, not a wrapper that modifies global configuration.
No runtime dependencies are vendored or installed by this experiment.

## Files

- `run.sh`: trusted-caller fixture setup and two namespace layers under a bounded
  systemd PTY. The worker sees its writable `/work`, private agent/session storage,
  read-only `/context`, pinned runtime and one fixture API Unix socket. No host home,
  shared `.git`, real credentials, Herdr or systemd socket is mounted inside Pi.
- `probe.ts`: native-helper assertions, fixture API checks, PTY/renderer measurements,
  session metadata and a harmless long-lived child cleanup canary. Direct helper calls
  alone do not prove the actual model/tool-dispatch path.
- `offline-provider.ts`: a deterministic two-response protocol fixture, **not an LLM**.
  Its predefined codemode call exercises the actual Pi dispatcher and MCP client.
- `server.mjs` / `bridge.mjs`: fixed-request MCP fixture and stdio–Unix bridge, not a
  production mypi/Derive adapter. Client-supplied scope never creates a grant.

## Launch requirements

Read `docs/TESTING.md` and load the installed Herdr skill before control. Discover fresh
pane IDs and shell TTY identity. Launch only through an owned Herdr pane, under the
exclusive `mypi-tests.service` with:

- `--pty --wait --collect`; a distinct service PTY/session, not the host-shell PTY;
- `CPUQuota=200%`, `MemoryMax=1G`, `MemorySwapMax=0`, `TasksMax=64`;
- `RuntimeMaxSec=55s`, `TimeoutStopSec=5s`, `KillMode=control-group`;
- `OOMPolicy=kill`, `NoNewPrivileges=yes`.

The trusted command inside that service is:

```text
bash <experiment>/run.sh host <experiment> <new-empty-run-directory> <pinned-pi-directory> <pinned-node-binary> <herdr-shell-tty-device>
```

All paths and the decimal TTY device are supplied by the trusted caller, never by the
worker. The empty run directory must already exist. `resume` replaces `host` only after
reconciling the previous attempt and removing a stale socket after verified cleanup.
Do not stop a service belonging to another run to obtain the unit name. No unbounded
fallback is permitted if the required environment or limits are unavailable.

After fresh readiness, commands inside Pi are `/mp5-probe`, `/mp5-pipeline`, and
`/mp5-size initial|split|restored`. `/mp5-arm-child` starts a cleanup canary;
`/mp5-finish` starts one and exits. Inspect actual result files, not just exit 0 or an
old terminal marker. Bind every observation and control operation to the current run.
The offline provider permits one two-response pipeline per Pi process.

Capture service/cgroup results, foreign/read-only canaries and session evidence before
removing the disposable tree. Verify descendant cleanup, then close only the owned
experimental panes through Herdr. An interrupted process can leave a socket pathname.

## Evidence and limits

Raw terminal/session traces, publication receipts and the detailed private report are
preserved in the managed MP-5 request context, not in this public repository. Public
findings and evidence artifact names are in `docs/MP-5-STATUS.md`. Do not manufacture
missing traces or interpret their omission from Git as a claim of independent review.

Full adversarial isolation, production grants/revocation, credential/provider streaming,
Git mediation and approval authenticity are unimplemented. The ordinary MP-5 task
session itself is not sandboxed. This prototype is not wired into the product test
profiles; its measured, bounded runs do not replace mandatory product verification.
