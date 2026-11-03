import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppCommand } from '../../src/app/commands.js';
import { createApi } from '../../src/http/api.js';
import type { ApiRequest } from '../../src/http/api.js';
import { decodeCursor, encodeCursor, requestUrl } from '../../src/http/validate.js';
import { InputError } from '../../src/shared/errors.js';
import { PartialError } from '../../src/shared/context.js';

const card = { id: 3, projectId: 1, number: 1, title: 'Задача', statusId: 2, status: 'new', isTerminal: false,
  contextDir: 'projects/one/project/tasks/MP-1-task', worktreePath: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z' };
const taskShape = { key: 'MP-1', project: 'MP', number: 1, title: 'Задача', status: 'new', isTerminal: false,
  contextDir: 'projects/one/project/tasks/MP-1-task', worktreePath: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z' };
const info = { version: '0.10.0', schemaVersion: 12, changeId: 4, instance: 'instance' };

function harness(outcomes: Record<string, (command: AppCommand) => unknown> = {}) {
  const commands: AppCommand[] = [];
  const fixtures: Record<string, (command: AppCommand) => unknown> = {
    task_page: () => ({ items: [{ ...card, key: 'MP-1' }], next: 3 }),
    task_show: () => card,
    task_create: () => ({ ...card, key: 'MP-1' }),
    task_status: () => card,
    event_list: () => ({ items: [{ id: 9, fromKey: 'global', toKey: 'MP', kind: 'message', message: 'go', createdAt: 'a', deliveredAt: null }], next: null }),
    journal_page: () => ({ items: [{ id: 5, entry: { at: 'b', scope: { type: 'project', key: 'MP' }, event_type: 'note', text: 't', artifacts: ['x.md', { path: 'y.md', commit: 'c' }] } }], next: null }),
    message_send: () => ({ message: 7, delivered: false }),
    journal_add: () => ({ saved: '12' }),
    sessions: () => ({ tree: { key: 'global', session: null, children: [] } }),
    ...outcomes,
  };
  const api = createApi({
    token: value => value === 'r-token' ? { name: 'reader', permission: 'read', sender: null }
      : value === 'w-token' ? { name: 'writer', permission: 'write', sender: 'global' } : undefined,
    execute: async command => { commands.push(command); const fixture = fixtures[command.name]; return fixture === undefined ? {} : fixture(command); },
    info: () => info, runtime: '/run/u',
  });
  const call = (method: string, url: string, options: { token?: string; authorization?: string; body?: unknown; contentType?: string } = {}) => {
    const parsed = new URL(url, 'http://localhost');
    const request: ApiRequest = { method, path: parsed.pathname, query: parsed.searchParams,
      authorization: options.authorization ?? (options.token === undefined ? undefined : 'Bearer ' + options.token),
      contentType: options.contentType ?? (options.body === undefined ? undefined : 'application/json'),
      body: options.body === undefined ? '' : typeof options.body === 'string' ? options.body : JSON.stringify(options.body) };
    return api(request) as Promise<{ status: number; body: { apiVersion: number; data?: unknown; error?: { code: string; message: string; saved?: string[]; missing?: string[] } }; token?: string; stream?: string }>;
  };
  return { commands, call };
}

test('requests without a known bearer token get 401 before routing and run nothing', async () => {
  const { commands, call } = harness();
  for (const [path, authorization] of [['/v1/info', undefined], ['/v1/info', 'Basic x'], ['/v1/info', 'Bearer unknown'], ['/v1/nope', undefined], ['/v1/nope', 'Bearer unknown']] as const) {
    const result = await call('GET', path, authorization === undefined ? {} : { authorization });
    assert.equal(result.status, 401);
    assert.equal(result.body.error?.code, 'unauthorized');
    assert.equal(result.token, undefined);
  }
  assert.equal(commands.length, 0);
});

test('unknown paths get 404, wrong methods 405 and read tokens 403 on writes, all before any command runs', async () => {
  const { commands, call } = harness();
  const expect = async (status: number, code: string, method: string, path: string, token = 'r-token') => {
    const result = await call(method, path, { token, body: {} });
    assert.equal(result.status, status);
    assert.equal(result.body.error?.code, code);
    assert.equal(result.token, token === 'r-token' ? 'reader' : 'writer');
  };
  await expect(404, 'not_found', 'GET', '/v1/nope');
  await expect(405, 'method_not_allowed', 'DELETE', '/v1/tasks');
  await expect(404, 'not_found', 'GET', '/v1/tasks/mp-1');
  await expect(403, 'forbidden', 'POST', '/v1/tasks');
  await expect(403, 'forbidden', 'PATCH', '/v1/tasks/MP-1');
  await expect(403, 'forbidden', 'POST', '/v1/messages');
  assert.equal(commands.length, 0);
});

test('query parameters translate to AppCommands with defaults and invalid ones are refused', async () => {
  const { commands, call } = harness();
  const last = () => commands.at(-1);
  assert.equal((await call('GET', '/v1/tasks?project=one/project&status=new&q=x&limit=2&cursor=' + encodeCursor(7), { token: 'r-token' })).status, 200);
  assert.deepEqual(last(), { name: 'task_page', project: 'one/project', status: 'new', q: 'x', before: 7, limit: 2 });
  await call('GET', '/v1/tasks', { token: 'r-token' });
  assert.deepEqual(last(), { name: 'task_page', limit: 50 });
  const count = commands.length;
  for (const url of ['/v1/tasks?limit=0', '/v1/tasks?limit=201', '/v1/tasks?limit=a', '/v1/tasks?cursor=zzz', '/v1/tasks?foo=1',
    '/v1/tasks?q=a&q=b', '/v1/events?delivered=maybe', '/v1/events?kind=other', '/v1/journal?type=other', '/v1/context?path=a.md&revision=abc']) {
    const result = await call('GET', url, { token: 'r-token' });
    assert.equal(result.status, 400, url);
    assert.equal(result.body.error?.code, 'invalid_request', url);
  }
  assert.equal(commands.length, count);
  await call('GET', '/v1/journal', { token: 'r-token' });
  assert.deepEqual(last(), { name: 'journal_page', scope: 'all', limit: 50 });
  await call('GET', '/v1/journal?scope=MP', { token: 'r-token' });
  assert.deepEqual(last(), { name: 'journal_page', scope: { reference: 'MP' }, limit: 50 });
  await call('GET', '/v1/events?to=MP&delivered=false', { token: 'r-token' });
  assert.deepEqual(last(), { name: 'event_list', to: 'MP', delivered: false, limit: 50 });
  await call('GET', '/v1/sessions', { token: 'r-token' });
  assert.deepEqual(last(), { name: 'sessions', runtime: '/run/u' });
});

test('responses use the stable envelope and map fields explicitly', async () => {
  const { call } = harness();
  const tasks = await call('GET', '/v1/tasks', { token: 'r-token' });
  assert.deepEqual(tasks.body, { apiVersion: 1, data: { items: [taskShape], next: encodeCursor(3) } });
  assert.equal(decodeCursor((tasks.body.data as { next: string }).next), 3);
  assert.deepEqual((await call('GET', '/v1/tasks/MP-1', { token: 'r-token' })).body, { apiVersion: 1, data: taskShape });
  assert.deepEqual((await call('GET', '/v1/events', { token: 'r-token' })).body, { apiVersion: 1, data: { items: [
    { id: 9, from: 'global', to: 'MP', kind: 'message', text: 'go', createdAt: 'a', deliveredAt: null }], next: null } });
  assert.deepEqual((await call('GET', '/v1/journal', { token: 'r-token' })).body, { apiVersion: 1, data: { items: [
    { id: 5, at: 'b', scope: { type: 'project', key: 'MP' }, type: 'note', text: 't',
      artifacts: [{ path: 'x.md', commit: null }, { path: 'y.md', commit: 'c' }] }], next: null } });
  assert.deepEqual((await call('GET', '/v1/info', { token: 'r-token' })).body, { apiVersion: 1, data: info });
});

test("writes translate with the token's sender, strict JSON bodies and the task_update rules", async () => {
  const { commands, call } = harness();
  const message = await call('POST', '/v1/messages', { token: 'w-token', body: { to: 'MP', text: 'go' } });
  assert.equal(message.status, 201);
  assert.deepEqual(message.body, { apiVersion: 1, data: { id: 7, delivered: false } });
  assert.deepEqual(commands.at(-1), { name: 'message_send', key: 'MP', body: { text: 'go' }, envScope: 'global', runtime: '/run/u' });
  commands.length = 0;
  const patched = await call('PATCH', '/v1/tasks/MP-1', { token: 'w-token', body: { status: 'done', reason: 'ok' } });
  assert.equal(patched.status, 200);
  assert.deepEqual(commands, [{ name: 'task_status', key: 'MP-1', status: 'done', reason: 'ok', envScope: 'global' }, { name: 'task_show', key: 'MP-1' }]);
  commands.length = 0;
  for (const body of [{ reason: 'x' }, { touch: true, progress: 'p' }, { artifacts: [] }, { touch: false }]) {
    assert.equal((await call('PATCH', '/v1/tasks/MP-1', { token: 'w-token', body })).status, 400);
  }
  assert.equal((await call('POST', '/v1/tasks', { token: 'w-token', body: { project: 'MP', title: 't', status: 'new', slug: 's', source: { file: '/etc/passwd' } } })).status, 400);
  assert.equal((await call('POST', '/v1/tasks', { token: 'w-token', body: { to: 'MP', text: 'go' }, contentType: 'text/plain' })).status, 415);
  const broken = await call('POST', '/v1/messages', { token: 'w-token', body: '{' });
  assert.deepEqual([broken.status, broken.body.error?.code], [400, 'invalid_json']);
  assert.equal((await call('POST', '/v1/messages', { token: 'w-token', body: '[]' })).status, 400);
  assert.equal(commands.length, 0);
  const created = await call('POST', '/v1/tasks', { token: 'w-token', body: { project: 'MP', title: 't', status: 'new', slug: 's', source: 'text' } });
  assert.deepEqual([created.status, created.body.data], [201, taskShape]);
  assert.deepEqual(commands.at(-1), { name: 'task_create', project: 'MP', title: 't', status: 'new', slug: 's', source: { text: 'text' } });
  const note = await call('POST', '/v1/journal', { token: 'w-token', body: { scope: 'MP', text: 'n' } });
  assert.deepEqual([note.status, note.body.data], [201, { id: 12 }]);
  assert.deepEqual(commands.at(-1), { name: 'journal_add', scope: { reference: 'MP' }, text: 'n' });
});

test('errors map InputError to 400, PartialError to 500 partial with saved and missing, others to 500 internal', async () => {
  const { call } = harness({
    task_show: () => { throw new InputError('Unknown task key'); },
    task_page: () => { throw new Error('Run db init with a compatible application before use'); },
    task_status: () => card,
    task_title: () => { throw new Error('busy'); },
  });
  assert.deepEqual((await call('GET', '/v1/tasks/MP-1', { token: 'r-token' })).body,
    { apiVersion: 1, error: { code: 'invalid_request', message: 'Unknown task key' } });
  const internal = await call('GET', '/v1/tasks', { token: 'r-token' });
  assert.deepEqual([internal.status, internal.body], [500, { apiVersion: 1, error: { code: 'internal', message: 'Run db init with a compatible application before use' } }]);
  const partial = await call('PATCH', '/v1/tasks/MP-1', { token: 'w-token', body: { status: 'done', title: 'new', reason: 'r' } });
  assert.equal(partial.status, 500);
  assert.equal(partial.body.error?.code, 'partial');
  assert.deepEqual([partial.body.error?.saved, partial.body.error?.missing], [['status'], ['title']]);
  assert.ok(new PartialError('x', [], [], []) instanceof Error);
});

test('GET /v1/changes returns the stream result only for a known token', async () => {
  const { commands, call } = harness();
  assert.deepEqual(await call('GET', '/v1/changes', { token: 'r-token' }), { status: 200, stream: 'changes', token: 'reader' });
  assert.equal((await call('GET', '/v1/changes')).status, 401);
  assert.equal(commands.length, 0);
});

test('a request target that WHATWG URL rejects parses to undefined instead of throwing', () => {
  for (const target of ['http://[/', 'http://a b/']) assert.equal(requestUrl(target), undefined);
  const url = requestUrl('/v1/tasks?limit=2');
  assert.deepEqual([url?.pathname, url?.searchParams.get('limit')], ['/v1/tasks', '2']);
  assert.equal(requestUrl(undefined)?.pathname, '/');
});
