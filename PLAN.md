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

## Фаза 2 — request lifecycle в файлах

Цель: draft из inbox превращается в tracked work, но всё ещё без БД и агентов.
Подробное обоснование — `adr/ADR-0001-three-layers-files-db-tracker.md` (proposed).

- [ ] `request` сущность: файл `home/<org>/<project>/requests/<id>.md` с frontmatter (status: draft|backlog|shipping|acceptance|done|canceled, created, links, related)
- [ ] Команды: `mypi request new <id>` (из inbox draft), `mypi request status <id> <status>` с валидацией переходов (упрощённая state machine из NorthStar 04: draft→backlog→shipping→done + cancel; planning как осознанный интерактивный шаг, не отдельный статус до фазы 4)
- [ ] `mypi request list` по статусам
- [ ] Авто-журнал: смена статуса автоматически добавляет outcome-строку в журнал проекта (проверенный паттерн yokemate)
- [ ] Паспорт: поле tracker в projects.json, команда `request import` — issue как draft (односторонняя проекция, тикет не условие работы)

Граница фазы: state machine в файлах с git-историей. БД всё ещё нет.

## Фаза 3 — облачная БД статусов

Цель: статус задачи живёт в удалённой БД для синка между устройствами в реальном времени.

- [ ] PostgreSQL как single authoritative store (ADR-0001: без multi-master, БД — проекция, requests-файлы — seed и источник восстановления)
- [ ] Схема = frontmatter requests-файлов: request(id, title, description, status, org, project, links[], related[], created, updated, closed)
- [ ] MYPY_HOME_REMOTE → дополнить MYPI_STORE_URL; bootstrap подключает store
- [ ] CLI-команды фазы 2 работают поверх store; интерфейс не меняется, меняется backend
- [ ] Синк в момент действия: команда = commit в git + транзакция в БД (без фоновых демонов)
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