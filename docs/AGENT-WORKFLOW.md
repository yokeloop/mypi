# Agent workflow withdrawal

The former mandatory mypi agent workflow was withdrawn at the user's explicit
request during the emergency correction on 2026-10-06.

Project resolution, memory warmup, request registration, outcome logging and
separate Herdr tabs are no longer prerequisites for agent work. No automatic
session routing or delegation policy is installed by this repository.

The CLI and MCP tools remain available for explicit use. Their data contracts,
existing requests, history, context files and published artifacts are unchanged.
[AGENTS.md](../AGENTS.md) contains the remaining repository development guidance;
[MCP.md](MCP.md) and [M1-CLI.md](M1-CLI.md) document optional APIs.

Earlier MP-1/MP-4/MP-5 instructions and reports are historical. Their presence in
Git, an old branch, a request artifact or a conversation does not reinstate the
withdrawn workflow. Existing sessions may retain already loaded instructions;
reload/reconnect or start a fresh session after changing the installation.
