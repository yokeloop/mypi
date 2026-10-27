import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeState, createApp } from '../../src/app/create-app.js';
import { databasePath, externalDatabasePath } from '../../src/infrastructure/filesystem/paths.js';
import { parseCommand } from '../../src/cli/command.js';
import { state } from '../support/state.js';

test('XDG/default state paths stay outside engine and context, including symlink aliases', t => {
  const { dir } = state(t);
  const engine = join(dir, 'engine');
  const home = join(dir, 'personal');
  mkdirSync(engine);
  assert.equal(databasePath({}, home, engine), join(home, '.local/state/mypi/state.sqlite3'));
  assert.equal(databasePath({ XDG_STATE_HOME: join(dir, 'state') }, home, engine), join(dir, 'state/mypi/state.sqlite3'));
  assert.throws(() => databasePath({ XDG_STATE_HOME: 'relative' }, home, engine), /absolute/);
  assert.throws(() => databasePath({ XDG_STATE_HOME: join(engine, 'home') }, home, engine), /outside/);
  const alias = join(dir, 'alias');
  symlinkSync(engine, alias);
  assert.throws(() => databasePath({ XDG_STATE_HOME: alias }, home, engine), /outside/);
  const dangling = join(dir, 'dangling.sqlite3');
  symlinkSync(join(engine, 'not-created.sqlite3'), dangling);
  assert.throws(() => externalDatabasePath(dangling, engine), /symlink|outside/i);
  assert.equal(externalDatabasePath(join(dir, 'new.sqlite3'), engine), join(dir, 'new.sqlite3'));
  const forbidden = fileURLToPath(new URL('../../../forbidden.sqlite3', import.meta.url));
  assert.throws(() => initializeState(forbidden), /outside/);
  assert.throws(() => createApp(forbidden, true), /outside/);
});

test('CLI parsing is strict without invoking a process for the validation matrix', () => {
  assert.deepEqual(parseCommand(['project', 'add', 'one/project', '--code', 'MP']), {
    type: 'add', identity: 'one/project', code: 'MP',
  });
  assert.deepEqual(parseCommand(['project', 'list', '--org', 'one']), { type: 'list', org: 'one' });
  assert.deepEqual(parseCommand(['db', 'init']), { type: 'initialize' });
  assert.deepEqual(parseCommand(['--help']), { type: 'help' });
  const parsed = parseCommand(['task', 'create', 'exact source', '--project', 'one/project', '--title', 'Title', '--slug', 'slug', '--status', 'planning']);
  assert.equal(parsed.type, 'workspace');
  if (parsed.type === 'workspace') {
    assert.equal(parsed.name, 'task create'); assert.deepEqual(parsed.args, ['exact source']);
    assert.deepEqual({ ...parsed.options }, { project: 'one/project', title: 'Title', slug: 'slug', status: 'planning' });
  }
  for (const args of [
    ['bootstrap'], ['capture', '--file', 'source'], ['warmup', '-s', 'one/project'],
    ['note', 'title', 'text'], ['error', 'one/project', 'error'],
    ['memory', 'show'], ['memory', 'add', 'fact'], ['memory', 'remove', '1', '--expected-revision', 'a'.repeat(64)], ['project', 'resolve', '/tmp'],
    ['journal', 'add', 'outcome'], ['journal', 'read', '--all'],
    ['task', 'create', 'source'], ['task', 'list'], ['task', 'show', 'REQ-1'],
    ['task', 'title', 'REQ-1', 'title'], ['task', 'status', 'REQ-1', 'new'],
    ['task', 'progress', 'REQ-1', 'progress'], ['task', 'touch', 'REQ-1'],
    ['status', 'list'], ['status', 'add', 'custom'], ['status', 'rename', 'a', 'b'],
    ['status', 'terminal', 'a', 'true'], ['status', 'remove', 'a'],
    ['context', 'read', 'MEMORY.md'], ['context', 'commit', 'MEMORY.md'],
    ['context', 'restore', 'MEMORY.md'], ['backup', '/tmp/backup'], ['restore', '/tmp/backup'],
    ['backup', '--publish', '--dry-run', '--file', 'chosen.md'], ['restore', '--repository', '/tmp/clone', '--commit', 'a'.repeat(40)],
  ]) assert.equal(parseCommand(args).type, 'workspace');
  for (const args of [
    ['project', 'add', 'one/project'],
    ['project', 'add', 'one/project', 'extra', '--code', 'MP'],
    ['project', 'list', 'extra'],
    ['project', 'list', '--unknown'],
    ['db', 'init', 'extra'],
    ['unknown'],
    ['import', 'legacy', '/tmp/archive', '--codes', '/tmp/codes.json'],
  ]) assert.throws(() => parseCommand(args));
});
