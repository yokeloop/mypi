# Node CLI M1

В корне checkout: `mise exec -- pnpm build`, затем `mise exec -- node dist/src/cli/main.js --help`.
Все результаты — JSON. Ошибка/partial: ненулевой exit и JSON в stderr; stdout не сообщает ложный успех.
Полный перечень команд — в help; core не вызывает LLM и не запускает flow.

## Хранилища и обычная работа

БД: XDG_STATE_HOME/mypi/state.sqlite3 (fallback ~/.local/state/mypi/state.sqlite3), вне git.
Контекст: home/ этого checkout. `db init` создаёт только БД; `bootstrap` — БД и отдельный Git контекста,
без fetch/pull/push. Личная инициализация не выполнялась во время разработки.

```text
project add org/project --code MP [--path /absolute/checkout]
project list [--org org]
memory add "fact" [-s org/project]
memory show [-s org/project]
memory remove 1 [-s org/project]
capture "original text"
capture --file /path/to/utf8-source
note "title" "text" [-s org/project]
note "title" --file /path/to/text [-s org/project]
error org/project "error or dead end"
warmup [-s org | org/project]
```

Без -s память/заметки глобальные. Memory поддерживает многострочные факты; в Markdown они сериализованы JSON-строкой,
при чтении возвращается точный текст. Остальной Markdown сохраняется как контекст, не распознаётся как управляемые факты. Capture — отдельный
immutable inbox/*.md с оригиналом, не SQL-копия; BOM/CRLF не удаляются. Notes не перезаписываются при совпадении темы.
Scoped warmup не включает inbox/чужой проект; это индекс, не замена чтения артефактов.

## Запросы и журнал

```text
request create --project org/project --title "Title" --status research --slug short-slug --file /path/to/source
request create --title "Unassigned" --status new --slug short-slug "source"
request list [--project org/project] [--status code]
request show MP-1
request status MP-1 review --reason "ready for review"
request title MP-1 "Better title" --reason "clarification"
request progress MP-1 "actual outcome" [--artifacts /path/to/artifacts.json]
status list
status add accepted --terminal
status rename accepted verified
status terminal unused-code true
status remove unused-code
journal add "outcome" -s org/project
journal add "checked current state" -s request:MP-1
journal read -s project:MP --from 2026-09-01T00:00:00Z --limit 10
journal read --all --type status_changed
```

Артефакты progress: JSON-массив `[{"path":"research/result.md","text":"new content"}]`;
без text — явная ссылка на существующий файл. Пути относительно папки задачи;
журнал сохраняет home-relative ссылки. Новое содержимое создаётся без overwrite.
Status задаётся явно; словарь читается из БД, терминальность использованного значения не меняется.
REQ имеет отдельную нумерацию. Title не переименовывает папку. Терминальный запрос не reopen-ится.

Фильтры журнала: global (по умолчанию), org:slug, project:CODE, request:KEY; org/project разрешается через БД.
Global не означает весь журнал. Результаты упорядочены по времени; limit выбирает последние записи общей выборки.

## Partial — не повторять команду вслепую

1. Прочитать карточку и конкретные файлы; сверить Git status и журнал.
2. Если запись уже есть, не дописывать её снова. Завершить только проверенный commit:
   `context commit journal/2026-10.jsonl requests/REQ-1-slug/source.md --message "Finish checked partial"`.
3. Если SQL-карточка отсутствует, но source сохранён, после сверки допустим тот же create с
   `--adopt-source`: совпадение оригинала проверяется; при изменившейся нумерации/пути операция останавливается.
4. Для неизвестной истории перехода — note о проверенном текущем состоянии, не выдуманный status_changed.
5. Если progress-файлы/журнал/Git сохранены, но activity timestamp нет — явный `request touch KEY`.

`context read path` не создаёт файл; отсутствие — ошибка. `context restore path --revision FULL_SHA`
восстанавливает mutable-файл (включая удалённый) из сохранённой Git-версии и делает новый commit.
Commit/restore принимают конкретные файлы, не каталоги. Незакоммиченный/staged preimage не теряется; immutable source/inbox и append-only журналы так не переписываются.
Данные, которых никогда не было в Git, Git восстановить не может.

## Backup и restore

`backup /existing-parent/new-backup-directory` использует SQLite backup API, отдельный Git bundle и checksum manifest.
Cooperating writers блокируются; грязный контекст/битые ссылки требуют сверки. DB-only backup разрешён и без home.
Snapshot не пишется в git. Manifest появляется последним; неполный backup не выдаётся за пригодный.

`restore /backup-directory` выполняется в новой установке с отсутствующими БД и home. Он не затирает текущие данные:
повтор отказывается без изменений. Проверяются hashes, схема/integrity/FK, source и все ссылки на артефакты.
Старые повреждённые данные сначала отдельно сохраняются оператором; автоматического удаления/retention нет.

Git commits контекста имеют identity mypi и не выполняют пользовательские hooks/fsmonitor/signing;
private Git attributes сохраняют байты без EOL/encoding/filter-преобразований.
Рабочие clones проектов, ветки и remote sync эти команды не затрагивают.

## Приёмка

`mise exec -- pnpm verify` — admission + fast + boundary под systemd/bubblewrap, без личного home и сети.
После изменения исходников сначала build; stale dist отвергается. Функциональные проверки и ограничения
независимого review/trusted gate — [M1-CYCLE.md](M1-CYCLE.md). Численные нормы — только [TESTING.md](TESTING.md).
