import test from 'node:test';
import assert from 'node:assert/strict';
import { decideOpen, defaultAgent, launchArgs, parseOpenKey } from '../../src/app/open-session.js';
import type { RegistryRecord, SessionRow } from '../../src/modules/sessions/public.js';
import { InputError } from '../../src/shared/errors.js';

const refused = (fn: () => unknown, message: string) =>
  assert.throws(fn, (error: unknown) => error instanceof InputError && error.message === message);

test('parseOpenKey accepts project codes, task keys and identities and refuses global, REQ and malformed keys', () => {
  assert.deepEqual(parseOpenKey('MP'), { kind: 'project', code: 'MP' });
  assert.deepEqual(parseOpenKey('MP-12'), { kind: 'task', code: 'MP', number: 12 });
  assert.deepEqual(parseOpenKey('one/project'), { kind: 'identity', org: 'one', slug: 'project' });
  assert.deepEqual(parseOpenKey('one/project#3'), { kind: 'identity', org: 'one', slug: 'project', number: 3 });
  refused(() => parseOpenKey('global'), 'global is the main chat, started by hand; /open opens project (MP) and task (MP-12) sessions');
  for (const key of ['REQ', 'REQ-1']) refused(() => parseOpenKey(key), 'REQ tasks have no project; /open opens sessions of registered projects');
  for (const key of ['mp-12', 'MP-0', 'one/project#0', 'one/Project', '']) {
    refused(() => parseOpenKey(key), 'Invalid key: ' + key + '; use a project code (MP), CODE-N (MP-12), org/project or org/project#N');
  }
});

test('defaultAgent reads home/settings.json and falls back to claude', () => {
  assert.equal(defaultAgent(undefined), 'claude');
  assert.equal(defaultAgent('{}'), 'claude');
  assert.equal(defaultAgent('{"defaultAgent":"pi"}'), 'pi');
  assert.equal(defaultAgent('{"defaultAgent":"claude"}'), 'claude');
  for (const text of ['{', '[]']) refused(() => defaultAgent(text), 'home/settings.json is not valid JSON');
  refused(() => defaultAgent('{"defaultAgent":"codex"}'), 'defaultAgent in home/settings.json must be claude or pi');
});

const row = (agent: 'claude' | 'pi', nativeId: string): SessionRow =>
  ({ key: 'MP-12', scopeType: 'task', projectId: 1, taskId: 1, agent, nativeId, createdAt: '2026-10-28T00:00:00.000Z' });
const live = (agent: 'claude' | 'pi'): RegistryRecord => ({ key: 'MP-12', agent, nativeId: 'c1', pid: 101, start: '1', name: null,
  socket: null, permissionMode: null, registeredAt: '2026-10-28T00:00:00.000Z' });

test('decideOpen focuses a live session, resumes a saved row with its own agent and starts the chosen agent otherwise', () => {
  const record = live('claude');
  assert.deepEqual(decideOpen({ row: row('claude', 'c1'), live: record }, 'pi'), { action: 'focus', agent: 'claude', live: record });
  assert.deepEqual(decideOpen({ row: row('pi', 'p1'), live: undefined }, 'claude'), { action: 'resume', agent: 'pi', nativeId: 'p1' });
  assert.deepEqual(decideOpen({ row: undefined, live: undefined }, 'pi'), { action: 'start', agent: 'pi' });
});

test('launchArgs builds Claude and Pi arguments', () => {
  const accept = ['--settings', '{"crossSessionInbound":"accept"}'];
  assert.deepEqual(launchArgs({ action: 'start', agent: 'claude' }, 'MP-12', 'auto', 'u1'),
    ['--session-id', 'u1', '--name', 'MP-12', '--permission-mode', 'auto', ...accept]);
  assert.deepEqual(launchArgs({ action: 'start', agent: 'claude' }, 'MP-12', null, 'u1'), ['--session-id', 'u1', '--name', 'MP-12', ...accept]);
  assert.deepEqual(launchArgs({ action: 'resume', agent: 'claude', nativeId: 'c1' }, 'MP-12', 'auto', 'u1'),
    ['--resume', 'c1', '--permission-mode', 'auto', ...accept]);
  assert.deepEqual(launchArgs({ action: 'resume', agent: 'claude', nativeId: 'c1' }, 'MP-12', null, 'u1'), ['--resume', 'c1', ...accept]);
  assert.deepEqual(launchArgs({ action: 'start', agent: 'pi' }, 'MP', 'auto', 'u1'), ['--session-id', 'u1', '--name', 'MP']);
  assert.deepEqual(launchArgs({ action: 'resume', agent: 'pi', nativeId: 'p9' }, 'MP', 'auto', 'u1'), ['--session-id', 'p9']);
});
