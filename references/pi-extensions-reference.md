# Pi: extensions (плагины) — полный разбор по официальной документации

Источники: https://pi.dev/docs/latest/extensions (полный текст), pi.dev/docs/latest/packages,
примеры github.com/earendil-works/pi (examples/extensions). Дата: 2026-09-26.

**Уточнение M0, 2026-09-29:** это вторичная историческая сводка, не фиксация
проверенного API для реализации. Точные сигнатуры сверяются с выбранной версией
Pi; в аудите читалась локальная документация 0.87.1. В частности, session replacement
описывается там как command-only, а status/acceptance mypi не предоставляются
ядром Pi автоматически. Маппинг mypi в §12 отражает прежние ADR; текущий контракт —
[ARCHITECTURE](../docs/ARCHITECTURE.md). Первая поставка — Node.js память/проекты
с DB-состоянием, без разработки extension/flow. Исходная сводка ниже сохранена.

---

## 1. Терминология: «плагинов» в Pi нет — есть extensions

Иерархия кастомизации Pi:

| Слой | Что это | Формат |
|---|---|---|
| **Extensions** | Код, расширяющий поведение агента | TypeScript-модуль |
| Skills | Процедуры/знания, подгружаемые агентом | Markdown (SKILL.md) |
| Prompt templates | Шаблоны `/команд` | Markdown |
| Themes | Оформление TUI | TS/JSON |
| **Pi packages** | Дистрибутив: бандл extensions + skills + themes | npm / git |

То, что в других агентах называют «плагином», в Pi — extension (единичный) или package (набор для `pi install`). Pi сознательно «minimal agent harness»: сабагенты, plan mode и т.п. — НЕ в ядре, а реализуются extensions («Primitives, not features»).

## 2. Что такое extension технически

