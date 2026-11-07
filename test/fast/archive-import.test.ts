import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { archivePath, createApp, engineRoot } from '../../src/app/create-app.js';
import { archiveStatus, engineFolders, importArchive } from '../../src/app/archive.js';
import { claudeFolderName, nativeIdOf, piFolderName } from '../../src/modules/archive/public.js';
import { openArchive } from '../../src/infrastructure/database/archive.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';

const jsonl = (records: object[]) => records.map(r => JSON.stringify(r) + '\n').join('');
const at = (minute: number) => '2026-11-07T10:' + String(minute).padStart(2, '0') + ':00.000Z';
const user = (uuid: string, parentUuid: string | null, minute: number) =>
  ({ type: 'user', uuid, parentUuid, timestamp: at(minute), turnOrigin: 'human', message: { role: 'user', content: 'synthetic ' + uuid } });
const assistant = (uuid: string, parentUuid: string | null, minute: number) =>
  ({ type: 'assistant', uuid, parentUuid, timestamp: at(minute), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'synthetic ' + uuid }] } });
const piHeader = (id: string) => ({ type: 'session', version: 3, id, timestamp: at(0), cwd: '/synthetic' });
const piMessage = (id: string, parentId: string | null, role: 'user' | 'assistant', minute: number) =>
  ({ type: 'message', id, parentId, timestamp: at(minute), message: { role, stopReason: 'stop', content: [{ type: 'text', text: 'synthetic ' + id }] } });
const command = (home: string, dirs?: { agent: 'claude' | 'pi'; path: string }[]) =>
  ({ name: 'archive_import' as const, home, ...(dirs ? { dirs } : {}) });

function engineHome(home: string) {
  const cwd = engineRoot().replace(/\/$/, '');
  const claude = join(home, '.claude', 'projects', claudeFolderName(cwd));
  const pi = join(home, '.pi', 'agent', 'sessions', piFolderName(cwd));
  mkdirSync(join(claude, 'c1', 'subagents'), { recursive: true });
  mkdirSync(pi, { recursive: true });
  writeFileSync(join(claude, 'c1.jsonl'), jsonl([user('u1', null, 1), assistant('a1', 'u1', 2)]));
  writeFileSync(join(claude, 'c1', 'subagents', 'agent-a.jsonl'), jsonl([user('s1', null, 3)]));
  writeFileSync(join(claude, 'notes.txt'), 'synthetic notes\n');
  symlinkSync(join(claude, 'c1.jsonl'), join(claude, 'c9.jsonl'));
  writeFileSync(join(pi, '2026-11-07T10-00-00-000Z_p1.jsonl'), jsonl([piHeader('p1'), piMessage('m1', null, 'user', 1), piMessage('m2', 'm1', 'assistant', 2)]));
  return { claude, pi };
}

function sessionRow(filename: string, nativeId: string) {
  const db = openArchive(archivePath(filename), true);
  try {
    return db.prepare('SELECT key, key_source AS keySource, bytes_read AS bytesRead FROM archive_sessions WHERE native_id = ?').get(nativeId) as
      { key: string | null; keySource: string | null; bytesRead: number };
  } finally { db.close(); }
}

test('transcript folder names and native ids follow each agent\'s layout', () => {
  assert.equal(claudeFolderName('/home/u/Projects/mypi'), '-home-u-Projects-mypi');
  assert.equal(claudeFolderName('/a/b.c_d'), '-a-b-c-d');
  assert.equal(piFolderName('/home/u/Projects/mypi'), '--home-u-Projects-mypi--');
  assert.equal(piFolderName('/a/b.c'), '--a-b.c--');
  assert.equal(nativeIdOf('claude', '/x/c1.jsonl'), 'c1');
  assert.equal(nativeIdOf('pi', '/x/2026-11-07T10-00-00-000Z_p1.jsonl'), 'p1');
  assert.equal(nativeIdOf('pi', '/x/p2.jsonl'), 'p2');
  assert.deepEqual(engineFolders('/h', '/e'), [{ agent: 'claude', path: '/h/.claude/projects/-e' }, { agent: 'pi', path: '/h/.pi/agent/sessions/--e--' }]);
});

test('archive import reads the engine root folders and skips subagents and other files', t => {
  const { dir, filename } = state(t);
  const home = join(dir, 'home');
  const { claude, pi } = engineHome(home);
  const result = importArchive(filename, command(home));
  assert.equal(result.archive, archivePath(filename));
  assert.deepEqual([result.files, result.inserted, result.skipped, result.failed], [2, 4, 0, []]);
  assert.deepEqual(result.dirs, [{ agent: 'claude', path: claude, files: 1, inserted: 2, skipped: 0 }, { agent: 'pi', path: pi, files: 1, inserted: 2, skipped: 0 }]);
  const status = archiveStatus(filename);
  assert.deepEqual(status.sessions, { claude: 1, pi: 1 });
  assert.deepEqual(status.messages, { claude: 2, pi: 2 });
  const empty = importArchive(filename, command(join(dir, 'empty')));
  assert.equal(empty.files, 0);
  assert.deepEqual(empty.dirs.map(d => d.files), [0, 0]);
});

