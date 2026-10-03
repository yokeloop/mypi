# M1 — поэтапный цикл реализации

Запрос 2026-10-02: реализовать всю M1 по этапам, проверять каждый этап и не переходить дальше при несоответствии. Это разрешение на разработку и проверки, не на миграцию личных данных/сетевой sync/коммиты движка.

Критерии этапов:
1. Context/Git: безопасные пути, точный текст, no-overwrite, сохранность чужого dirty/staged diff, partial и явное завершение commit; реальные Git-проверки.
2. Journal: UTC-ротация, строгая оболочка, потоковое чтение всех месяцев, scope/filter до общего limit, повреждение не маскируется.
3. Requests: DB authority, атомарная нумерация, явные расширяемые статусы, terminal/no-op, source/artifacts/journal/partial без повторного создания.
4. Memory/knowledge/inbox/warmup: все legacy-сценарии без Python, сохранность multiline, read-only, наследование без чужого scope/inbox.
5. Import/backup/restore: повторяемость, сохранность оригиналов, проверка ссылок, реальные восстановленные данные, без личной миграции.
6. Интеграция CLI и итоговая приёмка по PLAN/TESTING: bounded verify, отрицательные/конкурентные проверки, доказательства и честные оставшиеся ограничения.

Журнал этапов дополняется только после фактических проверок.

**Текущий статус (2026-10-03):** функциональные этапы 1–6 реализованы, локальные проверки — 19/19. Независимый статический reviewer подтвердил исправления продуктового кода после двух полных обзоров и двух уточнений ([итог](evidence/m1-independent-review-4.md)); это не запуск тестов reviewer и не человеческая приёмка. Доверенный удалённый gate/CI остаётся заблокирован: имя job и GitHub Actions App не удостоверяют workflow ([подробности](M1-CI.md)). M1 не закрыта; к следующей фазе не переходили.

## Этап 1 — проверен

ContextFiles и ContextGit, общий changeContext: точный текст, no-overwrite, отказ по traversal/symlink/hardlink, dirty-target precondition, commit только перечисленных файлов, сохранение чужого staged diff. Git failure возвращает partial, файлы сохраняются; повторный append блокируется dirty-target, завершение — явный commit после сверки. При проверке добавлены partial-проверка и отказ на переадресованную .git. 9/9 tests, bounded verify прошёл: [запуск](evidence/m1-stage-1.txt). Сериализация составных операций подключается владельцем SQL-транзакции; автоматического retry/recovery нет.

 Самопроверка не является независимым review; trusted gate и внешние права не появляются от создания scripts.

## Этап 2 — проверен

JSONL writer/stream reader с UTC-ротацией, строгой оболочкой и непустыми artifact paths, фильтры до общего порядка/limit. При заданном limit хранится только ограниченное число результатов. Проверены multiline/CRLF, пересечение месяцев, перемешанный порядок, malformed scope/дата и оборванная строка. В первом запуске fsync был запрещён Node permission mode: реальную durability-проверку поместили в обязательный boundary, pure-правила проверяются в fast; ограничения не ослаблены. 11/11 tests, [bounded verify](evidence/m1-stage-2.txt). Связи org/project/request будут разрешаться публичными API БД в этапе 3, не regex вместо БД.

## Этап 3 — проверен

Request API: отдельные MP/YM/REQ номера внутри BEGIN IMMEDIATE, source без trim/overwrite, явный статус, расширяемый справочник и устойчивый status_id. No-op без записи, terminal без reopen. История разрешает родителей по публичным API владельцев, не читает чужие SQL-таблицы. Проверены source/artifacts/progress, переход через месяц, global/org/project/request выборки и Git failure после успешной DB-смены. Явный complete не повторяет append. Два независимых writer-процесса сохранили номера 1/2 и две записи. При review derivation context_dir перенесена в доверенное разрешение проекта; progress поддерживает явные существующие артефакты. 13/13 tests: [bounded verify](evidence/m1-stage-3.txt).

## Этап 4 — проверен

