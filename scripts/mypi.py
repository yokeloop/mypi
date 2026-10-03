#!/usr/bin/env python3
"""mypi CLI — phase 1: home directory memory + project passport.

No deps, stdlib only. Memory lives in home/ (nested git repo).

Structure:
  home/
  ├── MEMORY.md            # global agent memory
  ├── inbox.md, projects.json
  ├── notes/               # non-project notes
  └── <org>/
      ├── MEMORY.md        # org-level memory (lazy)
      └── <project>/
          ├── MEMORY.md    # project-level memory (lazy)
          ├── journal/YYYY-MM.md
          ├── notes/
          ├── context.md, adr/, ai/

Scope flag: `-s <org>` or `-s <org>/<project>` applies to memory/note commands.
"""
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOME = ROOT / "home"
INBOX = HOME / "inbox.md"
PROJECTS = HOME / "projects.json"

TZ = datetime.now().astimezone().tzinfo  # local machine timezone

def today() -> str:
    return datetime.now(TZ).strftime("%Y-%m-%d")

def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)

def ensure_home() -> None:
    if not HOME.is_dir():
        die("home/ not found — run scripts/bootstrap.sh first")

def read_projects() -> dict:
    if not PROJECTS.exists():
        return {}
    return json.loads(PROJECTS.read_text(encoding="utf-8"))

def write_projects(data: dict) -> None:
    PROJECTS.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

# --- scope ---

def resolve_scope_dir(scope: str | None) -> Path:
    """None → home/; 'org' → home/<org>/; 'org/project' → home/<org>/<project>/. Validated against passport."""
    if scope is None:
        return HOME
    data = read_projects()
    if "/" in scope:
        if scope not in data:
            die(f"unknown project scope: {scope} (not in passport — run project add)")
        org, name = scope.split("/", 1)
        return HOME / org / name
    orgs = {p.get("org") for p in data.values()}
    if scope not in orgs:
        die(f"unknown org scope: {scope} (no passport projects in this org)")
    return HOME / scope

def extract_scope(args: list[str]) -> tuple[str | None, list[str]]:
    """Pop leading '-s <scope>' from args."""
    if len(args) >= 2 and args[0] == "-s":
        return args[1], args[2:]
    return None, args

# --- journal (per project) ---

def journal_file(project_dir: Path, create: bool = False) -> Path:
    jdir = project_dir / "journal"
    p = jdir / f"{datetime.now(TZ):%Y-%m}.md"
    if create and not p.exists():
        jdir.mkdir(parents=True, exist_ok=True)
        p.write_text("# Journal\n", encoding="utf-8")
    return p

def journal_add(org_project: str, text: str) -> None:
    ensure_home()
    pdir = resolve_scope_dir(org_project)
    if pdir == HOME:
        die("journal requires a project: mypi.py journal <org/project> \"<outcome>\"")
    p = journal_file(pdir, create=True)
    entry = f"\n## {today()} — no ticket\n\n- {text}\n"
    content = p.read_text(encoding="utf-8")
    lines = content.split("\n")
    idx = 1
    for i, line in enumerate(lines):
        if line.startswith("# "):
            idx = i + 1
            break
    lines[idx:idx] = entry.rstrip("\n").split("\n")
    p.write_text("\n".join(lines), encoding="utf-8")
    print(f"journal: {org_project} → {p.relative_to(ROOT)}")

def journal_last_entry(project_dir: Path) -> str | None:
    """First '## ' line from the newest journal file of a project."""
    jdir = project_dir / "journal"
    if not jdir.is_dir():
        return None
    files = sorted(jdir.glob("*.md"), reverse=True)
    for f in files:
        for line in f.read_text(encoding="utf-8").split("\n"):
            if line.startswith("## "):
                return line.strip("# ").strip()
    return None

# --- error log (per project) ---

def error_log_add(org_project: str, text: str) -> None:
    """Structured error/dead-end log: source for bugreports and improvements.

    Journal records outcomes; errors.md records what hurt and why —
    searchable separately, reviewed periodically.
    """
    ensure_home()
    pdir = resolve_scope_dir(org_project)
    if pdir == HOME:
        die("error log requires a project: mypi.py error <org/project> \"<what failed>\"")
    p = pdir / "errors.md"
    if not p.exists():
        p.write_text(
            "# Ошибки\n\nЖурнал ошибок и тупиков проекта: что случилось, "
            "симптом, причина/гипотеза, куда ведёт (issue, ADR, nothing).\n"
            "Источник для багрепортов и улучшений.\n",
            encoding="utf-8",
        )
    with p.open("a", encoding="utf-8") as f:
        f.write(f"- ({today()}) {text}\n")
    print(f"error → {p.relative_to(ROOT)}")

