import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { piTurnSession } from '../support/pi-turn-sessions.js';
import { turnFindings, turnReason } from '../../src/app/turn-check.js';
import { createApp } from '../../src/app/create-app.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { localSessionRunner } from '../../src/app/session-operations.js';
import { turnCheck } from '../../src/app/events.js';
import { piTurnActions } from '../../src/infrastructure/transcript/pi-turn.js';

function turn(t: TestContext) {
  const { dir, filename } = state(t);
  const home = join(dir, 'home'), tmp = join(dir, 'tmp');
  mkdirSync(join(home, 'projects/one/project/tasks/MP-12-scoped-warmup'), { recursive: true });
  mkdirSync(tmp);
  const session = (name: string) => {
    const path = join(dir, name + '.jsonl');
    writeFileSync(path, piTurnSession(name, home, tmp));
    return path;
  };
  const findings = (name: string, since?: string) => turnFindings(piTurnActions(session(name), since)!, { home, tmp: [tmp],
    read: path => { try { return readFileSync(path, 'utf8'); } catch { return undefined; } },
    isDirectory: path => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true });
  return { dir, filename, home, tmp, session, findings };
}

test('pi turn actions are the tool calls after the since entry, in order, with the session cwd', t => {
  const { dir, home, tmp, session, findings } = turn(t);
  const path = session('write-bash');
  const after = [
    { kind: 'write', path: tmp + '/notes.md', cwd: '/work', content: '# Notes\n' },
    { kind: 'bash', command: 'echo x > ' + tmp + '/a.md', cwd: '/work' },
    { kind: 'write', path: 'notes/rel.md', cwd: '/work' }];
  assert.deepEqual(piTurnActions(path, 'e2'), after);
  assert.deepEqual(piTurnActions(path), [{ kind: 'write', path: tmp + '/old.md', cwd: '/work', content: '# Old\n' }, ...after]);
  assert.equal(piTurnActions(path, 'missing'), undefined);
  assert.equal(piTurnActions(join(dir, 'missing.jsonl')), undefined);
  const found = findings('write-bash', 'e2');
  assert.deepEqual(found!.documents.map(d => d.path), [tmp + '/notes.md', tmp + '/a.md']);
  const folder = join(home, 'projects/one/project/tasks/MP-12-scoped-warmup');
  const reason = turnReason(found!, { path: folder, label: 'the task folder MP-12' }, home);
  for (const part of [tmp + '/notes.md', tmp + '/a.md', 'cp ', 'context_write', 'git -C ']) assert.ok(reason.includes(part), part);
});

test('pi codemode calls unfold from nestedCalls, and a write without arguments or without nestedCalls by a tmp literal in the code', t => {
  const { tmp, session } = turn(t);
  assert.deepEqual(piTurnActions(session('codemode')), [
    { kind: 'write', path: tmp + '/nested.md', cwd: '/work', content: '# Nested\n' },
    { kind: 'write', path: '/tmp/mypi-big-report.md', cwd: '/work' },
    { kind: 'publish', content: '# Plan\n', title: 'Plan' },
    { kind: 'context_write', paths: ['projects/one/project/tasks/MP-12-scoped-warmup/plan.md'] },
    { kind: 'write', path: '/tmp/mypi-old.html', cwd: '/work' }]);
  assert.deepEqual(piTurnActions(session('truncated')), [
    { kind: 'bash', command: 'ls', cwd: '/work' },
    { kind: 'write', path: '/tmp/mypi-late.md', cwd: '/work' }]);
});

test('a pi turn that copies its document into the task folder is saved', t => {
  const { findings } = turn(t);
  assert.equal(findings('saved-source'), null);
});

test('a link in INDEX.md alone does not save the pi document', t => {
  const { home, tmp, findings } = turn(t);
  writeFileSync(join(home, 'projects/one/project/INDEX.md'), '- notes ' + tmp + '/notes.md\n');
  assert.deepEqual(findings('index-only')!.documents, [{ path: tmp + '/notes.md', uploaded: false }]);
});

test('a pi turn keeps the calls before and after a parent message mid-turn, a custom message gives no action', t => {
  const { home, tmp, session, findings } = turn(t);
  const folder = home + '/projects/one/project/tasks/MP-12-scoped-warmup/';
  assert.deepEqual(piTurnActions(session('parent'), 'e2'), [
    { kind: 'write', path: tmp + '/a.md', cwd: '/work', content: '# A\n' },
    { kind: 'write', path: tmp + '/b.md', cwd: '/work', content: '# B\n' },
    { kind: 'bash', command: 'cp ' + tmp + '/a.md ' + tmp + '/b.md ' + folder, cwd: '/work' }]);
  assert.equal(findings('parent', 'e2'), null);
});

test('the pi turn check gives the reason with the task folder of its key, nothing for a saved turn, and fails with its reader', async t => {
  const { filename, home, tmp, session } = turn(t);
  const app = createApp(filename, false);
  try { app.projects.add('one/project', 'MP', undefined, 'file:///nonexistent/one/project.git'); } finally { app.close(); }
  const db = openDatabase(filename);
  try {
    db.prepare(`INSERT INTO tasks(project_id, number, title, status_id, context_dir, worktree_path, created_at, updated_at)
      VALUES ((SELECT id FROM projects WHERE code = 'MP'), 12, 'scoped-warmup', (SELECT id FROM task_statuses WHERE code = 'new'),
      'projects/one/project/tasks/MP-12-scoped-warmup', NULL, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`).run();
  } finally { db.close(); }
  const runner = localSessionRunner(filename);
  const check = (name: string) => ({ name: 'turn_check' as const, agent: 'pi' as const, file: session(name), key: 'MP-12', since: 'e1' });
  const { reason } = await turnCheck(runner, check('write-bash'), home);
  assert.ok(reason!.includes(join(home, 'projects/one/project/tasks/MP-12-scoped-warmup') + ' (the task folder MP-12)'));
  assert.ok(reason!.includes(tmp + '/notes.md'));
  assert.deepEqual(await turnCheck(runner, check('saved-source'), home), {});
  await assert.rejects(turnCheck(runner, check('saved-source'), home, () => { throw new Error('broken'); }), /broken/);
});
