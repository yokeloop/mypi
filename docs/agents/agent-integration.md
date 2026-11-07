# Claude Code and Pi integration

Read when: starting, configuring or diagnosing Claude Code or Pi in this checkout — hooks, the Pi extension, MCP registration, the allow list, skills, personal agent settings.

## Pi

- After project trust, Pi started in this checkout loads `.pi/extensions/mypi.ts`
  (the entry point; its logic lives in `.pi/extensions/mypi-lib/`, which Pi does not
  load as a separate extension) and the skills in `.pi/skills`. Start with `mise exec -- pi` so `node` on PATH is
  Node 24; the extension needs a built engine (`mise exec -- pnpm build`). At each
  session start it registers the `mypi` MCP server with the session id in
  `PI_SESSION_ID` and runs `mypi warmup`; it first registers the session
  (`mypi session register --agent pi`) and passes the registered key to the
  warmup, and unregisters the process when Pi quits; the output is the
  `mypi_context` system-prompt section of every turn. It also appends one codemode
  tool guideline to every turn: `searchTools()`, `describeTool()` and
  `describeNamespace()` return Promises and must be awaited; Pi shows it in the
  prompt rules only while codemode is active. The key is the one saved for
  this conversation, else `MYPI_SCOPE`, else `global`.
  It also registers the /open command (`/open <key...> [--message text]`, the
  rest of the line after --message is the text), which runs mypi open
  and suggests keys while its arguments are typed (the session's project and its
  open tasks in a project or task chat, the organization's projects and their open
  tasks in an organization chat, all projects and open tasks in the main chat; loaded through the CLI and reused for 15 s; none for flags or after
  --message), and the /inbox command, which runs the inbox skill as /skill:inbox.
  A same-name server in a Pi `mcp.json` overrides the registration, including
  `enabled: false`; `pi -ne` starts without extensions. Shell `pi mcp list` does
  not load extension servers. After updating/rebuilding, reload or restart Pi.
  Inspect diagnostics before claiming an integration works.

## Claude Code

- Start `claude` in the engine root after `mise exec -- pnpm build`. The tracked
  `.mcp.json` starts the `mypi` MCP server with `node dist/src/mcp/main.js`; Claude
  asks once to approve this project server. The tracked `.claude/settings.json`
  allows exactly the mypi MCP tools and runs one SessionStart command on every
  source (startup, resume, clear, compact, fork): `mypi session register --agent
  claude --hook` (its output is discarded, its failure does not stop the warmup),
  then `mypi warmup --max-chars 9500`, so each session starts with its scoped
  context: the key saved for this conversation, else `MYPI_SCOPE`, else `global`.
  The budget keeps the hook
  under Claude Code's 10,000-character limit for hook output. The Stop hook runs
  `mypi turn end` and the Notification hook, for `permission_prompt` and
  `elicitation_dialog`, runs `mypi event emit --waiting --hook`; both create an
  event only when the current turn was started by a parent message (`turnOrigin`
  `peer` with the mypi parent-message frame in the transcript), and discard their
  output.
- When the MCP tool list changes, update the allow list in the same change; a fast
  test compares them. Do not add `enableAllProjectMcpServers`,
  `enabledMcpjsonServers` or `crossSessionInbound` to the tracked settings: project
  settings can only tighten cross-session delivery, so `accept` there changes nothing.
- Personal Claude settings belong in the ignored `.claude/settings.local.json` or in
  user settings. There is no `CLAUDE.md`; Claude Code loads [AGENTS.md](../../AGENTS.md) instead.
- Shared skills live in `integrations/skills/`; each gets a relative symlink
  `.claude/skills/<name>`. The development pipeline's skills and agents in
  `.claude/` are real directories and files, used only with Claude Code.

## Personal customization

- Customize through personal agent configuration with distinct resource names,
  not by editing tracked `.pi/` or `integrations/` files; do not rely on
  duplicate-name discovery order. Secrets belong in environment variables or
  credential storage, not committed JSON.
