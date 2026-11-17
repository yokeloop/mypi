import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { AppCommand } from '../../src/app/commands.js';
import { deviceName, remoteBackend } from '../../src/app/backend.js';
import type { Backend } from '../../src/app/backend.js';
import { executeCommand } from '../../src/app/execute-command.js';
import { runOperation } from '../../src/app/operations.js';
import { fileFingerprint } from '../../src/app/file-fingerprints.js';
import { contextFiles } from '../../src/infrastructure/filesystem/context-files.js';
import { contextGit } from '../../src/infrastructure/git/context-git.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { sqliteJournalStore } from '../../src/modules/knowledge/public.js';
import { InputError } from '../../src/shared/errors.js';
import { state } from '../support/state.js';

function temporary(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-remote-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('server operations store device paths as sent and never resolve them on the server', t => {
  const { filename } = state(t);
  const server = { filename, trustedPaths: true };
  const added = runOperation(server, 'project_add', { identity: 'one/project', code: 'MP', checkoutPath: '/nonexistent/mypi-device/clone',
    repository: 'file:///nonexistent/one/project.git' }) as { project: { checkoutPath: string } };
  assert.equal(added.project.checkoutPath, '/nonexistent/mypi-device/clone');
  const resolved = runOperation(server, 'project_resolve', { path: '/nonexistent/mypi-device/clone/src' }) as { match: string; code: string };
  assert.deepEqual([resolved.match, resolved.code], ['project', 'MP']);
  assert.throws(() => runOperation(server, 'project_add', { identity: 'one/other', code: 'OT', checkoutPath: 'relative/clone',
    repository: 'file:///nonexistent/one/other.git' }), (error: unknown) => error instanceof InputError && error.message === 'Checkout path must be absolute');
  assert.throws(() => runOperation({ filename }, 'project_add', { identity: 'one/third', code: 'TH', checkoutPath: '/nonexistent/mypi-device/clone',
    repository: 'file:///nonexistent/one/third.git' }));
});

test('deviceName prefers the server file device over the hostname', () => {
  const url = 'http://127.0.0.1:8737', token = 'mypi_x';
  assert.equal(deviceName({ url, token, device: 'rpi-laptop' }), 'rpi-laptop');
  assert.equal(deviceName({ url, token }), hostname());
  assert.equal(deviceName(undefined), hostname());
});

test('an unreachable server is one clear error', async () => {
  await assert.rejects(remoteBackend({ url: 'http://127.0.0.1:1', token: 'mypi_x' }).run('project_list', {}),
    (error: unknown) => error instanceof Error && error.message === 'mypi server unreachable: http://127.0.0.1:1');
});

test('remote mode refuses other commands and touches no local state', async t => {
  const dir = temporary(t), root = join(dir, 'home'), filename = join(dir, 'state', 'state.sqlite3');
  mkdirSync(root);
  const calls: [string, unknown][] = [];
  const fixtures: Record<string, unknown> = {
    project_remove: { removed: { project: { id: 1, org: 'one', slug: 'project', code: 'MP', checkoutPath: null, repository: null } } },
    project_list: { projects: [{ id: 1, org: 'one', slug: 'project', code: 'MP', checkoutPath: null, repository: null }] },
  };
  const backend: Backend = { remote: true, device: 'laptop', run: async (name, input) => { calls.push([name, input]); return fixtures[name]; } };
  const refused: AppCommand[] = [{ name: 'db_init' }, { name: 'backup', destination: '/tmp/x' }, { name: 'api_token_list', file: '/tmp/x' },
    { name: 'sessions' }, { name: 'task_worktree', key: 'MP-1' }, { name: 'home_migrate_tasks' }, { name: 'journal_import' },
    { name: 'open_session', keys: ['MP'] }, { name: 'archive_capture', agent: 'claude' }];
  for (const command of refused) {
    await assert.rejects(executeCommand(command, filename, root, {}, {}, backend),
      (error: unknown) => error instanceof InputError && error.message === command.name + ' is not available in remote mode');
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(await executeCommand({ name: 'project_remove', identity: 'one/project', expectedCode: 'MP' }, filename, root, {}, {}, backend),
    { ...fixtures['project_remove'] as object, homeFolder: null });
  assert.deepEqual(calls, [['project_remove', { identity: 'one/project', expectedCode: 'MP' }]]);
  const flow = await executeCommand({ name: 'project_flow', project: 'MP' }, filename, root, {}, {}, backend) as { code: string; source: string; integration: string };
  assert.deepEqual([flow.code, flow.source, flow.integration], ['MP', 'default', 'main']);
  assert.deepEqual(calls.at(-1), ['project_list', {}]);
  assert.equal(existsSync(join(dir, 'state')), false);
});

test('the context guard reads registered fingerprints and the device compares them', async t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  contextGit(root).initialize();
  mkdirSync(join(root, 'notes'));
  writeFileSync(join(root, 'notes/old.md'), 'v1');
  const db = openDatabase(filename);
  try {
    sqliteJournalStore(db).append({ at: '2026-01-01T00:00:00.000Z', scope: { type: 'global' }, event_type: 'note', text: 'old', artifacts: ['notes/old.md'] });
    sqliteJournalStore(db).saveFingerprint(fileFingerprint(contextFiles(root), 'notes/old.md', '2026-01-01T00:00:00.000Z'));
  } finally { db.close(); }
  const guard = runOperation({ filename, trustedPaths: true }, 'context_guard', { paths: ['notes/old.md', 'notes/new.md'] }) as
    { frozen: string[]; fingerprints: { path: string }[] };
  assert.deepEqual(guard.frozen, ['notes/old.md']);
  assert.deepEqual(guard.fingerprints.map(f => f.path), ['notes/old.md']);
  const backend: Backend = { remote: true, device: 'laptop', run: async (name, input) => runOperation({ filename, trustedPaths: true }, name, input) };
  const unused = join(dir, 'unused', 'state.sqlite3');
  writeFileSync(join(root, 'notes/old.md'), 'v2');
  await assert.rejects(executeCommand({ name: 'context_commit', paths: ['notes/old.md'], message: 'm' }, unused, root, {}, {}, backend),
    (error: unknown) => error instanceof InputError && error.message === 'Registered file changed: notes/old.md');
  await assert.rejects(executeCommand({ name: 'context_restore', path: 'notes/old.md', revision: 'a'.repeat(40) }, unused, root, {}, {}, backend),
    (error: unknown) => error instanceof InputError && error.message === 'Registered file cannot be restored');
  assert.equal(existsSync(join(dir, 'unused')), false);
});