# --- capture (inbox draft) ---

def capture(text: str) -> None:
    ensure_home()
    if not INBOX.exists():
        INBOX.write_text("# Inbox\n\n## Drafts\n\n", encoding="utf-8")
    with INBOX.open("a", encoding="utf-8") as f:
        f.write(f"- ({today()}) {text}\n")
    print("captured → home/inbox.md")

def inbox_drafts() -> list[str]:
    if not INBOX.exists():
        return []
    return [l for l in INBOX.read_text(encoding="utf-8").split("\n") if l.startswith("- (")]

# --- memory (MEMORY.md at global/org/project scope) ---

def memory_path(scope: str | None) -> Path:
    d = resolve_scope_dir(scope)
    if scope is not None:
        d.mkdir(parents=True, exist_ok=True)
    p = d / "MEMORY.md"
    if not p.exists():
        header = f"# Memory — {scope or 'global'}\n\nПамять: факты, предпочтения, договорённости.\nПодгружается на старте сессии (warmup).\n"
        p.write_text(header, encoding="utf-8")
    return p

def memory_items(p: Path) -> list[tuple[int, str]]:
    return [(i, l) for i, l in enumerate(p.read_text(encoding="utf-8").split("\n")) if l.startswith("- (")]

def memory_add(scope: str | None, text: str) -> None:
    ensure_home()
    p = memory_path(scope)
    with p.open("a", encoding="utf-8") as f:
        f.write(f"- ({today()}) {text}\n")
    print(f"memory → {p.relative_to(ROOT)}")

def memory_show(scope: str | None) -> None:
    ensure_home()
    p = memory_path(scope)
    content = p.read_text(encoding="utf-8")
    n = 0
    for line in content.split("\n"):
        if line.startswith("- ("):
            n += 1
            print(f"{n}. {line}")
        elif line.strip():
            print(line)

def memory_remove(scope: str | None, num: int) -> None:
    ensure_home()
    p = memory_path(scope)
    items = memory_items(p)
    if num < 1 or num > len(items):
        die(f"no item #{num} (1..{len(items)}) in {p.relative_to(ROOT)}")
    raw_idx, line = items[num - 1]
    lines = p.read_text(encoding="utf-8").split("\n")
    del lines[raw_idx]
    p.write_text("\n".join(lines), encoding="utf-8")
    print(f"removed #{num}: {line}")

# --- note ---

def note_add(scope: str | None, topic: str, text: str) -> None:
    ensure_home()
    ndir = resolve_scope_dir(scope) / "notes"
    ndir.mkdir(parents=True, exist_ok=True)
    slug = "".join(c if c.isalnum() else "-" for c in topic.lower()).strip("-")
    p = ndir / f"{today()}-{slug}.md"
    p.write_text(f"# {topic}\n\n- {text}\n", encoding="utf-8")
    print(f"note → {p.relative_to(ROOT)}")

# --- project passport ---

def project_add(org_name: str, path: str) -> None:
    ensure_home()
    data = read_projects()
    org, name = org_name.split("/", 1)
    clone = Path(path).expanduser().resolve()
    if not clone.is_dir():
        die(f"clone path does not exist: {clone}")
    data[org_name] = {"org": org, "name": name, "path": str(clone), "added": today()}
    write_projects(data)
    # project skeleton
    pdir = HOME / org / name
    (pdir / "journal").mkdir(parents=True, exist_ok=True)
    for sub in ("adr", "ai", "notes"):
        (pdir / sub).mkdir(exist_ok=True)
    ctx = pdir / "context.md"
    if not ctx.exists():
        ctx.write_text(f"# Глоссарий: {org}/{name}\n\n", encoding="utf-8")
    print(f"project: {org_name} → {clone}")

def project_list() -> None:
    data = read_projects()
    if not data:
        print("no projects in passport")
        return
    for key, p in data.items():
        print(f"{key}\n  path: {p.get('path')}\n  added: {p.get('added')}")

