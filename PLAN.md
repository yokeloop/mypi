# mypi roadmap

Current foundation: local project memory and DB-backed request accounting, exposed
through optional CLI and MCP tools. Development guidance: [AGENTS](AGENTS.md).
The former agent workflow is [withdrawn](docs/AGENT-WORKFLOW.md).
Architecture: [ARCHITECTURE](docs/ARCHITECTURE.md).

## Product direction

Requests and memory are available as explicit data operations. There is no mandatory
agent startup, registration, logging or Herdr-session procedure. The earlier policy
has been withdrawn without deleting existing records or changing the API.

Flow is part of this direction, not a forbidden concept. Its automated executor and
agents with different scopes are future implementation. Present instructions must
support that evolution without claiming that permissions/isolation are enforced now.

## Completed foundation

- [x] M0 architecture contract accepted; historical record: [M0-CONTRACT](docs/M0-CONTRACT.md).
- [x] M1 TypeScript/Node 24, SQLite authority, pnpm, modular monolith and Ports & Adapters.
- [x] Organization/project registry, optional checkout mapping, memory, capture, notes/errors.
- [x] DB request cards/status dictionary; immutable source and artifacts in home.
- [x] Common append-only JSONL journal with monthly UTC rotation and scoped selection.
- [x] Scoped warmup, safe context operations and local Git commits.
- [x] Explicit partial outcomes, reconciliation, SQLite backup + Git bundle, safe restore.
- [x] CLI/API, bounded tests/admission, independent reviews and ordinary hosted CI.
- [x] stdio MCP: 31 tools over the shared typed API; [MCP-CYCLE](docs/MCP-CYCLE.md).
- [x] Prototype/import compatibility removed; M1 SQL schema migrations retained.

An RC was published previously. M1 final acceptance is still open: the independent
GitHub App issuer, required check and negative spoofing check remain outstanding
([M1-CI](docs/M1-CI.md)). A green ordinary Actions run is not that trusted gate.

## Current operating foundation

- Project-local English instructions; communicate in the user's language.
- Optional request/memory tools without automatic task accounting or session routing.
- Distinct context and checkout; explicit scope, permission and outcome evidence.
- CLI/MCP APIs remain usable as independent operations.
- Bootstrap, registration, migration, backup destination and network actions are
  explicit operations, not side effects of installation or reading documentation.

## Next milestones: direction, not an approved implementation queue

The old numbered phases in Git history are not reinstated. Future sequence and
acceptance details must be agreed for concrete work; no new M2–M5 numbering is implied.

| Direction | Intended result | Boundary to retain now |
|---|---|---|
| Units | Reusable role, inputs/outputs, restrictions and acceptance contract | A unit is not an agent process or extension; do not impose human-only acceptance |
| Project flows and runtime | Compose units; validate and persist execution/progress/results in DB | Request statuses are not a hardcoded pipeline; Markdown changes do not trigger work |
| Scoped coordination | Root/org/project coordination and request workers with relevant context and explicit permissions | Inherit relevant parent knowledge, not sibling/inbox contents; context selection is not an ACL |
| Runner safety | Verified launch, cancellation, resource bounds, isolation, ownership and recovery | Neither cwd, tool descriptions nor process ancestry proves exclusivity/cleanup |
| Parallel work and handoff | Task pipelines/tabs and controlled transfer between sessions, later devices if needed | Ownership must be solved before multiple autonomous writers; no mutable DB sync through Git |
| Reuse and integrations | Reusable units and optional tracker/distribution integrations | No mandatory tracker, marketplace or cloud before a concrete need |

Future scoped coordination is product design, not an instruction to launch agents
or move current work into separate sessions.

## Superseded proposals and provenance

The earlier broad roadmap and conceptual ADRs can be read in Git history:
`8b7a3ac:PLAN.md`, `8b7a3ac:CONCEPT.md`,
`8b7a3ac:adr/ADR-0002-plugin-subagents-on-pi-primitives.md` and
`8b7a3ac:adr/ADR-0003-orchestrator-cascade.md`.

Preserve useful direction, not rejected mechanisms: file-authoritative lifecycle,
DB-as-projection, Python backend, guaranteed ownership from a process tree, a
mandatory cascade of LLMs, and the former phase order are not current requirements.
MP-1/MP-4 registration policies and MP-5's mandatory Herdr-session guidance are
withdrawn. Their cards, reports and earlier user-global installation guidance remain
historical evidence, not active agent instructions.

No speculative flow schema, agent catalog, supervisor or universal recovery engine.
Test policy remains [TESTING](docs/TESTING.md); limits are not raised to get green.
