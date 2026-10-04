# Карта файлов mypi — рабочее дерево M1

Сгенерировано `mise exec -- node docs/reports/build-report.mjs` из текущего рабочего дерева (включая новые и исключая удалённые файлы).
Базовый commit: `580942ddce9dc907e683e27a45e114c3d2313f96`. Изменённые файлы не выдаются за опубликованный RC.
Релиз-кандидат, не окончательная приёмка M1. `home/` в Git движка отсутствует.

## Движок — полное дерево

```text
├── .dependency-cruiser.cjs
├── .github/
│   ├── CODEOWNERS
│   └── workflows/
│       └── m1-verify.yml
├── .gitignore
├── .npmrc
├── AGENTS.md
├── PLAN.md
├── README.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── FILEMAP.md
│   ├── M0-CONTRACT.md
│   ├── M1-CI.md
│   ├── M1-CLI.md
│   ├── M1-CYCLE.md
│   ├── M1-DESIGN.md
│   ├── M1-IMPLEMENTATION.md
│   ├── M1-PUBLISH.md
│   ├── M1-REQUESTS.md
│   ├── M1-START.md
│   ├── MCP-PLAN.html
│   ├── RELEASE.md
│   ├── TESTING.md
│   ├── evidence/
│   │   ├── m1-ci-checks.txt
│   │   ├── m1-ci-control-plane-blocker.txt
│   │   ├── m1-ci-design-review-1.md
│   │   ├── m1-ci-design-review-2.md
│   │   ├── m1-ci-readonly-build.txt
│   │   ├── m1-contention-sensitivity.txt
│   │   ├── m1-final-checks.txt
│   │   ├── m1-final-sensitivity.txt
│   │   ├── m1-git-guard-regression.txt
│   │   ├── m1-hosted-first-failure.txt
│   │   ├── m1-hosted-green.txt
│   │   ├── m1-hosted-isolation-diagnosis.txt
│   │   ├── m1-independent-review-1.md
│   │   ├── m1-independent-review-2.md
│   │   ├── m1-independent-review-3.md
│   │   ├── m1-independent-review-4.md
│   │   ├── m1-initial-checks.txt
│   │   ├── m1-rc-review.md
│   │   ├── m1-remove-legacy-build.txt
│   │   ├── m1-remove-legacy-docs.txt
│   │   ├── m1-remove-legacy-final-build.txt
│   │   ├── m1-remove-legacy-final-verify.txt
│   │   ├── m1-remove-legacy-red-build.txt
│   │   ├── m1-remove-legacy-red.txt
│   │   ├── m1-remove-legacy-verify.txt
│   │   ├── m1-report-browser-check.txt
│   │   ├── m1-report-browser-initial.txt
│   │   ├── m1-report-publication.txt
│   │   ├── m1-report-rc-browser.txt
│   │   ├── m1-retired-entrypoints.txt
│   │   ├── m1-review-calibration.json
│   │   ├── m1-review-current-checks.txt
│   │   ├── m1-review-final-checks.txt
│   │   ├── m1-review-input-sha256.txt
│   │   ├── m1-review-regressions-green.txt
│   │   ├── m1-review-regressions-red-runtime.txt
│   │   ├── m1-review-regressions-red.txt
│   │   ├── m1-stage-1.txt
│   │   ├── m1-stage-2.txt
│   │   ├── m1-stage-3.txt
│   │   ├── m1-stage-4.txt
│   │   ├── m1-stage-5.txt
│   │   ├── m1-stage-6.txt
│   │   └── mcp-plan-publication.txt
│   └── reports/
│       ├── build-report.mjs
│       ├── file-guide.mjs
│       ├── m1-report.html
│       └── page.css
├── mise.toml
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── references/
│   ├── pi-extensions-reference.md
│   └── pi-subagents-reference.md
├── scripts/
│   ├── admission.mjs
│   ├── build-state.mjs
│   ├── build.sh
│   ├── check.sh
│   ├── ci.sh
│   ├── test-profile.sh
│   └── test-sandbox.sh
├── src/
│   ├── app/
│   │   ├── backup.ts
│   │   ├── commands.ts
│   │   ├── context-changes.ts
│   │   ├── create-app.ts
│   │   ├── create-workspace.ts
│   │   ├── execute-command.ts
│   │   ├── journal-storage.ts
│   │   ├── request-work.ts
│   │   └── warmup.ts
│   ├── cli/
│   │   ├── command.ts
│   │   ├── main.ts
│   │   ├── run.ts
│   │   └── workspace-command.ts
│   ├── infrastructure/
│   │   ├── database/
│   │   │   ├── backup.ts
│   │   │   ├── database.ts
│   │   │   └── migrations/
│   │   │       └── 001-initial.sql
│   │   ├── filesystem/
│   │   │   ├── context-files.ts
│   │   │   └── paths.ts
│   │   └── git/
│   │       └── context-git.ts
│   ├── modules/
│   │   ├── inbox/
│   │   │   └── public.ts
│   │   ├── knowledge/
│   │   │   ├── adapters/
│   │   │   │   └── jsonl-journal.ts
│   │   │   ├── model.ts
│   │   │   ├── notes.ts
│   │   │   ├── ports.ts
│   │   │   └── public.ts
│   │   ├── memory/
│   │   │   └── public.ts
│   │   ├── projects/
│   │   │   ├── adapters/
│   │   │   │   └── sqlite-project-store.ts
│   │   │   ├── model.ts
│   │   │   ├── ports.ts
│   │   │   └── public.ts
│   │   └── requests/
│   │       ├── adapters/
│   │       │   └── sqlite-request-store.ts
│   │       ├── ports.ts
│   │       └── public.ts
│   └── shared/
│       ├── context.ts
│       ├── errors.ts
│       └── scope.ts
├── test/
│   ├── boundary/
│   │   ├── cli.test.ts
│   │   ├── contention.test.ts
│   │   ├── context.test.ts
│   │   ├── journal.test.ts
│   │   ├── maintenance.test.ts
│   │   ├── memory.test.ts
│   │   ├── requests.test.ts
│   │   └── workspace-cli.test.ts
│   ├── fast/
│   │   ├── database.test.ts
│   │   ├── journal-rules.test.ts
│   │   ├── memory.test.ts
│   │   ├── paths-cli.test.ts
│   │   └── projects.test.ts
│   └── support/
│       └── state.ts
└── tsconfig.json
```

