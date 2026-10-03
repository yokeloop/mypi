# CI M1 — доверенный gate ещё не принят

**Текущий rollout:** [M1-PUBLISH.md](M1-PUBLISH.md). Инженер разрешил GitHub App и публикацию ветки/PR без merge.
Подготовлен отдельный publisher job с ключом только в environment `mypi-gate`, разрешающем branch main.
App ещё не зарегистрирован. Ветка и draft PR #1 опубликованы, hosted-запуск остановился до тестов из-за AppArmor (см. M1-PUBLISH). Защита подлинности издателя пока только подготовлена, не принята runtime-проверкой.

## Исторический срез до разрешения публикации

Ниже сохранено состояние предыдущего обзора; утверждения «код не закоммичен» и «единственное внешнее изменение» относятся к нему.

Разрешение инженера 2026-10-03: «разрешаю ревьювера и CI».
Цель внешних настроек — GitHub `yokeloop/mypi`, `main`.

## Что готово

`.github/workflows/m1-verify.yml`: Ubuntu 24.04, pinned Actions, contents:read, checkout без credentials,
только pull_request_target. Инструменты и зависимости берутся из base, не из PR.
`scripts/ci.sh` сравнивает policy/dependencies с отдельным base; кандидат передаёт только src/test без symlinks.
Сборка — bubblewrap без сети/home/credentials, исходники/инструменты readonly, systemd/cgroup.
Затем единственный штатный verify с прежними лимитами. Нет альтернативного бесконтрольного runner.
CODEOWNERS подготовлен для CI/scripts/test/config/policy, не для каждой рабочей операции продукта.

Тот же entrypoint проверен локально с отдельными base/candidate: нормальная версия проходит,
подмена MemoryMax=1G на 2G отвергается до исполнения. Evidence: `docs/evidence/m1-ci-checks.txt`.
Это не GitHub-hosted запуск. Ubuntu/AppArmor/user-systemd нужно проверить в настоящем job.

## Обнаруженный блокер

Второй независимый review обнаружил: check по имени trusted-verify и app_id GitHub Actions
не удостоверяет конкретный workflow. Другой branch-workflow способен сообщить такой же check.
CODEOWNERS контролирует слияние, но не удостоверяет запущенный workflow.
workflow_dispatch убран, однако это не решает общий случай подмены check.

Поэтому установленная в этой сессии branch protection **откачена к прежнему отсутствию**.
Она не выдаётся за защищённый gate и не оставляет main заблокированной без опубликованного workflow.
Проверка: `docs/evidence/m1-ci-control-plane-blocker.txt`.
Требование полного SHA для Actions оставлено включённым; это отдельное проверенное усиление, не решение блокера.

Организация использует Free. Запрос org rulesets отклонён: текущему credential не хватает admin:org.
Права автоматически не расширялись. Поддержка workflow-bound правила на выбранном плане не подтверждена.

Для доверенного результата нужен внешний workflow-bound rule в поддерживаемой конфигурации GitHub
либо отдельный GitHub App/check issuer, чей ключ недоступен произвольным branch-workflows.
Credentials нельзя положить в обычный repository secret, доступный тем же изменяемым workflow.
Нужен изолированный доверенный исполнитель/защищённая среда с допустимым ref и привязка required check к отдельному App.

## Публикация и оставшаяся проверка

Удалённый main остаётся на 9b68f28; workflow и M1-код не закоммичены и не опубликованы.
Коммиты движка, PR и ветки не создавались. После разрешённой публикации reviewed base:
проверить настоящий job; отдельно проверить, что одноимённый поддельный check не удовлетворяет требованию,
а настоящий issuer сообщает результат именно проверенного head SHA.

Учётная запись prineycom имеет repo admin. Администратора, способного снять protection,
этот механизм не ограничивает; рабочему агенту нужен credential без управления защитой.

## Что изменено снаружи и откат

Активное изменение: Actions sha_pinning_required=true в yokeloop/mypi.
До сессии: Actions enabled/all, SHA pinning=false, branch protection отсутствовала.
Временная protection создана, прочитана обратно и удалена после замечания reviewer.
Для отката оставшегося изменения по отдельному запросу: вернуть sha_pinning_required=false.