Модули memory/inbox/knowledge и read-only warmup подключены к общим файловым/Git механизмам и DB-сериализации. Capture хранит точный source в отдельном immutable inbox/*.md (без captures SQL), facts поддерживают multiline через JSON-строки в MEMORY.md; исходный Markdown сохраняется. Notes с одинаковым заголовком не перезаписываются. Scoped warmup наследует MEMORY родителей, не inbox/чужой проект. Remove отвергает незакоммиченный preimage. Проверка обнаружила необходимость отказа на невалидный Unicode и на перепубликацию изменённого source/переписывание журнала через generic commit; исправлено во всех входах Git. 14/14: [bounded verify](evidence/m1-stage-4.txt).

## Этап 5 — проверен

Backup: SQLite backup API при блокировке cooperating writers, отдельный Git bundle, checksum manifest последним; DB/snapshots вне git. Restore только в отсутствующие DB/context, с проверкой integrity/FK, checksums и ссылок source/artifacts. Повтор restore отказывается без изменений, повтор import возвращает already_imported. Импорт принимает отдельный read-only legacy archive и явные коды, сохраняет текст/бинарные файлы, исходные Markdown-журналы доступны по legacy-journal путям warmup. Конфликты/повреждённый паспорт не превращаются в пустое состояние. Git recovery требует committed preimage; immutable/append-only пути не переписываются. Зафиксирована byte-preserving Git attribute policy, чтобы CRLF/filters не меняли source при восстановлении. 16/16 tests: [verify](evidence/m1-stage-5.txt). Реальные личные данные не мигрировались. Legacy CLI будет отключён при переключении основного входа в этапе 6; никаких двух активных паспортов новая реализация не использует.

## Этап 6 — функциональные проверки пройдены, итоговая приёмка открыта

Node CLI подключает все сценарии через app, не через Python. Legacy CLI/bootstrap отключены;
исторические тела сохранены. [Одноразовая проверка отключённых входов](evidence/m1-retired-entrypoints.txt)
выполнена в отдельной ограниченной копии; основной suite не требует Python. Временная сквозная установка проверяет capture с BOM/CRLF, memory,
note/error/warmup, request/status/progress, partial Git failure, явный commit без повторного append,
backup и restore в независимую свежую установку. Parser проверяется без отдельного процесса на каждый
вариант правила; boundary проверяет реальную композицию.

При review исправлены: потеря BOM при декодировании, восстановление удалённого mutable-файла и
бинарных bytes через Git, DB-only backup без home, соответствие import receipt авторитетной БД,
публикация manifest только после проверки source/artifact-ссылок в реальном snapshot checkout,
запрет ignored-контекста при backup, fsmonitor во всех Git-входах. Публичный workspace не экспортирует
низкоуровневые request-мутации под видом status API или внешний transaction callback.

Обнаружен реальный дефект readonly: SQLite допускал source callback до ошибки INSERT.
Сначала добавлена проверка — она упала с `readonly must reject before source writes`.
До следующего этапа не переходили; adapter теперь отказывает до callback, повторный verify зелёный.
[Запись red → green](evidence/m1-stage-6.txt).

Ещё одна воспроизведённая ошибка: immutable-проверка большого файла через Git stdout
упиралась в ENOBUFS. Лимит не поднят: сравнение заменено потоковым hash префикса Git blob.
Commit/restore принимают конкретные файлы, не directory pathspecs, включая удалённые
каталоги: иначе можно обойти immutable/append-only guards через родителя.
[Регрессионная проверка](evidence/m1-git-guard-regression.txt).

Дополнительно проверены:
- SQL failure после source: исходник остаётся, DB-card и событие отсутствуют; явное adopt-source
  не принимает изменённый текст и регистрирует ровно одну карточку.
- SIGKILL собственного writer после DB commit, до журнала: при новом открытии карточка/source сохранены;
  сверка добавляет note о проверенном состоянии, не выдуманный переход и не второй request.
- бинарный существующий artifact не декодируется как UTF-8 ради ссылки.
- мутации утечки inbox в scoped warmup и terminal reopen ловятся нужными assertions в отдельной временной копии;
  [полные результаты](evidence/m1-final-sensitivity.txt). Копия удалена.
- Полный ограниченный verify и отдельный fast: [итоговый запуск](evidence/m1-final-checks.txt).
  Verify: 18/18, service runtime 4.378 s, memory peak 323.7 MiB, tasks peak 36.
  Отдельный fast: 8/8, service runtime 0.981 s. Build fingerprint сохранён рядом с выводом.

### Сопоставление Acceptance M1

| Критерий PLAN | Проверенное свидетельство |
|---|---|
| Полезные сценарии без Python/flow | workspace CLI + memory/requests boundary |
| DB authority, статусы, отдельные номера, scope/ротация | requests, journal, database; два writer-процесса |
| Точный текст, no-overwrite, безопасные пути, read-only | context, memory, paths-cli, readonly red→green |
| Повторяемый import/restore, повреждённый вход | maintenance; checksum/receipt/source/artifact проверки |
| DB/Git/partial различимы, без повторного append | requests + workspace CLI + SIGKILL/reconciliation |
| Реальное восстановление, Git не backup всей системы | native SQLite backup + Git bundle + независимый restore |
| Границы модулей и бюджет verify | dependency-cruiser/admission + systemd/cgroup/bubblewrap |
| Работа без обязательного request | memory/inbox/notes/project CLI до регистрации первого запроса |

### Что не объявляется завершённым

Независимый review и trusted gate/CI по TESTING отсутствуют. Gate в изменяемом checkout не защищён
от намеренного self-bypass автора; повторный собственный запуск не заменяет внешнюю проверку.
Поэтому **M1 не объявлена принятой и закрытой**. Новые внешние права, engine commits, настройка
удалённого CI и запуск сабагентов этим отчётом не разрешаются.

Нет обещания exactly-once audit или атомарности SQL+FS+Git; при неоднозначности нужна сверка.
SIGKILL-проверка не является испытанием физической потери питания. Замеры — отдельные локальные
запуски, не baseline/p95. Другие ОС и личная миграция не испытывались.

Исход разработки записан здесь и в evidence, без создания личного home ради журнала.
Рабочие клоны проектов, личная БД, сетевой sync и commits движка не выполнялись.


## Независимое review и CI — 2026-10-03

Инженер разрешил reviewer, CI и публикацию подробного интерактивного отчёта через Derive.
Reviewer запускался отдельным Pi-процессом без tools/extensions/context, под отдельным systemd deadline/cgroup;
модель та же семья, не независимый поставщик. Узкая предварительная калибровка — 4/4
([результат](evidence/m1-review-calibration.json)), без утверждения общей квалификации.

- [Обзор 1](evidence/m1-independent-review-1.md): dangling DB symlink, mutable published artifact,
  история title и import destination collision; исправлено, регрессии добавлены.
- [Обзор 2](evidence/m1-independent-review-2.md): обнаружен обход через рабочий JSONL и подмена CI-check.
  Префиксы всех журналов из HEAD теперь проверяются до публикаций/коммитов, включая удалённые файлы.
  Идемпотентность и ссылки проверяются точными оракулами; CLI matrix преимущественно in-process.
- [Уточнение 3](evidence/m1-independent-review-3.md) требовало Git-проверку перед DB-only операциями.
  Это выход за Q5; код не расширяли этим правилом.
- [Уточнение 4](evidence/m1-independent-review-4.md): возражение отозвано, продуктовый fix одобрен статически;
  CI отдельно BLOCKED. Все исходные ответы сохранены.

Добавлен IPC-тест write reservation до source callback. В отдельной копии замена IMMEDIATE на deferred
действительно ловится assertion ([мутация](evidence/m1-contention-sensitivity.txt)).
Финальный ограниченный запуск и fingerprint: [проверки](evidence/m1-review-final-checks.txt).

CI entrypoint локально выполняет ограниченную сборку/verify из отдельных base/candidate;
ослабленный MemoryMax отвергнут ([запись](evidence/m1-ci-checks.txt)).
Удалённо включён SHA pinning Actions. Временная branch protection откачена после выявления подмены check;
org rulesets API требует отсутствующий admin:org, расширения прав не было.
[Текущее состояние и блокер](M1-CI.md), [readback](evidence/m1-ci-control-plane-blocker.txt).

Это не закрытие M1. Код движка, ветки и PR не публиковались; личные данные не мигрировались.

[Интерактивный отчёт Derive](https://draft.yokeloop.com/artifacts/mypi-m1-bqso2mhf) опубликован по запросу инженера;
[публикация и сверка](evidence/m1-report-publication.txt). Исходник — [HTML](reports/m1-report.html).
Снимок Derive проверен визуально; локальная автоматическая проверка кликов Chromium не завершилась
в текущей среде (crash, затем task exhaustion/deadline), бюджеты не повышались и успех не заявлялся.


## Разрешение публикации — 2026-10-03

Инженер ответил «делай все разрешаю» на отдельный GitHub App/доверенный CI и коммиты/ветку/push/PR в yokeloop/mypi без автоматического merge. Затем подтвердил размещение home/ внутри клона отдельным Git-репозиторием: «нет все правильно, так и оставляем. Продолжай работу». Личный bootstrap/миграция не выполняются; исходный код публикуется отдельно от данных пользователя.


## Публикация и hosted-проверка — 2026-10-03

Создана ветка m1/implementation и draft [PR #1](https://github.com/yokeloop/mypi/pull/1), без merge.
Ранее накопленные договорённости сохранены отдельным коммитом 9be933a; код и доказательства — 8b7a3ac.
Обнаружено, что старый незафиксированный шаблон gitignore projects/ также исключал src/modules/projects:
32bec0f ограничил игнорирование корневыми /home/ и /projects/ и включил уже проверенный модуль.
Все 37 исходных и 13 тестовых файлов находятся в Git. Свежий git archive e10adf9 прошёл локальный bounded CI: 19/19.

Независимый CI reviewer обнаружил writable tools bridge: теперь весь build workspace readonly, кроме dist;
build сохраняет mountpoint. [Review](evidence/m1-ci-design-review-1.md), [подтверждение](evidence/m1-ci-design-review-2.md),
[probe](evidence/m1-ci-readonly-build.txt): запись в tools/node и корень запрещена, сборка/tests проходят.

Настроен environment mypi-gate: только branch main. App publisher отделён от test runner, секретов пока нет.
Hosted Ubuntu 24.04 прошёл checkout/Node/pnpm/install, но bwrap остановился ДО тестов.
[Диагноз](evidence/m1-hosted-isolation-diagnosis.txt): AppArmor unprivileged_userns запрещает setpcap/net_admin.
Ограничения не снимались, alternative unbounded runner не запускался. Это не зелёный CI и не закрытие M1.

Нужны интерактивная регистрация/установка App владельцем GitHub и согласованный точечный профиль AppArmor
для bwrap на одноразовом CI-runner (не глобальное отключение AppArmor). Последовательность — M1-PUBLISH.
Raw evidence сохранены дословно: staged diff --check сообщает trailing spaces в старых логах/review;
код/документы вне docs/evidence проходят whitespace check. Старые записи ради форматирования не переписывались.
