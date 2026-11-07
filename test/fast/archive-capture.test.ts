import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { archivePath } from '../../src/app/create-app.js';
import { captureArchive } from '../../src/app/archive.js';
import { captureInput } from '../../src/app/session-input.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { openArchive } from '../../src/infrastructure/database/archive.js';

const jsonl = (records: object[]) => records.map(r => JSON.stringify(r) + '\n').join('');
const at = (minute: number) => '2026-11-07T10:' + String(minute).padStart(2, '0') + ':00.000Z';
const user = (uuid: string, parentUuid: string | null, minute: number) =>
  ({ type: 'user', uuid, parentUuid, timestamp: at(minute), turnOrigin: 'human', message: { role: 'user', content: 'synthetic ' + uuid } });
const assistant = (uuid: string, parentUuid: string | null, minute: number) =>
  ({ type: 'assistant', uuid, parentUuid, timestamp: at(minute), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'synthetic ' + uuid }] } });
const piHeader = (id: string) => ({ type: 'session', version: 3, id, timestamp: at(0), cwd: '/synthetic' });
const piMessage = (id: string, parentId: string | null, role: 'user' | 'assistant', minute: number) =>
  ({ type: 'message', id, parentId, timestamp: at(minute), message: { role, stopReason: 'stop', content: [{ type: 'text', text: 'synthetic ' + id }] } });

const recorded = (result: ReturnType<typeof captureArchive>) => {
  assert.equal(result.captured, true);
  return result as Extract<typeof result, { inserted: number }>;
};

const stop = { session_id: 'c1', transcript_path: '/tmp/t.jsonl', cwd: '/work', permission_mode: 'default', hook_event_name: 'Stop', stop_hook_active: false };
const end = (reason: string) => ({ session_id: 'c1', transcript_path: '/tmp/t.jsonl', cwd: '/work', hook_event_name: 'SessionEnd', reason });

test('capture hook input takes the native id and transcript of Stop and SessionEnd', () => {
  const expected = { nativeId: 'c1', transcript: '/tmp/t.jsonl' };
  assert.deepEqual(captureInput(JSON.stringify(stop)), expected);
  assert.deepEqual(captureInput(JSON.stringify({ ...stop, stop_hook_active: true })), expected);
  assert.deepEqual(captureInput(JSON.stringify({ ...stop, last_assistant_message: 'synthetic answer' })), expected);
  for (const reason of ['clear', 'logout', 'prompt_input_exit', 'other']) assert.deepEqual(captureInput(JSON.stringify(end(reason))), expected);
  for (const transcript_path of [undefined, '', 7]) assert.deepEqual(captureInput(JSON.stringify({ ...stop, transcript_path })), { nativeId: 'c1' });
  const { hook_event_name: _, ...unnamed } = stop;
  const { session_id: __, ...anonymous } = stop;
  for (const text of ['{', '[]', 'null', JSON.stringify({ ...stop, hook_event_name: 'Notification' }), JSON.stringify({ ...stop, hook_event_name: 'SessionStart' }),
    JSON.stringify(unnamed), JSON.stringify({ ...stop, session_id: '' }), JSON.stringify(anonymous)])
    assert.throws(() => captureInput(text), /Invalid Stop or SessionEnd hook input/);
});

test('archive capture records a transcript from its saved offset and writes nothing without one', t => {
  const { dir, filename } = state(t);
  assert.deepEqual(captureArchive(filename, { name: 'archive_capture', agent: 'claude', nativeId: 'c1' }), { captured: false, file: null });
  const missing = join(dir, 'missing.jsonl');
  assert.deepEqual(captureArchive(filename, { name: 'archive_capture', agent: 'claude', file: missing, nativeId: 'c1' }), { captured: false, file: missing });
  assert.equal(existsSync(archivePath(filename)), false);
  const stateDb = openDatabase(filename);
  try {
    stateDb.prepare(`INSERT INTO sessions(key, scope_type, org_id, project_id, task_id, agent, native_id, created_at)
      VALUES ('global', 'global', NULL, NULL, NULL, 'claude', 'c1', ?)`).run(at(0));
  } finally { stateDb.close(); }
  const file = join(dir, 'c1.jsonl');
  writeFileSync(file, jsonl([user('u1', null, 1), assistant('a1', 'u1', 2)]));
  const capture = () => captureArchive(filename, { name: 'archive_capture', agent: 'claude', file, nativeId: 'c1' });
  assert.deepEqual(capture(), { captured: true, archive: archivePath(filename), agent: 'claude', nativeId: 'c1', path: file, inserted: 2, skipped: 0,
    bytesRead: statSync(file).size, key: 'global' });
  const again = recorded(capture());
  assert.deepEqual([again.inserted, again.skipped], [0, 0]);
  appendFileSync(file, jsonl([user('u2', 'a1', 3), assistant('a2', 'u2', 4)]));
  assert.equal(recorded(capture()).inserted, 2);
  const db = openArchive(archivePath(filename), true);
  try {
    assert.deepEqual(db.prepare('SELECT count(*) AS rows, count(DISTINCT entry_id) AS entries FROM archive_messages WHERE native_id = ?').get('c1'), { rows: 4, entries: 4 });
    assert.deepEqual(db.prepare('SELECT bytes_read AS bytesRead, key_source AS keySource FROM archive_sessions WHERE native_id = ?').get('c1'),
      { bytesRead: statSync(file).size, keySource: 'sessions' });
  } finally { db.close(); }
  const pi = join(dir, '2026-11-07T10-00-00-000Z_p1.jsonl');
  writeFileSync(pi, jsonl([piHeader('p1'), piMessage('m1', null, 'user', 1), piMessage('m2', 'm1', 'assistant', 2)]));
  const piResult = recorded(captureArchive(filename, { name: 'archive_capture', agent: 'pi', file: pi }));
  assert.deepEqual([piResult.nativeId, piResult.inserted, piResult.key], ['p1', 2, null]);
});
