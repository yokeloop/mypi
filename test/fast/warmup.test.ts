import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { state } from '../support/state.js';
import { createApp } from '../../src/app/create-app.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { readWarmup, warmupScope, WARMUP_LIMIT } from '../../src/app/warmup.js';

function fixture(t: TestContext, personal?: string) {
  const { dir, filename } = state(t);
  const root = join(dir, 'home'), clone = join(dir, 'clone');
  mkdirSync(root); mkdirSync(clone);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  if (personal !== undefined) write('USER-INSTRUCTIONS.md', personal);
  write('MEMORY.md', '# Memory\n\nGlobal notes written by hand.\n\n- "global fact one"\n- "global fact two"\n');
  write('projects/one/MEMORY.md', '# Memory\n\n- "org fact"\n');
  write('projects/one/project/MEMORY.md', '# Memory\n\nProject conventions by hand.\n\n```\n# not a heading\n```\n\n- "project fact"\n');
  write('projects/two/other/MEMORY.md', '# Memory\n\n- "foreign fact"\n');
  const app = createApp(filename, false);
  try {
    app.projects.add('one/project', 'MP', clone);
    app.projects.add('one/noclone', 'NC');
    app.projects.add('two/other', 'OT');
  } finally { app.close(); }
  const tasks: [string | null, number, string, string, string, string | null][] = [
    ['MP', 3, 'draft-api', 'Draft the API', 'new', null],
    ['MP', 5, 'old-work', 'Old work', 'done', null],
    ['MP', 7, 'started', 'Started work', 'in_progress', join(dir, 'clone--MP-7-started')],
    ['MP', 12, 'scoped-warmup', 'Scoped warmup', 'planning', null],
    ['NC', 1, 'no-clone', 'No clone task', 'new', null],
    ['OT', 1, 'foreign', 'Foreign task', 'new', null],
    [null, 1, 'legacy', 'Legacy', 'new', null],
  ];
  const identities: Record<string, string> = { MP: 'one/project', NC: 'one/noclone', OT: 'two/other' };
  const db = openDatabase(filename);
  try {
    for (const [code, number, slug, title, status, worktree] of tasks) {
      const contextDir = code === null ? 'tasks/REQ-' + number + '-' + slug
        : 'projects/' + identities[code] + '/tasks/' + code + '-' + number + '-' + slug;
      db.prepare(`INSERT INTO tasks(project_id, number, title, status_id, context_dir, worktree_path, created_at, updated_at)
        VALUES ((SELECT id FROM projects WHERE code = ?), ?, ?, (SELECT id FROM task_statuses WHERE code = ?), ?, ?,
        '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`).run(code, number, title, status, contextDir, worktree);
      write(contextDir + '/source.md', code === 'MP' && number === 12
        ? '# T4 Scoped warmup\n\n## Goal\n\nTask card text.\n\nDone when the goldens match.\n\n~~~\n## not a heading\n~~~\n\n##### Deep\n'
        : title + '\n');
    }
  } finally { db.close(); }
  return { dir, filename, root, clone, write };
}

const normal = (dir: string, out: string) => out.replaceAll(realpathSync(dir), '<TMP>').replaceAll(dir, '<TMP>');
const facts = (zone: string, title: string, count: number) => '# Memory\n\n' + title + ' conventions by hand.\n\n'
  + Array.from({ length: count }, (_, i) => '- ' + JSON.stringify(zone + ' fact ' + String(i).padStart(3, '0') + ' ' + 'x'.repeat(150)) + '\n').join('');
const fact = (zone: string, i: number) => zone + ' fact ' + String(i).padStart(3, '0') + ' ';

test('global, MP and MP-12 warmups match the golden files and read nothing but files and the DB', t => {
  const { dir, filename, root } = fixture(t, '# Personal instructions\n\n## Developer preferences\n\nPersonal rule: answer in English.\n');
  const before = readFileSync(filename);
  for (const key of ['global', 'MP', 'MP-12']) {
    assert.equal(normal(dir, readWarmup(filename, root, key)),
      readFileSync(new URL('../../../test/fixtures/warmup/' + key + '.md', import.meta.url), 'utf8'), key);
  }
  assert.deepEqual(readFileSync(filename), before);
  assert.equal(existsSync(join(root, '.git')), false);
  const started = readWarmup(filename, root, 'MP-7');
  assert(started.includes('Path: ' + join(dir, 'clone--MP-7-started')));
  assert(!started.includes('Not created yet'));
});

test('scope priority: explicit over MYPI_SCOPE over global, and missing personal instructions omit the section', t => {
  assert.equal(warmupScope('MP', 'MP-12'), 'MP');
  assert.equal(warmupScope(undefined, 'MP-12'), 'MP-12');
  assert.equal(warmupScope(undefined, ''), 'global');
  assert.equal(warmupScope(undefined, undefined), 'global');
  assert.equal(warmupScope('', 'MP'), '');
  const { filename, root } = fixture(t);
  const task = readWarmup(filename, root, warmupScope(undefined, 'MP-12'));
  const global = readWarmup(filename, root, warmupScope(undefined, undefined));
  assert(task.startsWith('# mypi warmup: MP-12 (one/project)\n'));
  assert(global.startsWith('# mypi warmup: global\n'));
  assert(!task.includes('## Personal instructions') && !global.includes('## Personal instructions'));
});