# --- warmup (cascade: global → org → project) ---

def warmup(scope: str | None) -> None:
    ensure_home()
    data = read_projects()
    print(f"=== mypi warmup — {scope or 'global'} ===")
    if scope is not None:
        # same validation as memory/note: scope must exist in passport
        resolve_scope_dir(scope)

    if scope is None:
        # global level: MEMORY.md, passport, inbox
        g = HOME / "MEMORY.md"
        print("\n--- memory (global) ---")
        print(g.read_text(encoding="utf-8") if g.exists() else "(empty)")
        print("\n--- projects ---")
        if data:
            for key in data:
                print(key)
        else:
            print("(empty)")
        print("\n--- inbox drafts ---")
        drafts = inbox_drafts()
        if drafts:
            for d in drafts[-10:]:
                print(d)
        else:
            print("(empty)")
        return

    # cascade: global → org → (project)
    parts = scope.split("/")
    org = parts[0]
    project = parts[1] if len(parts) > 1 else None

    g = HOME / "MEMORY.md"
    print("\n--- memory (global) ---")
    print(g.read_text(encoding="utf-8") if g.exists() else "(empty)")

    m = HOME / org / "MEMORY.md"
    print(f"\n--- memory ({org}) ---")
    print(m.read_text(encoding="utf-8") if m.exists() else "(empty)")

    if project is not None:
        pdir = HOME / org / project
        m = pdir / "MEMORY.md"
        print(f"\n--- memory ({scope}) ---")
        print(m.read_text(encoding="utf-8") if m.exists() else "(empty)")
        ctx = pdir / "context.md"
        if ctx.exists():
            print(f"\n--- glossary ({scope}) ---")
            print(ctx.read_text(encoding="utf-8"))
        entry = journal_last_entry(pdir)
        print(f"\n--- journal ({scope}, last) ---")
        print(entry if entry else "(empty)")
    else:
        # org level: list its projects
        org_projects = [k for k, p in data.items() if p.get("org") == org]
        print(f"\n--- projects ({org}) ---")
        if org_projects:
            for k in org_projects:
                print(k)
        else:
            print("(empty)")

def main() -> None:
    die("legacy CLI retired; use mise exec -- node dist/src/cli/main.js --help (import legacy explicitly)")
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(0)
    cmd = args[0]
    if cmd == "warmup":
        scope, rest = extract_scope(args[1:])
        if rest:
            die("warmup takes no positional args: mypi.py warmup [-s <org|org/project>]")
        warmup(scope)
    elif cmd == "capture":
        if len(args) < 2:
            die('capture requires text: mypi.py capture "<text>"')
        capture(" ".join(args[1:]))
    elif cmd == "journal":
        if len(args) < 3:
            die('journal requires org/project and text: mypi.py journal <org/project> "<outcome>"')
        journal_add(args[1], " ".join(args[2:]))
    elif cmd == "error":
        if len(args) < 3:
            die('error log requires org/project and text: mypi.py error <org/project> "<what failed>"')
        error_log_add(args[1], " ".join(args[2:]))
    elif cmd == "memory":
        scope, rest = extract_scope(args[1:])
        sub = rest[0] if rest else ""
        if sub == "add" and len(rest) >= 2:
            memory_add(scope, " ".join(rest[1:]))
        elif sub == "show":
            memory_show(scope)
        elif sub == "remove" and len(rest) >= 2 and rest[1].isdigit():
            memory_remove(scope, int(rest[1]))
        else:
            die('usage: mypi.py memory [-s <org|org/project>] add "<fact>" | show | remove <n>')
    elif cmd == "note":
        scope, rest = extract_scope(args[1:])
        if len(rest) < 2:
            die('note requires topic and text: mypi.py note [-s <scope>] "<topic>" "<text>"')
        note_add(scope, rest[0], " ".join(rest[1:]))
    elif cmd == "project":
        sub = args[1] if len(args) > 1 else ""
        if sub == "add" and len(args) >= 4:
            project_add(args[2], args[3])
        elif sub == "list":
            project_list()
        else:
            die("usage: mypi.py project add <org/name> <path> | project list")
    else:
        die(f"unknown command: {cmd}")

if __name__ == "__main__":
    main()