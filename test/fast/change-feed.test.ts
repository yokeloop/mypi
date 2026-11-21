import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { createApp, deviceSessions } from '../../src/app/create-app.js';
import { createChangeFeed } from '../../src/app/change-feed.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { localSessionRunner } from '../../src/app/session-operations.js';
import type { SessionRunner } from '../../src/app/session-operations.js';
import { registerSession } from '../../src/app/sessions.js';
import { IDLE_MS, subscribeInbox } from '../../src/app/inbox-subscription.js';
import type { SubscriptionOptions } from '../../src/app/inbox-subscription.js';
import type { EventTransports } from '../../src/app/delivery.js';
import type { EventTransport } from '../../src/modules/events/public.js';
import { ProcessProbeError } from '../../src/modules/sessions/public.js';
import { InputError } from '../../src/shared/errors.js';

test('change feed counts commits of other connections once and stays still without them', t => {
  const { filename } = state(t);
  const feed = createChangeFeed(filename);
  t.after(() => feed.close());
  assert.equal(feed.changeId(), 1);
  assert.equal(feed.poll(), false);
  const app = createApp(filename, false);
  try { app.projects.add('one/project', 'MP', undefined, 'file:///nonexistent/one/project.git'); } finally { app.close(); }
  assert.equal(feed.poll(), true);
  assert.equal(feed.changeId(), 2);
  assert.equal(feed.poll(), false);
  const reader = createApp(filename, true);
  try { reader.projects.list(); } finally { reader.close(); }
  assert.equal(feed.poll(), false);
  assert.equal(feed.changeId(), 2);
});

function subscription(t: TestContext) {
  const { dir, filename } = state(t);
  const app = createApp(filename, false);
  try { app.projects.add('one/project', 'MP', undefined, 'file:///nonexistent/one/project.git'); } finally { app.close(); }
  const db = openDatabase(filename);
  try {
    db.prepare(`INSERT INTO tasks(project_id, number, title, status_id, context_dir, worktree_path, created_at, updated_at)
      VALUES ((SELECT id FROM projects WHERE code = 'MP'), 12, 'remote', (SELECT id FROM task_statuses WHERE code = 'new'),
      'projects/one/project/tasks/MP-12-remote', NULL, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`).run();
  } finally { db.close(); }
  const run = join(dir, 'run'), proc = join(dir, 'proc');
  mkdirSync(run, { mode: 0o700 });
  mkdirSync(proc);
  const alive = (pid: number) => {
    mkdirSync(join(proc, String(pid)), { recursive: true });
    writeFileSync(join(proc, String(pid), 'stat'), `${pid} (pi) S 1 ${'0 '.repeat(17)}1 0 0\n`);
    writeFileSync(join(proc, String(pid), 'cmdline'), 'pi\0');
  };
  const runner = localSessionRunner(filename);
  const register = (pid: number, nativeId: string, socket: string) => {
    alive(pid);
    return registerSession(runner, { name: 'session_register', agent: 'pi', pid, nativeId, fork: false, envScope: 'MP-12', runtime: run, socket }, proc);
  };
  const events = () => {
    const db = openDatabase(filename, true);
    try {
      return db.prepare('SELECT id, claimed_by AS claimedBy, delivered_at AS deliveredAt FROM events ORDER BY id').all() as
        { id: number; claimedBy: number | null; deliveredAt: string | null }[];
    } finally { db.close(); }
  };
  const rowId = (nativeId: string) => {
    const db = openDatabase(filename, true);
    try { return db.prepare('SELECT id FROM sessions WHERE native_id = ?').pluck().get(nativeId) as number; } finally { db.close(); }
  };
  const fetched: { url: string; headers: unknown }[] = [];
  const fetcher = (answers: ((signal: AbortSignal) => Response)[]) => async (url: string, init: RequestInit) => {
    fetched.push({ url, headers: init.headers });
    const answer = answers.shift();
    if (answer === undefined) throw new Error('unexpected fetch');
    return answer(init.signal!);
  };
  const options = (pid: number, controller: AbortController, fetch: (url: string, init: RequestInit) => Promise<Response>,
    extra: { transports?: EventTransports; runner?: SessionRunner; pause?: (ms: number) => Promise<void>;
      timer?: SubscriptionOptions['timer']; device?: SubscriptionOptions['device']; now?: () => number } = {}): SubscriptionOptions => ({
    server: { url: 'http://mypi.test', token: 't1' }, pid, agent: 'pi', runner: extra.runner ?? runner, device: extra.device ?? deviceSessions(run, proc),
    transports: extra.transports ?? {}, fetch, pause: extra.pause ?? (async () => undefined), timer: extra.timer ?? (() => () => undefined),
    signal: controller.signal, ...(extra.now === undefined ? {} : { now: extra.now }) });
  const counting = (onClaim: (n: number) => void): SessionRunner => {
    let n = 0;
    return { remote: runner.remote, device: runner.device, run: async (name, input) => {
      const result = await runner.run(name, input);
      if (name === 'events_claim') onClaim(++n);
      return result;
    } };
  };
  return { proc, runner, alive, register, events, rowId, fetched, fetcher, options, counting };
}