### `.dependency-cruiser.cjs`

Правила допустимых импортов: CLI → app → публичные API, запрет циклов, IO в domain и зависимости production от tests.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/.dependency-cruiser.cjs).

### `.github/CODEOWNERS`

Владелец review для CI, тестов, скриптов, зависимостей и политики. Это не правило приёмки пользовательских задач.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/.github/CODEOWNERS).

### `.github/workflows/m1-verify.yml`

GitHub Actions: checkout base/candidate, pinned Node/pnpm, отдельный профиль AppArmor для bwrap, ограниченная сборка/verify. Отдельный App publisher не исполняет PR-код и пока не настроен.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/.github/workflows/m1-verify.yml).

### `.gitignore`

Исключает только корневые /home/ и /projects/, зависимости, dist и БД. Исходный src/modules/projects в Git включён.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `.npmrc`

Настройки pnpm и ограничения разрешения зависимостей. Не содержит токенов.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/.npmrc).

### `AGENTS.md`

Правила работы агента и ссылки на принятые контракты. Не исполняется движком.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `PLAN.md`

План этапов и критерии приёмки, отдельно от фактического состояния пользовательских запросов.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `README.md`

Первый вход в проект: назначение, установка, команды, ограничения и ссылки.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/ARCHITECTURE.md`

Актуальные границы системы, ответственность слоёв и принятые решения.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/FILEMAP.md`

Сгенерированный справочник каждого файла движка и шаблонов home; тот же источник пояснений, что в интерактивном отчёте.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/M0-CONTRACT.md`

Закрытый контракт M0 и запись его приёмки.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/M1-CI.md`

Граница доверия CI, исторические отказы и ссылки на текущий rollout.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/M1-CI.md).

### `docs/M1-CLI.md`

Синтаксис команд, точный текст, partial, backup и restore.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/M1-CYCLE.md`

Append-only журнал этапов разработки, найденных дефектов и проверок; не пользовательский журнал home.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/M1-DESIGN.md`

Выбранный модульный монолит, Ports & Adapters, зависимости и стек.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/M1-IMPLEMENTATION.md`

История первого небольшого среза реализации. Не текущая сводка готовности.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/M1-IMPLEMENTATION.md).

### `docs/M1-PUBLISH.md`

Публикация ветки/релиза, состояние CI и оставшаяся регистрация независимого издателя.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/M1-PUBLISH.md).

### `docs/M1-REQUESTS.md`

Контракт карточек, ключей, статусов, контекста, журнала и истории согласований.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/M1-START.md`

Принятые стартовые схема, пути, partial и бюджеты реализации.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/MCP-PLAN.html`

Предложение локального MCP поверх общего API: каталог инструментов, структура, запуск и подключение к сессиям. Не реализованный сервер.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/RELEASE.md`

Релиз-кандидат: установка, проверенные возможности, границы поддержки и незакрытая окончательная приёмка.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/RELEASE.md).

### `docs/TESTING.md`

