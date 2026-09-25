# План mypi

Статус: план фаз. Фаза 1 реализована; фазы 2-3 — направления, не обязательства.

## Фаза 1 — основа памяти и проектов (сейчас)

Цель: минимальная полезная система без агентов и БД.

- [x] `home/` — вложенный git со своей структурой (journal, inbox, knowledge, notes, projects.json)
- [x] `scripts/bootstrap.sh` — поднятие home/ из remote или с нуля
- [x] `scripts/mypi.py` — CLI: warmup, capture, journal, note, project add/list
- [x] Контракты: README, CONCEPT, PLAN, AGENTS
- [x] Пример проекта в паспорте (prineycom/sp-cli)
- [x] Пуш на GitHub

### Acceptance фазы 1

- [x] warmup показывает: журнал (последние N записей), проекты из паспорта, inbox drafts
- [x] capture записывает черновик в inbox.md с датой, без изменений формулировки
- [x] journal добавляет запись в месячный файл, newest-first
- [x] project add/list читает/пишет projects.json
- [x] Всё на python3 stdlib, ноль зависимостей
- criteria: запустить на Pi и на другой машине — работает одинаково

## Фаза 2 — request lifecycle в файле

Цель: draft из inbox превращается в tracked work, но всё ещё без БД и агентов.

- [ ] `request` сущность: файл `home/requests/<id>.md` с frontmatter (status: draft|backlog|planning|shipping|acceptance|done, created, links)
- [ ] Команды: `mypi request new <id>` (из inbox draft), `mypi request status <id> <status>` с валидацией переходов (state machine как в NorthStar 04, но упрощённая: draft→backlog→shipping→done + cancel)
- [ ] `mypi request list` по статусам
- [ ] Journal-хук: смена статуса автоматически добавляет outcome-строку в журнал (как outcome lines в yokemate)
- [ ] Паспорт: поле tracker в projects.json, импорт issue как draft

Граница фазы: state machine в файлах с git-историей. БД всё ещё нет.

## Фаза 3 — облачная БД статусов

Цель: статус задачи живёт не в файле, а в удалённой БД для синка между устройствами в реальном времени.

- [ ] Выбор БД: PostgreSQL (single authoritative store, как рекомендует NorthStar roadmap) — без multi-master, без SQLite-синка через git
- [ ] Схема: request(id, title, description, status, links[], related[], created, updated) — плоская, но со связями; детальная схема — отдельная проработка из опыта фаз 1-2
- [ ] MYPY_HOME_REMOTE → дополнить MYPI_STORE_URL; bootstrap подключает store
- [ ] CLI-команды фазы 2 работают поверх store
- [ ] Оркестрация всё ещё без агентов: человек + CLI

## Фаза 4 — сабагенты

Цель: подключаемые плагины-сабагенты в виде набора инструкций и скриптов + конфиг pi-агента.

- [ ] Формат плагина: `<plugin>/SKILL.md + scripts/ + config.yaml`
- [ ] Плагин описывает: роль, сейфгарды, права, условия запуска и передачи
- [ ] Конфиг-флоу на проект (из исходной идеи): статус↔сабагент, массив шагов, луп, правила перехода
- [ ] Вложенный граф сабагентов — только внутри плагинов (как в исходной идее: ограничения внутри плагина)
- [ ] Консистентность с NorthStar: координатор не выполняет предметную работу; reviewer отделён от executor

## Фаза 5 — pipeline/табы

Цель: каждый пайплайн на задачу — отдельный таб; таб-оркестратор имеет свою конфигурацию.

- [ ] Табы (клоны coordinator chat) — сверить с NorthStar темой 1 «координатор и клоны»
- [ ] Handoff между табами/машинами — сверить с NorthStar темой 2 ownership
- [ ] Sandbox playbook на проект — сверить с NorthStar lifecycle Deploying

## Что НЕ делать

- Не реализовывать оркестратор до контрактов (запрет NorthStar).
- Не синкать mutable SQLite через git.
- Не строить multi-master репликацию.
- Не добавлять tracker как обязательное условие.
- Не переносить command set из Yoke/Yokemate/PiOps.