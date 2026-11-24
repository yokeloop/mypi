const transcripts: Record<string, unknown[]> = {
  'bash-tmp': [
    {"type": "user", "turnOrigin": "human", "cwd": "/work", "message": {"role": "user", "content": "сделай"}},
    {"type": "assistant", "cwd": "{{TMP}}", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t2", "name": "Bash", "input": {"command": "echo x > {{TMP}}/a.md"}}]}},
    {"type": "assistant", "cwd": "{{TMP}}", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t3", "name": "Bash", "input": {"command": "printf y | tee {{TMP}}/b.md"}}]}},
    {"type": "assistant", "cwd": "{{TMP}}", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t4", "name": "Bash", "input": {"command": "cat <<'EOF' > {{TMP}}/c.html\n<p>body</p>\n> quote.md\nEOF"}}]}},
    {"type": "assistant", "cwd": "{{TMP}}", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t5", "name": "Bash", "input": {"command": "ls {{TMP}} 2>/dev/null"}}]}},
    {"type": "assistant", "cwd": "{{TMP}}", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t6", "name": "Bash", "input": {"command": "cat <<< word\necho d > {{TMP}}/d.md"}}]}},
    {"type": "assistant", "cwd": "{{TMP}}", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t7", "name": "Bash", "input": {"command": "echo $((1<<2))\necho e > {{TMP}}/e.md"}}]}},
  ],
  'index-only': [
    {"type": "user", "turnOrigin": "human", "cwd": "/work", "message": {"role": "user", "content": "сделай"}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t10", "name": "Write", "input": {"file_path": "{{TMP}}/notes.md", "content": "# Notes\n"}}]}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t11", "name": "Edit", "input": {"file_path": "{{HOME}}/projects/one/project/INDEX.md", "old_string": "a", "new_string": "- notes {{TMP}}/notes.md"}}]}},
  ],
  'map': [
    {"type": "user", "turnOrigin": "human", "cwd": "/work", "message": {"role": "user", "content": "сделай"}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t19", "name": "Edit", "input": {"file_path": "{{HOME}}/projects/one/project/INDEX.md", "old_string": "a", "new_string": "b"}}]}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t20", "name": "mcp__mypi__context_write", "input": {"paths": ["projects/one/INDEX.md"], "message": "map"}}]}},
  ],
  'parent-block': [
    {"type": "user", "turnOrigin": "human", "cwd": "/work", "message": {"role": "user", "content": "раньше"}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t0", "name": "Write", "input": {"file_path": "{{TMP}}/earlier.md", "content": "old"}}]}},
    {"type": "user", "turnOrigin": "peer", "isMeta": true, "cwd": "/work", "message": {"role": "user", "content": "Another Claude session sent a message:\n[mypi: сообщение родительской сессии MP для MP-12. Ниже — поручение родительской сессии]\ngo"}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "text", "text": "пишу"}, {"type": "tool_use", "id": "t1", "name": "Write", "input": {"file_path": "{{TMP}}/notes.md", "content": "# Notes\n"}}, {"type": "tool_use", "id": "t2", "name": "Read", "input": {"file_path": "{{TMP}}/notes.md"}}]}},
    {"type": "user", "cwd": "/work", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]}},
    {"type": "user", "isMeta": true, "rowSource": "hook", "cwd": "/work", "message": {"role": "user", "content": "Stop hook feedback:\nmypi: this turn made files that home does not keep."}},
    {"type": "assistant", "cwd": "/other", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t3", "name": "Bash", "input": {"command": "cp {{TMP}}/notes.md {{HOME}}/projects/one/project/tasks/MP-12-scoped-warmup/"}}]}},
  ],
  'publish': [
    {"type": "user", "turnOrigin": "human", "cwd": "/work", "message": {"role": "user", "content": "сделай"}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t12", "name": "mcp__derive__publish", "input": {"title": "Plan A", "content": "# Plan A\n"}}]}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t13", "name": "mcp__derive__publish", "input": {"title": "Plan B", "content": "# Plan B\n"}}]}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t14", "name": "Write", "input": {"file_path": "{{HOME}}/projects/one/project/tasks/MP-12-scoped-warmup/plan-b.md", "content": "# Plan B\n"}}]}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t15", "name": "mcp__derive__publish", "input": {"artifact": "abc", "edits": [{"old": "a", "new": "b"}]}}]}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t16", "name": "Bash", "input": {"command": "curl -sS -F file=@{{TMP}}/x.md https://draft.example/api"}}]}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t17", "name": "Bash", "input": {"command": "curl -sS -F file=@$D/plan.md https://draft.example/api"}}]}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t18", "name": "Bash", "input": {"command": "curl -sS -F file=@{{HOME}}/projects/one/project/tasks/MP-12-scoped-warmup/plan.md https://draft.example/api"}}]}},
  ],
  'saved-source': [
    {"type": "user", "turnOrigin": "human", "cwd": "/work", "message": {"role": "user", "content": "сделай"}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t6", "name": "Write", "input": {"file_path": "{{TMP}}/notes.md", "content": "# Notes\n"}}]}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t7", "name": "Bash", "input": {"command": "cp {{TMP}}/notes.md {{HOME}}/projects/one/project/tasks/MP-12-scoped-warmup/"}}]}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t8", "name": "Write", "input": {"file_path": "{{TMP}}/draft.md", "content": "# Draft\n"}}]}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t9", "name": "Write", "input": {"file_path": "{{HOME}}/projects/one/project/tasks/MP-12-scoped-warmup/plan.md", "content": "# Draft"}}]}},
  ],
  'write-tmp': [
    {"type": "user", "turnOrigin": "human", "cwd": "/work", "message": {"role": "user", "content": "сделай"}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "Write", "input": {"file_path": "{{TMP}}/notes.md", "content": "# Notes\n"}}]}},
  ],
  'teammate-after-stop': [
    {"type": "user", "turnOrigin": "human", "cwd": "/work", "message": {"role": "user", "content": "сделай"}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "Write", "input": {"file_path": "{{TMP}}/x.md", "content": "# X\n"}}]}},
    {"type": "system", "subtype": "stop_hook_summary", "hookCount": 2, "cwd": "/work"},
    {"type": "user", "cwd": "/work", "message": {"role": "user", "content": "<teammate-message teammate_id=\"mp-1\">done</teammate-message>"}},
    {"type": "assistant", "cwd": "/work", "message": {"role": "assistant", "content": [{"type": "text", "text": "ok"}]}},
  ],
};

export function turnTranscript(name: string, home: string, tmp: string): string {
  return transcripts[name]!.map(entry => JSON.stringify(entry).replaceAll('{{HOME}}', home).replaceAll('{{TMP}}', tmp) + '\n').join('');
}
