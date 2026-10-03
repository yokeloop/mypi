# mypi v0.1.0-rc.1

Релиз-кандидат для проверки инженером; не production-ready и не окончательная приёмка M1.
Разрешение 2026-10-03: «можешь довести все до релиза как считаешь нужным я потом проверю».
Оно включает продвижение проверенной ветки и prerelease; личная миграция не выполняется.

## Установка

```sh
git clone https://github.com/yokeloop/mypi.git
cd mypi
git checkout v0.1.0-rc.1
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm build
mise exec -- node dist/src/cli/main.js --help
```

Node 24.21.0 / pnpm 12.6.0 закреплены в mise.toml. Git, timeout, Linux и native build tools нужны
для соответствующих команд; тестам дополнительно нужны user systemd/cgroup v2 и bubblewrap.
Help ничего не инициализирует. Только явный `bootstrap` создаёт БД и отдельный Git home.

## Данные не входят в движок

`home/` — вложенный самостоятельный Git, не submodule; исключён из Git движка.
`projects/` — игнорируемые рабочие клоны. `src/modules/projects/` — включённый исходный код.
SQLite хранится отдельно: XDG_STATE_HOME/mypi/state.sqlite3, fallback ~/.local/state/mypi/state.sqlite3.
БД и backups не хранятся в Git. Исходники задач/артефакты и общий JSONL — в home.

## Что проверено

19/19 локально и на GitHub-hosted Ubuntu 24.04: [первый успешный run](https://github.com/yokeloop/mypi/actions/runs/37124664193).
Внешние лимиты сохранены; AppArmor не отключён, добавлен только профиль /usr/bin/bwrap
на одноразовой VM. Тесты не работают с личными данными. Подробности — M1-CYCLE и evidence.

## Что открыто

Обычный bounded CI работает. Независимый GitHub App issuer пока не зарегистрирован:
required check, защищённый от одноимённого Actions workflow, ещё не введён в эксплуатацию.
RC публикуется с этим явным ограничением, не выдаётся за полную приёмку TESTING/M1.
Publisher без App ID ничего не подписывает. Не использовать обычный Actions check как доказательство
неподменяемой проверки. Администратор GitHub остаётся доверенной стороной.

Нет flow/LLM runner, multi-device, автоматического сетевого sync и автоматической личной миграции.
Не проверены другие ОС, физическое отключение питания и большие многолетние истории.

## Карта и команды

- [Полная карта файлов и home](FILEMAP.md).
- [CLI и partial/recovery](M1-CLI.md).
- [Журнал реализации](M1-CYCLE.md).
- [Публикация и CI](M1-PUBLISH.md).
- [Интерактивный отчёт](https://draft.yokeloop.com/artifacts/mypi-m1-bqso2mhf).

GitHub source archives — исходники, не готовая npm-установка: зависимости устанавливаются отдельно.
Пакет private; публикация в npm не выполняется. Git tag фиксирует проверяемый RC.
