import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../../src/app/create-app.js';
import { createWorkChats, type ChatInspection, type ChatRuntime } from '../../src/app/work-chats.js';
import type { NativeIdentity } from '../../src/modules/work-chats/public.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { state } from '../support/state.js';

const selected = { provider: 'fixture', model: 'selected' };
function fixture(t: TestContext) {
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
  const facts = { status: 'dead' as ChatInspection['status'], native: undefined as NativeIdentity | undefined,
    model: selected, launches: 0, focuses: [] as string[],
    process: { pane: 'pane', processId: 123, processStart: 'tick', processBootId: 'boot', herdrEndpoint: '/tmp/herdr.sock' } };
  const runtime: ChatRuntime = {
    async validate(args) { return { ...args, gitCommonDir: '/tmp/git', branch: 'task/ux' }; },
    async validateModel() {},
    async history(chat) { return { native: { sessionId: chat.sessionId!, historyPath: chat.historyPath! }, saved: { status: 'selected', selection: facts.model } }; },
    async provenEmpty() { return false; },
    async inspect(chat) { return facts.status === 'live' ? { status: 'live', binding: chat,
      process: facts.process, native: facts.native!, model: facts.model } : { status: facts.status }; },
    async focus(_chat, observation) { facts.focuses.push(observation.process!.pane); },
    async prepareLaunch({ chat }) { return async () => {
      facts.launches++;
      assert.equal(app.chatStore.get(chat.id)?.sessionId, chat.sessionId, 'native UUID is durable before dispatch');
      facts.native = { sessionId: chat.sessionId!, historyPath: chat.historyPath ?? `/tmp/${chat.sessionId}.jsonl` };
      facts.status = 'live';
      return { status: 'opened', process: facts.process, native: facts.native, model: facts.model };
    }; },
  };
  const chats = createWorkChats({ store: app.chatStore, projects: app.projects, requests: app.requests, userHome: dir, runtime });
  const args = { identity: 'team/tool', requestId: request.id, sourceClone: dir, worktree: dir + '/task', installation: '/tmp/engine', statePath: filename };
  return { app, chats, args, facts, runtime, dir, filename };
}

test('native default opens without auth/target adoption; list/show/resume-preview are read-only even for legacy phases', async t => {
  const { app, chats, args, facts, filename, runtime } = fixture(t);
  const result = await chats.execute(await chats.previewOpen(args));
  assert.equal(result.outcome, 'opened');
  assert.equal(result.chat.requestedProvider, null, 'no native model is adopted as a permanent target');
  for (const phase of ['ready', 'auth-pending', 'partial'] as const) {
    app.chatStore.update({ ...result.chat, phase, requestedProvider: 'old', requestedModel: 'target' });
    const before = app.chatStore.list();
    facts.model = { provider: 'new', model: 'native-choice' };
    const reader = createApp(filename, true);
    try {
      const readChats = createWorkChats({ store: reader.chatStore, projects: reader.projects, requests: reader.requests,
        userHome: '/tmp/no-config', runtime });
      assert.equal((await readChats.show(result.chat.id)).observation.status, 'live');
      assert.equal((await readChats.list())[0]!.chat.phase, phase);
      assert.deepEqual((await readChats.previewResume(result.chat.id)).model, { ...facts.model, source: 'saved session' });
    } finally { reader.close(); }
    assert.equal((await chats.show(result.chat.id)).observation.status, 'live');
    assert.equal((await chats.list())[0]!.chat.phase, phase);
    assert.deepEqual((await chats.previewResume(result.chat.id)).model, { ...facts.model, source: 'saved session' });
    assert.deepEqual(app.chatStore.list(), before);
  }
  assert.equal(facts.launches, 1);
});

test('same live native process can move panes; explicit open focuses it once, never launches a duplicate', async t => {
  const { chats, args, facts, app } = fixture(t);
  const opened = await chats.execute(await chats.previewOpen(args));
  const preview = await chats.previewResume(opened.chat.id);
  facts.process = { ...facts.process, pane: 'moved-pane' };
  assert.equal((await chats.show(opened.chat.id)).observation.process?.pane, 'moved-pane');
  assert.equal(app.chatStore.get(opened.chat.id)?.pane, 'pane', 'observation does not rewrite locators');
  const existing = await chats.execute(preview, true);
  assert.equal(existing.outcome, 'existing');
  assert.deepEqual(facts.focuses, ['moved-pane']);
  assert.equal(facts.launches, 1);
  facts.native = { ...facts.native!, sessionId: 'switched-native' };
  assert.equal((await chats.show(opened.chat.id)).observation.status, 'unknown');
  await assert.rejects(chats.previewResume(opened.chat.id), /ownership unknown/);
  assert.equal(facts.launches, 1);
});

