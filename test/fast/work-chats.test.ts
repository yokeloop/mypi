import test from 'node:test';
import assert from 'node:assert/strict';
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
    async validateModel() { return 'ready' as const; },
    async launch() {
      launches++;
      observed = { status: 'live', native: { sessionId: 'session-1', historyPath: '/tmp/history-1' },
        process: { pane: 'pane-1', processId: 100, processStart: 'start-1' }, model: pair, readiness: 'ready' };
      return { status: 'acknowledged', native: observed.native!, process: observed.process!, model: pair, readiness: 'ready' };
    },
  };
  const chats = createWorkChats({ store: app.chatStore, projects: app.projects, requests: app.requests, userHome: '/tmp/no-config', runtime });
  const args = { identity: 'team/tool', requestId: card.id, sourceClone: dir, worktree: dir + '/worktree-one', installation: '/tmp/installed', statePath: filename, model: pair, readiness: 'ready' };
  const preview = await chats.previewOpen(args);
  delete process.env.HERDR_ENV;
  await assert.rejects(chats.execute(preview), /Persistent Herdr environment required/);
  assert.deepEqual(app.chatStore.list(), []);
  assert.equal(launches, 0);
  assert.deepEqual(await chats.list(), []); // Inspection does not require launch environment.
  process.env.HERDR_ENV = '1';
  assert.equal((await chats.execute(preview)).outcome, 'ready');
  assert.equal(launches, 1);
  await assert.rejects(chats.previewOpen(args), /already has/);
  const id = (await chats.list())[0]!.chat.id;
  const live = await chats.previewResume(id);
  assert.equal((await chats.execute(live)).outcome, 'existing');
  assert.equal(launches, 1);
  await assert.rejects(chats.previewResume(id, { provider: 'other', model: 'model' }), /Live chat has another model/);
  observed = { status: 'unknown' };
  await assert.rejects(chats.previewResume(id), /ownership unknown/);
  observed = { status: 'dead' };
  await assert.rejects(chats.execute(live), /Live state changed since preview/);
  assert.equal(launches, 1);
  const resume = await chats.previewResume(id);
  assert.equal(resume.native?.sessionId, 'session-1');
  assert.equal((await chats.execute(resume)).outcome, 'ready');
  assert.equal(launches, 2);
  assert.equal(app.chatStore.get(id)?.historyPath, '/tmp/history-1');
  const reader = createApp(filename, true);
  assert.equal(reader.chatStore.get(id)?.sessionId, 'session-1');
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
    const first = { id: 'a', requestId: 1, projectId: 1, name: null, sourceClone: 'clone', worktree: 'tree', gitCommonDir: 'git', branch: 'branch', installation: 'pi', statePath: 'db', sessionId: 'session', historyPath: 'history', attemptId: 'attempt-a', pane: 'pane-a', processId: 100, processStart: 'start-a', requestedProvider: null, requestedModel: null, phase: 'ready' as const };
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

