const header = { type: 'session', version: 3, id: 's1', timestamp: '2026-11-07T10:00:00.000Z', cwd: '/work' };
const at = '2026-11-07T10:00:01.000Z';
const user = (id: string, parentId: string | null, text: string) =>
  ({ type: 'message', id, parentId, timestamp: at, message: { role: 'user', content: [{ type: 'text', text }] } });
const call = (id: string, parentId: string, callId: string, name: string, args: Record<string, unknown>) =>
  ({ type: 'message', id, parentId, timestamp: at, message: { role: 'assistant', content: [{ type: 'toolCall', id: callId, name, arguments: args }] } });
const result = (id: string, parentId: string, callId: string, toolName: string, nestedCalls?: unknown) =>
  ({ type: 'message', id, parentId, timestamp: at, message: { role: 'toolResult', toolCallId: callId, toolName, content: [{ type: 'text', text: 'ok' }],
    isError: false, ...(nestedCalls === undefined ? {} : { nestedCalls }) } });
const folder = '{{HOME}}/projects/one/project/tasks/MP-12-scoped-warmup/';

const sessions: Record<string, unknown[]> = {
  'write-bash': [
    header,
    user('e1', null, 'раньше'),
    call('e2', 'e1', 't1', 'write', { path: '{{TMP}}/old.md', content: '# Old\n' }),
    user('e3', 'e2', 'сделай'),
    call('e4', 'e3', 't2', 'write', { path: '{{TMP}}/notes.md', content: '# Notes\n' }),
    result('e5', 'e4', 't2', 'write'),
    call('e6', 'e5', 't3', 'bash', { command: 'echo x > {{TMP}}/a.md' }),
    call('e7', 'e6', 't4', 'edit', { path: 'notes/rel.md', oldText: 'a', newText: 'b' }),
  ],
  'codemode': [
    header,
    user('e1', null, 'сделай'),
    call('e2', 'e1', 'c1', 'codemode', { code: "await write({ path: dir + '/nested.md', content }); await write({ path: '/tmp/mypi-big-report.md', content: big }); await publish(plan);" }),
    result('e3', 'e2', 'c1', 'codemode', { calls: [
      { name: 'write', arguments: { path: '{{TMP}}/nested.md', content: '# Nested\n' } },
      { name: 'write', argumentsBytes: 20000 },
      { name: 'mcp__derive__publish', arguments: { content: '# Plan\n', title: 'Plan' } },
      { name: 'mcp__mypi__context_write', arguments: { paths: ['projects/one/project/tasks/MP-12-scoped-warmup/plan.md'] } },
    ], complete: true }),
    call('e4', 'e3', 'c2', 'codemode', { code: "await write({ path: '/tmp/mypi-old.html', content: page });" }),
  ],
  'truncated': [
    header,
    user('e1', null, 'сделай'),
    call('e2', 'e1', 'c1', 'codemode', { code: "for (const p of parts) await bash({ command: p }); await write({ path: '/tmp/mypi-late.md', content: tail });" }),
    result('e3', 'e2', 'c1', 'codemode', { calls: [{ name: 'bash', arguments: { command: 'ls' } }], complete: false }),
  ],
  'saved-source': [
    header,
    user('e1', null, 'сделай'),
    call('e2', 'e1', 't1', 'write', { path: '{{TMP}}/notes.md', content: '# Notes\n' }),
    call('e3', 'e2', 't2', 'bash', { command: 'cp {{TMP}}/notes.md ' + folder }),
  ],
  'index-only': [
    header,
    user('e1', null, 'сделай'),
    call('e2', 'e1', 't1', 'write', { path: '{{TMP}}/notes.md', content: '# Notes\n' }),
    call('e3', 'e2', 't2', 'edit', { path: '{{HOME}}/projects/one/project/INDEX.md', oldText: 'a', newText: '- notes {{TMP}}/notes.md' }),
  ],
  'parent': [
    header,
    user('e1', null, 'раньше'),
    call('e2', 'e1', 't0', 'bash', { command: 'ls' }),
    user('e3', 'e2', 'сделай'),
    call('e4', 'e3', 't1', 'write', { path: '{{TMP}}/a.md', content: '# A\n' }),
    user('e5', 'e4', '[mypi: сообщение родительской сессии MP для MP-12. Ниже — поручение родительской сессии]\ngo'),
    call('e6', 'e5', 't2', 'write', { path: '{{TMP}}/b.md', content: '# B\n' }),
    { type: 'custom_message', id: 'e7', parentId: 'e6', timestamp: at, customType: 'mypi-save-check', content: 'mypi: this turn made files that home does not keep.', display: true },
    call('e8', 'e7', 't3', 'bash', { command: 'cp {{TMP}}/a.md {{TMP}}/b.md ' + folder }),
  ],
};

export function piTurnSession(name: string, home: string, tmp: string): string {
  return sessions[name]!.map(entry => JSON.stringify(entry).replaceAll('{{HOME}}', home).replaceAll('{{TMP}}', tmp) + '\n').join('');
}
