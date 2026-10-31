# Agent-driven manual acceptance through Herdr

Use this guide when the operator asks for live acceptance of a mypi candidate on a
disposable stand: real Claude Code and Pi sessions in a separate Herdr session,
driven by an agent and checked against the stand's own state. The
[engine feature-development workflow](../AGENTS.md#engine-feature-development-workflow)
authorizes clean, recoverable acceptance of an approved feature on its designated
stand. It does not authorize arbitrary resets, control of unrelated sessions or
merge.

The sequence is **clean stand → explicit checklist → real Claude Code/Pi/Herdr
exercise → independent state checks → per-criterion evidence → operator
acceptance**. An agent can execute a manual checklist; that does not make it a CI
test, and the agent's narrative is not an independent oracle.

The working example of an isolated stand is the «Stand» section of
[v2 facts](v2/facts.md#stand): its layout, `bin/env.sh`, isolation rules and
teardown are the reference for the techniques below. This guide names stand paths
and binaries by variables: `$STAND` for the stand root, `$CLAUDE`, `$PI` and
`$HERDR` for absolute agent and Herdr binaries.

## 1. Scope, authority and recorded versions

Follow the [workspace workflow](../AGENTS.md#common-project-workflow) for source
changes and the [testing policy](TESTING.md) for build and test execution. This
guide adds an operator-directed procedure, not another runner, test profile or
exception to mandatory checks.

Before starting, settle and write down:

- the candidate SHA and PR, and the criteria under acceptance;
- the stand path `$STAND`;
- what the agent may drive itself and what the operator does (starting the stand's
  Herdr session, approvals the agent must not give);
- the model budget: the maximum number of model turns for the whole run.

Record in the checklist and in the PR: `$CLAUDE --version`, `$PI --version`,
`$HERDR --version`, `node --version`, the candidate SHA and the model ids used. The
testing policy requires the Claude Code and Pi versions of every manual stand run.

## 2. Boundaries

- Never use the personal database, the personal home, the personal
  `XDG_RUNTIME_DIR`, the operator's own Herdr session or the installed engine.
- Do not change global settings: `~/.claude/settings.json`, `~/.pi/agent/`,
  `mise use -g`. Do not call wrappers that rewrite them (for example a `pi` wrapper
  that runs `mise use -g`); call the absolute binaries.
- `pnpm verify` on the candidate runs only within the `AGENTS.md` limits: 2 CPU,
  1 GiB, 64 tasks, 60 seconds, one suite run on the machine at a time. The live run
  does not replace `verify`, CI or review and does not prove OS isolation.
- Path separation is not a sandbox: global tools and credentials stay reachable
  from the stand's sessions. Use only the agreed services.
- Never print or store secrets, `/proc/*/environ` or `/proc/*/cmdline`.
- A permission request that leads outside the stand is not approved: decline it,
  record it and treat it as a finding.

## 3. Build the disposable stand

Place the stand outside the `projects/` folder of a working installation: Pi applies
the closest saved trust decision, so a checkout under the installation would inherit
its trust (`AGENTS.md`, «Protect the installed engine»).

| Path | Role |
|---|---|
| `$STAND/engine` | clone of the candidate |
| `$STAND/state` | `XDG_STATE_HOME`; the stand database is `$STAND/state/mypi/state.sqlite3` |
| `$STAND/run` | `XDG_RUNTIME_DIR` (`chmod 700`): session records and sockets |
| `$STAND/pi-sessions` | `PI_CODING_AGENT_SESSION_DIR` |
| `$STAND/remote/home.git` | bare remote of the fixture home |
| `$STAND/remote/<project>.git` | bare remote of the fixture project |
| `$STAND/logs` | turn log and evidence |
| `$STAND/bin/env.sh` | the stand environment |

Build the engine from the candidate:

```bash
git clone --branch <PR-branch> https://github.com/yokeloop/mypi.git $STAND/engine
git -C $STAND/engine checkout <SHA>
cd $STAND/engine
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm build
```

`bin/env.sh` follows the `bin/env.sh` of the reference stand and adds the mypi
variables:

```bash
STAND=<stand root>
CLAUDE=<absolute claude binary>
PI=<absolute pi binary>
HERDR=<absolute herdr binary>
NODE=<absolute Node 24 binary>
export STAND CLAUDE PI HERDR
export XDG_STATE_HOME=$STAND/state
export XDG_RUNTIME_DIR=$STAND/run
export PI_CODING_AGENT_SESSION_DIR=$STAND/pi-sessions
export ANTHROPIC_MODEL=claude-haiku-4-5-20251001
export PATH="$(dirname "$NODE"):$(dirname "$HERDR"):$PATH"
hs() { env -u HERDR_ENV -u HERDR_SOCKET_PATH -u HERDR_WORKSPACE_ID -u HERDR_TAB_ID -u HERDR_PANE_ID "$HERDR" --session <stand-session> "$@"; }
mp() { (cd "$STAND/engine" && mise exec -- node dist/src/cli/main.js "$@"); }
```

`mp` is the only way to call the stand's CLI. The tracked `.mcp.json` and the
Claude Code hooks run `node` from PATH, so Node 24 comes first on PATH; `herdr` is
on PATH because `/open` calls it by name.

Fixture home, from `$STAND/engine` with `env.sh` sourced:

```bash
mise exec -- pnpm bootstrap   # the database path in the preview must be inside $STAND/state
git init --bare $STAND/remote/home.git
git -C home add -A && git -C home commit -m "Initialize the fixture home"   # bootstrap leaves home without commits; needs a Git identity
git -C home remote add origin $STAND/remote/home.git
git -C home push -u origin main
```

Fixtures: a fixture project clone with its own bare remote and a `main` branch
(`/open` of a task key creates the task worktree from `origin/main`),
`mp project add <org/project> --code <CODE> --path <clone>`, and tasks created with
`mp task create … --project <org/project>`. Use synthetic data only; keep real data
and existing checkouts out of the fixtures.

`$STAND/engine/.claude/settings.local.json` holds a minimal allow list: only what
the scenarios need beyond the tracked mypi tools of `.claude/settings.json`
(`/open` and `/inbox` call the allowed MCP tools `open_session` and `inbox`). Every
other request then stays a request and is checked.

Check before the first agent starts:

```bash
mp sessions                                                         # empty
mp project list                                                     # the fixtures only
sqlite3 -readonly $STAND/state/mypi/state.sqlite3 'pragma user_version'   # 9
stat -c %a $STAND/run                                               # 700
```

## 4. A separate Herdr session

The operator starts the stand's Herdr session in a terminal outside Herdr, from a
shell with `env.sh` sourced, so that its panes inherit the stand environment:

```bash
source <stand root>/bin/env.sh
$HERDR --session <stand-session>   # that is, herdr --session <stand-session>
```

Every agent command to Herdr goes through `hs`, which unsets the `HERDR_*`
variables of the driving session; the operator's own Herdr session is neither read
nor controlled. In a new stand tab check the environment:

```bash
env | grep -E '^(XDG_STATE_HOME|XDG_RUNTIME_DIR|PI_CODING_AGENT_SESSION_DIR|ANTHROPIC_MODEL)='
```

It must show the stand values. `/open` passes a new tab only `MYPI_SCOPE` and
`XDG_STATE_HOME` (`src/app/launcher.ts:87`); everything else comes from the Herdr
server, so repeat the check in the first tab opened by `/open`. `/open` calls
`herdr` without `--session` and reaches the Herdr session of the pane it runs in:
call it only from sessions inside the stand's Herdr session, never as `mp open`
from the driving agent's own shell.

Before sending input, read the screen and the foreground process of the target
pane. Target an explicit pane id, never the focused pane or a guessed one. Use
finite waits; a stalled prompt or an `unknown` state is not completion.

## 5. Start both agents

Claude Code starts from `$STAND/engine`:

```bash
$CLAUDE --setting-sources project,local --strict-mcp-config --mcp-config $STAND/engine/.mcp.json
```

User hooks, user MCP servers and user `crossSessionInbound` do not apply
([v2 facts](v2/facts.md#stand-layout-and-isolation), «Stand layout and
isolation»). The first start asks for folder trust and for approval of the project
server `mypi`: approve only that server. Check `/mcp` (the `mypi` server from the
stand's `.mcp.json`), `/hooks` (SessionStart, Stop and Notification from
`.claude/settings.json`) and that the first answer sees the warmup of the expected
scope.

Tabs opened by `/open` start the agent through `herdr agent start --kind`
(`src/infrastructure/herdr/herdr.ts:52`) with only the arguments of `launchArgs`
(`src/app/open-session.ts:51-56`): no isolation flags. User Claude settings apply
there, and Pi there loads user extensions. In every such tab check `/mcp` and the
hooks, and record this limitation in the evidence.

Pi starts as `mise exec -- $PI` from `$STAND/engine`, so that `node` on PATH is
Node 24; never through a wrapper that rewrites the global mise configuration. Trust
the project, check that the extension `.pi/extensions/mypi.ts` loaded, that `/mcp`
shows `mypi` connected and that the context holds the `mypi_context` section.

Models: Claude uses `ANTHROPIC_MODEL=claude-haiku-4-5-20251001` from `env.sh`; Pi
uses the lightest available model through its model selection. Record both ids.
The budget is the maximum number of model turns for the whole run, set in the
checklist; log every turn in `$STAND/logs/turns.txt`. Keep prompts trivial and
bounded.

Exit: Claude Code on `ctrl+c` twice; Pi on `ctrl+d` in an empty editor.

## 6. v2 surfaces to drive

| Surface | Action | Independent check |
|---|---|---|
| Scoped warmup | start sessions with `MYPI_SCOPE=global`, `<CODE>` and `<CODE-N>` | `mp warmup -s <key>` matches what the agent sees |
| Session registration | start, resume and quit each agent | `sqlite3 -readonly $STAND/state/mypi/state.sqlite3 "select key, scope_type, agent, native_id from sessions"`; the live record `$XDG_RUNTIME_DIR/mypi/sessions/<key>.json` with mode `600`; `mp sessions` shows the tree |
| `/open <CODE-N>` from the project chat | open, open again, quit the agent, open again | a new tab in the stand's Herdr session (`hs tab list`); the second `/open` focuses the same tab; after the agent quit, `/open` continues its session (`--resume` for Claude, `--session-id` for Pi) |
| Events | a turn end and a wait for input in the task chat | `select id, from_key, to_key, kind, delivered_at from events`; `to_key` is the project code |
| Live delivery | a live project chat: Pi through `$XDG_RUNTIME_DIR/mypi/<key>-<pid>.sock`, Claude through its native inbox socket | `delivered_at` is set and the parent received a turn |
| `/inbox` and the project warmup | `/inbox` in the project chat; a new project session | the shown events are marked delivered; «Новые события» in the warmup |
| Both agents | every scenario where the agent matters | passed with Claude Code and with Pi |

## 7. Write an executable checklist

The checklist header holds the candidate SHA, the versions of section 1, the stand
paths, the budget and the permitted actions. Write it in the operator's language;
this guide stays in English. Each scenario needs:

| Field | Required content |
|---|---|
| Preconditions | Exact starting state, scope, fixture, prior steps and active writers |
| Action | Copyable `mp` command or narrowly scoped agent prompt |
| Expected result | Status or exit code, exact data and required rows, files or events |
| Forbidden effects | What must stay absent or logically unchanged |
| Independent check | Command of section 8 that rereads the state |
| Evidence/result | PASS, FAIL, BLOCKED or NOT RUN, with actual outputs and paths |

State the order of the steps and whether each is one-shot or replay-safe. Use only
returned ids, not guessed ones. On `error`, `partial`, a timeout or a lost
connection, inspect the actual state before retrying; never create compensating
history or normalize data to produce the expected result.

## 8. Verify state independently

Check through separate processes on the stand: `mp` and
`sqlite3 -readonly $STAND/state/mypi/state.sqlite3`, the registry files in
`$XDG_RUNTIME_DIR/mypi/sessions/`, `hs tab list`, `git -C $STAND/engine/home log`
and `git -C $STAND/remote/home.git log`. Take a snapshot before the action and
after it. An MCP answer proves only its own entry point. A no-write criterion is
checked by a logical snapshot, and by bytes when the bytes are the subject of the
scenario. SQLite WAL and SHM files follow the product's contract, not a blanket
"no filesystem change" assertion.

## 9. Close the evidence

Report each criterion with expected and actual results and its evidence, including
partial coverage and driver errors. Keep these categories separate:

1. Build and mandatory automated verification (`verify`) on the candidate.
2. Independent review and CI.
3. Operator-directed live acceptance on the stand.
4. Human acceptance and authorized merge.
5. Installation update, migration, restore and release: separate operations.

Do not mark an unexecuted step PASS or infer rollout permission from a green
checklist. Keep the report outside the fixture history under check.

## 10. Teardown

1. Exit the agents; `pgrep -af "$STAND"` prints nothing.
2. The operator closes the stand's Herdr window; then, with `env.sh` sourced:

   ```bash
   env -u HERDR_ENV -u HERDR_SOCKET_PATH -u HERDR_WORKSPACE_ID -u HERDR_TAB_ID -u HERDR_PANE_ID $HERDR session stop <stand-session>
   env -u HERDR_ENV -u HERDR_SOCKET_PATH -u HERDR_WORKSPACE_ID -u HERDR_TAB_ID -u HERDR_PANE_ID $HERDR session delete <stand-session>
   ```

3. Save the checklist, logs and report outside the stand, then remove `$STAND`.

Records left outside the stand — Claude transcripts in
`~/.claude/projects/<stand-path>/`, the folder-trust entry in `~/.claude.json`, the
Pi project trust — are named in the report and are not removed without a separate
decision of the operator.

## History

The previous edition of this guide described the MP-20 method
([PR #29](https://github.com/yokeloop/mypi/pull/29)) for Pi and the request model;
it remains in the Git history of this file.
