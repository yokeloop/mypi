import type { AppCommand } from '../app/commands.js';
import { runSequence } from '../app/task-sequence.js';
import { InputError } from '../shared/errors.js';
import { PartialError } from '../shared/context.js';
import { ApiError, decodeCursor, encodeCursor, fields, jsonBody, limit, literalTrue, query, str } from './validate.js';
import * as shape from './shape.js';

export const API_VERSION = 1;
export type ApiToken = { name: string; permission: 'read' | 'write'; sender: string | null };
export type ApiRequest = { method: string; path: string; query: URLSearchParams;
  authorization: string | undefined; contentType: string | undefined; body: string };
export type ApiResult = { status: number; body: unknown; token?: string } | { status: 200; stream: 'changes'; token: string };
export type ApiInfo = { version: string; schemaVersion: number; changeId: number; instance: string };
export type ApiDeps = { token(value: string): ApiToken | undefined; execute(command: AppCommand): Promise<unknown>;
  info(): ApiInfo; runtime: string | undefined };

type Reply = { status?: number; data: unknown } | { stream: 'changes' };
type Route = { method: string; pattern: RegExp; permission: 'read' | 'write';
  run(match: RegExpExecArray, request: ApiRequest, token: ApiToken): Promise<Reply> };
type Page = { items: unknown[]; next: number | null };

const KEY = '([A-Z]+-[1-9][0-9]*)', CODE = '([A-Z]+)';

function invalid(message: string): ApiError {
  return new ApiError(400, 'invalid_request', message);
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], name: string): T | undefined {
  if (value !== undefined && !(allowed as readonly string[]).includes(value)) throw invalid('Invalid ' + name);
  return value as T | undefined;
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

function paging(q: Record<string, string>) {
  return { ...optional('q', q['q']), ...optional('before', q['cursor'] === undefined ? undefined : decodeCursor(q['cursor'])), limit: limit(q['limit']) };
}

function page(result: unknown, map: (item: never) => unknown) {
  const { items, next } = result as Page;
  return { items: items.map(item => map(item as never)), next: next === null ? null : encodeCursor(next) };
}

function body(request: ApiRequest, required: string[], optionalFields: string[]): Record<string, unknown> {
  const value = jsonBody(request.contentType, request.body);
  fields(value, required, optionalFields);
  return value;
}

function failure(error: unknown): { status: number; body: unknown } {
  if (error instanceof ApiError) return { status: error.status, body: { apiVersion: API_VERSION, error: { code: error.code, message: error.message } } };
  if (error instanceof InputError) return { status: 400, body: { apiVersion: API_VERSION, error: { code: 'invalid_request', message: error.message } } };
  if (error instanceof PartialError) return { status: 500, body: { apiVersion: API_VERSION,
    error: { code: 'partial', message: error.message, saved: error.saved, missing: error.missing } } };
  return { status: 500, body: { apiVersion: API_VERSION, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } } };
}

