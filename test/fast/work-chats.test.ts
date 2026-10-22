import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../../src/app/create-app.js';
import { createWorkChats } from '../../src/app/work-chats.js';
import type { ChatRuntime, ChatInspection } from '../../src/app/work-chats.js';
import { openDatabase, initializeDatabase } from '../../src/infrastructure/database/database.js';
import { state } from '../support/state.js';

const pair = { provider: 'test-provider', model: 'model/id' };
function herdrEnvironment(t: { after(fn: () => void): void }) {
  const previousEnv = process.env.HERDR_ENV, previousWorkspace = process.env.HERDR_WORKSPACE_ID;
  process.env.HERDR_ENV = '1'; process.env.HERDR_WORKSPACE_ID = 'test-workspace';
  t.after(() => {
    if (previousEnv === undefined) delete process.env.HERDR_ENV; else process.env.HERDR_ENV = previousEnv;
    if (previousWorkspace === undefined) delete process.env.HERDR_WORKSPACE_ID; else process.env.HERDR_WORKSPACE_ID = previousWorkspace;
  });
}

test('work chat reserves once, confirms process/native identity and preserves exact session on reopen', async t => {
  herdrEnvironment(t);
  const { filename, dir } = state(t);
  const app = createApp(filename, false);
  t.after(() => app.close());
  const project = app.projects.add('team/tool', 'TT', dir);
  const card = app.requests.create({ projectId: project.id, slug: 'one', title: 'One', status: 'new' }, () => {});
  let launches = 0;
  let observed: ChatInspection = { status: 'dead' };
  const runtime: ChatRuntime = {
    async validate(args) { return { ...args, gitCommonDir: '/tmp/git-common', branch: 'task/one' }; },
    async history(chat) { return { native: { sessionId: chat.sessionId!, historyPath: chat.historyPath! }, saved: { status: 'selected', selection: pair } }; },
    async inspect(chat) { return observed.status === 'live' ? { ...observed, binding: chat } : observed; },
    async provenEmpty() { return false; },
    async validateModel() {},
    async focus() {},
    async prepareLaunch({ chat }) { return async () => {
      launches++;
      observed = { status: 'live', native: { sessionId: chat.sessionId!, historyPath: '/tmp/history-1' },
        process: { pane: 'pane-1', processId: 100, processStart: 'start-1' }, model: pair };
      return { status: 'opened', native: observed.native!, process: observed.process!, model: pair };
    }; },
  };
  const chats = createWorkChats({ store: app.chatStore, projects: app.projects, requests: app.requests, userHome: '/tmp/no-config', runtime });
  const args = { identity: 'team/tool', requestId: card.id, sourceClone: dir, worktree: dir + '/worktree-one', installation: '/tmp/installed', statePath: filename, model: pair };
  const preview = await chats.previewOpen(args);
  delete process.env.HERDR_ENV;
  await assert.rejects(chats.execute(preview), /Persistent Herdr environment required/);
  assert.deepEqual(app.chatStore.list(), []);
  assert.equal(launches, 0);
  assert.deepEqual(await chats.list(), []); // Inspection does not require launch environment.
  process.env.HERDR_ENV = '1';
  assert.equal((await chats.execute(preview)).outcome, 'opened');
  assert.equal(launches, 1);
  await assert.rejects(chats.previewOpen(args), /already has/);
  const id = (await chats.list())[0]!.chat.id;
  const live = await chats.previewResume(id);
  assert.equal((await chats.execute(live)).outcome, 'existing');
  assert.equal(launches, 1);
  await assert.rejects(chats.previewResume(id, { provider: 'other', model: 'model' }), { name: 'InputError', message: 'Live chat has another or unconfirmed model; use /model in that chat' });
  observed = { status: 'unknown' };
  await assert.rejects(chats.previewResume(id), /ownership unknown/);
  observed = { status: 'dead' };
  await assert.rejects(chats.execute(live), /Live state changed since preview/);
  assert.equal(launches, 1);
  const resume = await chats.previewResume(id);
  assert.equal(resume.native?.sessionId, (await chats.show(id)).chat.sessionId);
  assert.equal((await chats.execute(resume)).outcome, 'opened');
  assert.equal(launches, 2);
  assert.equal(app.chatStore.get(id)?.historyPath, '/tmp/history-1');
  const reader = createApp(filename, true);
  assert.equal(reader.chatStore.get(id)?.sessionId, resume.native?.sessionId);
  reader.close();
});

