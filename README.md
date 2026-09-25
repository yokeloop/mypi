# mypi

Личная система ведения проектов и памяти для Pi-агента. Фаза 1: только основа —
`home/` (память, вложенный git со своим remote) и `projects/` (рабочие клоны).
Без агентов, табов, скиллов для разработки и БД.

## Философия

- **Память — это git, не база.** Наблюдаемые факты (journal, knowledge, notes,
  manifest проектов) живут в `home/` и синкаются своим remote между машинами.
- **Обычное сообщение ничего не создаёт.** Сущность рождается только из
  явного capture (унаследовано из NorthStar: explicit capture → Draft).
- **Journal хранит исходы, не процесс.** Код, решения, тупики — одной строкой
  со ссылками на артефакты по путям. Никаких «обсудили X».
- **Артефакты иммутабельны и адресуемы.** Plan/report/ADR лежат в
  `home/knowledge/<org>/<project>/ai/<slug>/`, journal ссылается по пути.
- **Проект — это паспорт + глоссарий.** `projects.json` знает, где клон;
  `context.md` фиксирует термины домена.

## Layout

```
mypi/
├── home/                  # вложенный git-репозиторий личных данных (не в git mypi)
│   ├── journal/YYYY-MM.md # пул-wide журнал, newest-first, один файл на месяц
│   ├── inbox.md           # явный capture: черновики (drafts), по строке на идею
│   ├── knowledge/<org>/<project>/
│   │   ├── context.md     # глоссарий домена проекта
│   │   ├── adr/           # архитектурные решения (accepted/proposed)
│   │   └── ai/<slug>/     # иммутабельные артефакты: plans, reports, research
│   ├── notes/             # отдельные заметки по темам
│   └── projects.json      # паспорт-манифест: org, name, path клона
├── projects/              # рабочие клоны проектов (не в git)
└── scripts/
    ├── bootstrap.sh       # поднять home/ из MYPY_HOME_REMOTE или создать свежий
    └── mypi.py            # CLI: journal / capture / note / project / warmup
```

## Быстрый старт

```bash
./scripts/bootstrap.sh                    # home/ из remote или с нуля
python3 scripts/mypi.py project add prineycom/sp-cli ~/repos/sp-cli
python3 scripts/mypi.py capture "переработать систему памяти"   # → inbox.md
python3 scripts/mypi.py journal prineycom/sp-cli "записать исход"
python3 scripts/mypi.py warmup            # дайджест на старте сессии
```

## Документы

- [`CONCEPT.md`](./CONCEPT.md) — синтез: что взято из yokemate-pi, что из NorthStar.
- [`PLAN.md`](./PLAN.md) — фазы развития, фаза 1 и что дальше.
- [`AGENTS.md`](./AGENTS.md) — правила агента, работающего в корне mypi.