Политика тестов, уровни, стоимость, ограничения, независимое review и требования к доказательствам.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/evidence/m1-ci-checks.txt`

Сохранённое доказательство/исход: m1-ci-checks.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: Trusted base/candidate LOCAL validation, not a hosted GitHub Actions run.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-ci-checks.txt).

### `docs/evidence/m1-ci-control-plane-blocker.txt`

Сохранённое доказательство/исход: m1-ci-control-plane-blocker.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: Independent review found spoofable GitHub Actions job-name identity. The branch protection created in this session was rolled back to its prior absent state, rather than presenting it as trusted or leaving main

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-ci-control-plane-blocker.txt).

### `docs/evidence/m1-ci-design-review-1.md`

Сохранённое доказательство/исход: m1-ci-design-review-1.md. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: ## REQUEST_CHANGES — для дизайна

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-ci-design-review-1.md).

### `docs/evidence/m1-ci-design-review-2.md`

Сохранённое доказательство/исход: m1-ci-design-review-2.md. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: **APPROVE** — по предоставленному статическому diff исправления. Команды и тесты не запускал.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-ci-design-review-2.md).

### `docs/evidence/m1-ci-readonly-build.txt`

Сохранённое доказательство/исход: m1-ci-readonly-build.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: Disposable base/candidate probe, same fixed limits. Attempts to overwrite tools/node and create host-visible root file must fail. Compilation/output in dist and all tests must still succeed.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-ci-readonly-build.txt).

### `docs/evidence/m1-contention-sensitivity.txt`

Сохранённое доказательство/исход: m1-contention-sensitivity.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: Disposable candidate only: BEGIN IMMEDIATE -> deferred. Expected failure in source callback reservation assertion. No budget changed.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-contention-sensitivity.txt).

### `docs/evidence/m1-final-checks.txt`

Сохранённое доказательство/исход: m1-final-checks.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: Final functional M1 check on isolated disposable state only. No independent review/trusted CI claim.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-final-checks.txt).

### `docs/evidence/m1-final-sensitivity.txt`

Сохранённое доказательство/исход: m1-final-sensitivity.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: Mutations in disposable source copy only. Expected nonzero exits; final original source tested separately.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-final-sensitivity.txt).

### `docs/evidence/m1-git-guard-regression.txt`

Сохранённое доказательство/исход: m1-git-guard-regression.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: Safe 1 MiB + 1 byte fixture reproduces Git stdout buffering defect; no resource limit raised.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-git-guard-regression.txt).

### `docs/evidence/m1-hosted-first-failure.txt`

Сохранённое доказательство/исход: m1-hosted-first-failure.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: bounded-verify	Build and verify through reviewed base	﻿2026-10-03T11:57:32.3779772Z ##[group]Run bash gate/scripts/ci.sh "$GITHUB_WORKSPACE/candidate"

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-hosted-first-failure.txt).

### `docs/evidence/m1-hosted-green.txt`

Сохранённое доказательство/исход: m1-hosted-green.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: GitHub-hosted Ubuntu 24.04, commit b458f8bcd4447f8975a4585e38b148cd15d5c67f

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-hosted-green.txt).

### `docs/evidence/m1-hosted-isolation-diagnosis.txt`

Сохранённое доказательство/исход: m1-hosted-isolation-diagnosis.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: Run: https://github.com/yokeloop/mypi/actions/runs/37121364633

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-hosted-isolation-diagnosis.txt).

### `docs/evidence/m1-independent-review-1.md`

Сохранённое доказательство/исход: m1-independent-review-1.md. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: ## Итог

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-independent-review-1.md).

### `docs/evidence/m1-independent-review-2.md`

Сохранённое доказательство/исход: m1-independent-review-2.md. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: ## Итог

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-independent-review-2.md).

### `docs/evidence/m1-independent-review-3.md`

Сохранённое доказательство/исход: m1-independent-review-3.md. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: ## Продукт: REQUEST_CHANGES

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-independent-review-3.md).

### `docs/evidence/m1-independent-review-4.md`

Сохранённое доказательство/исход: m1-independent-review-4.md. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: **Продуктовое исправление одобряю в рамках уточнённого контракта.** В представленном коде не вижу обычного прикладного входа, который способен закоммитить изменение опубликованного артефакта в обход проверки пр

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-independent-review-4.md).

### `docs/evidence/m1-initial-checks.txt`

Сохранённое доказательство/исход: m1-initial-checks.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: 2026-10-02 — initial M1 slice; negative checks only in disposable copy.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-initial-checks.txt).

### `docs/evidence/m1-rc-review.md`

Сохранённое доказательство/исход: m1-rc-review.md. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: **APPROVE** — для `v0.1.0-rc.1` как prerelease, не production и не окончательной приёмки M1. В представленных изменениях блокеров не обнаружено.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-rc-review.md).

### `docs/evidence/m1-remove-legacy-build.txt`

Сохранённое доказательство/исход: m1-remove-legacy-build.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: $ timeout --kill-after=5s 55s bash scripts/build.sh

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/evidence/m1-remove-legacy-docs.txt`

Сохранённое доказательство/исход: m1-remove-legacy-docs.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: 2026-10-04 — static checks for prototype removal; not runtime MCP/browser evidence.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/evidence/m1-remove-legacy-final-build.txt`

Сохранённое доказательство/исход: m1-remove-legacy-final-build.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: $ timeout --kill-after=5s 55s bash scripts/build.sh

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/evidence/m1-remove-legacy-final-verify.txt`

Сохранённое доказательство/исход: m1-remove-legacy-final-verify.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: $ bash scripts/check.sh verify

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/evidence/m1-remove-legacy-red-build.txt`

Сохранённое доказательство/исход: m1-remove-legacy-red-build.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: $ timeout --kill-after=5s 55s bash scripts/build.sh

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/evidence/m1-remove-legacy-red.txt`

Сохранённое доказательство/исход: m1-remove-legacy-red.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: $ bash scripts/check.sh fast

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/evidence/m1-remove-legacy-verify.txt`

Сохранённое доказательство/исход: m1-remove-legacy-verify.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: $ bash scripts/check.sh verify

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/evidence/m1-report-browser-check.txt`