test('schema upgrade preserves requests and rejects duplicate worktree/session reservations', t => {
  const { filename } = state(t);
  const db = openDatabase(filename);
  db.prepare("INSERT INTO organizations(slug) VALUES ('team')").run();
  db.prepare("INSERT INTO projects(org_id,slug,code) VALUES (1,'tool','TT')").run();
  db.prepare("INSERT INTO requests(project_id,number,title,status_id,context_dir,created_at,updated_at) VALUES (1,1,'Original',1,'original','now','now')").run();
  db.exec('DROP TABLE work_chats');
  db.pragma('user_version = 2');
  db.close();
  assert.throws(() => openDatabase(filename, true), /compatible/);
  initializeDatabase(filename);
  const app = createApp(filename, false);
  try {
    assert.equal(app.requests.get(1).title, 'Original');
    const first = { id: 'a', requestId: 1, projectId: 1, name: null, sourceClone: 'clone', worktree: 'tree', gitCommonDir: 'git', branch: 'branch', installation: 'pi', statePath: 'db', sessionId: 'session', historyPath: 'history', attemptId: 'attempt-a', pane: 'pane-a', processId: 100, processStart: 'start-a', requestedProvider: null, requestedModel: null, processBootId: null, herdrEndpoint: null, phase: 'ready' as const };
    app.chatStore.transaction(() => app.chatStore.reserve(first));
    const other = { ...first, id: 'b', attemptId: 'attempt-b', sessionId: 'session-b', historyPath: 'history-b' };
    const stored = app.chatStore.list();
    assert.throws(() => app.chatStore.transaction(() => app.chatStore.reserve(other)), /UNIQUE/);
    assert.deepEqual(app.chatStore.list(), stored);
    assert.throws(() => app.chatStore.transaction(() => app.chatStore.reserve({ ...other, worktree: 'tree-2', sessionId: first.sessionId })), /UNIQUE/);
    assert.deepEqual(app.chatStore.list(), stored);
    app.chatStore.transaction(() => app.chatStore.retireEmpty(first.id, first.attemptId));
    app.chatStore.transaction(() => app.chatStore.reserve(other));
    assert.equal(app.chatStore.get(first.id)?.phase, 'closed');
    assert.deepEqual(app.chatStore.get(other.id), other);
  } finally { app.close(); }
});

test('v3 ready chat metadata survives v4 auth-pending migration without inventing a requested model', t => {
  const { filename } = state(t);
  const db = openDatabase(filename);
  db.prepare("INSERT INTO organizations(slug) VALUES ('team')").run();
  db.prepare("INSERT INTO projects(org_id,slug,code) VALUES (1,'tool','TT')").run();
  db.prepare("INSERT INTO requests(project_id,number,title,status_id,context_dir,created_at,updated_at) VALUES (1,1,'Original',1,'original','now','now')").run();
  db.exec('DROP TABLE work_chats');
  db.exec(`CREATE TABLE work_chats (
    id TEXT PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id),
    project_id INTEGER NOT NULL REFERENCES projects(id), name TEXT, source_clone TEXT NOT NULL,
    worktree TEXT NOT NULL, git_common_dir TEXT NOT NULL, branch TEXT NOT NULL,
    installation TEXT NOT NULL, state_path TEXT NOT NULL, session_id TEXT UNIQUE,
    history_path TEXT UNIQUE, attempt_id TEXT NOT NULL UNIQUE, pane TEXT, process_id INTEGER,
    process_start TEXT, phase TEXT NOT NULL CHECK (phase IN ('reserved','partial','ready','closed'))
  ) STRICT;
  INSERT INTO work_chats VALUES ('old',1,1,NULL,'/clone','/task','/git','task/one',
    '/engine','/state','session','/state/sessions/session.jsonl','attempt','pane',100,'start','ready');`);
  db.pragma('user_version = 3');
  db.close();
  initializeDatabase(filename);
  const app = createApp(filename, false);
  try {
    assert.equal(app.chatStore.get('old')?.phase, 'ready');
    assert.equal(app.chatStore.get('old')?.sessionId, 'session');
    assert.equal(app.chatStore.get('old')?.requestedProvider, null);
    assert.equal(app.chatStore.get('old')?.requestedModel, null);
  } finally { app.close(); }
});

