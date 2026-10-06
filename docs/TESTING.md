# mypi testing policy

Accepted rules, not a new policy proposal. The architecture and rules were accepted
on 2026-09-30; initial numeric budgets on 2026-10-02 (§11). Local isolation/admission
are implemented; evidence and protection boundaries: [M1-CYCLE](M1-CYCLE.md),
[MCP-CYCLE](MCP-CYCLE.md); initial slice: [M1-IMPLEMENTATION](M1-IMPLEMENTATION.md).
MP-1 translates the active guidance into English without changing budgets, profiles,
runner, admission or review requirements. Historical records in §§9–11 stay verbatim.
The MCP cycle contains limited comparative measurements, not a full p95 baseline.

Basis: [the pinned research report](https://gist.github.com/prineycom/0bce7da0b37ae6f580b292e5d854d528/aaa39187b7aa20722bd4405d431078f7d418297c),
its primary sources, [M0-CONTRACT](M0-CONTRACT.md) and [ARCHITECTURE](ARCHITECTURE.md).
Scope: developing mypi tests before future delegation to units. Accepting this policy
does not authorize implementation or introduce a flow/agent runner. M0 acceptance
and subsequent stack decisions are separate records. Current request-accounting rules
are in [AGENT-WORKFLOW](AGENT-WORKFLOW.md).

## 1. Main conclusion

**Bound execution and maintenance cost while demonstrating additional protection,
not the number of tests.**

The previous project's report described missing boundaries of level, cost and
responsibility: process-based scenario matrices, umbrella tests running other suites,
and a supervisor that added machinery without reducing work. Its reduced suite had
53 files / 436 tests. The reported 73.961 s, 347.41 MiB and 53 kernel tasks describe
one isolated reduced run, not mypi targets. CI used another environment/partly another
revision: no valid percentage speedup follows. That code and local evidence were
not audited here; the dangerous old suite was not run.

Protection needs three independent parts:

1. Execution: enforced resource limits and mandatory test composition.
2. Meaning: review of additional value, sensitivity and maintainability.
3. Future delegation: a small eval set checking agents' compliance with both.

Prompts alone do not protect the machine. Limits alone do not stop thousands of
pointless fast tests. Agent evals do not replace product tests.

## 2. What the sources support, and what they do not

| Source | Useful principle | Limit of the conclusion |
|---|---|---|
| OpenAI harness engineering [1] | Concise AGENTS entry/index; mechanical boundaries; repeated errors become checkable rules | Do not copy a million lines of infrastructure, autonomous until-green loops or flake tolerance |
| Atlassian mutation coverage [2] | Generated tests need value review; generic coverage requests create excess tests; bound analysis | Excess tests remain a known problem; 80% is not our target |
| Meta ACH [3] | Check sensitivity to specific plausible faults | Chosen mutants do not prove completeness; no initial LLM mutation engine |
| Google chapters 11–13 [4–6] | Separate scope/resources; minimum sufficient check; public behavior; cheap real dependencies | Pyramid percentages are not quotas; temp-FS/embedded-DB fast is not strictly Google small |
| Anthropic agent evals [7] | Check actual outcomes, positive/negative controls and grader quality | Nondeterministic evals stay outside ordinary suites; model judges need calibration |
| OpenAI skill evals [8] | Start small, preserve traces/artifacts, check mandatory properties | Roughly 10–20 prompts are a starting scale, not proof of reliability |
| StrykerJS incremental [9] | Bounded mutation analysis may help | Cache misses environment changes; Command runner lacks test-change data; integration is unverified |

The earlier [YM-284 proposal](https://gist.github.com/prineycom/f27b4e019e959c8cf3b8b650f7ac027b)
suggested a manual catalog/resource harness. The later report rejects a second manual
database of derivable facts and a complex supervisor. Do not adopt both proposals.

## 3. Product architecture that permits cheap tests

Use the product's CLI → core → DB/context/Git adapter boundaries, not a parallel
"test architecture".

- Core and CLI parsing are Node APIs. Importing a module must not launch a command,
  network call, process or write to personal home.
- Keep the executable thin: arguments, API call, stdout/stderr and exit code. Do not
  duplicate domain logic in CLI.
- Test rule matrices through public component APIs; public API does not mean subprocess.
- Use real cheap deterministic dependencies: text operations, temp FS and the selected
  embedded DB. Do not build a DB clone just for unit isolation.
- Separate clock/ID/external effects only where needed. No speculative DI framework,
  universal fake runtime or production test hooks.
- Git adapters, CLI packaging and restart need real boundary checks. Mocks do not
  prove commit, durability or launcher correctness.

Use Node.js 24 LTS node:test and node:assert/strict; stack decision:
[M1-DESIGN §11](M1-DESIGN.md#11-принятие-стека). Tests run as JavaScript after tsc;
do not rebuild per file. Pin versions and verify compatibility during authorized setup.
Runner file concurrency bounds its workers, not all descendants/native threads [10].

## 4. Two profiles, not a universal runner

Profiles/commands are implemented; current coverage/limits are recorded in M1-CYCLE
and MCP-CYCLE, the first implementation in M1-IMPLEMENTATION.

| Profile | Allowed | Forbidden |
|---|---|---|
| test/fast/ | Deterministic in-worker checks; small temp FS/embedded DB fixtures; input tables | Child processes in tests or called code, extra workers, network/sockets, LLM/Pi, real sleeps |
| test/boundary/ | Specific real Node CLI/Git/restart boundaries; isolated local data; explicit cleanup | Nested runners, entire workflow for a local assertion, network/LLM, personal home, detached processes |

Workers created by the standard runner are not forbidden child spawns from a fast
test; they count toward the total budget. Server-based DB checks belong in boundary,
not a mislabeled fast profile.

- test: quick feedback, not complete acceptance.
- verify: admission + fast + mandatory boundary; required for completion and CI.
- Targeted red→green runs do not replace final verify.
- New test files must belong to a known profile; unknown paths fail discovery rather
  than being silently excluded or added to an expensive glob.
- Do not move a mandatory check into opt-in to weaken verification.
- No empty system/evals/future-unit suites in M1. Add profiles with real functionality
  and a separate cost decision.

### Applying profiles to mypi risks

This is a placement guide, not a manual per-file catalog or eight separate runners.

| Risk | Primary cheap check | Necessary real boundary |
|---|---|---|
| Scope/identity/traversal | Core input tables; temp FS symlink/escape and no-write checks | Narrow CLI forwarding/error canary, not every ID through subprocess |
| Scoped warmup | Distinct global/org/project/foreign fixtures, inheritance/inbox exclusion | CLI wiring/output without duplicating the matrix |
| Capture/memory/note/journal | Unicode/multiline, exact source, no-overwrite, read-only API behavior | Real context commit and preservation of unrelated dirty diff |
| DB authority/constraints | Real engine, transactions and resulting state, not mocked INSERT | Reopen/restart and competing writers; in-memory is not durability proof |
| Retry/mixed-operation recovery | Bounded failure scenarios at durable protocol boundaries | Abrupt termination/restart when exceptions/finally behave differently |
| Backup/restore | Real backup, restore to new storage, validate data/references | Real filesystem mode and required recovery, not file existence alone |
| CLI/bootstrap | In-process parsing/dispatch of every command | Launcher, exit/stdout/stderr and required save→reread path without Python |

Cover useful commands without replicating the complete error matrix at every level.
A domain test and boundary canary may overlap when they catch different failures:
the rule itself versus failure to wire it into the application.

## 5. Admission of a new test

Before editing, inspect existing tests and briefly answer in the change rationale,
not a separate registry:

1. Which observable contract is protected?
2. Which plausible fault do existing tests miss?
3. Why is this the cheapest reliable level? Can an existing table be extended?
4. How will sensitivity and cost be checked? Explain separately why a new process
   boundary cannot be proved in-process.

No extra protection means no new test. Documentation changes and pure refactors do
not require new test files merely for appearance.

### Quality and maintainability

- Assert results, durable state, forbidden effects and cleanup, not private call order
  unless it is contractual.
- Specify expected results independently from the tested algorithm. A mock returning
  the expected answer does not prove the product.
- Do not stop at no-throw, exit 0 or file existence for a content/preservation contract.
  A launcher-only canary may check launch but is not evidence of storage behavior.
- One test means clear behavior, not necessarily one assertion. Include positive
  controls: rejecting everything must not pass as correct validation.
- Avoid complete snapshots of random IDs, timestamps, internal SQL and large output.
  Exact text equality is justified when source fidelity is the contract.
- Small setup repetition is acceptable. Helpers should serve real repeated operations,
  not conceal scenarios behind a new DSL.
- No full process-based Cartesian products without a named interaction risk. Bound
  tables/property tests by examples and data size/length; reproducible seed, bounded shrinking.
- Replace waits with controlled time or readiness signals with deadlines. Retry-until-green
  and timeout increases instead of diagnosis are not fixes.
- Public-behavior-preserving refactors should not require mass test rewrites; if they
  do, reconsider the test boundary.

### Sensitivity evidence

Regression: red on broken behavior, green on the fix. Red must fail at the intended
assertion, not import/setup. If old code cannot run correctly with the new API,
report the limitation rather than claiming red→green.

For critical new invariants, use targeted faults in a disposable copy: for example,
allow foreign scope or repeated append. Normal passes, the specified violation fails.
Never mutate live storage/root. Check selected agreed risks, not mutants until a
coverage percentage. Mutation tooling is not mandatory or added by default.

### Removal and stopping growth

A proven duplicate may be merged/removed, naming the remaining protection. A removed
contract may lose its test. Never remove the only meaningful assertion for green.
Neither ban all deletion nor require one deletion per addition; no coverage auto-pruning.

**Stop:** agreed failure modes are protected, sensitivity checked, required profile
passes within budget. Do not add more comprehensive edge cases without a new justified risk.

## 6. Execution and growth limits

### Accepted initial limits, not measured baseline

Accepted in the M1 preparation package on 2026-10-02 (§11):

| Parameter | Accepted value |
|---|---:|
| Fast working time | ≤ 5 s |
| Full mandatory test-profile working time | ≤ 30 s |
| External hard deadline, including stop/cleanup | 60 s |
| CPU / memory of the entire test scope | 2 CPU / 1 GiB |
| Kernel tasks including threads | 64 |
| Concurrent test workers / suite runs on the dedicated runner | 1 / 1 |

These are initial working targets/emergency bounds, not a benchmark or YM numbers.
Apply hard bounds from the first safe measurement; assess working targets with a
series of identically bounded representative runs. If unsuitable, discuss the cause
and explicitly revise the decision, never auto-raise a failed limit. Without standard
limits/isolation, do not run unbounded and do not build a custom supervisor.

The complete profile includes fixture setup/teardown, admission, fast and boundary.
Dependency installation and build/typecheck are measured separately, never repeated
per test file. Their limits remain **installation: 5 minutes; build/typecheck: 60 seconds**.
Do not relabel expensive work outside the measurement to claim a faster suite.

### Mechanical checks

- Before execution: profile membership, .only/.skip, nested runners, new effectful
  imports/spawn/workers/network, sleeps, timeout/concurrency increases, discovery/
  policy/CI changes. Prefer existing lint/structural tools; small checkers only for gaps.
- Inspect called helpers/adapters too: hidden spawn is still spawn. Static filtering
  is not proof of no dynamic effects or a sandbox.
- Standard container/cgroup/CI scope must bound total CPU/RAM/tasks, deny network and
  personal data access. External emergency termination is independent of Node's event loop.
- Disposable workspace; no real home/project mounts, credentials or user Git hooks/config.
  Git fixtures use their own local identity/settings.
- Cleanup on success/failure/timeout. Use a standard container reaper where needed.
  Surviving descendants, OOM, missing mandatory tests or exceeded budgets are failure
  even if the main runner exits zero.
- Per-run limits do not replace a machine-wide parallel-run cap. Use standard CI/
  dedicated-worker concurrency; do not write a host scheduler.
- Targeted, test, verify and CI runs obey one policy. Direct unbounded node --test is
  not evidence of safe verification; a package script alone does not prevent bash bypass.

Physical launch control needs environment/permission restrictions. An agent able to
change CI/limits/checker without independent admission can bypass itself. Execute
the gate from a trusted revision; separately authorize policy/resource expansion;
protect required checks outside the candidate diff. This is a control-plane permission
boundary, not universal human acceptance for all future flows.

### Detecting gradual growth

Derive a short report from Git/runner/measurements: base/head and environment; added/
changed/removed cases/files; wall/CPU; whole-scope peak memory/tasks; expensive files;
skips/retries/survivors and limit changes. LOC/case count are review signals, not KPIs.

Compare base/head in the same environment; one run is not p95. Start with a small
report and multiple measurements for significant growth, not an observability platform.
One worker's peak is not the group's; summed RSS is not cgroup memory.

Require both an absolute budget and cost-increment review. Weekly baseline updates
must not normalize degradation. Without variation measurements, do not invent a
statistical +20% regression gate. Examine growth even below the absolute cap.

## 7. Review now, delegation later

Require independent **test-diff** review: additional risk, oracle reliability,
sensitivity, minimum level, maintainability, cost and removal rationale. Author
claims do not replace it. Without another reviewer, do not call self-review independent
or launch subagents without a request.

A future unit needs a policy link and a short instruction:

> Find existing checks. Name the observable contract and the fault they miss. Choose
> the cheapest reliable level; prove failure for the intended reason. Stop once agreed
> risks are covered and the mandatory profile passes within budget. Do not expand
> execution privileges/limits, weaken the checker or add infrastructure to get green.

These rules are specific to mypi, not automatically imposed on all working projects.
Future acceptance remains defined by unit/flow contracts; an executor's own statement
of completion is not evidence.

**Before delegation**, not inside every product test, use small bounded author/reviewer
evals covering:

- New parser input → extend a table, no subprocess.
- New launcher → justify a real boundary canary, not just a mock.
- Duplicate → reject; meaningful new risk → accept.
- Self-derived expected or always-green mock → detect.
- Proven duplicate deletion → allow; sole protection deletion → reject.
- Timeout/budget increase for green → stop and explain.
- Generic coverage request → no uncontrolled generation.
- Missing infrastructure → no new supervisor in a feature task.

Assess diff, commands, artifacts and saved outcomes, not just prose. Protect the grader
from the evaluated agent; calibrate it with known good/bad decisions. Calibrate semantic
scores and distinguish model failures from environment errors. Bound trials/time/
tokens/cost independently; no retry-until-green. These evals are not implemented here.

## 8. Applying the policy without extra bureaucracy

One policy source: docs/TESTING.md. AGENTS, architecture and M1 acceptance link to it;
do not duplicate it in every prompt/document. Numeric budgets in §6 were accepted
later (§11). Local limits/admission exist; independent static review and current
evidence are in M1-CYCLE/MCP-CYCLE. The independent trusted issuer remains open in
M1-CI. Policy acceptance does not authorize implementation.

The original M1 rollout requirement was to ship standard runner, two profiles,
simple admission, bounded execution and cost reporting with the first vertical slice,
not after a large suite or as a separate pre-product platform. Before acceptance,
check safe negative cases: unknown file/skip, forbidden effect, timeout, surviving
owned child and gate weakening. Use small bounded fixtures, never actual host
resource-exhaustion workloads. These requirements are not waived by translation.

Before delegation, put the link/criteria in unit contracts and verify a bounded eval
set. Do not create flows/units solely for test policy.

Do not introduce a manual per-file owner/ticket/time catalog, test-count quotas,
mandatory coverage percentage, second runner, universal resource registry, custom
supervisor/scheduler, full-repo mutation pipeline or new tickets for policy bookkeeping.

<!-- Historical research and acceptance records below are retained verbatim. -->

## 9. Источники и запись исследования

Ниже сохранена запись исходного исследования до принятия политики. Прежний путь `docs/TESTING-PROPOSAL.md` оставлен указателем на этот документ.

Основной отчёт и шесть его основных первоисточников ([1–4], [7–8]) получены и прочитаны через Firecrawl MCP; также проверена документация Stryker [9]. Дополнительные главы Google [5–6], Node [10] и ранний gist изучены по ранее загруженным текстам. Firecrawl мог вернуть кэшированное содержимое; это чтение материалов, не проверка их deployment-status.

1. [OpenAI — Harness engineering](https://openai.com/index/harness-engineering/).
2. [Atlassian — Automating Mutation Coverage with AI](https://www.atlassian.com/blog/development/automating-mutation-coverage-with-ai).
3. [Meta — LLMs Are the Key to Mutation Testing and Better Compliance](https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/).
4. [Software Engineering at Google — Testing Overview](https://abseil.io/resources/swe-book/html/ch11.html).
5. [Software Engineering at Google — Unit Testing](https://abseil.io/resources/swe-book/html/ch12.html), разделы о brittle tests, public APIs, state vs interactions, DAMP.
6. [Software Engineering at Google — Test Doubles](https://abseil.io/resources/swe-book/html/ch13.html), реальные реализации, fidelity и цена fakes.
7. [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).
8. [OpenAI — Testing Agent Skills Systematically with Evals](https://developers.openai.com/blog/eval-skills).
9. [StrykerJS — Incremental mode и ограничения](https://stryker-mutator.io/docs/stryker-js/incremental/).
10. [Node.js v24 — Test runner execution model](https://nodejs.org/docs/latest-v24.x/api/test.html#test-runner-execution-model). Версия документации не означает выбор runtime baseline mypi.

Исход исследования: подготовлено это предложение, без изменений реализации и без принятия политики за инженера. В checkout нет `home/`, поэтому project journal не создавался; устойчивый артефакт — `docs/TESTING-PROPOSAL.md`. Две пакетные попытки чтения через mcpScript завершились timeout (180 и 120 s); отдельные вызовы Firecrawl MCP затем вернули материалы. Код старого suite не запускался, внешние записи не выполнялись.

Проверка артефакта: Node.js-скриптом проверены 2 локальные Markdown-ссылки, синтаксис 12 внешних URL и парность code fences; `git diff --check` прошёл. `git diff --exit-code -- scripts/ .gitignore` подтвердил отсутствие изменений реализации. Это статическая проверка документа, не испытание предложенных профилей, лимитов или test policy.

## 10. Запись принятия политики

2026-09-30 — ответом «закрепляем» приняты архитектурная основа и правила; численные бюджеты оставлены на согласование и проверку при подготовке первой реализации. Единый источник перенесён в `docs/TESTING.md`, прежний путь оставлен указателем; обновлены AGENTS, README, PLAN, M0-CONTRACT и ARCHITECTURE. M0 не закрыт, реализация не начата, коммиты и внешние записи не выполнялись. `home/` отсутствует; запись исхода — этот раздел, без инициализации личного хранилища.

Проверка согласования: Node.js-скрипт проверил 14 документов, 53 локальные Markdown-ссылки, парность code fences, отсутствие хвостовых пробелов, ссылки на политику и сохранение границ согласования бюджетов/M0. `git diff --check` и `git diff --exit-code -- scripts/ .gitignore` прошли. Это проверка документации, не runtime-проверка enforcement.

## 11. Принятие стартовых численных пределов

2026-10-02 — после общего предложения схемы/хранения/частичных сбоев/тестовых пределов и уточнения id/number инженер ответил:

> понял, тогда оставляем. по остальным вопрсов нет

Приняты рабочие цели и аварийные пределы §6, включая отдельные пределы установки зависимостей и build/typecheck. Используются штатные средства изоляции, не свой supervisor; недоступность ограничений не разрешает неограниченный запуск. Полная запись пакета — [M1-START.md](M1-START.md), §5. Числа не выдаются за замер выбранного стека, не увеличиваются автоматически при failure.

Активные требования и указатели обновлены, исходные записи §9–10 сохранены. Реализация и миграция не разрешены; test suite и enforcement не созданы, зависимости не устанавливались, ресурсные прогоны не выполнялись. Документальная проверка не является runtime-проверкой этих пределов. Запись исхода — этот раздел.
