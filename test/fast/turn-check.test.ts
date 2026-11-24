import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { turnTranscript } from '../support/turn-transcripts.js';
import { createApp } from '../../src/app/create-app.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { localSessionRunner } from '../../src/app/session-operations.js';
import { REASON_MAX, saveFolder, turnFindings, turnReason } from '../../src/app/turn-check.js';
import type { TurnFindings } from '../../src/app/turn-check.js';
import { startedByParent } from '../../src/modules/events/public.js';
import { claudeTurnPrompt } from '../../src/infrastructure/transcript/claude-transcript.js';
import { claudeTurnActions } from '../../src/infrastructure/transcript/claude-turn.js';

function turn(t: TestContext) {
  const { dir, filename } = state(t);
  const home = join(dir, 'home'), tmp = join(dir, 'tmp');
  mkdirSync(join(home, 'projects/one/project/tasks/MP-12-scoped-warmup'), { recursive: true });
  mkdirSync(tmp);
  const transcript = (name: string) => {
    const path = join(dir, name);
    writeFileSync(path, turnTranscript(name.replace(/\.jsonl$/, ''), home, tmp));
    return path;
  };
  const findings = (name: string) => turnFindings(claudeTurnActions(transcript(name))!, { home, tmp: [tmp], cwd: '/work',
    read: path => { try { return readFileSync(path, 'utf8'); } catch { return undefined; } },
    isDirectory: path => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true });
  return { dir, filename, home, tmp, transcript, findings };
}

test('claude turn actions are the tool calls after the turn prompt, in order, with the record cwd', t => {
  const { dir, home, tmp, transcript } = turn(t);
  const path = transcript('parent-block.jsonl');
  assert.equal(startedByParent(claudeTurnPrompt(path)), true);
  assert.deepEqual(claudeTurnActions(path), [
    { kind: 'write', path: tmp + '/notes.md', cwd: '/work', content: '# Notes\n' },
    { kind: 'bash', command: 'cp ' + tmp + '/notes.md ' + home + '/projects/one/project/tasks/MP-12-scoped-warmup/', cwd: '/other' }]);
  assert.equal(claudeTurnActions(join(dir, 'missing.jsonl')), undefined);
});

test('a turn that writes a document into tmp is found, with a reason naming the path, the folder and the steps', t => {
  const { home, tmp, findings } = turn(t);
  const found = findings('write-tmp.jsonl');
  assert.deepEqual(found, { documents: [{ path: tmp + '/notes.md', uploaded: false }], publications: [], maps: [] });
  const folder = join(home, 'projects/one/project/tasks/MP-12-scoped-warmup');
  const reason = turnReason(found!, { path: folder, label: 'the task folder MP-12' }, home);
  assert.match(reason, /^mypi: this turn made files that home does not keep\./);
  for (const part of ['- ' + tmp + '/notes.md (written)', 'Save each source to ' + folder + ' (the task folder MP-12):',
    '1. cp ' + tmp + '/notes.md ' + folder + '/', '2. context_write {"paths":["projects/one/project/tasks/MP-12-scoped-warmup/notes.md"],"message":"<what the files are>"}',
    '3. git -C ' + home + ' push', 'This check runs once per turn: if a file is disposable, say so and finish.']) {
    assert.ok(reason.includes(part), part);
  }
  assert.ok(!reason.includes('For a derive publish'));
  assert.ok(!reason.includes('Maps to fix'));
});

test('bash writes into tmp by redirect, tee and heredoc are documents, heredoc bodies and fd redirects are not', t => {
  const { tmp, findings } = turn(t);
  assert.deepEqual(findings('bash-tmp.jsonl')!.documents.map(d => d.path), [tmp + '/a.md', tmp + '/b.md', tmp + '/c.html', tmp + '/d.md', tmp + '/e.md']);
});

test('a turn without turnOrigin starts after the last Stop hook summary, so an earlier turn is not checked again', t => {
  const { findings, transcript } = turn(t);
  assert.deepEqual(claudeTurnActions(transcript('teammate-after-stop.jsonl')), []);
  assert.equal(claudeTurnPrompt(transcript('teammate-after-stop.jsonl'))?.origin, 'human');
  assert.equal(findings('teammate-after-stop.jsonl'), null);
});

test('a document copied into home or written there with the same content is saved', t => {
  const { findings } = turn(t);
  assert.equal(findings('saved-source.jsonl'), null);
});