const initial = 'retry: 2000\nid: 1\nevent: change\ndata: {"changeId":1}\n\n';

function stream(chunks: string[], close = false) {
  return (signal: AbortSignal) => new Response(new ReadableStream<Uint8Array>({ start(c) {
    for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
    const end = () => { try { c.close(); } catch { return; } };
    if (close) end();
    signal.addEventListener('abort', end);
  } }));
}

test('a change frame claims for the watched session, sends to its socket and settles the acknowledged rows', async t => {
  const x = subscription(t);
  await x.register(101, 'p1', '/s/p1.sock');
  await x.runner.run('message_create', { from: 'MP', to: 'MP-12', message: 'hi' });
  const controller = new AbortController();
  const sent: [string, number[]][] = [];
  const pi: EventTransport = async (socket, events) => { sent.push([socket, events.map(e => e.id)]); controller.abort(); return events.map(e => e.id); };
  await subscribeInbox(x.options(101, controller, x.fetcher([stream([initial])]), { transports: { pi } }));
  assert.deepEqual(sent, [['/s/p1.sock', [1]]]);
  const [event] = x.events();
  assert.equal(event!.claimedBy, x.rowId('p1'));
  assert.notEqual(event!.deliveredAt, null);
  assert.deepEqual(x.fetched, [{ url: 'http://mypi.test/v1/changes', headers: { authorization: 'Bearer t1', accept: 'text/event-stream' } }]);
});

test('the subscription of an inactive session claims nothing', async t => {
  const x = subscription(t);
  await x.register(101, 'p1', '/s/p1.sock');
  await x.register(102, 'p3', '/s/p3.sock');
  await x.runner.run('message_create', { from: 'MP', to: 'MP-12', message: 'hi' });
  const controller = new AbortController();
  let claims = 0;
  const sent: string[] = [];
  const pi: EventTransport = async (socket, events) => { sent.push(socket); return events.map(e => e.id); };
  await subscribeInbox(x.options(102, controller, x.fetcher([stream([initial])]),
    { transports: { pi }, runner: x.counting(n => { claims = n; controller.abort(); }) }));
  assert.equal(claims, 1);
  assert.deepEqual(sent, []);
  assert.deepEqual(x.events(), [{ id: 1, claimedBy: null, deliveredAt: null }]);
});

test('a non-200 answer and the end of the stream reconnect after the stream\'s retry', async t => {
  const x = subscription(t);
  x.alive(101);
  const controller = new AbortController();
  const paused: number[] = [];
  await subscribeInbox(x.options(101, controller, x.fetcher([
    () => new Response('unavailable', { status: 503 }),
    stream(['retry: 500\n\n'], true),
    () => { controller.abort(); throw new Error('aborted'); },
  ]), { pause: async ms => { paused.push(ms); } }));
  assert.deepEqual(paused, [2000, 500]);
  assert.equal(x.fetched.length, 3);
});

test('a stream silent past the idle limit is dropped, reconnected after retry and claimed again', async t => {
  const x = subscription(t);
  await x.register(101, 'p1', '/s/p1.sock');
  const controller = new AbortController();
  const sent: [string, number[]][] = [];
  const pi: EventTransport = async (socket, events) => { sent.push([socket, events.map(e => e.id)]); return events.map(e => e.id); };
  const timers: { ms: number; fire: () => void; live: boolean }[] = [];
  const timer = (ms: number, fire: () => void) => {
    const entry = { ms, fire, live: true };
    timers.push(entry);
    return () => { entry.live = false; };
  };
  const paused: number[] = [];
  await subscribeInbox(x.options(101, controller, x.fetcher([stream([initial]), stream([initial])]), {
    transports: { pi }, timer, pause: async ms => { paused.push(ms); },
    runner: x.counting(n => {
      if (n === 2) { controller.abort(); return; }
      void x.runner.run('message_create', { from: 'MP', to: 'MP-12', message: 'hi' }).then(() => {
        const live = timers.filter(e => e.live);
        assert.equal(live.length, 1);
        live[0]!.fire();
      });
    }) }));
  assert.equal(x.fetched.length, 2);
  assert.deepEqual(paused, [2000]);
  assert.ok(timers.length >= 2 && timers.every(e => e.ms === IDLE_MS));
  assert.deepEqual(sent, [['/s/p1.sock', [1]]]);
  assert.equal(x.events()[0]!.claimedBy, x.rowId('p1'));
});

