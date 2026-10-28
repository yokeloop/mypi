# Agent workflow withdrawal

The former mandatory mypi agent workflow was withdrawn at the user's explicit
request during the emergency correction on 2026-10-06.

The old mandatory project resolution, MCP warmup, request registration, outcome
logging and separate Herdr tabs are not prerequisites for agent work. `mypi warmup`
prints scoped context on request; Pi CLI autoload of it is paused until the Pi
integration adopts the text warmup. Neither registers tasks, logs outcomes or
authorizes work. Approved mypi engine features follow the
[engine feature-development workflow](../AGENTS.md#engine-feature-development-workflow),
not the withdrawn universal task/session automation.

Current source-development rules are maintained separately in the
[common project workflow](../AGENTS.md#common-project-workflow), including the
installed engine's development boundary. That Git/worktree policy does not restore
the withdrawn task/session automation or implement a flow runner.

The CLI and MCP tools remain available for explicit use. Their data contracts
(except warmup, which now prints Markdown instead of JSON), existing requests,
history, context files and published artifacts are unchanged.
[AGENTS.md](../AGENTS.md) contains the remaining repository development guidance;
[MCP.md](MCP.md) and [M1-CLI.md](M1-CLI.md) document optional APIs.

Earlier MP-1/MP-4/MP-5 instructions and reports are historical. Their presence in
Git, an old branch, a request artifact or a conversation does not reinstate the
withdrawn workflow. Existing sessions may retain already loaded instructions;
reload/reconnect or start a fresh session after changing the installation.
