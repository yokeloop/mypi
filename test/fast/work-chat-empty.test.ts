import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app/create-app.js';
import { createWorkChats } from '../../src/app/work-chats.js';
import type { ChatRuntime } from '../../src/app/work-chats.js';
import { state } from '../support/state.js';

const pair = { provider: 'custom', model: 'model/id' };
test('live empty chat is ready/idempotent; positive final empty death permits explicit fresh chat in same worktree', async t => {
  const { filename, dir } = state(t);
  const app = createApp(filename, false);
  t.after(() => app.close());
  const project = app.projects.add('team/tool', 'TT', dir);
  const card = app.requests.create({ projectId: project.id, slug: 'one', title: 'One', status: 'new' }, () => {});
  let alive = true, finalEmpty = false, count = 0;
  const runtime: ChatRuntime = {
    async validate(args) { return { ...args, gitCommonDir: '/tmp/git', branch: 'task/one' }; },
    async history() { throw new Error('No persisted native history'); },
    async inspect(chat) { return alive ? { status: 'live', binding: chat,
      process: { pane: chat.pane!, processId: chat.processId!, processStart: chat.processStart! },
      native: { sessionId: chat.sessionId!, historyPath: chat.historyPath! }, model: pair, persisted: false } : { status: 'dead' }; },
    async provenEmpty() { return finalEmpty && !alive; },
    async validateModel() {},
    async launch() { count++; alive = true; return { status: 'acknowledged',
      native: { sessionId: `session-${count}`, historyPath: `/tmp/history-${count}` },
      process: { pane: `pane-${count}`, processId: count + 100, processStart: `start-${count}` }, model: pair }; },
  };
  const chats = createWorkChats({ store: app.chatStore, projects: app.projects, requests: app.requests, userHome: '/tmp/no-config', runtime });
  const args = { identity: 'team/tool', requestId: card.id, sourceClone: dir, worktree: dir + '/task', installation: '/tmp/installed', statePath: filename, model: pair };
  const first = await chats.execute(await chats.previewOpen(args));
  assert.equal(first.outcome, 'ready');
  assert.equal(first.observation.persisted, false);
  assert.equal((await chats.execute(await chats.previewResume(first.chat.id))).outcome, 'existing');
  assert.equal(count, 1);
  alive = false;
  await assert.rejects(chats.previewResume(first.chat.id), /native history|empty chat/i);
  await assert.rejects(chats.previewNewEmpty(first.chat.id, { model: pair }), /unconfirmed/);
  finalEmpty = true;
  const preview = await chats.previewNewEmpty(first.chat.id, { model: pair, name: 'fresh' });
  assert.equal(preview.action, 'new-empty');
  assert.equal(preview.priorAttempt, first.chat.attemptId);
  alive = true;
  await assert.rejects(chats.execute(preview), /unconfirmed/);
  assert.equal(app.chatStore.get(first.chat.id)?.phase, 'ready');
  alive = false;
  const rejecting = createWorkChats({ store: { ...app.chatStore, reserve() { throw new Error('reservation failed'); } },
    projects: app.projects, requests: app.requests, userHome: '/tmp/no-config', runtime });
  await assert.rejects(rejecting.execute(preview), /reservation failed/);
  assert.equal(app.chatStore.get(first.chat.id)?.phase, 'ready');
  const second = await chats.execute(preview);
  assert.equal(second.outcome, 'ready');
  assert.notEqual(second.chat.id, first.chat.id);
  assert.equal(app.chatStore.get(first.chat.id)?.phase, 'closed');
  assert.equal(app.chatStore.get(first.chat.id)?.sessionId, 'session-1');
  assert.equal(app.chatStore.byWorktree(args.worktree)?.id, second.chat.id);
  assert.equal(count, 2);
  await assert.rejects(chats.execute(preview), /No occupied|changed/);
});
