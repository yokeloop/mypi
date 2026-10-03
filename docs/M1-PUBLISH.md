# Публикация M1

Разрешено инженером 2026-10-03: CI/GitHub App, коммиты движка, отдельная ветка, push и PR в
`yokeloop/mypi`, без автоматического merge. `home/` остаётся отдельным Git внутри клона,
не submodule и не часть публикуемого движка. Личная миграция не выполняется.

## Текущий результат

Ветка опубликована: [draft PR #1](https://github.com/yokeloop/mypi/pull/1), без merge.
Свежий Git-снимок проходит 19/19 локально. Hosted [запуск](https://github.com/yokeloop/mypi/actions/runs/37121364633)
остановлен до тестов: AppArmor Ubuntu 24.04 запрещает bwrap setpcap/net_admin в unprivileged_userns.
Установка Node/pnpm/зависимостей прошла. Нужен отдельно согласованный точечный профиль bwrap на временном
runner, без глобального отключения AppArmor или ослабления cgroup/bwrap. До согласования обход отказа не выполняется.

## Первый запуск

Ветка `m1/implementation` имеет push-trigger только для первичной проверки опубликованного snapshot.
Он берёт один и тот же проверенный SHA в разные каталоги base/candidate. Это bootstrap-проверка,
а НЕ required trusted check. Workflow в main ещё отсутствует; pull_request_target заработает после
отдельно согласованного продвижения reviewed base. Слияние автоматически не выполняется.

## Издатель доверенного результата

- GitHub environment `mypi-gate` допускает только branch `main`, не tags и не `refs/pull/*/merge`.
- Отдельный publisher job не скачивает и не исполняет PR-код, не принимает от него артефакты.
- В нём GitHub App token ограничен репозиторием mypi и Checks:write. Token отзывается action после job.
- Required check должен быть `mypi/verified` с app_id отдельного App, НЕ app_id GitHub Actions.
- Приватный ключ хранится только в environment secret `MYPI_GATE_PRIVATE_KEY`, App ID — environment variable
  `MYPI_GATE_APP_ID`. Не repository secret и не ключ в Git.
- До загрузки ключа main должна быть защищена от прямого push/обхода, а reviewed base отдельно продвинут.
  Включение required App check и отрицательная проверка поддельного check — отдельный шаг приёмки.
  Администратор, способный менять environment/protection, остаётся границей доверия.

Документация GitHub подтверждает: deployment branch policy сравнивает GITHUB_REF, а для обычного
pull_request нужен отдельный шаблон refs/pull/*/merge, который мы НЕ разрешаем.
Источник: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments

## Необходимое действие владельца GitHub

Регистрация GitHub App требует интерактивного подтверждения GitHub; действующий gh OAuth token
сам по себе не создаёт App через REST. Подготовить private App `mypi-ci-verifier` в организации yokeloop:
homepage — https://github.com/yokeloop/mypi, webhook выключен, Repository permissions — Checks: Read & write,
Metadata: Read-only; никаких других permissions/events. Установить только в mypi.

Страница: https://github.com/organizations/yokeloop/settings/apps/new

Профиль AppArmor на личной машине не меняется; речь только о временной VM GitHub Actions.
После подготовки совместимой среды, App и отдельно разрешённого продвижения reviewed base нужны
успешный hosted verify и отрицательная проверка поддельного check; затем можно обсуждать приёмку M1.
После регистрации нужны App ID и созданный PEM-файл. Ключ не присылать в чат и не добавлять в Git:
передать только локальный путь, загрузка выполняется через gh secret set с stdin в защищённое environment.

Пока App не зарегистрирован/не установлен и проверка не выполнена, trusted CI и M1 остаются открытыми.
