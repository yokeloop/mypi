# MCP — цикл реализации

Основание: [план v3](https://draft.yokeloop.com/artifacts/mcp-mypi-krfyduz7),
ответы инженера в Derive («Подтверждаю», два «а)», итог «подтверждаю»),
прямой запрос реализовать, проверить, провести review и слить в main. Без релизов.
Base: 1990920. Работа: feat/mcp-memory. Личный bootstrap не разрешён.

## Реализация

31 stdio-инструмент, SDK 1.32.0 / Zod 4.6.5 (точные версии).
CLI сохраняет argv/JSON; оба адаптера вызывают AppCommand/executeCommand.
DB-only операции не открывают workspace. MCP не хранит currentProject,
не запускает CLI и не вводит таблиц, HTTP, flow или daemon.
project_resolve использует канонический путь, границы компонентов, deepest match и ambiguity.
Очередь — только внутри процесса, отмена до начала, без автоматического retry.
Исходы partial сохраняют поля core; disconnect не означает rollback.

## Обоснование тестового diff (TESTING §5)

- Существующий workspace-cli сценарий теперь вызывает общий CLI run с временным root:
  прежние assertions сохранены, механический переход на типизированный API.
- Расширение projects fast: реальная SQLite/temp FS доказывают checkout lookup,
  symlink alias, deepest match, component boundary и ambiguity. Прежние тесты lookup не знали.
- mcp-contract fast: независимый каталог из 31 примера (не expected из registry),
  strict nested schema, source, команды CLI, partial и последовательная очередь
  с управляемым Promise/AbortSignal без sleeps/process/network.
- mcp boundary: настоящий SDK client и stdio, все инструменты на одной временной установке,
  DB-only до bootstrap, stdout, exact source, scoped warmup, отказ Git и repair без append,
  два MCP процесса + CLI, async backup + queued write, restore и EOF/SIGTERM.
  Матрица доменных ограничений M1 не размножена на subprocess.
- Существующий contention-test сохраняет доказательство запрета source до writer reservation.
  Очередь/отмена проверяются управляемо в fast; штатный SDK переносит signal в callback.
- SDK содержит транзитивные HTTP-зависимости, но сервер импортирует только stdio/McpServer.
  Admission по-прежнему не следует внутрь node_modules; runtime-suite изолирован без сети.
  Это ограничение статического анализа, не доказательство отсутствия всех сетевых зависимостей.

## Проверки и найденные проблемы

Первый build выявил отсутствующие callback types SDK — исправлено.
Первый verify остановился на unresolved SDK exports до тестов. В dependency-cruiser
включены exportsFields/ESM conditions, unresolved-imports не отключён.
Добавлены запреты MCP→CLI/modules/infrastructure и обратных зависимостей/SDK в core.
scripts, лимиты и TESTING.md не изменены.

Первый зелёный verify: 14 fast + 12 boundary; wall 6.785 s, fast 152 ms,
memory peak 440741888 bytes, tasks peak 50; прежние бюджеты соблюдены.
Это одиночный замер, не p95. Последующие этапы ниже.

## Review → исправления → повторные проверки

Независимый read-only reviewer — отдельная Pi-сессия openai-codex/gpt-6-astra,
без write/bash/MCP/сабагентов; три статических прохода с пределом 4–5 минут.
Первая попытка через Codex CLI не состоялась: 401, без результата review;
использован работающий Pi provider, credentials не переносились.
Калибровочные решения reviewer (parser/oracle/sole assertion/stdio/sandbox) — в третьем отчёте.

- [Review 1](evidence/mcp-independent-review-1.md): CLI-организация `global`/пустой scope
  смешивались с глобальным default; SDK выдавал text-only validation errors.
  [Red](evidence/mcp-review-red.txt) → [green](evidence/mcp-review-green.txt).
- [Review 2](evidence/mcp-independent-review-2.md): организация `all` смешивалась с `--all`.
  Исправлено структурно: ScopeInput = Scope | {reference:string}; строка all — только селектор.
  [Red](evidence/mcp-all-scope-red.txt) → [green](evidence/mcp-all-scope-green.txt).
- [Review 3](evidence/mcp-independent-review-3.md): все findings закрыты, новых must-fix нет;
  одобрены feature и отдельное продвижение dependencies/policy в base.

SDK продолжает отвечать за framing/discovery/JSON-RPC; well-formed tools/call идут
через единый invoke, чтобы ошибки схемы и неизвестный tool также получали structuredContent.
Невалидный JSON-RPC остаётся protocol error, не маскируется под application outcome.