Сохранённое доказательство/исход: m1-report-browser-check.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: Second isolated Chromium attempt: normal renderer instead of unsupported single-process. Same limits. No interaction success marker; bounded service failed. Browser interaction coverage NOT claimed. No further

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-report-browser-check.txt).

### `docs/evidence/m1-report-browser-initial.txt`

Сохранённое доказательство/исход: m1-report-browser-initial.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: Isolated Chromium single-process attempt failed, exit 133. Not a successful interaction check; limits not increased. No coredump (LimitCORE=0).

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-report-browser-initial.txt).

### `docs/evidence/m1-report-publication.txt`

Сохранённое доказательство/исход: m1-report-publication.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: Published through Derive stage(target=doc), workspace ws_51b016a6e5aad4721e72e8a3.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-report-publication.txt).

### `docs/evidence/m1-report-rc-browser.txt`

Сохранённое доказательство/исход: m1-report-rc-browser.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: One new local Chromium attempt with reduced CPU affinity/raster/V8 parallelism; same 2 CPU / 1 GiB / 64 tasks / 30 s renderer deadline. Failed at bounded deadline. Not interaction coverage; no limits increased.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-report-rc-browser.txt).

### `docs/evidence/m1-retired-entrypoints.txt`

Сохранённое доказательство/исход: m1-retired-entrypoints.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: One-off check in disposable copy under the same bounded verify. Python is only used to verify retirement of the historical script; it is not a Node CLI backend or a dependency of the permanent suite.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-retired-entrypoints.txt).

### `docs/evidence/m1-review-calibration.json`

Сохранённое доказательство/исход: m1-review-calibration.json. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: {

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-review-calibration.json).

### `docs/evidence/m1-review-current-checks.txt`

Сохранённое доказательство/исход: m1-review-current-checks.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: $ timeout --kill-after=5s 55s bash scripts/build.sh

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-review-current-checks.txt).

### `docs/evidence/m1-review-final-checks.txt`

Сохранённое доказательство/исход: m1-review-final-checks.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: Final LOCAL CI entrypoint + fast after native /lib64 mapping fix in both sandbox entrypoints. Ubuntu still not run.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-review-final-checks.txt).

### `docs/evidence/m1-review-input-sha256.txt`

Сохранённое доказательство/исход: m1-review-input-sha256.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: Input fingerprints of isolated static reviews. Temporary raw inputs are removed; these hashes identify the supplied snapshots, not a substitute for execution evidence.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-review-input-sha256.txt).

### `docs/evidence/m1-review-regressions-green.txt`

Сохранённое доказательство/исход: m1-review-regressions-green.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: $ timeout --kill-after=5s 55s bash scripts/build.sh

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-review-regressions-green.txt).

### `docs/evidence/m1-review-regressions-red-runtime.txt`

Сохранённое доказательство/исход: m1-review-regressions-red-runtime.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: $ timeout --kill-after=5s 55s bash scripts/build.sh

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-review-regressions-red-runtime.txt).

### `docs/evidence/m1-review-regressions-red.txt`

Сохранённое доказательство/исход: m1-review-regressions-red.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: $ timeout --kill-after=5s 55s bash scripts/build.sh

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-review-regressions-red.txt).

### `docs/evidence/m1-stage-1.txt`

Сохранённое доказательство/исход: m1-stage-1.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: $ timeout --kill-after=5s 55s bash scripts/build.sh

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-stage-1.txt).

### `docs/evidence/m1-stage-2.txt`

Сохранённое доказательство/исход: m1-stage-2.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: $ timeout --kill-after=5s 55s bash scripts/build.sh

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-stage-2.txt).

### `docs/evidence/m1-stage-3.txt`

Сохранённое доказательство/исход: m1-stage-3.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: $ timeout --kill-after=5s 55s bash scripts/build.sh

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-stage-3.txt).

### `docs/evidence/m1-stage-4.txt`

Сохранённое доказательство/исход: m1-stage-4.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: $ timeout --kill-after=5s 55s bash scripts/build.sh

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-stage-4.txt).

### `docs/evidence/m1-stage-5.txt`

Сохранённое доказательство/исход: m1-stage-5.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: $ timeout --kill-after=5s 55s bash scripts/build.sh

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-stage-5.txt).

### `docs/evidence/m1-stage-6.txt`

Сохранённое доказательство/исход: m1-stage-6.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: Stage 6 review found a real readonly side-effect defect. Added regression first:

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/evidence/m1-stage-6.txt).

### `docs/evidence/mcp-plan-publication.txt`

Сохранённое доказательство/исход: mcp-plan-publication.txt. Это запись конкретного запуска или review, не исполняемый код и не текущий статус системы. Начало: 2026-10-03 — plan only, implementation not started.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/reports/build-report.mjs`

Генерирует FILEMAP.md и HTML: читает git ls-files, извлекает TypeScript-символы/imports и встраивает исходники в безопасный просмотрщик.

Символы: `visit`, `treePaths`, `walk`.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/reports/file-guide.mjs`