test('unknown keys, tasks without a project and projects without a clone fail with a clear message', t => {
  const { filename, root } = fixture(t);
  assert.throws(() => readWarmup(filename, root, 'XX'), /Unknown project: XX/);
  assert.throws(() => readWarmup(filename, root, 'MP-99'), /Unknown task: MP-99/);
  assert.throws(() => readWarmup(filename, root, 'REQ-1'), /Task REQ-1 has no project/);
  for (const key of ['NC', 'NC-1']) {
    assert.throws(() => readWarmup(filename, root, key),
      /Project one\/noclone \(NC\) has no clone; register one with project_update \{"identity":"one\/noclone","expectedCheckoutPath":null,"checkoutPath":"<checkout>"\} \(CLI: mypi project update one\/noclone --expected-unset --path <checkout>\)/);
  }
  for (const key of ['one/project', '', 'mp']) assert.throws(() => readWarmup(filename, root, key), /Invalid scope key/);
});

test('memory over 64 KiB hides the oldest facts of the farthest zone first, keeps hand-written text and says what it hid', t => {
  const orgMarker = /^> (\d+) older facts hidden from projects\/one\/MEMORY\.md to fit the 64 KiB warmup limit\. Read in full: memory_show \{"scope":\{"type":"org","key":"one"\}\} \(CLI: mypi memory show -s one\)$/m;
  const projectMarker = /^> (\d+) older facts hidden from projects\/one\/project\/MEMORY\.md to fit the 64 KiB warmup limit\. Read in full: memory_show \{"scope":\{"type":"project","key":"MP"\}\} \(CLI: mypi memory show -s one\/project\)$/m;
  {
    const { filename, root, write } = fixture(t);
    write('projects/one/MEMORY.md', facts('org', 'Org', 400));
    write('projects/one/project/MEMORY.md', facts('project', 'Project', 100));
    const out = readWarmup(filename, root, 'MP');
    assert(Buffer.byteLength(out) <= WARMUP_LIMIT);
    assert(out.includes('Org conventions by hand.'));
    const hidden = Number(orgMarker.exec(out)![1]);
    assert(hidden > 0 && hidden < 400);
    for (let i = 0; i < hidden; i++) assert(!out.includes(fact('org', i)), 'org fact ' + i);
    assert(out.includes(fact('org', hidden)) && out.includes(fact('org', 399)));
    for (let i = 0; i < 100; i++) assert(out.includes(fact('project', i)));
    assert(!projectMarker.test(out));
  }
  {
    const { filename, root, write } = fixture(t);
    write('projects/one/MEMORY.md', facts('org', 'Org', 10));
    write('projects/one/project/MEMORY.md', facts('project', 'Project', 500));
    const out = readWarmup(filename, root, 'MP');
    assert(Buffer.byteLength(out) <= WARMUP_LIMIT);
    assert.equal(Number(orgMarker.exec(out)![1]), 10);
    const hidden = Number(projectMarker.exec(out)![1]);
    assert(hidden > 0 && hidden < 500);
    assert(out.includes(fact('project', 499)));
    assert(out.includes('Project conventions by hand.'));
  }
  {
    const { filename, root, write } = fixture(t);
    write('projects/one/project/MEMORY.md', facts('project', 'Project', 500));
    const out = readWarmup(filename, root, 'MP-12');
    assert(Buffer.byteLength(out) <= WARMUP_LIMIT);
    assert(projectMarker.test(out));
    assert(out.includes(fact('project', 499)));
    assert(out.includes('## Task card\n\nKey: MP-12\nTitle: Scoped warmup\nStatus: planning\n'));
    assert(out.includes('Task card text.\n\nDone when the goldens match.'));
    assert(out.includes('## Worktree\n\nNot created yet. Expected path: '));
  }
  {
    const { filename, root } = fixture(t, 'p'.repeat(70_000));
    const out = readWarmup(filename, root, 'MP');
    assert(Buffer.byteLength(out) > WARMUP_LIMIT);
    assert(out.includes('p'.repeat(70_000)));
    assert(out.includes('## Memory\n\n> This warmup exceeds the 64 KiB limit even without memory facts; all facts are hidden.\n'));
    assert(out.includes('> 1 older facts hidden from projects/one/MEMORY.md'));
    assert(out.includes('> 1 older facts hidden from projects/one/project/MEMORY.md'));
    assert(out.includes('Project conventions by hand.'));
    assert(!out.includes('org fact') && !out.includes('project fact'));
    assert(out.includes('## Open tasks'));
  }
});