TypeScript-модуль, экспортирующий **factory-функцию**, получающую `ExtensionAPI`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // события
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });
  // гейт
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });
  // кастомный тур
  pi.registerTool({ name: "greet", /* ... */ });
  // команда
  pi.registerCommand("hello", { handler: async (args, ctx) => { /* ... */ } });
}
```

- Загрузка через **jiti** — TypeScript без компиляции, просто `.ts`-файл.
- Factory бывает **async** (await зависимостей при старте).
- npm-зависимости: `package.json` рядом с extension (или в родителе), `node_modules` резолвится автоматически. Для пакетов: runtime-зависимости обязаны быть в `dependencies` (прод-инсталл).
- Node built-ins (`node:fs`, `node:path`) доступны.
- ⚠️ **Security (из доки): extensions выполняются с полными правами системы и могут исполнять произвольный код. Ставить только из доверенных источников.** Project-local грузятся только после trust проекта.

## 3. Расположение и загрузка

| Место | Скоуп |
|---|---|
| `~/.pi/agent/extensions/*.ts` | глобально (все проекты) |
| `~/.pi/agent/extensions/*/index.ts` | глобально (папкой) |
| `.pi/extensions/*.ts` | проект-локально (после trust) |
| `.pi/extensions/*/index.ts` | проект-локально (папкой) |

- `/reload` — hot reload всего из auto-discovery мест.
- `pi -e ./path.ts` — разовый запуск для теста (не hot-reloadable).
- Доп. пути через `settings.json`:
```json
{
  "packages": ["npm:@foo/bar@1.0.0", "git:github.com/user/repo@v1"],
  "extensions": ["/path/to/local/extension.ts", "/path/to/dir"]
}
```
- `pi install npm:pkg` / `pi install git:...` — установка пакетов; у каждого хоста (Pi, OMP) свой манифест.

## 4. Ключевые способности (из доки)

- **Custom tools** — туры, вызываемые LLM (`registerTool`)
- **Event interception** — блок/модификация tool-коллов, инжект контекста, кастомная компакция
- **User interaction** — `ctx.ui`: select, confirm, input, notify
- **Custom UI** — полные TUI-компоненты с клавиатурой (`ctx.ui.custom()`)
- **Custom commands** — `/mycommand` (`registerCommand`)
- **Session persistence** — `pi.appendEntry()`, состояние переживает рестарты
- **Custom rendering** — как выглядят tool-коллы/сообщения в TUI
- **Stateful tools** — todo-листы, пулы соединений (пример todo.ts)
- **Внешние интеграции** — file watcher'ы, webhooks, CI (пример file-trigger.ts)

Документированные use-cases: permission-гейты, git-checkpoint (stash на каждый turn), защита путей (`.env`, `node_modules/`), кастомная компакция, summarize, интерактивные визарды, SSH remote exec, sandbox, игры (snake.ts, space-invaders.ts, doom-overlay/).

## 5. События — главный механизм перехвата

Категории: **Startup → Resource → Session → Agent → Model → Tool → User Bash → Input**.

### Session events
- `session_start` (reason: startup|reload|new|resume|fork) — инициализация in-memory состояния.
- `session_shutdown` (reason: quit|reload|new|resume|fork) — очистка ресурсов.
- `session_before_switch` — **вето** `{cancel: true}` на `/new` / `/resume`.
- `session_before_fork` — **вето** на `/fork` / `/clone`.
- `session_before_compact` / `session_compact` / `session_compact_failed` — **полная замена компакции**: можно вернуть `{compaction: {summary, firstKeptEntryId, tokensBefore}}` вместо дефолтной.
- `session_before_tree` / `session_tree` — навигация по дереву сессии, кастомный summary ветки.
- `session_info_changed` — переименование сессии.

### Agent events
- `before_agent_start` — после сабмита промпта, до agent loop. Может: **инжектить сообщение** (`{message: {customType, content, display}}`) и **переписать system prompt на этот ход** (`{systemPrompt: ...}`). Доступ к `systemPromptOptions`: customPrompt, selectedTools, toolSnippets, promptGuidelines, appendSystemPrompt, cwd, contextFiles (AGENTS.md), skills. Цепочечно по порядку загрузки extensions.
- `agent_start` / `agent_end` / `agent_settled` — `settled` = агент точно не продолжит сам (ретраи/компакция учтены).
- `turn_start` / `turn_end` — один ответ LLM + его туры.
- `message_start` / `message_update` (стриминг) / `message_end` — `message_end` может **заменить** финальное сообщение (сохранив role).
- `ui_prompt_start` / `ui_prompt_end` — нотификация «ждём юзера» для host-интеграций.
- `context` — перед каждым LLM-коллом, **мутация истории сообщений** (RAG, memory, вырезание): `return {messages: filtered}`.
- `before_provider_headers` / `before_provider_request` / `after_provider_response` — HTTP-уровень: заголовки, payload (temperature и т.п.), отслеживание 429/retry-after.

### Tool events
- `tool_call` — **до исполнения, может блокировать и мутировать аргументы**:
  - `event.input` мутабелен in-place; мутации видны позже загруженным handlers; ревалидации нет.
  - `return {block: true, reason, terminate?}` — блок; terminate гасит агента, если все результаты батча терминирующие.
  - `isToolCallEventType("bash", event)` — type-safe narro wing аргументов.
- `tool_result` — после исполнения, **middleware-цепочка** (порядок = порядок загрузки extensions): патчи `{content, details, isError, usage}`; можно дергать внешние API (пример — summarize-сервис через fetch).
- `tool_execution_start/update/end` — жизненный цикл исполнения (parallel mode: start в source-порядке, end в completion-порядке).

### User bash
- `user_bash` — `!` / `!!` команды: перехват с заменой backend'а (примеры: ssh.ts — команды уезжают на удалённую машину; interactive-shell.ts — персистентный шелл; gondolin/ — микро-VM).

### Input
- `input` — сырой ввод ДО раскрытия скиллов/шаблонов. Результаты: `continue` | `transform` (переписать текст) | `handled` (съесть без LLM). Порядок обработки: extension commands → input event → skills → templates → agent.

## 6. ExtensionContext (ctx)

- `ctx.ui` — select/confirm/input/editor/notify/setStatus (футер)/setWidget (виджет над редактором)/setEditorText/custom (полноценные компоненты).
- `ctx.mode` — "tui" | "rpc" | "json" | "print"; `ctx.hasUI` — true в TUI и RPC. В print/JSON UI-методы — no-ops (гардить перед вызовами).
- `ctx.cwd`, `ctx.isProjectTrusted()`, `ctx.sessionManager` (сессии, getSessionFile/Id).
- `ctx.modelRegistry / ctx.model / ctx.thinkingLevel / ctx.scopedModels` — модели.
- `ctx.signal` — AbortSignal: Esc отменяет и fetch, и nested-модели внутри handlers.
- `ctx.isIdle() / ctx.abort() / ctx.hasPendingMessages() / ctx.shutdown()`.
- `ctx.getContextUsage()` — занятость контекста; `ctx.compact()` — программный запуск компакции.
- `ctx.getSystemPrompt()` — текущий промпт (провайдер-уровневые перезаписи в нём не видны).
- `ctx.waitForIdle()` — дождаться полного settle (ретраи, queued follow-ups) — безопасно менять сессию.
- `ctx.newSession(options)` / `ctx.fork(entryId, options)` / `ctx.switchSession(path)` / `ctx.navigateTree(targetId)` — **программное управление сессиями**; в options — `setup` (мутация SessionManager до старта) и `withSession` (работа с НОВЫМ ctx после замены).
  - Футганы (из доки): после замены сессии старые `pi`/`ctx`/`sessionManager` протухают и кидают исключения; `withSession` получает свежий `ReplacedSessionContext`; state, инвалидированный shutdown, уже потерян — передавать только plain data.
- `ctx.reload()` — как `/reload`; после await — код продолжает выполняться старой версией, in-memory состояние считать невалидным; handler должен сразу `return`.

## 7. ExtensionAPI (pi) — методы регистрации

- `pi.on(event, handler)` — подписки.
- `pi.registerTool(definition)` — name, label, description, typebox-параметры, `execute(toolCallId, params, signal, onUpdate, ctx)`, опционально:
  - `promptSnippet` — строка в «Available tools» системного промпта;
  - `promptGuidelines` — буллеты в Guidelines (каждый должен называть тур по имени);
  - `prepareArguments` — shim до валидации схемы;
  - `renderCall/renderResult` — кастомный рендер;
  - `terminate: true` — финальный structured-output тур.
  - **Регистрация работает и в рантайме** (в session_start, командах, handlers) — тулы сразу в `pi.getAllTools()`, без reload. **Одноимённая регистрация переопределяет builtin-тур** (пример tool-override.ts: свой read).
- `pi.registerCommand(name, options)` — slash-команды.
- `pi.registerShortcut("ctrl+x", opts)`, `pi.registerFlag("my-flag", opts)`.
- `pi.registerMessageRenderer / registerMarkdownTransformer / registerEntryRenderer` — рендеринг.
- `pi.addAutocompleteProvider` — автокомплит (пример: #issue из `gh issue list`).
- `pi.sendMessage(message, options)` — кастомное сообщение в сессию; `deliverAs: "steer"|"followUp"|"nextTurn"`, `triggerTurn: true`.
- `pi.sendUserMessage(content, options)` — сообщение «от юзера», всегда триггерит turn; может раскрывать `/templates` (`expandPromptTemplates`).
- `pi.appendEntry(customType, data)` — персистентная запись в сессию (переживает рестарт; TUI-only контент — рендерить через registerEntryRenderer, LLM его не видит).
- `pi.setSessionName / getSessionName / setLabel` — метаданные сессии, закладки для /tree.
- `pi.exec(command, args)` — запуск процессов.
- `pi.getActiveTools / getAllTools / setActiveTools(names)` — **включение/выключение тулов в рантайме**.
- `pi.setModel / setThinkingLevel` — программная смена модели.
- `pi.events` — шина событий между extensions.
- `pi.registerProvider(name, config) / unregisterProvider` — кастомные LLM-провайдеры (примеры: Anthropic-прокси, GitLab Duo с OAuth, LiteLLM).

## 8. Кастомные туры — детали

- Схема — typebox: `parameters: Type.Object({...})`.
- Прогресс: `onUpdate?.({content: [...]})` — стриминг в UI.
- Результат: `{content: [{type: "text", ...}], details: {}}`.
- Remote execution: тул может быть клиентом удалённого сервиса (пример ssh.ts).
- Output truncation: `truncateHead` и т.п.
- Multiple tools / Dynamic Tool Loading: dynamic-tools.ts — регистрация после старта и из команд.

## 9. State management

In-memory состояние — в замыкании factory (reestablish в `session_start`, чистить в `session_shutdown` — сессии заменяются, extension инстанс ребайндится). Долгоживущие ресурсы (вотчеры, коннекты) — убивать в shutdown. Персистентное — `appendEntry` в session-файл или свой стор.

## 10. Режимы (mode behavior)

| Режим | ctx.mode | ctx.hasUI | Заметки |
|---|---|---|---|
| Interactive TUI | "tui" | true | всё, включая custom() |
| RPC | "rpc" | true | диалоги работают, TUI-специфика — no-ops |
| JSON (--mode json) | "json" | false | event stream в stdout, UI — no-ops |
| Print (-p) | "print" | false | extensions работают, промптить нельзя |

## 11. Примеры из репо (карта готовых паттернов)

- **Гейты**: permission-gate.ts (confirm на rm -rf), protected-paths.ts, dirty-repo-guard, confirm-destructive, project-trust.ts.
- **Сессии**: git-checkpoint.ts (stash на turn), auto-commit-on-exit.ts, custom-compaction.ts.
- **Контекст**: claude-rules.ts (правила из файлов), prompt-customizer.ts, system-prompt-header.ts.
- **Сабагенты**: examples/extensions/subagent/ — spawn сабагентов (на этом паттерне сделан и pi-subagents, и yokemate-расширение).
- **Удалённо/sandbox**: ssh.ts, interactive-shell.ts, sandbox/, gondolin/ (микро-VM).
- **Сложные**: plan-mode/ (полный plan mode), preset.ts, tools.ts.
- **UI**: modal-editor, custom-footer/header, widget-placement, doom-overlay/.
- **Коммуникация**: event-bus.ts, message-renderer.ts, send-user-message.ts.

## 12. Что это значит для mypi

1. **Сейфгарды плагинов (ADR-0002)** — `tool_call` handler + permission-gate паттерн. Yokemate так и построен (guards как extensions).
2. **Хук статусов (ADR-0001)** — «статус request сменился → запись в журнал / запуск flow» — extension: событие или кастомный тур с side-effect.
3. **Оркестраторы (ADR-0003)** — extension с registerTool("subagent"): диспетчер = extension, роли = agent.md, конфиг флоу = данные (flow.yaml). Вся таб-механика (herdr-табы, courtesy, return-address) — это extensions.
4. **Разделение слоёв**: механика (код) — extensions; роли/знания (данные) — .md-агенты, скиллы, home/-файлы. Интерпретатор конфига флоу — extension; флоу — YAML.
5. **Границы**: полный доступ к системе; хард-изоляция — только контейнер (gondolin/sandbox примеры), что совпадает с выводом ADR-0003 про «хард — уровень ОС».

## 13. Ключевые цитаты

> "Extensions are TypeScript modules that extend pi's behavior. They can subscribe to lifecycle events, register custom tools callable by the LLM, add commands, and more."

> "Security: Extensions run with your full system permissions and can execute arbitrary code. Only install from sources you trust."

> "Pi is a minimal agent harness. Adapt Pi to your workflows, not the other way around." — Features that other agents bake in, you can build yourself.