test('v5 migration preserves every v4 phase and association; native intent and nullable origin retain SQL constraints', t => {
  const { filename } = state(t);
  const db = openDatabase(filename);
  db.prepare("INSERT INTO organizations(slug) VALUES ('team')").run();
  db.prepare("INSERT INTO projects(org_id,slug,code) VALUES (1,'tool','TT')").run();
  db.prepare("INSERT INTO requests(project_id,number,title,status_id,context_dir,created_at,updated_at) VALUES (1,1,'Original',1,'original','now','now')").run();
  db.exec('DROP TABLE work_chats');
  db.exec(readFileSync(new URL('../../src/infrastructure/database/migrations/003-work-chats.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../src/infrastructure/database/migrations/004-work-chat-auth-pending.sql', import.meta.url), 'utf8'));
  for (const phase of ['ready', 'auth-pending', 'partial', 'reserved', 'closed']) {
    db.prepare(`INSERT INTO work_chats VALUES (?,1,1,?, '/clone',?, '/git',?, '/engine','/state',?,?,?, 'pane',100,'tick','provider','model',?)`)
      .run(phase, phase + '-name', '/task/' + phase, 'task/' + phase,
        phase === 'reserved' ? null : 'native-' + phase, phase === 'reserved' ? null : '/history/' + phase, 'attempt-' + phase, phase);
  }
  const before = db.prepare('SELECT * FROM work_chats ORDER BY id').all();
  db.pragma('user_version = 4');
  db.close();
  assert.throws(() => openDatabase(filename, true), /compatible/);
  initializeDatabase(filename);
  const migrated = openDatabase(filename);
  t.after(() => migrated.close());
  assert.equal(migrated.pragma('user_version', { simple: true }), 5);
  const rows = migrated.prepare('SELECT * FROM work_chats ORDER BY id').all() as Record<string, unknown>[];
  assert.deepEqual(rows.map(({ process_boot_id, herdr_endpoint, ...row }) => {
    assert.equal(process_boot_id, null);
    assert.equal(herdr_endpoint, null);
    return row;
  }), before, 'no legacy process origin, target, association or history is invented/lost');
  assert.deepEqual(migrated.pragma('foreign_key_check'), []);
  assert.throws(() => migrated.prepare("UPDATE work_chats SET session_id = 'native-ready' WHERE id = 'partial'").run(), /UNIQUE/);
  assert.throws(() => migrated.prepare("UPDATE work_chats SET history_path = '/history/ready' WHERE id = 'partial'").run(), /UNIQUE/);
  assert.throws(() => migrated.prepare("UPDATE work_chats SET attempt_id = 'attempt-ready' WHERE id = 'partial'").run(), /UNIQUE/);
  assert.throws(() => migrated.prepare("UPDATE work_chats SET worktree = '/task/ready' WHERE id = 'partial'").run(), /UNIQUE/);
  assert.throws(() => migrated.prepare("UPDATE work_chats SET request_id = 999 WHERE id = 'partial'").run(), /FOREIGN KEY/);
  assert.throws(() => migrated.prepare("UPDATE work_chats SET project_id = 999 WHERE id = 'partial'").run(), /FOREIGN KEY/);
  assert.throws(() => migrated.prepare("UPDATE work_chats SET history_path = NULL WHERE id = 'ready'").run(), /CHECK/);
  assert.throws(() => migrated.prepare("UPDATE work_chats SET session_id = NULL WHERE id = 'partial'").run(), /CHECK/);
  migrated.prepare("UPDATE work_chats SET session_id = 'preassigned' WHERE id = 'reserved'").run();
  assert.equal((migrated.prepare("SELECT history_path FROM work_chats WHERE id = 'reserved'").get() as { history_path: unknown }).history_path, null);
  migrated.prepare("UPDATE work_chats SET process_boot_id = 'boot', herdr_endpoint = '/tmp/herdr.sock' WHERE id = 'ready'").run();
  const app = createApp(filename, false);
  try {
    assert.equal(app.chatStore.get('ready')?.processBootId, 'boot');
    assert.equal(app.chatStore.get('ready')?.herdrEndpoint, '/tmp/herdr.sock');
    assert.throws(() => app.chatStore.update(app.chatStore.get('ready')!, 'stale-attempt'), /Stale/);
  } finally { app.close(); }
});
