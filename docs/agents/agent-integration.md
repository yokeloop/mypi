# Claude Code and Pi integration

Read when: starting, configuring or diagnosing Claude Code or Pi in this checkout — hooks, the Pi extension, archive capture, MCP registration, the allow list, skills, personal agent settings, the Pi pipeline roles and workflow templates.

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
  --message), the /inbox command, which runs the inbox skill as /skill:inbox, the
  /flow command, which runs the Pi-only flow skill as /skill:flow, and the /epic
  command, which runs the Pi-only epic skill as /skill:epic. It registers the tool
  `mypi_ask` (direct, run sequentially): `question` and 2–4 `options`, the recommended
  one first; it shows a select with the first option marked «(рекомендую)» and «Своё
  слово» last, which opens a text input; it returns `{"answer","custom"}`,
  `{"answer":null,"cancelled":true}` when Escape closes the select or the input (or the
  input is empty), and an error result without asking when the session has no
  interactive UI. It also registers the tool `mypi_compact` (direct, run
  sequentially): `key` — the task whose folder takes the summary, `resume` —
  `/flow <name> <KEY>…` or `/epic <KEY>`, `focus` — what the summary points at; it
  refuses while `git status --porcelain` of the project's home folder in home is not
  empty, otherwise records the request and ends the turn (`terminate`). On the next
  `agent_settled`, after the archive capture, when the session is idle, it runs
  `ctx.compact` with instructions naming the task folder, the project's entry, the
  score and the resume command; on success it appends the summary and the token
  counts to `compactions.md` of the task folder and runs
  `scripts/pipeline/mp-home-commit <KEY>`; then it sends `/skill:flow …` or
  `/skill:epic …` as a follow-up — also after «Nothing to compact», «Already
  compacted» and a failure (the last with a warning). From the recorded request
  until the resumed run starts (`agent_start`; 5 s at most after the follow-up, at
  once when the follow-up cannot be sent or the request is dropped on shutdown), an
  incoming event batch waits and is injected and acknowledged after it; an event
  delivered again while it waits is sent once. Known limit: when the resume prompt's
  preflight takes longer than 5 s (for example an OAuth auth check), the held batch
  is released before that run is active and can be lost as in a plain prompt
  submitted beside it.
  On every `agent_settled`, after the [event emit](sessions.md#events-and-parent-messages),
  when its session has a file (`getSessionFile()`; none under `--no-session`) it runs
  `mypi archive capture --agent pi --file <that file>` with a 5-second limit and ignores
  its result: the file is recorded into the conversation archive from its saved offset
  and bound to a key by the session's `sessions` row, else by its `session_info` name
  (`--name <key>` from /open); user messages that start with a mypi frame are stored
  with origin `frame` and hidden from archive search.
  A same-name server in a Pi `mcp.json` overrides the registration, including
  `enabled: false`; `pi -ne` starts without extensions. Shell `pi mcp list` does
  not load extension servers. After updating/rebuilding, reload or restart Pi.
  Inspect diagnostics before claiming an integration works.
- Pi pipeline resources: the tracked `.pi/settings.json` sets pi-subagents'
  `defaultExtensions: []` (children start without ambient extensions, mypi
  included) and `agentScanDirs` to `integrations/pi-flow` and `home/pi-flow`,
  resolved from the engine root, where Pi starts. `integrations/pi-flow/` holds
  the engine's roles (`*.md`) and workflow templates (`*.js`), `home/pi-flow/` the
  engineer's own for all projects; subfolders are scanned too. pi-subagents reads
  only `*.md`, so the templates are not roles; `subagent({ action: "list" })`
  lists the roles. In a Pi session started in the engine root the engine roles
  `scout` and `reviewer` shadow pi-subagents' builtin roles of the same names, also
  inside its builtin `/parallel-review` and `/review-loop`.
- A role file: frontmatter of flat `key: value` lines, then the body. `name`
  equals the file's base name; `description` is one line, and the planner picks a
  role by it (a role for one project says so); `tools` lists Pi tools comma-
  separated — `read, grep, find, ls, bash` for a read-only role, plus
  `edit, write` for one that changes files; `acceptanceRole` is `read-only` or
  `writer`; `inheritProjectContext: true`; `outputSchema` is the answer's JSON
  Schema on one line, an object with `additionalProperties: false`. Never `model`
  (models are personal, see «Personal customization») and never `extensions`
  (`extensions: []` parses as a path; `defaultExtensions` covers every role). The
  body: the input, what to do, what never, when to ask the lead
  (`contact_supervisor`, only at a real fork), the answer. A file without `name` or
  `description` is skipped silently; invalid JSON in one `outputSchema` fails
  every agent definition.
- A workflow template: a pi-subagents workflow script (`runs.run`, `runs.all`,
  `resume`; no filesystem, shell or Pi tools inside; no nested async functions
  (plain helpers returning `runs.run(...)` or Promise chains)) that opens with a `/* … */`
  header naming what it does and each `args` parameter. Run it as
  `subagent({ workflow: "integrations/pi-flow/standard.js", args })`; check it
  without launching children with `subagent({ action: "validate", workflow: … })`,
  not with bare `node --check`, which rejects the top-level `await` and `return`.

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
  output. A second Stop command and the SessionEnd hook (every reason, including
  /clear and exit) run `mypi archive capture --agent claude --hook`: it reads
  `session_id` and `transcript_path` from stdin and records that transcript file
  into the conversation archive from its saved offset, so an answer the file had
  not yet written at Stop arrives on the next Stop or at SessionEnd. Without a
  transcript it writes nothing; its output is discarded, and its failure (exit 1,
  never 2) blocks neither Stop nor exit.
- When the MCP tool list changes, update the allow list in the same change; a fast
  test compares them. Do not add `enableAllProjectMcpServers`,
  `enabledMcpjsonServers` or `crossSessionInbound` to the tracked settings: project
  settings can only tighten cross-session delivery, so `accept` there changes nothing.
- Personal Claude settings belong in the ignored `.claude/settings.local.json` or in
  user settings. There is no `CLAUDE.md`; Claude Code loads [AGENTS.md](../../AGENTS.md) instead.
- Shared skills live in `integrations/skills/`; each gets a relative symlink
  `.claude/skills/<name>`, except the Pi-only skills (`flow`, `epic`), which Claude Code
  replaces with its own pipeline skill of the same name. The development pipeline's skills and agents in
  `.claude/` are real directories and files, used only with Claude Code.

## Personal customization

- Customize through personal agent configuration with distinct resource names,
  not by editing tracked `.pi/` or `integrations/` files; do not rely on
  duplicate-name discovery order. Secrets belong in environment variables or
  credential storage, not committed JSON.
- Own Pi roles and workflow templates live in `home/pi-flow/`, in the formats of
  «Pi» above, written with ordinary file tools, each with a line in the home map
  `home/INDEX.md`. Their names differ from every role in `integrations/pi-flow/`:
  the order between same-name roles of the two scan roots is not a contract.
- Model tiers of the Pi roles are personal: `~/.pi/agent/settings.json` →
  `subagents.agentOverrides.<role>` with `model` and `thinking`, never the tracked
  `.pi/settings.json` (project overrides beat personal ones). Tier 1 (fast):
  `scout`, `investigator`; tier 2 (standard): `executor`, `tester`; tier 3 (deep,
  bounded): `reviewer`, `challenger`; tier 4 (intent): `planner`. A tier whose
  model comes from a provider extension (for example litellm) also needs
  `"subagentOnlyExtensions": ["<path to the provider extension>"]` in the same
  override: under `defaultExtensions: []` the role fails before its first turn
  without it.
