import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app/create-app.js';
import { createWorkChats } from '../../src/app/work-chats.js';
import type { ChatInspection, ChatRuntime } from '../../src/app/work-chats.js';
import { state } from '../support/state.js';

test('uncertain launch retains its reserved native UUID even after process death without known history', async t => {
  const previousEnv = process.env.HERDR_ENV, previousWorkspace = process.env.HERDR_WORKSPACE_ID;
  process.env.HERDR_ENV = '1'; process.env.HERDR_WORKSPACE_ID = 'test-workspace';
  t.after(() => {
    if (previousEnv === undefined) delete process.env.HERDR_ENV; else process.env.HERDR_ENV = previousEnv;
    if (previousWorkspace === undefined) delete process.env.HERDR_WORKSPACE_ID; else process.env.HERDR_WORKSPACE_ID = previousWorkspace;
  });
  const { dir, filename } = state(t);
  const app = createApp(filename, false);
  t.after(() => app.close());
  const project = app.projects.add('team/tool', 'TT', dir);
  const card = app.requests.create({ projectId: project.id, slug: 'one', title: 'One', status: 'new' }, () => {});
  let observation: ChatInspection = { status: 'unknown' };
  const runtime: ChatRuntime = {
    async validate(args) { return { ...args, gitCommonDir: dir + '/.git', branch: 'task/one' }; },
    async inspect() { return observation; },
    async history() { throw new Error('not called'); },
    async provenEmpty() { return false; },
    async validateModel() {},
    async focus() {},
    async prepareLaunch() { return async () => { throw new Error('Herdr did not confirm whether a tab was created'); }; },
  };
  const chats = createWorkChats({ store: app.chatStore, projects: app.projects, requests: app.requests, runtime, userHome: dir });
  const args = { identity: 'team/tool', requestId: card.id, sourceClone: dir, worktree: dir + '/task', installation: dir + '/pi', statePath: filename, model: { provider: 'p', model: 'm' } };
  const preview = await chats.previewOpen(args);
  const result = await chats.execute(preview);
  assert.equal(result.outcome, 'partial');
  assert.match(result.observation.reason!, /Herdr did not confirm/);
  await assert.rejects(chats.previewOpen(args), /already has/);
  await assert.rejects(chats.previewResume(result.chat.id), /ownership unknown/);
  assert.equal(app.chatStore.list().length, 1);
  observation = { status: 'dead' };
  await assert.rejects(chats.previewResume(result.chat.id), /Exact native history unavailable/);
  await assert.rejects(chats.previewNewEmpty(result.chat.id), /No occupied/);
  await assert.rejects(chats.previewOpen(args), /already has/);
  assert.equal(app.chatStore.list().length, 1);
  assert.equal(app.chatStore.get(result.chat.id)?.sessionId, result.chat.sessionId);
  assert.ok(result.chat.sessionId);
});
