# MCP mypi

Локальный stdio-сервер в том же пакете, без HTTP/daemon/flow.
[План](MCP-PLAN.html), [ход, проверки и ограничения](MCP-CYCLE.md).

## Запуск

```sh
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm build
mise exec -- node dist/src/mcp/main.js
```

Последняя команда ожидает JSON-RPC на stdin, а не интерактивный ввод.
Bin: `mypi-mcp`. Node 24, SDK 1.32.0, Zod 4.6.5.
DB — действующий XDG_STATE_HOME (fallback ~/.local/state); home — внутри клона,
оба независимы от cwd клиента. Connect/tools/list не создают DB/home.

## Pi

Объедини только запись mypi из [примера](../integrations/pi/mcp.example.json)
с активным пользовательским `<agent-dir>/mcp.json`, подставив абсолютные пути
(`mise which node` и собранный entrypoint). Не заменяй другие серверы.
Добавь [инструкцию](../integrations/pi/mypi-instructions.md) в применяемый
пользовательский context-файл; учитывай AGENTS.override.md.
Сначала сохрани локальную копию конфигурации с исходными правами.
Два инструмента direct: project_resolve, warmup. Остальные — codemode.
Инструкция не является lifecycle-hook или гарантией автоматического warmup.

`/reload` подхватит настройку в открытой сессии; `/mcp` показывает состояние,
`/mcp reconnect mypi` переподключает. После новой сборки перезапусти MCP.
`pi mcp list` подключается ко **всем** включённым серверам: для проверки только
mypi используй отдельный временный agent-dir.
Личный bootstrap требует отдельного явного запроса.

## Контракт

31 инструмент и поля перечислены в плане и в стандартном tools/list.
Все аргументы strict, неизвестные поля отклоняются, в том числе вложенные.
Scope — обязательный объект global/org/project; журнал также request или явное
`"all"`. Project key — код, не org/project. У request_create project обязателен:
identity или null. Статусы валидирует DB, не enum.
TextInput — ровно `{text}` или `{file:absolutePath}`; BOM/CRLF сохраняются.
Context paths относительны home, progress artifacts — папке задачи.

Успех: `{status:"ok",data:...}`. Ошибка инструмента:
`isError:true`, `{status:"error",message}`. Partial содержит status, message,
saved, missing, paths и requestId, если он известен.
structuredContent и JSON в text content совпадают. Внутри data сохраняются
прежние JSON-формы CLI. Невалидный JSON-RPC остаётся protocol error SDK.
Неизвестное имя/невалидные аргументы well-formed tools/call получают наш error-envelope.

В одном процессе вызовы последовательны, включая async backup.
Отменённый ожидающий вызов не пишет; начатый синхронный вызов не обещает rollback.
EOF/SIGTERM прекращают принятие работы, отменяют ожидающие и дожидаются активного
вызова; принудительное завершение требует сверки неизвестного исхода.
Межпроцессные транзакции/защита — общие с CLI. Bootstrap/restore требуют остановки
других писателей. JSON-RPC ID не является ключом идемпотентности.

Scope не ACL. Сервер имеет права локального пользователя; file/checkout/backup
могут обращаться к явно указанным внешним путям. Нет произвольного SQL/shell.
Read-only hints не являются механизмом авторизации. Записи не объявлены
идемпотентными, backup не read-only. Ответы не обрезаются сервером.

## Откат

Удалить только запись mypi и отмеченный фрагмент инструкции, затем /reload.
Это не удаляет DB/home. Код возвращать Git revert с соответствующим lockfile
и новой сборкой; существующие записи сами не откатываются.