test('auth-pending launch keeps one writer and promotes only the same attempt with exact native model/auth', async t => {
  herdrEnvironment(t);
  const { filename, dir } = state(t);
  const app = createApp(filename, false);
  t.after(() => app.close());
  const project = app.projects.add('team/tool', 'TT', dir);
  const card = app.requests.create({ projectId: project.id, slug: 'pending', title: 'Pending', status: 'new' }, () => {});
  const native = { sessionId: 'pending-session', historyPath: '/tmp/pending-history' };
  const process = { pane: 'pending-pane', processId: 400, processStart: 'tick-1' };
  let selected: typeof pair | undefined;
  let readiness: 'ready' | 'auth-pending' = 'auth-pending';
  let launches = 0;
  const runtime: ChatRuntime = {
    async validate(args) { return { ...args, gitCommonDir: '/tmp/common', branch: 'task/pending' }; },
    async validateModel() { return readiness; },
    async history() { throw new Error('No history before a turn'); },
    async provenEmpty() { return false; },
    async inspect(chat) { return { status: 'live', binding: chat, native, process,
      ...(selected ? { model: selected } : {}), readiness: selected?.provider === pair.provider && selected.model === pair.model ? readiness : 'auth-pending', persisted: false }; },
    async launch() { launches++; return { status: 'acknowledged', native, process, readiness: 'auth-pending' }; },
  };
  const chats = createWorkChats({ store: app.chatStore, projects: app.projects, requests: app.requests, userHome: dir, runtime });
  const args = { identity: 'team/tool', requestId: card.id, sourceClone: dir, worktree: dir + '/pending', installation: '/tmp/engine', statePath: filename, model: pair };
  const result = await chats.execute(await chats.previewOpen(args));
  assert.equal(result.outcome, 'auth-pending');
  assert.equal(result.chat.phase, 'auth-pending');
  assert.equal(result.chat.requestedProvider, pair.provider);
  assert.equal(result.chat.requestedModel, pair.model);
  assert.equal(launches, 1);
  const originalInspect = runtime.inspect;
  runtime.inspect = async chat => ({ ...(await originalInspect(chat)), native: { ...native, sessionId: 'foreign' } });
  assert.equal((await chats.show(result.chat.id)).observation.status, 'unknown');
  assert.equal(app.chatStore.get(result.chat.id)?.phase, 'auth-pending');
  runtime.inspect = originalInspect;
  await assert.rejects(chats.previewOpen(args), /already has/);
  selected = { provider: 'other', model: 'automatic' };
  readiness = 'ready';
  assert.equal((await chats.show(result.chat.id)).chat.phase, 'auth-pending');
  await assert.rejects(chats.previewResume(result.chat.id, selected), /Live chat has another model/);
  selected = pair;
  assert.equal((await chats.list())[0]!.chat.phase, 'ready');
  const promoted = app.chatStore.get(result.chat.id)!;
  assert.equal(promoted.attemptId, result.chat.attemptId);
  assert.equal(promoted.sessionId, native.sessionId);
  assert.equal(promoted.pane, process.pane);
  assert.equal((await chats.execute(await chats.previewResume(result.chat.id))).outcome, 'existing');
  assert.equal(launches, 1);
  readiness = 'auth-pending';
  assert.equal((await chats.show(result.chat.id)).chat.phase, 'auth-pending');
  assert.equal((await chats.execute(await chats.previewResume(result.chat.id))).outcome, 'existing');
  assert.equal(launches, 1);
});

test('dead persisted pending chat retains requested target across resume unless override is explicit', async t => {
  herdrEnvironment(t);
  const { filename, dir } = state(t);
  const app = createApp(filename, false);
  t.after(() => app.close());
  const project = app.projects.add('team/tool', 'TT', dir);
  const card = app.requests.create({ projectId: project.id, slug: 'pending-resume', title: 'Pending resume', status: 'new' }, () => {});
  const alternate = { provider: 'other', model: 'automatic' };
  const native = { sessionId: 'saved-session', historyPath: '/tmp/saved-history' };
  const process = { pane: 'next-pane', processId: 505, processStart: 'tick-2' };
  const row = { id: 'pending-row', projectId: project.id, requestId: card.id, sourceClone: dir,
    worktree: dir + '/pending-task', installation: '/tmp/engine', statePath: filename,
    gitCommonDir: '/tmp/common', branch: 'task/pending', name: null, attemptId: 'old-attempt',
    requestedProvider: pair.provider, requestedModel: pair.model, phase: 'auth-pending' as const,
    ...native, pane: 'old-pane', processId: 404, processStart: 'tick-1' };
  app.chatStore.transaction(() => app.chatStore.reserve(row));
  let live = false;
  const runtime: ChatRuntime = {
    async validate(args) { return { ...args, gitCommonDir: row.gitCommonDir, branch: row.branch }; },
    async validateModel() { return 'auth-pending' as const; },
    async history(chat) { return { native: { sessionId: chat.sessionId!, historyPath: chat.historyPath! },
      saved: { status: 'selected' as const, selection: alternate } }; },
    async provenEmpty() { return false; },
    async inspect(chat) { return live ? { status: 'live', binding: chat, native, process,
      model: alternate, readiness: 'auth-pending', persisted: true } : { status: 'dead' }; },
    async launch() { live = true; return { status: 'acknowledged', native, process,
      model: alternate, readiness: 'auth-pending' }; },
  };
  const chats = createWorkChats({ store: app.chatStore, projects: app.projects, requests: app.requests, userHome: dir, runtime });
  const preview = await chats.previewResume(row.id);
  assert.deepEqual(preview.model, { ...pair, source: 'saved session' });
  const result = await chats.execute(preview);
  assert.equal(result.outcome, 'auth-pending');
  assert.equal(result.chat.requestedProvider, pair.provider);
  assert.equal(result.chat.requestedModel, pair.model);
  assert.notEqual(result.chat.attemptId, row.attemptId);
  live = false;
  const override = await chats.previewResume(row.id, alternate);
  assert.deepEqual(override.model, { ...alternate, source: 'invocation' });
  const changed = await chats.execute(override);
  assert.equal(changed.chat.requestedProvider, alternate.provider);
  assert.equal(changed.chat.requestedModel, alternate.model);
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
