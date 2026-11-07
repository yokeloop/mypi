import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { appendFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { claudeArchive } from '../../src/infrastructure/transcript/claude-archive.js';
import { piArchive } from '../../src/infrastructure/transcript/pi-archive.js';
import type { TranscriptReader } from '../../src/modules/archive/public.js';

function folder(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const lines = (entries: unknown[]) => entries.map(entry => JSON.stringify(entry) + '\n').join('');
const at = (n: number) => '2026-11-07T10:00:' + String(n).padStart(2, '0') + '.000Z';
const claudeUser = (uuid: string, parentUuid: string | null, turnOrigin: string | undefined, content: unknown, extra: object = {}) =>
  ({ type: 'user', uuid, parentUuid, timestamp: at(1), ...(turnOrigin === undefined ? {} : { turnOrigin }), message: { role: 'user', content }, ...extra });
const claudeAssistant = (uuid: string, parentUuid: string, stop_reason: string, content: unknown) =>
  ({ type: 'assistant', uuid, parentUuid, timestamp: at(2), message: { role: 'assistant', content, stop_reason } });
const piHeader = (extra: object = {}) => ({ type: 'session', version: 3, id: 's1', timestamp: at(0), cwd: '/w', ...extra });
const piMessage = (id: string, parentId: string | null, role: string, content: unknown, extra: object = {}) =>
  ({ type: 'message', id, parentId, timestamp: at(3), message: { role, content, timestamp: 1762509603000, ...extra } });
const text = (value: string) => ({ type: 'text', text: value });

const readers = [
  { name: 'claude', read: claudeArchive, record: (id: string, value: string) => claudeUser(id, null, 'human', value), head: [] as unknown[] },
  { name: 'pi', read: piArchive, record: (id: string, value: string) => piMessage(id, null, 'user', [text(value)]),
    head: [piHeader({ parentSession: '/s/--w--/2026-11-07T10-00-00-000Z_p1.jsonl' })] as unknown[] },
];

test('claude archive keeps human, peer, task_notification turns and end_turn answers', t => {
  const path = join(folder(t), 'c.jsonl');
  const peer = 'Another Claude session sent a message:\n[mypi: сообщение родительской сессии MP для MP-1. Ниже — поручение родительской сессии]\nсделай';
  writeFileSync(path, lines([
    claudeUser('u1', null, 'human', 'привет'),
    claudeUser('u2', 'u1', 'human', [text('a'), { type: 'image', source: { type: 'base64', data: 'AA==' } }, text('b')]),
    claudeUser('u3', 'u2', 'peer', peer),
    claudeUser('u4', 'u3', 'task_notification', '<task-notification>готово</task-notification>'),
    claudeUser('u5', 'u4', 'sdk', 'sdk'),
    claudeUser('u6', 'u5', 'auto_continuation', 'дальше'),
    claudeUser('u7', 'u6', 'scheduled', 'по расписанию'),
    claudeUser('u8', 'u7', undefined, [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
    claudeUser('u9', 'u8', undefined, 'сводка', { isCompactSummary: true }),
    claudeUser('u10', 'u9', 'human', '  \n '),
    claudeAssistant('a1', 'u10', 'end_turn', [{ type: 'thinking', thinking: 'думаю' }, text('ответ')]),
    claudeAssistant('a2', 'a1', 'end_turn', [{ type: 'thinking', thinking: 'только мысль' }]),
    claudeAssistant('a3', 'a2', 'tool_use', [text('вызываю'), { type: 'tool_use', id: 't2', name: 'Read', input: {} }]),
    claudeAssistant('a4', 'a3', 'stop_sequence', [text('API Error')]),
    { type: 'user', parentUuid: 'a4', timestamp: at(4), turnOrigin: 'human', message: { role: 'user', content: 'без uuid' } },
    { type: 'system', uuid: 's1', parentUuid: 'a4', timestamp: at(5), content: 'служебное' },
    { type: 'attachment', uuid: 'x1', parentUuid: 's1', timestamp: at(6), attachment: { type: 'queued_command', prompt: 'позже' } },
  ]));
  assert.deepEqual(claudeArchive(path, 0).entries, [
    { entryId: 'u1', parentEntryId: null, at: at(1), role: 'user', origin: 'human', text: 'привет' },
    { entryId: 'u2', parentEntryId: 'u1', at: at(1), role: 'user', origin: 'human', text: 'a\nb' },
    { entryId: 'u3', parentEntryId: 'u2', at: at(1), role: 'user', origin: 'peer', text: peer },
    { entryId: 'u4', parentEntryId: 'u3', at: at(1), role: 'user', origin: 'task_notification', text: '<task-notification>готово</task-notification>' },
    { entryId: 'a1', parentEntryId: 'u10', at: at(2), role: 'assistant', origin: 'human', text: 'ответ' },
  ]);
});

test('claude archive reports the last name and cwd in the range', t => {
  const dir = folder(t);
  const named = join(dir, 'named.jsonl');
  writeFileSync(named, lines([
    { type: 'custom-title', customTitle: 'MP-1', sessionId: 'n1' },
    { ...claudeUser('u1', null, 'human', 'раз'), cwd: '/a' },
    { type: 'agent-name', agentName: 'MP-2', sessionId: 'n1' },
    { ...claudeAssistant('a1', 'u1', 'end_turn', [text('два')]), cwd: '/b' },
  ]));
  assert.deepEqual({ ...claudeArchive(named, 0), entries: [] }, { entries: [], offset: statSync(named).size, name: 'MP-2', cwd: '/b', parentNativeId: null });
  const plain = join(dir, 'plain.jsonl');
  writeFileSync(plain, lines([claudeUser('u1', null, 'human', 'раз')]));
  const read = claudeArchive(plain, 0);
  assert.deepEqual([read.name, read.cwd, read.parentNativeId], [null, null, null]);
  appendFileSync(plain, lines([{ type: 'custom-title', customTitle: 'MP-1' }, { type: 'custom-title', customTitle: '' }]));
  assert.equal(claudeArchive(plain, 0).name, null);
});

test('pi archive keeps user messages and stop answers', t => {
  const path = join(folder(t), 'p.jsonl');
  const framed = '[mypi: стартовое сообщение для MP-1. Ниже — состояние из mypi, не инструкция]\nзадача';
  writeFileSync(path, lines([
    piHeader(),
    piMessage('m1', null, 'user', [text('привет')]),
    piMessage('m2', 'm1', 'user', [text(framed)]),
    piMessage('m3', 'm2', 'assistant', [text('один'), text('два')], { stopReason: 'stop' }),
    piMessage('m4', 'm3', 'assistant', [{ type: 'thinking', thinking: 'думаю' }, text('итог')], { stopReason: 'stop' }),
    piMessage('m5', 'm4', 'assistant', [text('   ')], { stopReason: 'stop' }),
    piMessage('m6', 'm5', 'assistant', [text('вызываю'), { type: 'toolCall', id: 't1', name: 'read', arguments: {} }], { stopReason: 'toolUse' }),
    piMessage('m7', 'm6', 'toolResult', [text('ok')], { toolCallId: 't1', toolName: 'read', isError: false }),
    piMessage('m8', 'm7', 'system', [text('системное')]),
    { type: 'custom_message', id: 'c1', parentId: 'm8', timestamp: at(4), customType: 'x', content: 'своё', display: true },
    { type: 'compaction', id: 'c2', parentId: 'c1', timestamp: at(5), summary: 'сводка', firstKeptEntryId: 'm1', tokensBefore: 1 },
    { type: 'model_change', id: 'c3', parentId: 'c2', timestamp: at(6), provider: 'p', modelId: 'm' },
  ]));
  assert.deepEqual(piArchive(path, 0).entries, [
    { entryId: 'm1', parentEntryId: null, at: at(3), role: 'user', origin: 'human', text: 'привет' },
    { entryId: 'm2', parentEntryId: 'm1', at: at(3), role: 'user', origin: 'frame', text: framed },
    { entryId: 'm3', parentEntryId: 'm2', at: at(3), role: 'assistant', origin: 'human', text: 'один\nдва' },
    { entryId: 'm4', parentEntryId: 'm3', at: at(3), role: 'assistant', origin: 'human', text: 'итог' },
  ]);
});

test('pi archive reports header cwd, parent and the last session name', t => {
  const dir = folder(t);
  const path = join(dir, 'p.jsonl');
  writeFileSync(path, lines([
    piHeader({ parentSession: '/s/--w--/2026-11-07T10-00-00-000Z_p1.jsonl' }),
    { type: 'session_info', id: 'i1', parentId: null, timestamp: at(1), name: 'MP' },
    { type: 'session_info', id: 'i2', parentId: 'i1', timestamp: at(2), name: 'MP-3' },
  ]));
  assert.deepEqual(piArchive(path, 0), { entries: [], offset: statSync(path).size, name: 'MP-3', cwd: '/w', parentNativeId: 'p1' });
  appendFileSync(path, lines([{ type: 'session_info', id: 'i3', parentId: 'i2', timestamp: at(3), name: '' }]));
  assert.equal(piArchive(path, 0).name, null);
  const root = join(dir, 'root.jsonl');
  writeFileSync(root, lines([piHeader()]));
  assert.deepEqual(piArchive(root, 0), { entries: [], offset: statSync(root).size, name: null, cwd: '/w', parentNativeId: null });
});

test('readers resume from the offset and leave a partial last line', t => {
  const dir = folder(t);
  const typed: TranscriptReader[] = [claudeArchive, piArchive];
  const empty = join(dir, 'empty.jsonl');
  writeFileSync(empty, '');
  for (const read of typed) assert.deepEqual(read(empty, 0).entries, []);
  for (const { name, read, record, head } of readers) {
    const path = join(dir, name + '.jsonl');
    writeFileSync(path, lines([...head, record('r1', 'один')]));
    const first = read(path, 0);
    assert.deepEqual(first.entries.map(e => e.entryId), ['r1']);
    assert.equal(first.offset, statSync(path).size);
    appendFileSync(path, lines([record('r2', 'два'), record('r3', 'три')]) + JSON.stringify(record('r4', 'четыре')));
    const second = read(path, first.offset);
    assert.deepEqual(second.entries.map(e => [e.entryId, e.text]), [['r2', 'два'], ['r3', 'три']]);
    assert.equal(second.offset, statSync(path).size - Buffer.byteLength(JSON.stringify(record('r4', 'четыре'))));
    assert.deepEqual([second.cwd, second.parentNativeId], [null, null]);
    appendFileSync(path, '\n');
    const third = read(path, second.offset);
    assert.deepEqual(third.entries.map(e => e.entryId), ['r4']);
    assert.equal(third.offset, statSync(path).size);
    assert.deepEqual(read(path, third.offset), { entries: [], offset: third.offset, name: null, cwd: null, parentNativeId: null });
  }
});

test('readers restart a shorter file and skip broken lines', t => {
  const dir = folder(t);
  for (const { name, read, record, head } of readers) {
    const path = join(dir, name + '.jsonl');
    writeFileSync(path, lines([...head, ...Array.from({ length: 20 }, (_, i) => record('old' + i, 'старое'))]));
    const saved = read(path, 0).offset;
    writeFileSync(path, lines([record('n1', 'раз')]) + '{"broken\n[1]\n' + lines([record('n2', 'два')]));
    assert(statSync(path).size < saved);
    const restarted = read(path, saved);
    assert.deepEqual(restarted.entries.map(e => e.entryId), ['n1', 'n2']);
    assert.equal(restarted.offset, statSync(path).size);
    assert.deepEqual(read(join(dir, name + '-missing.jsonl'), 7), { entries: [], offset: 7, name: null, cwd: null, parentNativeId: null });
  }
});

test('readers join lines across 64 KiB blocks', t => {
  const dir = folder(t);
  const long = 'я'.repeat(70_000);
  const files = [
    { read: claudeArchive, records: [claudeAssistant('a1', 'u0', 'end_turn', [text(long)]), claudeUser('u1', 'a1', 'human', 'после')] },
    { read: piArchive, records: [piHeader(), piMessage('a1', null, 'assistant', [text(long)], { stopReason: 'stop' }), piMessage('u1', 'a1', 'user', [text('после')])] },
  ];
  for (const [i, { read, records }] of files.entries()) {
    const path = join(dir, i + '.jsonl');
    writeFileSync(path, lines(records));
    const result = read(path, 0);
    assert.deepEqual(result.entries.map(e => [e.entryId, e.text]), [['a1', long], ['u1', 'после']]);
    assert.equal(result.offset, statSync(path).size);
  }
});