Пояснения к файлам движка и шаблонам home. Данные для генератора отчёта, не конфигурация приложения.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/reports/m1-report.html`

Самодостаточный интерактивный отчёт: схемы, дерево, поиск файлов, исходники, правила данных и результаты. Не выполняет команды mypi.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `docs/reports/page.css`

Общий стиль Derive: светлая/тёмная тема, типографика, таблицы, статусы и доступные цвета. Не код движка.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/docs/reports/page.css).

### `mise.toml`

Закреплённые версии Node.js и pnpm для воспроизводимой среды разработки.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/mise.toml).

### `package.json`

Версия, ESM, bin, scripts build/test/verify и точные прямые зависимости. private запрещает случайный npm publish, но не git clone.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/package.json).

### `pnpm-lock.yaml`

Точные разрешённые версии и integrity зависимостей. Frozen install не пересчитывает дерево.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/pnpm-lock.yaml).

### `pnpm-workspace.yaml`

Настройки единственного пакета, в том числе допуск native build better-sqlite3. Это не многопакетный продукт.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/pnpm-workspace.yaml).

### `references/pi-extensions-reference.md`

Историческая вторичная справка по Pi extensions; не гарантия API текущей версии.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/references/pi-extensions-reference.md).

### `references/pi-subagents-reference.md`

Историческая справка об отдельном pi-subagents; эта библиотека не входит в M1.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/references/pi-subagents-reference.md).

### `scripts/admission.mjs`

Статически проверяет границы импортов, discovery, skip/only, запрещённые fast-эффекты и свежесть build. Читает TypeScript AST и запускает dependency-cruiser; не заменяет sandbox.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/scripts/admission.mjs).

### `scripts/build-state.mjs`

SHA256 по входам src/test/config и выходам dist. write сохраняет fingerprint, check отвергает устаревшую/изменённую сборку.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/scripts/build-state.mjs).

### `scripts/build.sh`

Проверяет Node 24; отказывает на symlink dist; find очищает содержимое dist без удаления mountpoint; tsc компилирует; SQL копируется; fingerprint записывается.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/scripts/build.sh).

### `scripts/check.sh`

Допускает только fast/verify, проверяет Node и инструменты, запускает фиксированный systemd unit с CPU/RAM/tasks/deadline и очисткой всей control group.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/scripts/check.sh).

### `scripts/ci.sh`

Сравнивает policy/dependencies с отдельным base, берёт только candidate src/test, создаёт временный snapshot. bwrap делает всё readonly кроме dist; затем вызывается штатный verify. Не запускает candidate package scripts.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/scripts/ci.sh).

### `scripts/test-profile.sh`

Внутри sandbox выполняет admission, затем node:test fast и при verify boundary. Проверяет время, cgroup peaks и отсутствие оставшихся процессов.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/scripts/test-profile.sh).

### `scripts/test-sandbox.sh`

Готовит временный workspace, копирует Node, проверяет принадлежность bounded unit; bwrap скрывает сеть/home/credentials, монтирует /work readonly и передаёт cgroup-метрики.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/scripts/test-sandbox.sh).

### `src/app/backup.ts`

Координирует write lock, SQLite snapshot и чистый Git bundle; проверяет ссылки и сохранённый checkout до manifest. Restore только в отсутствующие DB/home.

Символы: `hash`, `verifyReferences`, `backupState`, `restoreState`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/app/backup.ts).

### `src/app/commands.ts`

DTO WorkspaceCommand: name, позиционные args и options. Без IO и исполнения.

Символы: `WorkspaceCommand`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/app/commands.ts).

### `src/app/context-changes.ts`

Общий порядок clean → save → commit. При сбое возвращает PartialError с тем, что действительно удалось сохранить; общего SQL/FS rollback не обещает.

Символы: `changeContext`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/app/context-changes.ts).

### `src/app/create-app.ts`

DB-only composition root: открывает БД, соединяет SQL stores с публичными Projects/Requests; даёт транзакционную serialize и close.

Символы: `engineRoot`, `resolveStatePath`, `initializeState`, `createApp`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/app/create-app.ts).

### `src/app/create-workspace.ts`

Собирает DB, контекст, Git, journal, memory/inbox/notes. Разрешает scope, наследование путей и ключей; перед файловой/Git-фазой проверяет префиксы журналов и опубликованные артефакты.

Символы: `defaultContextRoot`, `initializeWorkspace`, `createWorkspace`, `serialize`, `project`, `requestKey`, `resolve`, `contains`, `contextPath`, `create`, `edit`, `journal`, `restoreContext`, `complete`, `error`, `warmup`.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `src/app/execute-command.ts`

Сопоставляет WorkspaceCommand с API: преобразует scope/параметры, выбирает readonly для чтения, вызывает bootstrap/backup/restore или методы workspace и закрывает БД.

Символы: `readInputFile`, `executeCommand`, `text`, `scope`.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `src/app/journal-storage.ts`

Сборка чтения журнала для системных операций и извлечение опубликованных путей; Git не получает прямую зависимость на SQL чужого модуля.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/app/journal-storage.ts).

### `src/app/request-work.ts`

Составные сценарии запросов: resolve ключа, create source→DB→journal→Git, смена title/status с причиной, progress/версии артефактов, touch и явные partial.

Символы: `requestWork`, `find`, `record`, `list`, `create`, `change`, `progress`, `touch`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/app/request-work.ts).

### `src/app/warmup.ts`

Read-only сборка индекса: MEMORY родителей, glossary и последние scoped события. Global получает inbox preview; scoped-вход — нет.

Символы: `warmup`.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `src/cli/command.ts`

Типы верхнеуровневых команд, usage, строгий разбор help/db/project; остальные команды передаются workspace parser.

Символы: `Command`, `parseCommand`.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `src/cli/main.ts`

Единственный исполняемый Node entrypoint: argv → parser → run; JSON в stdout/stderr, exitCode=1 при error/partial. --help не открывает БД.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/cli/main.ts).

### `src/cli/run.ts`

Тонкий диспетчер: db init и проекты через createApp, остальные команды через executeCommand; соединение БД закрывается в finally.

Символы: `run`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/cli/run.ts).

### `src/cli/workspace-command.ts`

Таблица команд, допустимые флаги/аргументы и строгий parser операций workspace. Файлы/SQL не изменяет.

Символы: `parseWorkspaceCommand`.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `src/infrastructure/database/backup.ts`

SQLite backup API, восстановление с integrity/FK checks и общий write lock для согласованной копии. Не копирование открытого файла БД вслепую.

Символы: `snapshotDatabase`, `withWriteLock`, `restoreDatabase`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/infrastructure/database/backup.ts).

### `src/infrastructure/database/database.ts`

Открытие better-sqlite3, foreign_keys, timeout, права файла, миграции user_version и отказ от будущей схемы. Readonly не создаёт отсутствующую БД.

Символы: `connect`, `version`, `initializeDatabase`, `openDatabase`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/infrastructure/database/database.ts).

### `src/infrastructure/database/migrations/001-initial.sql`

DDL четырёх STRICT-таблиц, FK/unique/check/index, триггеры сохранения номеров и terminality; однократный seed десяти статусов.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/infrastructure/database/migrations/001-initial.sql).

### `src/infrastructure/filesystem/context-files.ts`

Домашние относительные пути, защита от traversal/symlink/hardlink, UTF-8 без потери BOM, создание без overwrite, замена с preimage, чтение/list/isFile.

Символы: `relativeContextPath`, `contextFiles`, `safe`, `write`, `isFile`, `read`, `list`, `create`, `append`, `replace`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/infrastructure/filesystem/context-files.ts).

### `src/infrastructure/filesystem/paths.ts`

Канонические пути checkout/БД, XDG fallback и отказ размещать состояние в движке/контексте. Учитывает symlink-алиасы и dangling symlink.

Символы: `canonicalDirectory`, `canonicalFuturePath`, `databasePath`, `externalDatabasePath`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/infrastructure/filesystem/paths.ts).

### `src/infrastructure/git/context-git.ts`

Реальный Git отдельного home: clean/commit выбранных файлов, сохранение чужого index, bundle/restore. Проверяет immutable/append-only по blob hash/prefix; отключает hooks/fsmonitor/signing и фильтры текста.

Символы: `contextGit`, `ensureAttributes`, `git`, `matchesBlob`, `ownMetadata`, `check`, `initialize`, `head`, `cleanAll`, `bundle`, `restoreFile`, `clean`, `validateJournal`, `validate`, `commit`, `cloneContextBundle`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/infrastructure/git/context-git.ts).

### `src/modules/inbox/public.ts`

Capture записывает точную исходную строку в уникальный inbox/*.md; index возвращает пути и короткие preview. Не регистрирует request автоматически.

Символы: `Files`, `createInbox`, `capture`, `index`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/modules/inbox/public.ts).

### `src/modules/knowledge/adapters/jsonl-journal.ts`

Реальный append/fsync JSONL по UTC-месяцу и потоковый reader ротации. Повреждение/оборванная строка не замалчиваются.

Символы: `jsonlJournal`, `append`, `entries`, `fileSize`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/modules/knowledge/adapters/jsonl-journal.ts).

### `src/modules/knowledge/model.ts`

Entry/EventType и чистая проверка строгого envelope, UTC, scope и home-relative artifact paths.

Символы: `EventType`, `Entry`, `utc`, `artifactPath`, `entryValue`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/modules/knowledge/model.ts).

### `src/modules/knowledge/notes.ts`

Notes создаёт уникальную Markdown-заметку с заголовком; error дописывает датированную JSON-строку в проектный errors.md.

Символы: `Files`, `createNotes`, `note`, `error`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/modules/knowledge/notes.ts).

### `src/modules/knowledge/ports.ts`

JournalStore — контракт append и потокового чтения истории, без SQL/Git.

Символы: `JournalStore`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/modules/knowledge/ports.ts).

### `src/modules/knowledge/public.ts`

API журнала: валидация/resolve scope, record/append, scope/date/type перед общим order/limit; извлечение ссылок публикаций. Экспорт notes API.

Символы: `publishedArtifacts`, `createJournal`, `record`, `append`, `read`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/modules/knowledge/public.ts).

### `src/modules/memory/public.ts`

Читает MEMORY, добавляет JSON-строки многострочных фактов, удаляет выбранный факт по номеру; остальной Markdown сохраняет как контекст, не распознаёт как факты.

Символы: `Files`, `items`, `createMemory`, `path`, `show`, `add`, `remove`.

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `src/modules/projects/adapters/sqlite-project-store.ts`

SQL организаций и проектов: поиск, список, insert и транзакция. Владеет только своими таблицами.

Символы: `sqliteProjectStore`, `list`, `find`, `findOrganization`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/modules/projects/adapters/sqlite-project-store.ts).

### `src/modules/projects/model.ts`

Типы Project/ProjectScope и чистые правила identity/code. org/project, буквенный код, запрет REQ.

Символы: `Project`, `ProjectScope`, `parseIdentity`, `validSlug`, `validateCode`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/modules/projects/model.ts).

### `src/modules/projects/ports.ts`

Контракты project store и файловой проверки checkout. Не содержит SQL/Node IO.

Символы: `ProjectStore`, `CheckoutPaths`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/modules/projects/ports.ts).

### `src/modules/projects/public.ts`

Публичные add/list/resolveScope: валидация, канонизация checkout и транзакционная регистрация организации/проекта.

Символы: `createProjects`, `add`, `list`, `resolveScope`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/modules/projects/public.ts).

### `src/modules/requests/adapters/sqlite-request-store.ts`

SQL requests/statuses и MAX(number)+1 под BEGIN IMMEDIATE; readonly отказывает до source callback. Нет отдельного счётчика или SQL-копии истории.

Символы: `card`, `sqliteRequestStore`, `addStatus`, `renameStatus`, `terminalStatus`, `removeStatus`, `nextNumber`, `insert`, `update`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/modules/requests/adapters/sqlite-request-store.ts).

### `src/modules/requests/ports.ts`

Типы Card/Status и интерфейс хранения карточек/словаря; callback source участвует в порядке создания, но текст не хранится в SQL.

Символы: `Status`, `Card`, `RequestStore`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/modules/requests/ports.ts).

### `src/modules/requests/public.ts`

Правила create/change/touch и справочника: явный статус, terminal/no-op, причины, устойчивые IDs, время активности; ключ/папка после создания не переименовываются.

Символы: `nonempty`, `createRequests`, `status`, `addStatus`, `renameStatus`, `setTerminal`, `removeStatus`, `create`, `change`, `touch`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/modules/requests/public.ts).

### `src/shared/context.ts`

Маленькие ContextFiles/ContextHistory порты и PartialError с saved/missing/paths/requestId.

Символы: `ContextFiles`, `ContextHistory`, `PartialError`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/shared/context.ts).

### `src/shared/errors.ts`

InputError для отклонённого ввода; не управляет stdout и exit.

Символы: `InputError`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/shared/errors.ts).

### `src/shared/scope.ts`

Строгая форма global/org/project/request и sameScope; существование/родители разрешаются через DB API, не regex.

Символы: `Scope`, `scopeValue`, `sameScope`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/src/shared/scope.ts).

### `test/boundary/cli.test.ts`

Реальная интеграционная граница на временных данных. real Node launcher persists projects across independent processes without Python or context writes

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/test/boundary/cli.test.ts).

### `test/boundary/contention.test.ts`

Реальная интеграционная граница на временных данных. writer reservation blocks a second source callback before number allocation completes

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/test/boundary/contention.test.ts).

### `test/boundary/context.test.ts`

Реальная интеграционная граница на временных данных. context preserves exact text, rejects escaping/overwrite, commits only selected files and exposes Git failure

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/test/boundary/context.test.ts).

### `test/boundary/journal.test.ts`

Реальная интеграционная граница на временных данных. journal streams rotation, exact multiline, scope/filter before global limit and rejects corruption

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/test/boundary/journal.test.ts).

### `test/boundary/maintenance.test.ts`

Реальная интеграционная граница на временных данных. backup uses real SQLite snapshot and Git bundle; restore validates source/artifact links and refuses overwrite/corruption

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `test/boundary/memory.test.ts`

Реальная интеграционная граница на временных данных. memory, notes, errors, capture and scoped warmup preserve originals, parent context and read-only behavior

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `test/boundary/requests.test.ts`

Реальная интеграционная граница на временных данных. requests preserve source, allocate separate numbers, filter parents, extend statuses and surface partial without replay; two independent request writers retain distinct committed numbers and journal records; abrupt exit after DB commit preserves identity/source; reconciliation adds a factual note, never a fabricated transition

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/test/boundary/requests.test.ts).

### `test/boundary/workspace-cli.test.ts`

Реальная интеграционная граница на временных данных. complete Node CLI dispatch: memory/context/request lifecycle, partial repair, backup and restore into a fresh installation

Символы: `installation`, `run`, `cli`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/test/boundary/workspace-cli.test.ts).

### `test/fast/database.test.ts`

Дешёвые проверки правил без subprocess из теста. STRICT types, relational uniqueness and foreign keys are enforced by real SQLite; migration is repeatable without reseeding renamed/custom statuses; newer schema is rejected

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/test/fast/database.test.ts).

### `test/fast/journal-rules.test.ts`

Дешёвые проверки правил без subprocess из теста. journal validates envelope and applies overall ordering/limit even for unordered input

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/test/fast/journal-rules.test.ts).

### `test/fast/memory.test.ts`

Дешёвые проверки правил без subprocess из теста. memory manages only JSON-string facts and preserves other Markdown as context

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `test/fast/paths-cli.test.ts`

Дешёвые проверки правил без subprocess из теста. XDG/default state paths stay outside engine and context, including symlink aliases; CLI parsing is strict without invoking a process for the validation matrix

Текущий локальный/генерируемый файл; эта версия не опубликована в GitHub.

### `test/fast/projects.test.ts`

Дешёвые проверки правил без subprocess из теста. registered scope, independent organizations and duplicate rollback through the public API; invalid identities/codes never register an organization or create context; read APIs leave database bytes and filesystem unchanged; absent database is not initialized

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/test/fast/projects.test.ts).

### `test/support/state.ts`

Маленькая временная SQLite fixture с cleanup, без личного home и общего test framework.

Символы: `state`.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/test/support/state.ts).

### `tsconfig.json`

Strict TypeScript, ESM, исходники src/test и вывод в dist. Не runtime loader.

[Исходник](https://github.com/yokeloop/mypi/blob/580942ddce9dc907e683e27a45e114c3d2313f96/tsconfig.json).

## Home — шаблоны, не созданное личное хранилище

### `home/.git/`

Отдельная история контекста, не submodule движка. Git создаёт HEAD, refs, objects, index и config; это служебные данные, не ручные карточки задач. Записывает/читает: Git adapter.

### `home/.git/info/attributes`

Правило * -text -filter -ident -working-tree-encoding сохраняет точные байты. CLI не запускает пользовательские hooks/fsmonitor/signing. Записывает/читает: context-git.ts.

### `home/MEMORY.md`

Глобальная память: заголовок и факты вида - "текст\nещё строка". Можно редактировать через memory; предыдущая версия сохраняется Git. Записывает/читает: memory add/show/remove.

### `home/inbox/<UTC>-<UUID>.md`

Неизменяемая исходная формулировка capture, без добавленного заголовка/trim. Не задача БД. Global warmup показывает короткий preview. Записывает/читает: capture.

### `home/notes/<UTC>-<UUID>.md`

Глобальная заметка: # Тема, пустая строка и текст. Одинаковые темы не перезаписывают прежний файл. Записывает/читает: note.

### `home/journal/YYYY-MM.jsonl`

Один общий журнал, UTC-ротация. Строка: at, scope, event_type, text, optional artifacts. Сохранённый префикс append-only. Записывает/читает: journal / request create/status/title/progress.

### `home/projects/<org>/MEMORY.md`

Память организации, наследуется после глобальной. Не подмешивает общий inbox. Записывает/читает: memory -s org.

### `home/projects/<org>/notes/<UTC>-<UUID>.md`

Заметки организации, уникальные файлы с заголовком и текстом. Записывает/читает: note -s org.

### `home/projects/<org>/<project>/MEMORY.md`

Память проекта после global и org. Это контекст, не статусный tracker. Записывает/читает: memory -s org/project.

### `home/projects/<org>/<project>/context.md`

Необязательный glossary проекта; warmup читает содержимое. Специального schema/автогенерации нет; mutable контекст можно сохранить explicit commit. Записывает/читает: warmup / context commit.

### `home/projects/<org>/<project>/notes/<UTC>-<UUID>.md`

Заметки проекта с точным переданным текстом под заголовком. Записывает/читает: note -s org/project.

### `home/projects/<org>/<project>/errors.md`

Append-only ошибки и тупики: дата и JSON-строка текста. Это исходы, а не отдельная БД багов. Записывает/читает: error.

### `home/projects/<org>/<project>/requests/CODE-number-slug/source.md`

Неизменяемый исходник задачи, точные UTF-8 байты/BOM/CRLF. Карточка БД хранит ссылку context_dir, а не копию текста. Записывает/читает: request create.

### `home/projects/<org>/<project>/requests/CODE-number-slug/<artifact-path>`

Материалы задачи: например research/result-v1.md, plans/plan-v2.md или бинарный файл. Папки не создаются заранее; после ссылки в journal файл опубликован и не переписывается. Записывает/читает: request progress / context commit.

### `home/requests/REQ-number-slug/source.md`

Та же структура для запроса без проекта. project_id=NULL; отдельная REQ-нумерация, не фиктивный проект. Записывает/читает: request create без --project.

### `home/requests/REQ-number-slug/<artifact-path>`

Материалы запроса без проекта. Новая опубликованная версия — новый путь, история всё равно в общем journal. Записывает/читает: request progress.

## Вне home

`$XDG_STATE_HOME/mypi/state.sqlite3` (fallback `~/.local/state/mypi/state.sqlite3`) — authoritative DB. Backup directory: `state.sqlite3`, optional `context.bundle`, `manifest.json` с checksum. Это не Git движка и не Git home.

`dist/` — сгенерированные JS из src/test, SQL и build-state.json; `node_modules/` — установленные зависимости; `.git/` — история движка. Эти деревья не являются собственными исходниками и не перечисляются по внутренним объектам/пакетам.