test('archive import resumes from the saved offset and rereads a shorter file', t => {
  const { dir, filename } = state(t);
  const folder = join(dir, 'claude');
  mkdirSync(folder);
  const file = join(folder, 'c1.jsonl');
  const run = () => importArchive(filename, command(dir, [{ agent: 'claude', path: folder }]));
  writeFileSync(file, jsonl([user('u1', null, 1), assistant('a1', 'u1', 2)]));
  assert.equal(run().inserted, 2);
  assert.deepEqual([run().inserted, run().skipped], [0, 0]);
  appendFileSync(file, jsonl([user('u2', 'a1', 3)]) + JSON.stringify(assistant('a2', 'u2', 4)));
  assert.equal(run().inserted, 1);
  appendFileSync(file, '\n');
  assert.equal(run().inserted, 1);
  writeFileSync(file, jsonl([user('u1', null, 1), assistant('a1', 'u1', 2), user('u3', 'a1', 5)]));
  const shorter = run();
  assert.deepEqual([shorter.inserted, shorter.skipped], [1, 2]);
  const db = openArchive(archivePath(filename), true);
  try {
    const ids = (db.prepare('SELECT entry_id AS id FROM archive_messages ORDER BY entry_id').all() as { id: string }[]).map(r => r.id);
    assert.deepEqual(ids, ['a1', 'a2', 'u1', 'u2', 'u3']);
  } finally { db.close(); }
  assert.equal(sessionRow(filename, 'c1').bytesRead, statSync(file).size);
  const broken = join(dir, 'broken');
  mkdirSync(broken);
  writeFileSync(join(broken, 'a\u0001.jsonl'), jsonl([user('x1', null, 1)]));
  writeFileSync(join(broken, 'b.jsonl'), jsonl([user('y1', null, 1)]));
  const partial = importArchive(filename, command(dir, [{ agent: 'claude', path: broken }]));
  assert.deepEqual(partial.failed, [{ agent: 'claude', path: join(broken, 'a\u0001.jsonl'), error: 'Invalid native session id' }]);
  assert.deepEqual([partial.files, partial.inserted], [1, 1]);
  assert.equal(sessionRow(filename, 'b').bytesRead, statSync(join(broken, 'b.jsonl')).size);
});

test('archive import binds a key on a later pass without new bytes', t => {
  const { dir, filename } = state(t);
  const setup = createApp(filename, false);
  try { setup.projects.add('one/project', 'MP'); } finally { setup.close(); }
  const folder = join(dir, 'claude');
  mkdirSync(folder);
  writeFileSync(join(folder, 'c1.jsonl'), jsonl([user('u1', null, 1)]));
  writeFileSync(join(folder, 'c2.jsonl'), jsonl([user('u2', null, 1), { type: 'custom-title', customTitle: 'MP' }]));
  const run = () => importArchive(filename, command(dir, [{ agent: 'claude', path: folder }]));
  run();
  assert.deepEqual([sessionRow(filename, 'c1').key, sessionRow(filename, 'c2').key, sessionRow(filename, 'c2').keySource], [null, 'MP', 'name']);
  const first = archiveStatus(filename);
  assert.deepEqual([first.boundSessions, first.unboundSessions, first.keys, first.keySources], [1, 1, 1, { sessions: 0, name: 1 }]);
  const stateDb = openDatabase(filename);
  try {
    stateDb.prepare(`INSERT INTO sessions(key, scope_type, org_id, project_id, task_id, agent, native_id, created_at)
      VALUES ('global', 'global', NULL, NULL, NULL, 'claude', 'c1', ?)`).run(at(0));
  } finally { stateDb.close(); }
  assert.equal(run().inserted, 0);
  assert.deepEqual([sessionRow(filename, 'c1').key, sessionRow(filename, 'c1').keySource], ['global', 'sessions']);
  const second = archiveStatus(filename);
  assert.deepEqual([second.boundSessions, second.unboundSessions, second.keys, second.keySources], [2, 0, 2, { sessions: 1, name: 1 }]);
});

test('archive import takes each --dir with its own --agent and refuses a missing folder', t => {
  const { dir, filename } = state(t);
  assert.throws(() => importArchive(filename, command(dir, [{ agent: 'pi', path: join(dir, 'missing') }])), /Not a directory/);
  assert.equal(existsSync(archivePath(filename)), false);
  const home = join(dir, 'home');
  engineHome(home);
  const other = join(dir, 'other');
  mkdirSync(other);
  writeFileSync(join(other, '2026-11-07T11-00-00-000Z_p2.jsonl'), jsonl([piHeader('p2'), piMessage('m3', null, 'user', 1)]));
  const result = importArchive(filename, command(home, [{ agent: 'pi', path: other }]));
  assert.deepEqual(result.dirs, [{ agent: 'pi', path: other, files: 1, inserted: 1, skipped: 0 }]);
  assert.deepEqual(archiveStatus(filename).sessions, { claude: 0, pi: 1 });
});

test('archive status counts sessions, messages and keys and never creates the archive', t => {
  const { dir, filename } = state(t);
  const path = archivePath(filename);
  assert.deepEqual(archiveStatus(filename), { path, exists: false, bytes: 0, sessions: { claude: 0, pi: 0 }, messages: { claude: 0, pi: 0 },
    boundSessions: 0, unboundSessions: 0, keys: 0, keySources: { sessions: 0, name: 0 } });
  assert.equal(existsSync(path), false);
  const home = join(dir, 'home');
  engineHome(home);
  importArchive(filename, command(home));
  const status = archiveStatus(filename);
  assert.deepEqual([status.path, status.exists, status.bytes], [path, true, statSync(path).size]);
  assert.deepEqual([status.sessions, status.messages, status.boundSessions, status.unboundSessions], [{ claude: 1, pi: 1 }, { claude: 2, pi: 2 }, 0, 2]);
});
