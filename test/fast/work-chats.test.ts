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
    async validateModel() {},
    async launch() {
      launches++;
      observed = { status: 'live', native: { sessionId: 'session-1', historyPath: '/tmp/history-1' },
        process: { pane: 'pane-1', processId: 100, processStart: 'start-1' }, model: pair };
      return { status: 'acknowledged', native: observed.native!, process: observed.process!, model: pair };
    },
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
    const first = { id: 'a', requestId: 1, projectId: 1, name: null, sourceClone: 'clone', worktree: 'tree', gitCommonDir: 'git', branch: 'branch', installation: 'pi', statePath: 'db', sessionId: 'session', historyPath: 'history', attemptId: 'attempt-a', pane: 'pane-a', processId: 100, processStart: 'start-a', phase: 'ready' as const };
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