test('legacy rows are historical; unknown/reused process origin blocks launch, positive death permits exact resume', async t => {
  const { chats, args, facts, app } = fixture(t);
  const opened = await chats.execute(await chats.previewOpen(args));
  for (const conflict of [{ processId: 555 }, { processStart: 'reused' }, { processBootId: 'new-boot' }, { herdrEndpoint: '/tmp/other.sock' }]) {
    const old = facts.process;
    facts.process = { ...old, ...conflict };
    assert.equal((await chats.show(opened.chat.id)).observation.status, 'unknown');
    await assert.rejects(chats.previewResume(opened.chat.id), /ownership unknown/);
    facts.process = old;
  }
  app.chatStore.update({ ...opened.chat, processBootId: null, herdrEndpoint: null, phase: 'auth-pending' });
  facts.status = 'unknown';
  await assert.rejects(chats.previewResume(opened.chat.id), /ownership unknown/);
  facts.status = 'dead';
  const resumed = await chats.execute(await chats.previewResume(opened.chat.id));
  assert.equal(resumed.outcome, 'opened');
  assert.equal(resumed.chat.sessionId, opened.chat.sessionId);
  assert.equal(facts.launches, 2);
});

test('saved native model ignores current config and obsolete pending target; missing history never becomes new-empty', async t => {
  const { chats, args, facts, app, dir, runtime } = fixture(t);
  const opened = await chats.execute(await chats.previewOpen(args));
  app.chatStore.update({ ...opened.chat, phase: 'auth-pending', requestedProvider: 'old', requestedModel: 'target' });
  facts.status = 'dead';
  mkdirSync(join(dir, 'pi'));
  writeFileSync(join(dir, 'pi/work-chats.json'), '{broken');
  assert.deepEqual((await chats.previewResume(opened.chat.id)).model, { ...selected, source: 'saved session' });
  runtime.history = async chat => ({ native: { sessionId: chat.sessionId!, historyPath: chat.historyPath! }, saved: { status: 'none' } });
  assert.deepEqual((await chats.previewResume(opened.chat.id)).model, { source: 'unselected' });
  runtime.history = async () => { throw new Error('Exact native history missing'); };
  await assert.rejects(chats.previewResume(opened.chat.id), /history missing/);
  await assert.rejects(chats.previewNewEmpty(opened.chat.id), /unconfirmed/);
  assert.equal(facts.launches, 1);
});

test('explicit invalid model fails before reservation; unconfirmed fallback is partial in the same occupied chat', async t => {
  const { chats, args, runtime, app, facts } = fixture(t);
  runtime.validateModel = async () => { throw new Error('Invalid exact model'); };
  await assert.rejects(chats.previewOpen({ ...args, model: selected }), /Invalid exact model/);
  assert.equal(app.chatStore.list().length, 0);
  runtime.validateModel = async () => {};
  const result = await chats.execute(await chats.previewOpen({ ...args, model: { provider: 'explicit', model: 'wanted' } }));
  assert.equal(result.outcome, 'partial');
  assert.match(result.observation.reason!, /launch model was not confirmed/);
  assert.equal(facts.launches, 1);
  assert.equal(app.chatStore.byWorktree(args.worktree)?.id, result.chat.id);
});

test('open-for-request selects exact existing history, asks on ambiguity, and requires supplied existing setup for new chat', async t => {
  const { chats, args, app, facts } = fixture(t);
  const request = { identity: args.identity, requestId: args.requestId };
  assert.equal((await chats.openForRequest(request)).outcome, 'setup-needed');
  const opened = await chats.openForRequest({ ...request, association: args });
  assert.equal(opened.outcome, 'opened');
  assert.equal((await chats.openForRequest(request)).outcome, 'existing');
  facts.status = 'dead';
  assert.equal((await chats.openForRequest(request)).outcome, 'opened');
  const row = app.chatStore.list()[0]!;
  app.chatStore.reserve({ ...row, id: 'second', attemptId: 'second-attempt', worktree: '/tmp/other-task',
    sessionId: 'second-session', historyPath: '/tmp/second-session' });
  const choice = await chats.openForRequest(request);
  assert.equal(choice.outcome, 'choice-needed');
  if (choice.outcome === 'choice-needed') assert.deepEqual(choice.chats.map(chat => chat.id), [row.id, 'second']);
  assert.equal((await chats.openForRequest({ ...request, chatId: row.id })).outcome, 'existing');
  await assert.rejects(chats.openForRequest({ ...request, chatId: 'foreign' }), /another request/);
  const another = app.requests.create({ projectId: null, slug: 'other', title: 'Other', status: 'new' }, () => {});
  await assert.rejects(chats.openForRequest({ ...request, requestId: another.id }), /different project/);
  assert.equal(facts.launches, 2);
});

