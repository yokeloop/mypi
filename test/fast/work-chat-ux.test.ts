import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../../src/app/create-app.js';
import { createWorkChats, type ChatInspection, type ChatRuntime } from '../../src/app/work-chats.js';
import { parseChatPreview, parseSyncReceipt } from '../../src/app/work-chat-input.js';
import { chatPreview } from '../../src/mcp/schemas.js';
import { state } from '../support/state.js';

const selected = { provider: 'fixture', model: 'selected' };
const expected = { provider: 'fixture', model: 'expected' };
test('model-less preview/execute adopts only verified authorized selection in same attempt; consent refuses stale selection', async t => {
  const { filename, dir } = state(t);
  const app = createApp(filename, false);
  t.after(() => app.close());
  const project = app.projects.add('team/tool', 'TT', dir);
  const request = app.requests.create({ projectId: project.id, slug: 'ux', title: 'UX', status: 'new' }, () => {});
  const prior = [process.env.HERDR_ENV, process.env.HERDR_WORKSPACE_ID];
  process.env.HERDR_ENV = '1'; process.env.HERDR_WORKSPACE_ID = 'test';
  t.after(() => { for (const [key, value] of [['HERDR_ENV', prior[0]], ['HERDR_WORKSPACE_ID', prior[1]]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  let model = selected, authorized = false, generation = 1, alive = true, empty = false, handoffs = 0;
  const paneProcess = { pane: 'pane', processId: 1024, processStart: 'start' };
  let native = { sessionId: 'session', historyPath: '/tmp/session.jsonl' };
  const runtime: ChatRuntime = {
    async validate(args) { return { sourceClone: args.sourceClone, worktree: args.worktree, installation: args.installation, statePath: args.statePath, gitCommonDir: '/tmp/git', branch: 'task/ux' }; },
    async validateModel() { return 'ready'; },
    async history() { return { native, saved: { status: 'selected', selection: model } }; },
    async provenEmpty() { return empty && !alive; },
    async inspect(chat): Promise<ChatInspection> { if (!alive) return { status: 'dead' }; return { status: 'live', binding: chat, process: paneProcess, native,
      model, authorized, generation, readiness: authorized && (!chat.requestedProvider || chat.requestedProvider === model.provider && chat.requestedModel === model.model) ? 'ready' : 'auth-pending' }; },
    receiptMatches(_chat, candidate, serial, _adopt) { return authorized && serial === generation && candidate.provider === model.provider && candidate.model === model.model; },
    launchCommitted(chat) { handoffs++; assert.equal(app.chatStore.get(chat.id)?.phase, chat.phase, 'handoff follows the SQL commit'); },
    async launch() { if (!alive) native = { sessionId: 'session-2', historyPath: '/tmp/session-2.jsonl' }; alive = true; return { status: 'acknowledged', process: paneProcess, native, model, readiness: 'auth-pending' }; },
  };
  const chats = createWorkChats({ store: app.chatStore, projects: app.projects, requests: app.requests, userHome: dir, runtime });
  const args = { identity: 'team/tool', requestId: request.id, sourceClone: dir, worktree: dir + '/task', installation: '/tmp/engine', statePath: filename };
  const preview = await chats.previewOpen(args);
  assert.deepEqual(preview.model, { source: 'unselected' });
  assert.deepEqual(parseChatPreview(preview), preview);
  assert.deepEqual(chatPreview.parse(preview), preview);
  mkdirSync(join(dir, 'pi'));
  const defaults = join(dir, 'pi', 'work-chats.json');
  writeFileSync(defaults, JSON.stringify({ default: expected }));
  await assert.rejects(chats.execute(preview), /Model changed since preview/);
  assert.equal(app.chatStore.byWorktree(args.worktree), undefined);
  unlinkSync(defaults);
  assert.equal((await chats.execute(preview)).outcome, 'auth-pending');
  assert.equal(handoffs, 1);
  const row = app.chatStore.byWorktree(args.worktree)!;
  assert.equal(row.requestedProvider, null);
  const receipt = { attempt: row.attemptId, sessionId: native.sessionId, processId: paneProcess.processId, generation, model };
  assert.deepEqual(parseSyncReceipt(receipt), receipt);
  await assert.rejects(chats.syncAttempt({ ...receipt, adopt: false }), /unconfirmed/);
  authorized = true;
  const inspectBeforeRace = runtime.inspect;
  let changedDuringInspection = false;
  runtime.inspect = async chat => {
    const observation = await inspectBeforeRace(chat);
    if (!changedDuringInspection && chat.phase === 'auth-pending' && chat.requestedProvider === null) {
      changedDuringInspection = true;
      app.chatStore.transaction(() => app.chatStore.update({ ...chat, requestedProvider: expected.provider, requestedModel: expected.model }));
    }
    return observation;
  };
  const stale = await chats.show(row.id);
  assert.equal(stale.observation.status, 'unknown');
  assert.equal(app.chatStore.get(row.id)?.requestedModel, expected.model, 'stale no-target adoption cannot overwrite a newer target');
  runtime.inspect = inspectBeforeRace;
  const changed = app.chatStore.get(row.id)!;
  app.chatStore.transaction(() => app.chatStore.update({ ...changed, requestedProvider: null, requestedModel: null }));
  assert.equal((await chats.syncAttempt({ ...receipt, adopt: false })).status, 'ready');
  assert.equal(app.chatStore.get(row.id)?.requestedModel, selected.model);
  assert.equal((await chats.previewResume(row.id)).live?.pane, paneProcess.pane);
  model = expected; generation++;
  const second = { ...receipt, generation, model };
  assert.equal((await chats.syncAttempt({ ...second, adopt: false })).status, 'mismatch');
  assert.equal(app.chatStore.get(row.id)?.phase, 'auth-pending', 'mismatch demotes ready metadata before notifying the tab');
  assert.equal(app.chatStore.get(row.id)?.requestedModel, selected.model);
  await assert.rejects(chats.syncAttempt({ ...receipt, adopt: true, expectedTarget: selected }), /unconfirmed/);
  assert.equal(app.chatStore.get(row.id)?.requestedModel, selected.model);
  await assert.rejects(chats.syncAttempt({ ...second, adopt: true }), /previewed target/);
  await assert.rejects(chats.syncAttempt({ ...second, adopt: true, expectedTarget: { provider: 'fixture', model: 'changed' } }), /Expected target changed/);
  const beforeConcurrentAdoption = app.chatStore.get(row.id)!;
  app.chatStore.transaction(() => app.chatStore.update({ ...beforeConcurrentAdoption, requestedModel: 'newer-target' }));
  await assert.rejects(chats.syncAttempt({ ...second, adopt: true, expectedTarget: selected }), /Expected target changed/);
  assert.equal(app.chatStore.get(row.id)?.requestedModel, 'newer-target');
  const newer = app.chatStore.get(row.id)!;
  app.chatStore.transaction(() => app.chatStore.update({ ...newer, requestedModel: selected.model }));
  assert.equal((await chats.syncAttempt({ ...second, adopt: true, expectedTarget: selected })).status, 'ready');
  assert.equal(app.chatStore.get(row.id)?.requestedModel, expected.model);
  alive = false; empty = true;
  const replacement = await chats.previewNewEmpty(row.id);
  assert.deepEqual(replacement.model, { source: 'unselected' });
  assert.equal((await chats.execute(replacement)).outcome, 'ready');
  assert.equal(handoffs, 2);
  assert.equal(app.chatStore.get(row.id)?.phase, 'closed');
  assert.throws(() => parseChatPreview({ ...preview, model: { source: 'unselected', provider: 'fixture' } }));
  assert.deepEqual(parseSyncReceipt({ ...receipt, expectedTarget: selected }).expectedTarget, selected);
  assert.throws(() => parseSyncReceipt({ ...receipt, injected: true }));
  assert.throws(() => parseSyncReceipt({ ...receipt, expectedTarget: { provider: 'fixture' } }));
});

test('initial model-less launch never adopts a model replaced between inspection and reservation commit', async t => {
  const { filename, dir } = state(t);
  const app = createApp(filename, false);
  t.after(() => app.close());
  const project = app.projects.add('team/tool', 'TT', dir);
  const request = app.requests.create({ projectId: project.id, slug: 'startup-race', title: 'Startup race', status: 'new' }, () => {});
  const prior = [process.env.HERDR_ENV, process.env.HERDR_WORKSPACE_ID];
  process.env.HERDR_ENV = '1'; process.env.HERDR_WORKSPACE_ID = 'test';
  t.after(() => { for (const [key, value] of [['HERDR_ENV', prior[0]], ['HERDR_WORKSPACE_ID', prior[1]]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const native = { sessionId: 'start-session', historyPath: '/tmp/start-session' };
  const paneProcess = { pane: 'start-pane', processId: 2222, processStart: 'tick' };
  let active = selected, generation = 1, checks = 0, handoffs = 0;
  const runtime: ChatRuntime = {
    launchCommitted() { handoffs++; },
    async validate(args) { return { ...args, gitCommonDir: '/tmp/common', branch: 'task/startup' }; },
    async validateModel() { return 'ready'; },
    async history() { throw new Error('No session persisted'); },
    async provenEmpty() { return false; },
    async inspect(chat) { return { status: 'live', binding: chat, native, process: paneProcess,
      model: active, authorized: true, generation, readiness: 'ready' }; },
    receiptMatches(_chat, candidate, serial) {
      checks++;
      if (checks === 2) { active = expected; generation++; }
      return candidate.provider === active.provider && candidate.model === active.model && serial === generation;
    },
    async launch() { return { status: 'acknowledged', native, process: paneProcess, model: selected, readiness: 'auth-pending' }; },
  };
  const chats = createWorkChats({ store: app.chatStore, projects: app.projects, requests: app.requests, userHome: dir, runtime });
  const args = { identity: 'team/tool', requestId: request.id, sourceClone: dir, worktree: dir + '/task',
    installation: '/tmp/engine', statePath: filename };
  const result = await chats.execute(await chats.previewOpen(args));
  assert.equal(checks, 2);
  assert.equal(handoffs, 0, 'uncertain launches never signal a committed reservation');
  assert.equal(result.outcome, 'partial');
  assert.equal(result.chat.requestedProvider, null);
  assert.equal(result.chat.phase, 'partial');
  assert.equal(app.chatStore.byWorktree(args.worktree)?.id, result.chat.id);
});
