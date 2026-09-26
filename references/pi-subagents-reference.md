# Pi Subagents — справочник параметров и практик

Статус: reference (сводка официальной документации pi-subagents v0.55,
docs/agents.md, docs/watchdog.md, docs/workflows.md, docs/models.md;
проверено 2026-09-25). Источник: github.com/nicobailon/pi-subagents.

## Важно

Пакет `pi-subagents` — официальная система делегирования Pi. Ранее в
ADR-0002/0003 частично разбирались механизмы кастомного расширения
yokemate-pi; там НЕТ `allowedAgents`, рекурсивного discovery и `permission:
ask`. Официальный пакет всё это имеет. Ниже — факты из официальной доки.

## Формат агента

`.md`-файл: YAML frontmatter сверху, system prompt снизу. Каталоги
(приоритет снизу вверх): builtin (`~/.pi/agent/extensions/subagent/agents/`)
→ package (npm, `pi.subagents.agents`) → user (`~/.pi/agent/agents/**/*.md`)
→ project (`.pi/agents/**/*.md`). Подпапки сканируются рекурсивно.
Доп. корни: `subagents.agentScanDirs`; исключения: `subagents.agentExcludeDirs`.
`agentScope: user|project|both` (default both, project побеждает коллизии).

## Frontmatter — полный список полей

| Поле | Значение |
|---|---|
| `name` | canonical identity; runtime, status, config используют его |
| `package` | регистрирует как `<package>.<name>` |
| `description` | описание для выбора/каталога |
| `advertise` | `true`: имя+описание в системный промпт родителя (до 16 агентов, 12к байт) |
| `aliases` | альтернативные имена выбора (конфиг — по canonical name) |
| `tools` | строгий allowlist туров; опущен = обычные builtin; пустой = без тулов; `mcp:server` = прямые MCP-туры |
| `excludeTools` | deny-list поверх tools; unknown игнорируются |
| `allowNestedSubagents` | `true`: право поднимать детей (не делает omitted tools allowlist-ом) |
| `allowedAgents` | КОГО можно поднимать: canonical имена; пустой = запрет всех; отсутствие = без ограничения; наследуемые списки пересекаются, расширить нельзя |
| `maxSubagentDepth` | глубина вложенности (только сужает унаследованное) |
| `extensions` | какие расширения грузить; опущено = ambient; `[]` = ничего; список = точно эти |
| `subagentOnlyExtensions` | расширения только в детях этого агента |
| `model` | модель по умолчанию; `inherit` = модель родителя |
| `thinking` | `:level` суффикс: off/minimal/low/medium/high/xhigh/max |
| `systemPromptMode` | `replace` (default) \| `append` (база Pi + роль) |
| `inheritProjectContext` | наследовать AGENTS.md/CLAUDE.md репо |
| `inheritGlobalContext` | наследовать ~/.pi/agent/AGENTS.md (только при inheritProjectContext: true) |
| `inheritSkills` | каталог скиллов Pi |
| `skills` / `skillPath` | выбор конкретных скиллов / приватные корни |
| `defaultContext` | `fresh` \| `fork` — контекст запуска |
| `defaultReads` | файлы для чтения перед стартом |
| `output` | файл результата single-агента |
| `defaultProgress` | вести progress.md |
| `async` | фон (true) / передний план (false) по умолчанию |
| `timeoutMs` | дедлайн запуска (foreground default 30 мин) |
| `toolTimeoutMs` | дедлайн одного tool-колла |
| `acceptance` | acceptance gate: scalar level или `{level, reason}` |
| `acceptanceRole` | `read-only` \| `writer` — для авто-инференса acceptance |
| `mutationTools` | туры, считающиеся мутацией (диагностика) |
| `interactive` | парсится, пока не принудителен |
| `machine` | запуск на Herdr-машине (label; cwd = путь на той машине) |
| `memory` | персональная память роли: `{scope: project\|user, path}` |
| `permission` / `permissions` | гвард туров: `allow` \| `ask` \| `deny` per tool |

Списковые поля (`tools`, `allowedAgents`, `skills`, ...) принимают и
через запятую, и блоком `- item`.

## Гварды (все уровни)

1. **`permission: <tool>: allow|ask|deny`** — per-tool гейт. `ask` ставит
   tool-колл на паузу и отправляет превью в one-call arbiter (модель
   child-watchdog), возвращает approve/deny; fail-closed при недоступности.
   Audit JSONL. НЕ гейтит bash (для него pi-guard), contact_supervisor,
   intercom. Правила агента перекрывают глобальные (config.json
   `~/.pi/agent/extensions/subagent/config.json`); явный `allow` снимает
   унаследованный запрет; если в политике нет ask/deny — гейт не регистрируется.
2. **Watchdog** — второй ревьюер после хода: boundary (после turn при
   изменениях), cadence (каждые N тулов, min 5), LSP-диагностика TS/JS.
   Findings: importance low/medium/high; high — в контекст модели, остальные
   — пользователю. Блокеры участвуют в acceptance. Инструкции: WATCHDOG.md
   (проект `.pi/` → юзер `~/.pi/agent/`, 8к симв). Stalemate: N одинаковых
   предупреждений подряд (default 3) → turn кончается. Per-role:
   `watchdog.children.overrides.<role>`.
