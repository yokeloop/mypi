# mypi

Личная система ведения проектов и памяти для Pi-агента. Фаза 1: только основа —
`home/` (память, вложенный git со своим remote) и проекты из паспорта.
Без агентов, табов, скиллов для разработки и БД.

## Философия

- **Память — это git, не база.** Наблюдаемые факты (journal, memory, notes,
  manifest проектов) живут в `home/` и синкаются своим remote между машинами.
- **Обычное сообщение ничего не создаёт.** Сущность рождается только из
  явного capture (унаследовано из NorthStar: explicit capture → Draft).
- **Journal хранит исходы, не процесс.** Код, решения, тупики — одной строкой
  со ссылками на артефакты по путям. Никаких «обсудили X».
- **Артефакты иммутабельны и адресуемы.** Plan/report/ADR лежат по стабильным
  путям в папке проекта, journal и memory ссылаются по пути.
- **Проект — это папка.** Всё о проекте: журнал, память, глоссарий, ADR,
  заметки, артефакты — в `home/<org>/<project>/`. Org тоже имеет свою память.

## Layout

```
mypi/
├── home/                       # вложенный git-репозиторий (не в git mypi)
│   ├── MEMORY.md               # глобальная память агента
│   ├── inbox.md                # явный capture: drafts
│   ├── projects.json           # паспорт: org, name, path клона
│   ├── notes/                  # заметки вне проектов
│   └── <org>/
│       ├── MEMORY.md           # память уровня организации (lazy)
│       └── <project>/
│           ├── MEMORY.md       # память проекта (lazy)
│           ├── journal/YYYY-MM.md   # журнал проекта, newest-first
│           ├── notes/          # заметки проекта
│           ├── context.md      # глоссарий домена
│           ├── adr/            # архитектурные решения
│           └── ai/<slug>/      # иммутабельные артефакты: plans, reports
├── projects/                   # рабочие клоны (не в git)
└── scripts/
    ├── bootstrap.sh            # поднять home/ из MYPY_HOME_REMOTE или создать
    └── mypi.py                 # CLI
```

## Быстрый старт

```bash
./scripts/bootstrap.sh
python3 scripts/mypi.py project add prineycom/sp-cli ~/repos/sp-cli
python3 scripts/mypi.py capture "переработать систему памяти"   # → inbox.md
python3 scripts/mypi.py journal prineycom/sp-cli "записать исход"
python3 scripts/mypi.py memory add "стабильный факт"             # глобальная
python3 scripts/mypi.py memory -s prineycom add "факт по орге"   # org-level
python3 scripts/mypi.py memory -s prineycom/sp-cli add "факт по проекту"
python3 scripts/mypi.py memory -s prineycom/sp-cli show           # с номерами
python3 scripts/mypi.py memory -s prineycom/sp-cli remove 2       # удалить №2
python3 scripts/mypi.py note -s prineycom/sp-cli "тема" "текст"   # заметка в проект
python3 scripts/mypi.py warmup                     # глобальный: память + проекты + inbox
python3 scripts/mypi.py warmup -s prineycom          # + память и проекты орги
python3 scripts/mypi.py warmup -s prineycom/sp-cli  # + память, глоссарий и хвост журнала проекта
```

## Scope-модель

`-s <org>` или `-s <org>/<project>` применяется к memory и note:

- без флага — глобальный уровень (`home/MEMORY.md`, `home/notes/`)
- `-s org` — уровень организации (`home/<org>/MEMORY.md`)
- `-s org/project` — уровень проекта (`home/<org>/<project>/…`)

Скопы валидируются по паспорту: журнал и память пишутся только в известные
проекты/орги — защита от опечаток, создающих пустые папки.

## Документы

- [`CONCEPT.md`](./CONCEPT.md) — синтез: что взято из yokemate-pi, что из NorthStar.
- [`PLAN.md`](./PLAN.md) — фазы развития, фаза 1 и что дальше.
- [`AGENTS.md`](./AGENTS.md) — правила агента, работающего в корне mypi.