Три мутации в disposable copy отвергнуты нужными assertions:
[partial→ok](evidence/mcp-mutation-partial.txt),
[потеря scope](evidence/mcp-mutation-scope.txt),
[bootstrap при connect](evidence/mcp-mutation-bootstrap.txt).
Рабочие source/data не мутировались. Две setup-попытки не являются evidence чувствительности:
сначала копия без pnpm workspace вызвала ignored-build guard, затем cpSync сделал
абсолютные symlinks зависимостей, недоступные в sandbox. Финальная копия сохраняла
relative symlinks и использовала штатные build/check entrypoints.

## Цена и изоляция

Base 1990920, отдельная копия, frozen/offline install исходного lockfile, Node 24.21.0,
тот же cgroup/bwrap. [Baseline](evidence/mcp-baseline.txt): 9 fast + 10 boundary,
wall 4.915 s, fast 85 ms, peak 305070080 bytes / 36 tasks.
Первая попытка baseline остановлена guard до тестов из-за системного Node 26;
[запись](evidence/mcp-baseline-wrong-node.txt), повтор — с явно выбранным Node 24.

[Build](evidence/mcp-final-build.txt), два финальных verify:
[1](evidence/mcp-final-verify-1.txt), [2](evidence/mcp-final-verify-2.txt).
14 fast + 12 boundary, wall 6.971 / 6.993 s, fast 155 / 150 ms,
peak 439328768 / 441991168 bytes, 50 tasks. Дополнительная цена примерно 2.1 s:
MCP SDK/реальные процессы, restore, EOF/SIGTERM и строгие схемы. Это малая серия,
не p95; все абсолютные бюджеты сохранены, skips/retries/survivors/OOM отсутствуют.

## Pi и личная конфигурация

[Offline smoke](evidence/mcp-pi-smoke.txt): настоящий Pi 1.0.0, builtin MCP/codemode,
отдельный agent-dir и временная установка, сеть/личный home не смонтированы.
31 tool, 2 direct; поиск memory_show и чтение сохранённого факта через codemode
в новой и возобновлённой сессии (1 → 2 user messages).
Для подачи предопределённого tool call использован временный локальный deterministic
provider, не LLM и не новый продуктовый extension. Это проверка механики клиента,
не качества решений модели. Исходные connection/list не создали DB/home; fixture
bootstrap затем выполнен явно. 2.045 s, peak 169.5 MiB. В обязательный suite Pi не добавлен.

По согласованному пользовательскому варианту добавлены только mypi в
`~/.pi/agent/mcp.json` и отмеченная инструкция в новом `~/.pi/agent/AGENTS.md`.
Реальный mcp.json — Stow symlink в dotfiles: ссылка и mode сохранены;
структурное сравнение подтвердило неизменность остальных четырёх серверов и настроек.
Backup вне Git: `~/.local/state/mypi-config-backups/20261004T100346Z/mcp.json`.
Личный DB/bootstrap/home не создавались; dotfiles не коммитились.
В уже открытом Pi нужен `/reload`, после сборок — reconnect.

## Продвижение и границы доказательств

Reviewed dependencies/policy выделены в commit 6f51355 для продвижения trusted base;
runner/scripts/TESTING/лимиты не менялись. Политика CI не обходится PR override.
Hosted CI и merge завершены: [PR #2](https://github.com/yokeloop/mypi/pull/2),
[run 37194235107](https://github.com/yokeloop/mypi/actions/runs/37194235107),
проверенный head ca4fb66, merge `4562ccd7c0851ae772d08cb6fb4479c2d0ff7402`
(2026-10-04 10:07:28 UTC). [Выдержка hosted log](evidence/mcp-hosted-green.txt).
Локальный main fast-forward до origin/main, рабочее дерево чистое после слияния.
Релизов/тегов не создавали. Успех publish-app-verdict сообщает отсутствие issuer,
а не доказывает доверенный gate.

Оставшиеся границы (не скрытые дефекты): независимый App issuer M1 по-прежнему отсутствует;
реальный SIGTERM во время активной async операции не доказан end-to-end, но stop/queue
проверены управляемо. Два MCP writer + CLI дают независимые процессы и уникальные номера,
не гарантированное перекрытие транзакций; прежний детерминированный contention-test сохранён.
Scope не ACL; автоматическая output-validation SDK при нашем call-handler не выполняется,
ответы проверяются контрактными/protocol assertions. Общий envelope не является полной
схемой каждого CLI data. Транзитивные SDK imports не анализируются admission глубже node_modules.

Устойчивый исход этой работы — этот документ/evidence: `home/` отсутствует,
личный journal ради отчёта не инициализировался.
