#!/usr/bin/env python3
"""mypi CLI — phase 1: home directory memory + project passport.

No deps, stdlib only. Memory lives in home/ (nested git repo).
"""
import json
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOME = ROOT / "home"
JOURNAL_DIR = HOME / "journal"
INBOX = HOME / "inbox.md"
NOTES = HOME / "notes"
KNOWLEDGE = HOME / "knowledge"
PROJECTS = HOME / "projects.json"
BOOTSTRAP = ROOT / "scripts" / "bootstrap.sh"

TZ = timezone(timedelta(hours=2))  # Europe/Belgrade CEST; see TODO in warmup

def now() -> str:
    return datetime.now(TZ).strftime("%Y-%m-%d %H:%M")

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

# --- journal ---

def journal_path() -> Path:
    p = JOURNAL_DIR / f"{datetime.now(TZ):%Y-%m}.md"
    if not p.exists():
        p.write_text("# Journal\n", encoding="utf-8")
    return p

def journal_add(org_project: str, text: str) -> None:
    ensure_home()
    p = journal_path()
    entry = f"\n## {today()} — {org_project} — no ticket\n\n- {text}\n"
    # insert after the "# Journal" header, newest-first
    content = p.read_text(encoding="utf-8")
    lines = content.split("\n")
    # find first blank line after header line
    idx = 1
    for i, line in enumerate(lines):
        if line.startswith("# "):
            idx = i + 1
            break
    insert = entry.rstrip("\n").split("\n")
    lines[idx:idx] = insert
    p.write_text("\n".join(lines), encoding="utf-8")
    print(f"journal: {org_project} → {p.relative_to(ROOT)}")

# --- capture (inbox draft) ---

def capture(text: str) -> None:
    ensure_home()
    if not INBOX.exists():
        INBOX.write_text("# Inbox\n\n## Drafts\n\n", encoding="utf-8")
    line = f"- ({today()}) {text}"
    with INBOX.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(f"captured → home/inbox.md")

def inbox_drafts() -> list[str]:
    if not INBOX.exists():
        return []
    drafts = []
    for line in INBOX.read_text(encoding="utf-8").split("\n"):
        if line.startswith("- ("):
            drafts.append(line)
    return drafts

# --- memory (MEMORY.md) ---

def memory_path() -> Path:
    p = HOME / "MEMORY.md"
    if not p.exists():
        p.write_text("# Memory\n\nОбщая память агента: факты, предпочтения, договорённости.\nПодгружается на старте каждой сессии (warmup).\n", encoding="utf-8")
    return p

def memory_items() -> list[tuple[int, str]]:
    """[(raw_line_index, line)] for item lines in MEMORY.md."""
    p = memory_path()
    lines = p.read_text(encoding="utf-8").split("\n")
    return [(i, l) for i, l in enumerate(lines) if l.startswith("- (")]

def memory_add(text: str) -> None:
    ensure_home()
    p = memory_path()
    with p.open("a", encoding="utf-8") as f:
        f.write(f"- ({today()}) {text}\n")
    print(f"memory → {p.relative_to(ROOT)}")

def memory_show() -> None:
    ensure_home()
    p = memory_path()
    if not p.exists():
        print("(memory file does not exist)")
        return
    content = p.read_text(encoding="utf-8")
    if "- (" not in content:
        print(content)
        return
    n = 0
    for line in content.split("\n"):
        if line.startswith("- ("):
            n += 1
            print(f"{n}. {line}")
        elif line.strip():
            print(line)

def memory_remove(num: int) -> None:
    ensure_home()
    p = memory_path()
    items = memory_items()
    if num < 1 or num > len(items):
        die(f"no item #{num} (1..{len(items)})")
    raw_idx, line = items[num - 1]
    lines = p.read_text(encoding="utf-8").split("\n")
    del lines[raw_idx]
    p.write_text("\n".join(lines), encoding="utf-8")
    print(f"removed #{num}: {line}")

# --- note ---

def note_add(topic: str, text: str) -> None:
    ensure_home()
    NOTES.mkdir(exist_ok=True)
    slug = "".join(c if c.isalnum() else "-" for c in topic.lower()).strip("-")
    p = NOTES / f"{today()}-{slug}.md"
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
    data[org_name] = {
        "org": org,
        "name": name,
        "path": str(clone),
        "added": today(),
    }
    write_projects(data)
    # knowledge skeleton
    kdir = KNOWLEDGE / org / name
    (kdir / "adr").mkdir(parents=True, exist_ok=True)
    (kdir / "ai").mkdir(parents=True, exist_ok=True)
    ctx = kdir / "context.md"
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

# --- warmup ---

def journal_blocks() -> list[str]:
    """Newest-first journal entry headers from the current month file."""
    p = journal_path()
    content = p.read_text(encoding="utf-8")
    return [b.strip() for b in content.split("\n## ")[1:]]

def warmup() -> None:
    ensure_home()
    print("=== mypi warmup ===")
    # MEMORY.md — agent-wide memory, loaded at session start
    print("\n--- memory ---")
    p = memory_path()
    if p.exists():
        print(p.read_text(encoding="utf-8"))
    print("\n--- journal (newest) ---")
    for b in journal_blocks()[:10]:
        print(b.split("\n")[0])
    # projects
    print("\n--- projects ---")
    data = read_projects()
    if data:
        for key in data:
            print(key)
    else:
        print("(empty)")
    # inbox
    print("\n--- inbox drafts ---")
    drafts = inbox_drafts()
    if drafts:
        for d in drafts[-10:]:
            print(d)
    else:
        print("(empty)")

def main() -> None:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(0)
    cmd = args[0]
    if cmd == "warmup":
        warmup()
    elif cmd == "capture":
        if len(args) < 2:
            die("capture requires text: mypi.py capture \"<text>\"")
        capture(" ".join(args[1:]))
    elif cmd == "journal":
        if len(args) < 3:
            die('journal requires org/project and text: mypi.py journal <org/project> "<outcome>"')
        journal_add(args[1], " ".join(args[2:]))
    elif cmd == "memory":
        sub = args[1] if len(args) > 1 else ""
        if sub == "add" and len(args) >= 3:
            memory_add(" ".join(args[2:]))
        elif sub == "show":
            memory_show()
        elif sub == "remove" and len(args) >= 3 and args[2].isdigit():
            memory_remove(int(args[2]))
        else:
            die('usage: mypi.py memory add "<fact>" | memory show | memory remove <n>')
    elif cmd == "note":
        if len(args) < 3:
            die('note requires topic and text: mypi.py note "<topic>" "<text>"')
        note_add(args[1], " ".join(args[2:]))
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