test('a link in INDEX.md alone does not save the document', t => {
  const { tmp, findings } = turn(t);
  assert.deepEqual(findings('index-only.jsonl')!.documents, [{ path: tmp + '/notes.md', uploaded: false }]);
});

test('a derive publish without its content in home and a curl upload from tmp are found, home and variable paths pass', t => {
  const { tmp, findings } = turn(t);
  const found = findings('publish.jsonl');
  assert.deepEqual(found, { documents: [{ path: tmp + '/x.md', uploaded: true }], publications: [{ title: 'Plan A' }], maps: [] });
  const reason = turnReason({ ...found!, publications: [...found!.publications, {}] }, { path: '/home', label: 'the global level' }, '/home');
  for (const part of ['- ' + tmp + '/x.md (uploaded with curl)', '- derive publish "Plan A" (its content is not written under home)',
    '- derive publish (untitled) (its content is not written under home)', 'For a derive publish, first write its content to a file in that folder.']) {
    assert.ok(reason.includes(part), part);
  }
});

test('an edited map over 1500 characters or with a bare derive URL is found', t => {
  const { home, findings } = turn(t);
  const line = '- research https://draft.example/artifacts/abc';
  writeFileSync(join(home, 'projects/one/project/INDEX.md'), line + '\n' + 'x'.repeat(1600 - line.length - 1));
  const pointer = '- research tasks/MP-12-x/research.md https://draft.example/artifacts/abc';
  writeFileSync(join(home, 'projects/one/INDEX.md'), pointer + '\n' + 'x'.repeat(1400 - pointer.length - 1));
  const found = findings('map.jsonl');
  assert.deepEqual(found, { documents: [], publications: [], maps: [{ path: 'projects/one/project/INDEX.md', length: 1600, bare: [line] }] });
  const reason = turnReason(found!, { path: home, label: 'the global level' }, home);
  assert.ok(reason.includes('- projects/one/project/INDEX.md: 1600 characters, over 1500 — move the detail into a branch beside it and leave a pointer.'));
  assert.ok(reason.includes('- projects/one/project/INDEX.md: derive URL without a home file on the line: ' + line + ' — link the home file the artifact publishes.'));
  assert.ok(!reason.includes('Save each source'));
});

test('the reason stays within its limit and shortens long lists', () => {
  const findings: TurnFindings = { documents: Array.from({ length: 30 }, (_, i) => ({ path: '/tmp/' + 'd'.repeat(200) + i + '.md', uploaded: false })),
    publications: [], maps: [] };
  const reason = turnReason(findings, { path: '/home', label: 'the global level' }, '/home');
  assert.ok(reason.length <= REASON_MAX);
  assert.ok(reason.includes('- … and 20 more'));
  assert.ok(reason.includes('context_write {"paths":["' + 'd'.repeat(200) + '0.md"'));
});

test('the save folder is the folder of the session level', async t => {
  const { filename, home } = turn(t);
  const app = createApp(filename, false);
  try { app.projects.add('one/project', 'MP', undefined, 'file:///nonexistent/one/project.git'); } finally { app.close(); }
  const db = openDatabase(filename);
  try {
    db.prepare(`INSERT INTO tasks(project_id, number, title, status_id, context_dir, worktree_path, created_at, updated_at)
      VALUES ((SELECT id FROM projects WHERE code = 'MP'), 12, 'scoped-warmup', (SELECT id FROM task_statuses WHERE code = 'new'),
      'projects/one/project/tasks/MP-12-scoped-warmup', NULL, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`).run();
  } finally { db.close(); }
  const runner = localSessionRunner(filename);
  assert.deepEqual(await saveFolder(runner, home, 'MP-12'),
    { path: join(home, 'projects/one/project/tasks/MP-12-scoped-warmup'), label: 'the task folder MP-12' });
  assert.deepEqual(await saveFolder(runner, home, 'MP'), { path: join(home, 'projects/one/project'), label: 'the project folder MP' });
  assert.deepEqual(await saveFolder(runner, home, 'one'), { path: join(home, 'projects/one'), label: 'the organization folder one' });
  for (const key of ['global', 'all', 'MP-99', 'ZZ']) assert.deepEqual(await saveFolder(runner, home, key), { path: home, label: 'the global level' }, key);
});