test('the subscription ends when the watched process is gone', async t => {
  const x = subscription(t);
  x.alive(101);
  const controller = new AbortController();
  await subscribeInbox(x.options(101, controller, x.fetcher([signal => {
    rmSync(join(x.proc, '101'), { recursive: true, force: true });
    return stream([': keepalive\n\n'])(signal);
  }])));
  assert.equal(x.fetched.length, 1);
  assert.equal(controller.signal.aborted, false);
});

test('a failed process check keeps the subscription and only a confirmed end stops it', async t => {
  const x = subscription(t);
  const controller = new AbortController();
  const failed = () => new ProcessProbeError('ps timed out');
  const answers: (string | undefined | Error)[] = [failed(), '1', failed(), failed(), '1', undefined];
  const start = () => {
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const paused: number[] = [];
  await subscribeInbox(x.options(101, controller, x.fetcher([stream([': keepalive\n\n', ': keepalive\n\n', ': keepalive\n\n'])]),
    { device: { start, records: () => [] }, pause: async ms => { paused.push(ms); } }));
  assert.deepEqual(answers, []);
  assert.equal(x.fetched.length, 1);
  assert.deepEqual(paused, [2000]);
  assert.equal(controller.signal.aborted, false);
});

test('an error other than a failed process check ends the subscription at once', async t => {
  const x = subscription(t);
  const controller = new AbortController();
  const paused: number[] = [];
  const start = () => { throw new InputError('XDG_RUNTIME_DIR must be an absolute path; the live session registry is kept there'); };
  await subscribeInbox(x.options(101, controller, x.fetcher([]),
    { device: { start, records: () => [] }, pause: async ms => { paused.push(ms); controller.abort(); } }));
  assert.deepEqual(paused, []);
  assert.equal(x.fetched.length, 0);
});

test('failed process checks for longer than 60 s end the subscription and a successful check resets the count', async t => {
  const x = subscription(t);
  const controller = new AbortController();
  let time = 0;
  const failed = () => new ProcessProbeError('ps timed out');
  const answers: (string | Error)[] = ['1', failed(), failed(), '1', failed(), failed(), failed(), failed()];
  const start = () => {
    time += 30000;
    const answer = answers.shift();
    if (answer === undefined) throw new Error('unexpected check');
    if (answer instanceof Error) throw answer;
    return answer;
  };
  await subscribeInbox(x.options(101, controller, x.fetcher([stream(Array(10).fill(': keepalive\n\n'))]),
    { device: { start, records: () => [] }, now: () => time }));
  assert.deepEqual(answers, []);
  assert.equal(x.fetched.length, 1);
  assert.equal(controller.signal.aborted, false);
});

test('a change during a claim in flight causes exactly one more claim', async t => {
  const x = subscription(t);
  await x.register(101, 'p1', '/s/p1.sock');
  const controller = new AbortController();
  let claims = 0;
  const pi: EventTransport = async (_socket, events) => events.map(e => e.id);
  const frame = 'event: change\ndata: {"changeId":2}\n\n';
  await subscribeInbox(x.options(101, controller, x.fetcher([stream([initial + frame + frame])]),
    { transports: { pi }, runner: x.counting(n => { claims = n; if (n === 2) controller.abort(); }) }));
  assert.equal(claims, 2);
});

test('a refusing socket makes no more than one claim per retry period', async t => {
  const x = subscription(t);
  await x.register(101, 'p1', '/s/p1.sock');
  await x.runner.run('message_create', { from: 'MP', to: 'MP-12', message: 'hi' });
  const controller = new AbortController();
  let feed: ReadableStreamDefaultController<Uint8Array> | undefined;
  const change = (id: number) => feed!.enqueue(new TextEncoder().encode('event: change\ndata: {"changeId":' + id + '}\n\n'));
  let claims = 0;
  const paused: number[] = [];
  const pi: EventTransport = async () => { change(10 + claims); throw new Error('ECONNREFUSED'); };
  await subscribeInbox(x.options(101, controller, x.fetcher([signal => new Response(new ReadableStream<Uint8Array>({ start(c) {
    feed = c;
    c.enqueue(new TextEncoder().encode(initial));
    change(2);
    change(3);
    signal.addEventListener('abort', () => { try { c.close(); } catch { return; } });
  } }))]), { transports: { pi }, runner: x.counting(n => { claims = n; if (n >= 4) controller.abort(); }),
    pause: async ms => { paused.push(ms); if (paused.length === 2) controller.abort(); } }));
  assert.deepEqual(paused, [2000, 2000]);
  assert.equal(claims, 2);
  assert.deepEqual(x.events().map(e => [e.claimedBy, e.deliveredAt]), [[null, null]]);
});
