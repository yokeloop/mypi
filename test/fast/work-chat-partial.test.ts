import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app/create-app.js';
import { createWorkChats } from '../../src/app/work-chats.js';
import type { ChatRuntime } from '../../src/app/work-chats.js';
import { state } from '../support/state.js';

const pair = { provider: 'custom', model: 'model/id' };
test('tab created without native acknowledgement preserves pane and blocks duplicate launch/release', async t => {
  const { filename, dir } = state(t);
  const app = createApp(filename, false);
  t.after(() => app.close());
  const project = app.projects.add('team/tool', 'TT', dir);
  const card = app.requests.create({ projectId: project.id, slug: 'one', title: 'One', status: 'new' }, () => {});
  const runtime: ChatRuntime = {
    async validate(args) { return { ...args, gitCommonDir: '/tmp/git', branch: 'task/one' }; },
    async history(chat) { return { native: { sessionId: chat.sessionId!, historyPath: chat.historyPath! }, saved: { status: 'selected', selection: pair } }; },
    async inspect() { return { status: 'unknown', reason: 'pane still occupied' }; },
    async provenEmpty() { return false; },
    async validateModel() {},
    async launch() { return { status: 'partial', reason: 'native acknowledgement unavailable', pane: 'owned-pane' }; },
  };
  const chats = createWorkChats({ store: app.chatStore, projects: app.projects, requests: app.requests, userHome: '/tmp/no-config', runtime });
  const args = { identity: 'team/tool', requestId: card.id, sourceClone: dir, worktree: dir + '/task', installation: '/tmp/installed', statePath: filename, model: pair };
  const result = await chats.execute(await chats.previewOpen(args));
  assert.equal(result.outcome, 'partial');
  assert.equal(result.chat.pane, 'owned-pane');
  assert.equal(result.chat.processId, null);
  assert.equal(result.chat.sessionId, null);
  await assert.rejects(chats.previewOpen(args), /already has/);
  await assert.rejects(chats.previewResume(result.chat.id), /ownership unknown/);
  await assert.rejects(chats.releaseUnused(result.chat.id), /not proven dead/);
});

test('stale attempt cannot attach its pane to a newer reservation', async t => {
  const { filename, dir } = state(t);
  const app = createApp(filename, false);
  t.after(() => app.close());
  const project = app.projects.add('team/tool', 'TT', dir);
  const card = app.requests.create({ projectId: project.id, slug: 'one', title: 'One', status: 'new' }, () => {});
  const runtime: ChatRuntime = {
    async validate(args) { return { ...args, gitCommonDir: '/tmp/git', branch: 'task/one' }; },
    async history(chat) { return { native: { sessionId: chat.sessionId!, historyPath: chat.historyPath! }, saved: { status: 'none' } }; },
    async inspect() { return { status: 'unknown' }; },
    async provenEmpty() { return false; },
    async validateModel() {},
    async launch({ chat }) {
      app.chatStore.transaction(() => app.chatStore.update({ ...chat, attemptId: 'new-attempt' }, chat.attemptId));
      return { status: 'partial', reason: 'native unavailable', pane: 'old-attempt-pane' };
    },
  };
  const chats = createWorkChats({ store: app.chatStore, projects: app.projects, requests: app.requests, userHome: '/tmp/no-config', runtime });
  const args = { identity: 'team/tool', requestId: card.id, sourceClone: dir, worktree: dir + '/task', installation: '/tmp/installed', statePath: filename, model: pair };
  const result = await chats.execute(await chats.previewOpen(args));
  assert.equal(result.outcome, 'partial');
  assert.equal(result.chat.attemptId, 'new-attempt');
  assert.equal(result.chat.pane, null);
  assert.match(result.observation.reason!, /old-attempt-pane.*not attached/);
});

test('foreign resume acknowledgement never replaces original native history', async t => {
  const { filename, dir } = state(t);
  const app = createApp(filename, false);
  t.after(() => app.close());
  const project = app.projects.add('team/tool', 'TT', dir);
  const card = app.requests.create({ projectId: project.id, slug: 'one', title: 'One', status: 'new' }, () => {});
  let launch = 0;
  const runtime: ChatRuntime = {
    async validate(args) { return { ...args, gitCommonDir: '/tmp/git', branch: 'task/one' }; },
    async history(chat) { return { native: { sessionId: chat.sessionId!, historyPath: chat.historyPath! }, saved: { status: 'selected', selection: pair } }; },
    async inspect() { return { status: 'dead' }; },
    async provenEmpty() { return false; },
    async validateModel() {},
    async launch() {
      launch++;
      return { status: 'acknowledged', native: launch === 1
        ? { sessionId: 'original', historyPath: '/tmp/original' } : { sessionId: 'foreign', historyPath: '/tmp/foreign' },
        process: { pane: 'owned-pane', processId: 100, processStart: 'start-1' }, model: pair };
    },
  };
  const chats = createWorkChats({ store: app.chatStore, projects: app.projects, requests: app.requests, userHome: '/tmp/no-config', runtime });
  const args = { identity: 'team/tool', requestId: card.id, sourceClone: dir, worktree: dir + '/task', installation: '/tmp/installed', statePath: filename, model: pair };
  const first = await chats.execute(await chats.previewOpen(args));
  assert.equal(first.chat.sessionId, 'original');
  const second = await chats.execute(await chats.previewResume(first.chat.id));
  assert.equal(second.outcome, 'partial');
  assert.equal(second.chat.sessionId, 'original');
  assert.equal(second.chat.historyPath, '/tmp/original');
  assert.equal(second.chat.pane, 'owned-pane');
});
