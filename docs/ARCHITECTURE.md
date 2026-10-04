# mypi — архитектура M1

Локальная система памяти, проектов и простого учёта запросов инженера.
Реализована на TypeScript strict / Node.js 24 LTS, ESM/tsc, SQLite + better-sqlite3,
SQL-миграциях без ORM, pnpm. Один пакет: модульный монолит, Ports & Adapters,
сценарии внутри предметных модулей.

M0 закрыт; исходные решения — [M0-CONTRACT.md](M0-CONTRACT.md).
Функциональная M1 реализована; опубликован v0.1.0-rc.1, но окончательная приёмка
остаётся открытой без независимого App issuer. Ход и доказательства — [M1-CYCLE.md](M1-CYCLE.md).
По прямому запросу инженера поддержка прототипа и импорт его данных удалены;
актуальная архитектура содержит только M1. Старые записи решений описывают своё время,
не дополнительные команды текущего продукта.

## 1. Границы

- Проекты и организации, необязательная привязка checkout.
- Память global/org/project, capture, notes/errors, глоссарий и артефакты.
- Warmup и чтение истории по scope без скрытых записей.
- Явные requests, статусы и progress; регистрация не запускает исполнение.
- Локальные Git commits контекста; SQLite backup и проверяемый restore.

Request не обязателен для обычной работы. Нет flow, runner/LLM, очереди исполнения,
tracker-обязательности, multi-device, сетевого sync, постоянного сервера или каталога сессий.
Реализован локальный stdio MCP: 31 инструмент, общий типизированный AppCommand с CLI,
без HTTP/daemon и управления сессиями. Подключение — [MCP.md](MCP.md), проверки — [MCP-CYCLE.md](MCP-CYCLE.md).

## 2. Структура и зависимости

```text
mypi/
├── src/
│   ├── cli/                       # argv → AppCommand, JSON, exit
│   ├── mcp/                       # SDK stdio, strict schemas, ответы/очередь
│   ├── app/                       # композиция, mixed-операции, warmup, backup/restore
│   ├── modules/
│   │   ├── projects/              # identity, реестр, scope, checkout
│   │   ├── requests/              # карточки, нумерация, справочник статусов
│   │   ├── memory/                # факты
│   │   ├── inbox/                 # immutable capture
│   │   └── knowledge/             # journal, notes, errors
│   ├── infrastructure/            # SQLite, файловые пути/запись, Git
│   └── shared/                    # общие типы scope, ошибки, partial
├── test/fast/, test/boundary/      # node:test + node:assert/strict
├── scripts/                       # только сборка и проверки
├── docs/, references/             # контракты, инструкции, доказательства, справочники
├── home/                          # отдельный ignored Git, не submodule
└── projects/                      # ignored рабочие клоны
```

```text
CLI / MCP → app → публичные API предметных модулей
модуль → собственные правила и порты
адаптер модуля → порты и техническая инфраструктура
composition root → конкретные адаптеры
```

Domain не делает IO, модули не обходят публичные API соседей. App координирует
несколько модулей и границ сохранения. CLI не дублирует бизнес-логику;
импорт модуля не запускает CLI. Направления импортов проверяются dependency-cruiser.
Без DI-фреймворка, event bus, CQRS, универсальных repositories или recovery engine.
Подробности — [M1-DESIGN.md](M1-DESIGN.md).

## 3. Источники данных

**SQLite — авторитет состояния и связей:**

```text
organizations(id, slug)
projects(id, org_id, slug, code, checkout_path)
request_statuses(id, code, is_terminal)
requests(id, project_id, number, title, status_id,
         context_dir, created_at, updated_at)
```

Четыре STRICT-таблицы, INTEGER PK, FK/unique/check/triggers, транзакционные
SQL-миграции с user_version. Статусы seed-ятся однократно. Неизвестная новая схема
отклоняется; readonly не создаёт отсутствующую БД.

Путь: `$XDG_STATE_HOME/mypi/state.sqlite3`, fallback `~/.local/state/mypi/state.sqlite3`.
БД и её backup находятся вне Git движка и home; пути внутрь них, включая
symlink aliases, запрещены. Создаваемые родительские каталоги — 0700, БД — 0600.

**Файлы — авторитет контекста и знаний:**

```text
home/
├── MEMORY.md
├── inbox/<UTC>-<UUID>.md
├── notes/<UTC>-<UUID>.md
├── journal/YYYY-MM.jsonl
├── requests/REQ-number-slug/
│   ├── source.md
│   └── <artifact-path>
└── projects/<org>/
    ├── MEMORY.md
    ├── notes/<UTC>-<UUID>.md
    └── <project>/
        ├── MEMORY.md
        ├── context.md
        ├── errors.md
        ├── notes/<UTC>-<UUID>.md
        └── requests/CODE-number-slug/
            ├── source.md
            └── <artifact-path>
```

Home внутри клона движка — самостоятельный репозиторий; данные в Git движка
не включаются. `home/projects/` — контекст, `<mypi>/projects/` — рабочие клоны.
Source/progress не дублируются SQL-полями; отдельного task journal/status.md нет.
Пользовательские данные этой очисткой не перемещаются и не удаляются.