3. **Launch rules** (`watchdog.rules`) — ДО запуска, без модели:
   `roleModels: {role: allow|deny <glob>}`, `action: warn|block`. Deny бьёт.
4. **`allowedAgents` + `maxSubagentDepth`** — контроль вложенности (см. выше).
5. **Acceptance gates** — process outcome, required outputs, verification
   commands, watchdog-blockers → авто-вывод об успехе запуска.

## Модели

Приоритет: per-run override → provider-scoped role override →
`agentOverrides.<role>.model` → frontmatter `model` → `subagents.defaultModel`
→ модель родителя. `modelScope` (enforce/strict + allow globs, глобальный +
per-agent списки, agent-список не ослабляет глобальный) — политика:
reject/warn, не выбор. `maxThinking` — жёсткий потолок thinking.
Fast mode (`fast: true`) — приоритетный tier OpenAI-Codex (allowlist моделей).

**Рекомендованный тиринг (из офиц. доки):**
1. Fast workhorse — дешёвая модель low thinking: scout, lookups, механика
2. Standard well-scoped — средняя medium: worker, reviewer, delegate
3. Deep but bounded — топ reasoning high, только чётко-скоупенные задачи
   (топ-модели циклятся на vague goals — держать их подальше от open-ended)
4. Taste and intent — модель, читающая намерение: UX, tradeoffs, planning

Правило: capability-тиры (1–3) когда задача well-scoped; intent-тир (4)
когда скоупить/оценить — сама задача.

## Оркестрация — рекомендуемый паттерн

```
clarify → scout → worker → fresh reviewers → worker
```

- `worker` default fresh context (бриф, а не недоделанный разговор родителя);
  `oracle`/`advisor` default fork.
- Children НЕ получают bundled-скилл pi-subagents; fork-контекст чистится от
  parent-only артефактов; дети по умолчанию не имеют subagent-тура и получают
  boundary-инструкции «ты не оркестратор».
- Recursion guard: вложенность default 2 уровня (main → sub → sub-sub);
  глубже — блок. Настройка: `PI_SUBAGENT_MAX_DEPTH`, `config.maxSubagentDepth`,
  frontmatter `maxSubagentDepth` (только сужает).
- **Failed lane recovery:** сбой workflow/запуска — lane-блокер, НЕ разрешение
  молча ретраить через другой режим (interactive_shell, pi -ne, CLI). Стоп,
  отчёт об ошибке, проверить worktree, ретрай только same-protocol.
- `workflowScript` — JS-сценарий с `runs.run/all/lanes/steer/status/ref`,
  без filesystem/shell; budgets: `timeoutMs`, `toolBudget {soft,hard}`,
  `usageBudget {tokens {soft,hard}}` — opt-in, terminalOutcome `partial`.
  Не ставить жёсткие бюджеты на mutation-воркеров без checkpoint-плана.
- Named workflow resources (`subagent({workflow: "review"})`) — provenance
  для permission-расширений; `runs.host` только через resource-гранты.
- Intercom: `contact_supervisor` (ребёнок → родитель), `subagent_supervisor`
  (только fanout-авторизованные координаторы). A → B → C: запрос C
  принадлежит B; steering ≠ reply.

## Overrides без копирования агента

`subagents.agentOverrides.<name>` в settings.json (user `~/.pi/agent/`,
project `.pi/`, проект бьёт): `description, machine, output, outputMode,
defaultReads, model, defaultProvider, thinking, systemPromptMode,
inheritProjectContext, inheritGlobalContext, inheritSkills, defaultContext,
acceptanceRole, disabled, skills, tools, systemPrompt` + `fast`.
`disabled: true` скрывает агента; `disableBuiltins: true` — все builtins.
`eject` — выгрузить builtin в редактируемый файл; `reset` — вернуть.

## Память роли

`memory: {scope, path}` — agent-memory/ namespace, отдельно от памяти Pi.
При каждом запуске первые 200 строк MEMORY.md в системный промпт ребёнка.
Project scope привязан к main checkout (общий для worktree-детей);
user scope — `~/.pi/agent/agent-memory/<path>`. Не создаётся заранее;
агент сам пишет при первом write. Read-only агенты получают read-only блок.
Валидация против traversal/symlink-escape.

## Built-in агенты

`scout` (быстрый recon), `researcher` (web+docs, нужны pi-web-access туры),
`evidence-auditor` (проверка research-brief), `worker` (имплементация,
эскалирует неодобренные решения), `reviewer` (ревью + мелкие фиксы),
`oracle`/`advisor` (второе мнение без правок), `delegate` (лёгкий прокси
родителя). Правило: scout до понимания кода, researcher до доверия фактам,
evidence-auditor до опоры на research, worker — делать, reviewer — проверить,
oracle — когда решение рискованное.