# mypi

**Релиз-кандидат:** [v0.1.0-rc.1](https://github.com/yokeloop/mypi/releases/tag/v0.1.0-rc.1) — для проверки инженером, не production-ready. [Установка/ограничения](docs/RELEASE.md) · [полная карта файлов](docs/FILEMAP.md) · [интерактивный отчёт опубликованного RC](https://draft.yokeloop.com/artifacts/mypi-m1-bqso2mhf) (исторический снимок, до очистки). Обычный hosted CI проходит; независимый App issuer и окончательная приёмка M1 ещё открыты.

Личная система управления памятью и проектами для Pi-агента.

**Выбранный стек:** TypeScript strict, Node.js 24 LTS, ESM/tsc,
SQLite + `better-sqlite3`, pnpm; тесты — `node:test` + `node:assert/strict`.

**Выбранная архитектура:** модульный монолит с Ports & Adapters;
БД — источник управляемого состояния,
Markdown — контекст и знания агентов. Первая поставка — память и проекты
на одной машине, включая простой учёт запросов инженера и их состояния в БД.
Папка задачи хранит исходник и артефакты, история — в общем JSONL-журнале
с помесячной UTC-ротацией (`home/journal/YYYY-MM.jsonl`, M1-REQUESTS §12); карточка и текущий статус — в БД. Выборки через Node CLI учитывают
все нужные файлы журнала, без индексации. Первый интерактивный flow MP-5 добавлен отдельно; общего scheduler нет.

**Фактический код:** реализованы Node.js CLI/API памяти, проектов, запросов,
контекста/Git, журнала и backup/restore. Поэтапные проверки —
[`docs/M1-CYCLE.md`](./docs/M1-CYCLE.md). Окончательная приёмка M1 пока не закрыта:
независимое статическое review проведено, исправления подтверждены; доверенный CI-gate заблокирован ([причина](./docs/M1-CI.md)).
**M0 закрыт:** архитектурный контракт принят; запись приёмки —
[`docs/M0-CONTRACT.md`, §8](./docs/M0-CONTRACT.md#8-итоговая-приёмка-m0).
Первоначальный срез сохранён в [`docs/M1-IMPLEMENTATION.md`](./docs/M1-IMPLEMENTATION.md).
Актуальные команды — [`docs/M1-CLI.md`](./docs/M1-CLI.md). M1 ещё не принята.

**MP-5:** интерактивный Pi в отдельном Herdr-tab, изоляция ресурсов, scoped MCP,
приватный Git и управляемые start/stop/resume/export. [Команды и ограничения](docs/MP-5-RUNTIME.md)
· [проверки](docs/MP-5-VERIFICATION.md). Это не production/security acceptance.

**MCP:** локальный stdio-сервер, 37 инструментов поверх общего типизированного API.
[Запуск и подключение Pi](docs/MCP.md) · [цикл реализации и evidence](docs/MCP-CYCLE.md).
Нового релиза нет; личный bootstrap не выполняется автоматически.

## Философия

- **Контекст — в файлах, состояние — в БД.** MEMORY, journal, notes и
  артефакты живут в `home/` со своим git. Управляемые состояния и связи — в
  авторитетной БД, не в Markdown frontmatter. БД требует собственного backup.
- **Обычная работа разрешена без учёта.** Сообщение не создаёт request;
  capture и учёт включаются явно.
- **Journal хранит исходы, не процесс.** Код, решения, тупики — одной строкой
  со ссылками на артефакты по путям. Никаких «обсудили X».
- **Опубликованные артефакты адресуемы.** Принятые plan/report/review не
  перезаписываются; рабочие drafts, актуальная память и статус ADR могут
  изменяться с сохранением истории.
- **Контекст проекта — папка.** Память, глоссарий, ADR, заметки и
  артефакты — в `home/projects/<org>/<project>/`; org имеет свою память. Это не папка
  со вторым источником текущих DB-статусов. История задачи находится в общем
  JSONL-журнале и выбирается по scope через CLI; это не state machine в файлах.
- **Сохранение и синк различаются.** Для файлов CLI должен делать локальный
  git commit; сеть разрешается отдельно. DB-only изменения — транзакция;
  БД в git не хранится, backup отдельно. Обработка реальных частичных сбоев
  не требует заранее универсального recovery engine.
- **Будущая приёмка — контракт юнита.** Кто/что принимает результат,
  зависит от выбранных юнитов и flow, а не глобального human-only правила.
  Принятое название компонента — **unit / юнит**: роль, интерфейс, ограничения
  и правила приёмки; не запущенный экземпляр агента.

## Разработка Node.js M1

Версии зафиксированы в `mise.toml`, `package.json` и lockfile. Из корня:

```bash
timeout --kill-after=5s 295s mise install
timeout --kill-after=5s 295s mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm build
mise exec -- pnpm verify
```

`test` запускает только fast, `verify` — admission + fast + boundary. Нужны Linux,
пользовательский systemd с cgroup v2 и bubblewrap; без ограничений тесты не запускаются.
После изменения исходников/тестов сначала `build`: устаревший dist отклоняется.
Установка ограничивается 5 минутами, build/typecheck — 60 секундами (TESTING §6);
ограничение установки включено в команду выше.

Пока только временные данные, без подключения личного хранилища:

```bash
state_dir="$(mktemp -d)"
export XDG_STATE_HOME="$state_dir"
mise exec -- node dist/src/cli/main.js db init
mise exec -- node dist/src/cli/main.js project add example/demo --code DEMO
mise exec -- node dist/src/cli/main.js project list
# После просмотра результата временное хранилище можно удалить: rm -rf "$state_dir"
```

Опциональная привязка checkout — `--path <directory>`, фильтр списка — `--org <org>`.
Ответы/ошибки — JSON; ошибки дают ненулевой exit. `db init` создаёт только БД,
не home и не git; обычное чтение отсутствующую БД не инициализирует.
Полный синтаксис и безопасное продолжение partial — [`docs/M1-CLI.md`](./docs/M1-CLI.md).
Bootstrap не запускай автоматически ради демонстрации;
сквозные проверки сами создают временные установки.

## Размещение M1

```text
mypi/
├── src/                  # cli, app, modules, infrastructure, shared
├── test/                 # fast и boundary
├── scripts/              # только build/checks
├── home/                 # самостоятельный ignored Git контекста
│   ├── MEMORY.md
│   ├── inbox/*.md
│   ├── notes/*.md
│   ├── journal/YYYY-MM.jsonl
│   ├── requests/REQ-number-slug/
│   └── projects/<org>/<project>/
│       ├── MEMORY.md, context.md, errors.md
│       ├── notes/
│       └── requests/CODE-number-slug/
└── projects/             # ignored рабочие клоны

$XDG_STATE_HOME/mypi/state.sqlite3  # вне обоих Git
```

У задачи source.md и материалы находятся в context_dir. Текущий статус —
в SQLite, история — в общем JSONL. Для организации MEMORY лежит в
`home/projects/<org>/MEMORY.md`. `home/projects/` и рабочие клоны — разные каталоги.

`warmup -s org/project` наследует MEMORY родителей и читает индекс истории выбранного
проекта, не общий inbox и не чужие проекты. `journal read` поддерживает
global/org/project/request; весь журнал — только через явный `--all`.

В рабочем дереве осталась только реализация M1: старый прототип, импорт его данных
и совместимость форматов удалены по запросу инженера. Исторический RC и evidence
описывают свои версии; текущую очистку фиксирует [M1-CYCLE](docs/M1-CYCLE.md#удаление-прототипа-и-совместимости).
SQL-миграции схемы M1 и backup/restore сохранены.

## Документы

- [`docs/M0-CONTRACT.md`](./docs/M0-CONTRACT.md) — исходные ответы инженера, принятые решения и оставшиеся уточнения.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — актуальная архитектура M1, данные, сценарии и границы.
- [`docs/M1-DESIGN.md`](./docs/M1-DESIGN.md) — принятые стек, модульный монолит, Ports & Adapters и организация кода.
- [`docs/M1-START.md`](./docs/M1-START.md) — принятый пакет подготовки: минимальная схема БД, путь, partial-контракт и ссылка на стартовые лимиты тестирования; не разрешение реализации.
- [`docs/M1-REQUESTS.md`](./docs/M1-REQUESTS.md) — принятые DB-карточка, папка артефактов и общий JSONL-журнал без индексации; принятые scope, справочник request_statuses(id, code, is_terminal) с начальным набором статусов и устойчивой ссылкой requests.status_id (§18/§19), явный выбор статуса при создании без is_initial/default (§20), INTEGER PRIMARY KEY для id всех четырёх таблиц (§21) и обязательный event_type (note/request_created/status_changed, §13); полная JSONL-оболочка принята (§14); именование проектных задач `MP-23-task-name-example` и нумерация приняты (§2.4/§15); запросы без проекта разрешены (§16), приняты REQ-number, отдельная общая нумерация и home/requests/ (§17).
- [`docs/TESTING.md`](./docs/TESTING.md) — принятая политика тестирования и стартовые численные бюджеты (§6/§11); локальный запуск ограничен; проверки и оставшиеся ограничения защиты описаны в M1-IMPLEMENTATION.
- [`references/pi-subagents-reference.md`](./references/pi-subagents-reference.md) — справочник: все frontmatter-поля, гварды, модели, best practices pi-subagents.
- [`references/pi-extensions-reference.md`](./references/pi-extensions-reference.md) — справочник: extensions Pi (события, ExtensionAPI, кастомные туры, режимы, маппинг на mypi).
- [`PLAN.md`](./PLAN.md) — фазы развития, фаза 1 и что дальше.
- [`AGENTS.md`](./AGENTS.md) — правила агента, работающего в корне mypi.