test('launch preparation failure leaves new and saved rows unchanged; corrected ordinary opening succeeds', async t => {
  const { chats, args, facts, runtime, app } = fixture(t);
  const prepare = runtime.prepareLaunch;
  runtime.prepareLaunch = async () => { throw new Error('Stock integration unavailable'); };
  const request = { identity: args.identity, requestId: args.requestId, association: args };
  await assert.rejects(chats.openForRequest(request), /Stock integration unavailable/);
  assert.deepEqual(app.chatStore.list(), [], 'known setup failure must not occupy the worktree');
  assert.equal(facts.launches, 0);
  runtime.prepareLaunch = prepare;
  const opened = await chats.openForRequest(request);
  assert.equal(opened.outcome, 'opened');
  const before = app.chatStore.list();
  facts.status = 'dead';
  runtime.prepareLaunch = async () => { throw new Error('Stock integration unavailable'); };
  await assert.rejects(chats.openForRequest(request), /Stock integration unavailable/);
  assert.deepEqual(app.chatStore.list(), before, 'failed resume retains attempt, history, process and origin');
  assert.equal(facts.launches, 1);
  // Read paths and existing-live focus do not need launch-only configuration.
  facts.status = 'live';
  assert.equal((await chats.list())[0]!.observation.status, 'live');
  assert.equal((await chats.show(before[0]!.id)).observation.status, 'live');
  assert.ok((await chats.previewResume(before[0]!.id)).live);
  assert.equal((await chats.openForRequest(request)).outcome, 'existing');
  assert.equal(facts.launches, 1);
  facts.status = 'dead';
  runtime.prepareLaunch = prepare;
  const resumed = await chats.openForRequest(request);
  assert.equal(resumed.outcome, 'opened');
  const after = app.chatStore.list()[0]!;
  assert.equal(after.sessionId, before[0]!.sessionId);
  assert.equal(after.historyPath, before[0]!.historyPath);
  assert.notEqual(after.attemptId, before[0]!.attemptId);
  assert.equal(facts.launches, 2, 'one original and one exact resume, no cleanup API');
});

test('reservation compares the exact inspected attempt, native identity and association, including changes during history IO and launch preparation', async t => {
  const { chats, args, app, facts, runtime, filename } = fixture(t);
  const opened = await chats.execute(await chats.previewOpen(args));
  facts.status = 'dead';
  const db = openDatabase(filename);
  t.after(() => db.close());
  const history = runtime.history, prepare = runtime.prepareLaunch;
  for (const stage of ['history', 'preparation']) {
    for (const [column, oldValue, newValue] of [
      ['attempt_id', opened.chat.attemptId, 'other-attempt'],
      ['session_id', opened.chat.sessionId, 'other-native'],
      ['branch', opened.chat.branch, 'task/changed'],
    ] as const) {
      runtime.history = history; runtime.prepareLaunch = prepare;
      const preview = await chats.previewResume(opened.chat.id);
      const change = (id: string) => db.prepare(`UPDATE work_chats SET ${column} = ? WHERE id = ?`).run(newValue, id);
      if (stage === 'history') runtime.history = async chat => {
        const result = await history(chat); change(chat.id); return result;
      };
      else runtime.prepareLaunch = async input => {
        const launch = await prepare(input); change(input.chat.id); return launch;
      };
      await assert.rejects(chats.execute(preview), /changed since inspection/);
      assert.equal(facts.launches, 1, 'stale inspection must not reserve or launch');
      assert.equal(app.chatStore.get(opened.chat.id)?.phase, 'ready');
      db.prepare(`UPDATE work_chats SET ${column} = ? WHERE id = ?`).run(oldValue, opened.chat.id);
    }
  }
});

test('overlapping resumes reserve once and reject a stale preview even when the history remains identical', async t => {
  const { chats, args, facts } = fixture(t);
  const opened = await chats.execute(await chats.previewOpen(args));
  facts.status = 'dead';
  const preview = await chats.previewResume(opened.chat.id);
  const results = await Promise.allSettled([chats.execute(preview), chats.execute(preview)]);
  assert.equal(results.filter(result => result.status === 'fulfilled' && result.value.outcome === 'opened').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(facts.launches, 2, 'one original and one resumed writer');
});

test('late result cannot overwrite changed association even when attempt ID was not changed', async t => {
  const { chats, args, runtime, filename, app } = fixture(t);
  const db = openDatabase(filename);
  t.after(() => db.close());
  const inspect = runtime.inspect;
  runtime.inspect = async chat => {
    const observation = await inspect(chat);
    db.prepare('UPDATE work_chats SET branch = ? WHERE id = ?').run('task/rebound', chat.id);
    return observation;
  };
  const result = await chats.execute(await chats.previewOpen(args));
  assert.equal(result.outcome, 'partial');
  assert.equal(app.chatStore.get(result.chat.id)?.branch, 'task/rebound');
  assert.equal(app.chatStore.get(result.chat.id)?.phase, 'partial');
  assert.match(result.observation.reason!, /Stale launch.*not attached/);
});

test('lost launch result is recovered only by an exact live observation, without repeating launch', async t => {
  const { chats, args, facts, runtime } = fixture(t);
  const prepare = runtime.prepareLaunch;
  runtime.prepareLaunch = async input => {
    const launch = await prepare(input);
    return async () => { await launch(); throw new Error('Lost native start result'); };
  };
  const result = await chats.execute(await chats.previewOpen(args));
  assert.equal(result.outcome, 'partial');
  assert.equal(result.chat.historyPath, null);
  assert.equal(result.chat.sessionId, facts.native!.sessionId);
  const recovered = await chats.execute(await chats.previewResume(result.chat.id), true);
  assert.equal(recovered.outcome, 'existing');
  assert.equal(recovered.chat.historyPath, facts.native!.historyPath);
  assert.equal(facts.launches, 1);
});