## 4. Проекты, запросы и статусы

`org/project` — identity; checkout — необязательный канонический путь, не identity.
Код проекта уникален, состоит из букв верхнего регистра; REQ зарезервирован.
Код нельзя менять после появления задач. Title не переименовывает папку/ключ.

Запрос имеет внутренний ID и локальный number. MAX+1 выделяется под BEGIN IMMEDIATE
до записи source; удаление requests и повторное использование номера не предусмотрены.
Для project_id=NULL — отдельная нумерация REQ и scope=request, не фиктивный проект.

Начальный статус обязателен. Справочник хранится в БД, не enum кода или pipeline.
Used status нельзя удалить или изменить его терминальность; rename сохраняет stable ID
и не считается переходом/активностью задач. Тот же статус — no-op; terminal не reopen.
Продолжение терминального исхода — новая запись, а не переписывание истории.
Подробный контракт — [M1-REQUESTS.md](M1-REQUESTS.md).

## 5. Память, journal и warmup

Управляемый факт MEMORY — Markdown-строка `- "JSON string"`; multiline экранируется,
при чтении возвращается точный текст. Остальной Markdown — контекст, не формат факта.
Capture хранит точный оригинал в отдельном immutable-файле без trim/BOM/CRLF-потерь.
Notes имеют уникальные пути; errors дописываются, не переписываются.

Journal — общий append-only JSONL, UTC-ротация по месяцу; поля at/scope/event_type/text,
необязательные home-relative artifacts. Типы: note/request_created/status_changed.
События не запускают исполнение. Повреждённые/незавершённые строки не пропускаются молча.

Scope: global — только global; org — организация и потомки; project — проект и его
requests; request — собственная история. Режим all выбирается явно. CLI разрешает
связи через БД, потоково читает нужные месяцы, фильтрует до общего sort/limit.
SQL-копии/индекса истории нет.

Warmup наследует MEMORY родителей; org/project не получают общий inbox и чужой
контекст вне своего scope. Выдаёт индекс и пути, не заменяет чтение полных артефактов.
Нет обращения к прежним Markdown-журналам. Чтение не создаёт файлов/БД.
Scope — выборка, не файловый sandbox или ACL пользователя.

## 6. Сохранение и partial

- DB-only операции: транзакция; нет зависимости от Git или пустого commit.
- Изменения контекста: безопасная запись и commit только конкретных файлов.
- Request create: source → DB commit → journal → Git.
- Status/title: DB → journal → Git; progress: файлы/journal → Git → activity.

Общей атомарности SQLite/FS/Git нет. Partial сообщает сохранённое и недостающее,
пути и при наличии requestId; CLI возвращает nonzero, а не ложный успех.
Нельзя автоматически повторять append/create, откатывать уже сохранённую DB-карточку
или удалять source. Продолжение — после сверки: commit выбранных файлов,
строгий adopt-source, фактическая note вместо выдуманного перехода, явный touch.

FS запрещает traversal, symlink/hardlink aliases, неявный overwrite. Git сохраняет
чужой staged diff, не выполняет hooks/fsmonitor/signing/сеть. Private attributes
предотвращают EOL/encoding/filter-преобразования. Source/inbox неизменяемы;
journal/errors append-only. Journal committed prefixes проверяются до извлечения
ссылок на опубликованные материалы. Новая версия материала — новый путь.
Mutable-контекст восстанавливается новым commit из полной Git-ревизии.

## 7. Backup и восстановление

SQLite backup API под блокировкой cooperating writers; чистый Git bundle контекста;
checksum manifest появляется после проверки сохранённой пары. Backup DB-only разрешён
без создания home. Restore — только в отсутствующее состояние, с checksums,
проверками schema/integrity/FK и source/artifact references. Не затирает текущие данные.

Git не восстанавливает всю систему и незакоммиченный исходник. Backup БД и сетевой sync
не следуют автоматически из локального commit. Расписание/retention и подключение
личных данных требуют отдельного действия. Команды — [M1-CLI.md](M1-CLI.md).

## 8. Проверка и границы готовности

Единственная политика — [TESTING.md](TESTING.md): fast и boundary, обязательный verify,
systemd/cgroup v2 + bubblewrap, без сети и личных данных. Пределы не повышаются ради green;
нет неограниченного fallback. Admission не выдаётся за sandbox proof.

Проверяются правила через API, настоящие SQLite/FS/Git/CLI-границы, конкуренция,
частичные исходы, SIGKILL и backup/restore. Build-state исключает stale dist.
Тесты не запускают LLM и вложенные suites. Реальные результаты — [M1-CYCLE.md](M1-CYCLE.md).

Обычный hosted CI зелёный для опубликованного RC; независимый required App check
ещё не введён в эксплуатацию — [M1-CI.md](M1-CI.md). Это не production-ready приёмка.
Владелец локальных файлов/БД и GitHub admin остаются доверенными сторонами.

Будущие интеграции используют общий API M1. Юнит — роль, интерфейс, ограничения
и правила приёмки, не процесс сабагента или Pi extension. Flow и его приёмка
проектируются по отдельной реальной потребности, не глобальному human-only правилу.
