# Публикация M1 — релиз-кандидат

Инженер 2026-10-03 разрешил довести работу до релиза по усмотрению агента с последующей проверкой:
«разрешаю делай уже. Это не продакшен можешь довести все до релиза как считаешь нужным я потом проверю».
Это расширяет прежнее ограничение без автоматического merge: разрешено продвижение проверенной ветки
и публикация prerelease. Личный home/миграция по-прежнему не выполняются.

## Результат

- [PR #1](https://github.com/yokeloop/mypi/pull/1), ветка m1/implementation.
- [RC v0.1.0-rc.1](https://github.com/yokeloop/mypi/releases/tag/v0.1.0-rc.1), не production-ready.
- Обычный bounded CI работает на Ubuntu 24.04: [первый green](https://github.com/yokeloop/mypi/actions/runs/37124664193), 19/19, wall 7,34 s.
- AppArmor не отключён: разрешён профиль /usr/bin/bwrap только в одноразовой VM; cgroup/bwrap ограничения сохранены.
- Build workspace readonly целиком, кроме dist; tools/node нельзя изменить перед host-фазой. Reviewer подтвердил исправление, negative probe сохранён.
- /home/ и /projects/ игнорируются только в корне; src/modules/projects включён в Git.
- Подробный [справочник файлов](FILEMAP.md) и [интерактивный отчёт](https://draft.yokeloop.com/artifacts/mypi-m1-bqso2mhf).

## Независимый издатель — открытая граница RC

GitHub App требует интерактивной регистрации/установки владельцем GitHub. Никакого App или секрета
в этой сессии не выдумано и не создано через неподдерживаемый API.
Publisher job отделён от проверки и запускается только для pull_request_target; environment mypi-gate
разрешает только branch main, не tags или refs/pull/*/merge. Без App ID шаги выпуска App check пропускаются
с явным notice — обычный Actions check не выдаётся за независимый issuer.

Будущий required check — mypi/verified с app_id отдельного App, не GitHub Actions.
Private key — только environment secret MYPI_GATE_PRIVATE_KEY, ID — environment variable MYPI_GATE_APP_ID.
Перед загрузкой ключа нужно защитить main от прямого push/обхода, затем проверить настоящий и поддельный check.
Текущий admin credential может менять защиту и не является изолированной ролью обычного автора.

App: https://github.com/organizations/yokeloop/settings/apps/new
Private app, webhook off, только Repository Checks:write и Metadata:read; установить только в mypi.
Ключ не передавать в чат/Git. Регистрация App не блокирует проверку RC, но блокирует заявление
о завершённом trusted gate и окончательной приёмке M1.

## Как запускается CI

Push main и первоначальной ветки проверяет snapshot как reviewed base/candidate.
Это первичная проверка, не неподменяемое удостоверение.
В pull_request_target инструменты/policy/dependencies берутся из base; кандидат даёт только src/test.
Изменение protected policy/dependencies требует отдельного контролируемого продвижения после review;
сравнение не обходится флагом из PR. Установка, сборка и тесты имеют отдельные пределы.

Deployment policy сравнивается с GITHUB_REF:
https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments

## Что содержит отчёт

Дерево каждого собственного файла движка с назначением, ключевыми символами, imports и исходным кодом.
Для scripts — реальные команды и ограничения. Отдельно 21 шаблон файла/каталога home, содержимое,
изменяемость и связь с БД/Git. Генерируемые dist/node_modules/.git объяснены, не смешаны с исходниками.
Две наглядные схемы слоёв/пути команды и интерактивная схема partial.
Личный home не создавался ради примеров.