export function createApi(deps: ApiDeps): (request: ApiRequest) => Promise<ApiResult> {
  const routes: Route[] = [
    { method: 'GET', pattern: /^\/v1\/info$/, permission: 'read', run: async (_, r) => { query(r.query, []); return { data: deps.info() }; } },
    { method: 'GET', pattern: /^\/v1\/changes$/, permission: 'read', run: async (_, r) => { query(r.query, []); return { stream: 'changes' }; } },
    { method: 'GET', pattern: /^\/v1\/projects$/, permission: 'read', run: async (_, r) => {
      const q = query(r.query, ['org']);
      const result = await deps.execute({ name: 'project_list', ...optional('org', q['org']) }) as { projects: never[] };
      return { data: { items: result.projects.map(shape.project) } };
    } },
    { method: 'GET', pattern: new RegExp('^/v1/projects/' + CODE + '/flow$'), permission: 'read', run: async (m, r) => {
      query(r.query, []);
      return { data: shape.flow(await deps.execute({ name: 'project_flow', project: m[1]! }) as never) };
    } },
    { method: 'GET', pattern: /^\/v1\/tasks$/, permission: 'read', run: async (_, r) => {
      const q = query(r.query, ['project', 'status', 'q', 'cursor', 'limit']);
      const result = await deps.execute({ name: 'task_page', ...optional('project', q['project']), ...optional('status', q['status']), ...paging(q) });
      return { data: page(result, (c: { key: string }) => shape.task(c as never, c.key)) };
    } },
    { method: 'POST', pattern: /^\/v1\/tasks$/, permission: 'write', run: async (_, r) => {
      query(r.query, []);
      const b = body(r, ['project', 'title', 'status', 'slug', 'source'], []);
      const [project, title, status, slug, source] = ['project', 'title', 'status', 'slug', 'source'].map(key => str(b, key)!) as [string, string, string, string, string];
      const card = await deps.execute({ name: 'task_create', project, title, status, slug, source: { text: source } }) as { key: string };
      return { status: 201, data: shape.task(card as never, card.key) };
    } },
    { method: 'GET', pattern: new RegExp('^/v1/tasks/' + KEY + '$'), permission: 'read', run: async (m, r) => {
      query(r.query, []);
      return { data: shape.task(await deps.execute({ name: 'task_show', key: m[1]! }) as never, m[1]!) };
    } },
    { method: 'PATCH', pattern: new RegExp('^/v1/tasks/' + KEY + '$'), permission: 'write', run: async (m, r, token) => {
      query(r.query, []);
      const key = m[1]!, b = body(r, [], ['status', 'title', 'reason', 'progress', 'touch']);
      const status = str(b, 'status'), title = str(b, 'title'), reason = str(b, 'reason'), progress = str(b, 'progress'), touch = literalTrue(b, 'touch');
      const change = status !== undefined || title !== undefined;
      if (!change && progress === undefined && touch === undefined) throw invalid('PATCH needs status, title, progress or touch');
      if (change && reason === undefined) throw invalid('reason is required with status or title');
      if (!change && reason !== undefined) throw invalid('reason is allowed only with status or title');
      if (touch !== undefined && (change || progress !== undefined)) throw invalid('touch is allowed only alone');
      const commands: AppCommand[] = [];
      if (status !== undefined) commands.push({ name: 'task_status', key, status, reason: reason!, envScope: token.sender! });
      if (title !== undefined) commands.push({ name: 'task_title', key, title, reason: reason! });
      if (progress !== undefined) commands.push({ name: 'task_progress', key, text: progress, artifacts: [] });
      if (touch) commands.push({ name: 'task_touch', key });
      await runSequence(commands, deps.execute);
      return { data: shape.task(await deps.execute({ name: 'task_show', key }) as never, key) };
    } },
    { method: 'GET', pattern: /^\/v1\/events$/, permission: 'read', run: async (_, r) => {
      const q = query(r.query, ['to', 'from', 'kind', 'delivered', 'q', 'cursor', 'limit']);
      const delivered = oneOf(q['delivered'], ['true', 'false'], 'delivered');
      const result = await deps.execute({ name: 'event_list', ...optional('to', q['to']), ...optional('from', q['from']),
        ...optional('kind', oneOf(q['kind'], ['turn_end', 'waiting', 'milestone', 'message'] as const, 'kind')),
        ...optional('delivered', delivered === undefined ? undefined : delivered === 'true'), ...paging(q) });
      return { data: page(result, shape.event) };
    } },
    { method: 'GET', pattern: /^\/v1\/journal$/, permission: 'read', run: async (_, r) => {
      const q = query(r.query, ['scope', 'from', 'to', 'type', 'q', 'cursor', 'limit']);
      const result = await deps.execute({ name: 'journal_page', scope: q['scope'] === undefined ? 'all' : { reference: q['scope'] },
        ...optional('from', q['from']), ...optional('to', q['to']),
        ...optional('eventType', oneOf(q['type'], ['note', 'task_created', 'status_changed'] as const, 'type')), ...paging(q) });
      return { data: page(result, shape.journal) };
    } },
    { method: 'POST', pattern: /^\/v1\/journal$/, permission: 'write', run: async (_, r) => {
      query(r.query, []);
      const b = body(r, ['scope', 'text'], []);
      const result = await deps.execute({ name: 'journal_add', scope: { reference: str(b, 'scope')! }, text: str(b, 'text')! }) as { saved: string };
      return { status: 201, data: { id: Number(result.saved) } };
    } },
    { method: 'POST', pattern: /^\/v1\/messages$/, permission: 'write', run: async (_, r, token) => {
      query(r.query, []);
      const b = body(r, ['to', 'text'], []);
      const result = await deps.execute({ name: 'message_send', key: str(b, 'to')!, body: { text: str(b, 'text')! }, envScope: token.sender!,
        ...(deps.runtime ? { runtime: deps.runtime } : {}) }) as { message: number; delivered: boolean };
      return { status: 201, data: { id: result.message, delivered: result.delivered } };
    } },
    { method: 'GET', pattern: /^\/v1\/sessions$/, permission: 'read', run: async (_, r) => {
      query(r.query, []);
      const result = await deps.execute({ name: 'sessions', ...(deps.runtime ? { runtime: deps.runtime } : {}) }) as { tree: never };
      return { data: shape.session(result.tree) };
    } },
    { method: 'GET', pattern: /^\/v1\/context$/, permission: 'read', run: async (_, r) => {
      const q = query(r.query, ['path', 'revision']);
      if (q['path'] === undefined) throw invalid('Missing query parameter: path');
      if (q['revision'] !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(q['revision'])) throw invalid('Invalid revision');
      return { data: shape.context(await deps.execute({ name: 'context_read', path: q['path'], ...optional('revision', q['revision']) }) as never) };
    } },
  ];
  return async request => {
    const presented = /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.authorization ?? '')?.[1];
    const token = presented === undefined ? undefined : deps.token(presented);
    if (token === undefined) return failure(new ApiError(401, 'unauthorized', 'Missing or unknown bearer token'));
    try {
      const matching = routes.map(route => ({ route, match: route.pattern.exec(request.path) })).filter(x => x.match !== null);
      if (matching.length === 0) throw new ApiError(404, 'not_found', 'Unknown path: ' + request.path);
      const found = matching.find(x => x.route.method === request.method);
      if (found === undefined) throw new ApiError(405, 'method_not_allowed', 'Method not allowed: ' + request.method);
      if (found.route.permission === 'write' && token.permission !== 'write') throw new ApiError(403, 'forbidden', 'This token is read-only');
      const reply = await found.route.run(found.match!, request, token);
      if ('stream' in reply) return { status: 200, stream: 'changes', token: token.name };
      return { status: reply.status ?? 200, body: { apiVersion: API_VERSION, data: reply.data }, token: token.name };
    } catch (error) {
      return { ...failure(error), token: token.name };
    }
  };
}
