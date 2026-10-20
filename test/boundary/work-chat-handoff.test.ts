import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import install from '../../src/app/startup-extension.js';

test('a single launch-commit handoff resyncs an early model_select without a show or polling loop', async t => {
  const state = mkdtempSync(join(tmpdir(), 'mypi-handoff-'));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = state;
  t.after(() => { if (previous === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous; });
  const ackDir = join(state, 'mypi', 'work-chat-acks');
  mkdirSync(ackDir, { recursive: true });
  const attempt = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const handlers = new Map<string, Array<(event: any, ctx: any) => Promise<void>>>();
  const notices: string[] = [], statuses: string[] = [];
  let auth = false, syncCalls = 0;
  let foundUnknown!: () => void, foundReady!: () => void;
  const unknown = new Promise<void>(resolve => { foundUnknown = resolve; });
  const ready = new Promise<void>(resolve => { foundReady = resolve; });
  let timeout!: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('One-shot launch handoff timed out')), 2000); });
  t.after(() => clearTimeout(timeout));
  install({ registerMcpServer() {}, registerFlag() {}, registerCommand() {}, appendEntry() {},
    getFlag(key: string) { return key === 'mypi-chat-attempt' ? attempt : key === 'mypi-chat-model' ? 'null'
      : key === 'mypi-chat-unpinned' ? true : key === 'mypi-scope' ? 'fixture/tool' : undefined; },
    on(name: string, handler: (event: any, ctx: any) => Promise<void>) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
    async exec(_bin: string, args: string[]) {
      if (args.includes('sync-attempt')) {
        syncCalls++;
        return syncCalls <= 3 ? { code: 1, stdout: '', stderr: 'Launch still reserved' }
          : { code: 0, stdout: JSON.stringify({ status: 'ready', expected: { provider: 'fixture', model: 'selected' }, selected: { provider: 'fixture', model: 'selected' } }), stderr: '' };
      }
      if (args.includes('warmup')) return { code: 0, stdout: JSON.stringify({ memory: [], work: { tasks: [] } }), stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
  } as never);
  const ctx = { hasUI: true, signal: new AbortController().signal, cwd: state, model: { provider: 'fixture', id: 'selected' },
    ui: { notify(message: string) { notices.push(message); if (message.includes('readiness unconfirmed')) foundUnknown();
      if (message.includes('Work chat ready:')) foundReady(); },
      setStatus(_key: string, value: string) { statuses.push(value); }, async confirm() { return false; } },
    modelRegistry: { find(provider: string, id: string) { return { provider, id }; }, hasConfiguredAuth() { return auth; } },
    sessionManager: { getSessionId() { return 'session-1'; }, getSessionFile() { return undefined; }, getHeader() { return null; },
      getEntries() { return []; }, getBranch() { return []; } },
  };
  for (const handler of handlers.get('session_start') ?? []) await handler({ reason: 'startup' }, ctx);
  auth = true;
  for (const handler of handlers.get('model_select') ?? []) await handler({}, ctx);
  await Promise.race([unknown, limit]);
  assert.equal(statuses.at(-1), 'work chat unknown');
  // An ordinary turn can supersede the model_select receipt before the launcher
  // commits. It must install its own handoff rather than silently losing it.
  const turn = { systemPromptOptions: { sections: {} as Record<string, string> } };
  for (const handler of handlers.get('before_agent_start') ?? []) await handler(turn, ctx);
  for (const handler of handlers.get('session_tree') ?? []) await handler({}, ctx);
  writeFileSync(join(ackDir, attempt + '-committed'), '', { flag: 'wx' });
  await Promise.race([ready, limit]);
  assert.equal(statuses.at(-1), 'work chat ready');
  assert.equal(syncCalls, 4, 'only the most recent event gets one post-commit verification');
  assert(notices.some(text => text.includes('Work chat ready: fixture/selected')));
});

test('existing commit marker cannot re-arm a failing adoption reconciliation', async t => {
  const state = mkdtempSync(join(tmpdir(), 'mypi-adopt-handoff-'));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = state;
  t.after(() => { if (previous === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous; });
  const dir = join(state, 'mypi', 'work-chat-acks');
  mkdirSync(dir, { recursive: true });
  const attempt = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  writeFileSync(join(dir, attempt + '-committed'), '', { flag: 'wx' });
  let command!: (args: string, ctx: any) => Promise<void>;
  let syncCalls = 0;
  const notices: string[] = [];
  install({ registerMcpServer() {}, registerFlag() {}, on() {},
    registerCommand(_name: string, item: { handler: (args: string, ctx: any) => Promise<void> }) { command = item.handler; },
    getFlag(key: string) { return key === 'mypi-chat-attempt' ? syncCalls >= 4 ? undefined : attempt
      : key === 'mypi-chat-model' ? 'null' : key === 'mypi-chat-unpinned' ? true : key === 'mypi-scope' ? 'fixture/tool' : undefined; },
    async exec(_bin: string, args: string[]) {
      if (args.includes('sync-attempt')) {
        syncCalls++;
        return { code: 1, stdout: '', stderr: 'Persistent native inspection failure' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  } as never);
  const ctx = { hasUI: true, signal: new AbortController().signal, cwd: state, model: { provider: 'fixture', id: 'selected' },
    ui: { notify(message: string) { notices.push(message); }, setStatus() {}, async confirm() { return false; } },
    modelRegistry: { find(provider: string, id: string) { return { provider, id }; }, hasConfiguredAuth() { return true; } },
    sessionManager: { getSessionId() { return 'session-1'; }, getSessionFile() { return undefined; }, getHeader() { return null; },
      getEntries() { return []; }, getBranch() { return []; } },
  };
  await command('adopt-model', ctx);
  for (let i = 0; i < 80; i++) await Promise.resolve();
  assert.equal(syncCalls, 2, 'initial failure and at most one post-commit check');
  assert(notices.some(text => text.includes('Model adoption unconfirmed')));
  assert(!notices.some(text => text.includes('Work chat ready:')));
});
