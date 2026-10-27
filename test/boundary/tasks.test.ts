import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync, rmSync, readFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { state } from '../support/state.js';
import { createWorkspace, initializeWorkspace } from '../../src/app/create-workspace.js';
import { createApp } from '../../src/app/create-app.js';
import { contextGit } from '../../src/infrastructure/git/context-git.js';
import { contextFiles } from '../../src/infrastructure/filesystem/context-files.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { PartialError } from '../../src/shared/context.js';

test('tasks preserve source, allocate separate numbers, filter parents, extend statuses and surface partial without replay', t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  initializeWorkspace(filename, root);
  let at = '2026-09-30T23:59:00.000Z';
  const app = createWorkspace(filename, false, root, () => at);
  try {
    app.projects.add('one/project', 'MP'); app.projects.add('two/project', 'YM');
    const create = (project?: string) => app.tasks.create({ project: project!,
      title: 'Task', status: 'research', slug: 'test-task', source: '  source\r\nline\n' });
    const a = create('one/project'), b = create('two/project');
    assert.throws(() => create(), /Project identity required/);
    assert.deepEqual([a.key, b.key], ['MP-1', 'YM-1']);
    assert.equal(app.read(a.contextDir + '/source.md'), '  source\r\nline\n');
    assert.equal(app.history({ type: 'org', key: 'one' }).length, 1);
    assert.equal(app.history({ type: 'global' }).length, 0);
    assert.throws(() => app.tasks.create({ project: 'one/project', title: 'bad', status: '', slug: 'bad', source: 'bad' }), /status/);
    at = '2026-10-02T00:00:00.000Z';
    app.tasks.change(a.key, { status: 'research' }, 'same');
    assert.equal(app.history({ type: 'task', key: a.key }).length, 1);
    app.statuses.renameStatus('research', 'investigation');
    assert.equal(app.tasks.get(a.key).updatedAt, a.updatedAt);
    assert.equal(app.tasks.get(a.key).statusId, a.statusId);
    assert.throws(() => app.statuses.setTerminal('investigation', true), /terminality/);
    app.statuses.addStatus('accepted', true);
    app.tasks.progress(a.key, 'progress\nline', [{ path: 'research/result.md', text: 'result' }]);
    app.tasks.change(a.key, { status: 'accepted' }, 'verified');
    assert.throws(() => app.tasks.change(a.key, { status: 'new' }, 'reopen'), /Terminal/);
    assert.equal(app.history({ type: 'project', key: 'MP' }).length, 3);
    assert.equal(app.history({ type: 'org', key: 'two' }).length, 1);
    writeFileSync(join(root, '.git/index.lock'), 'blocked');
    app.tasks.change(b.key, { status: 'planning' }, 'plan');
    assert.equal(app.tasks.get(b.key).status, 'planning');
    assert.equal(app.history({ type: 'task', key: b.key }).length, 2);
    const failure = openDatabase(filename);
    failure.exec("CREATE TRIGGER fail_event BEFORE INSERT ON knowledge_journal BEGIN SELECT RAISE(ABORT, 'injected journal failure'); END");
    failure.close();
    const prior = app.tasks.get(b.key), count = app.history('all').length;
    assert.throws(() => app.tasks.change(b.key, { status: 'accepted' }, 'attempt'), /injected journal failure/);
    assert.equal(app.tasks.get(b.key).status, prior.status);
    assert.equal(app.tasks.get(b.key).updatedAt, prior.updatedAt);
    assert.equal(app.history('all').length, count);
    const release = openDatabase(filename); release.exec('DROP TRIGGER fail_event'); release.close();
    rmSync(join(root, '.git/index.lock'));
    assert.equal(readFileSync(join(root, a.contextDir, 'research/result.md'), 'utf8'), 'result');
    writeFileSync(join(root, a.contextDir, 'research/plot.bin'), Buffer.from([0xff, 0x00, 0x01]));
    app.tasks.progress(a.key, 'binary evidence', [{ path: 'research/plot.bin' }]);
    assert.deepEqual(readFileSync(join(root, a.contextDir, 'research/plot.bin')), Buffer.from([0xff, 0x00, 0x01]));
    const beforeRename = app.tasks.get(b.key);
    app.tasks.change(b.key, { title: 'Renamed task' }, 'clarification');
    const renamed = app.history({ type: 'task', key: b.key }).at(-1)!;
    assert.equal(renamed.event_type, 'note');
    assert.match(renamed.text, /Title.*Task.*Renamed task.*clarification/);
    assert.equal(app.tasks.get(b.key).contextDir, beforeRename.contextDir);
    assert.equal(app.tasks.get(b.key).status, beforeRename.status);
    const published = a.contextDir + '/research/result.md';
    const eventsBefore = app.history('all').length;
    writeFileSync(join(root, published), 'replacement');
    assert.throws(() => app.tasks.progress(a.key, 'replace', [{ path: 'research/result.md' }]), /Registered file changed/);
    assert.equal(app.history('all').length, eventsBefore);
    assert.throws(() => app.complete([published], 'replace proof'), /Registered|Immutable/);
    writeFileSync(join(root, published), 'result');
    app.tasks.progress(a.key, 'next version', [{ path: 'research/result-v2.md', text: 'replacement' }]);
    const injection = openDatabase(filename);
    injection.exec("CREATE TRIGGER fail_registration BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT, 'injected SQL failure'); END");
    injection.close();
    const rows = app.tasks.list().length, events = app.history('all').length;
    const interrupted = { project: 'one/project', title: 'Interrupted', status: 'new', slug: 'interrupted', source: 'kept source\\r\\n' };
    let sourcePath = '';
    assert.throws(() => app.tasks.create(interrupted), e => {
      assert(e instanceof PartialError); assert.deepEqual(e.saved, ['source']); assert.equal(e.taskId, undefined);
      sourcePath = e.paths[0]!; return true;
    });
    assert.equal(app.tasks.list().length, rows); assert.equal(app.history('all').length, events);
    assert.equal(app.read(sourcePath), interrupted.source);
    const clear = openDatabase(filename); clear.exec('DROP TRIGGER fail_registration'); clear.close();
    assert.throws(() => app.tasks.create({ ...interrupted, source: 'changed', adoptSource: true }), /differs/);
    assert.equal(app.read(sourcePath), interrupted.source);
    app.tasks.create({ ...interrupted, adoptSource: true });
    assert.equal(app.tasks.list().length, rows + 1);
  } finally { app.close(); }
});

test('local task and journal saves never require a context Git repository', t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  initializeWorkspace(filename, root);
  rmSync(join(root, '.git'), { recursive: true });
  const app = createWorkspace(filename, false, root);
  try {
    app.projects.add('one/project', 'MP');
    const card = app.tasks.create({ project: 'one/project', title: 'No Git', status: 'new', slug: 'local', source: 'exact\r\n' });
    app.tasks.change(card.key, { status: 'planning' }, 'working');
    app.tasks.progress(card.key, 'result', [{ path: 'result.md', text: 'proof' }]);
    app.journal({ type: 'global' }, 'another entry');
    assert.equal(app.read(card.contextDir + '/source.md'), 'exact\r\n');
    assert.deepEqual(app.history({ type: 'task', key: card.key }).map(x => x.event_type),
      ['task_created', 'status_changed', 'note']);
    assert.equal(app.history('all').length, 4);
    const before = readFileSync(filename);
    assert.equal(app.warmup('one/project').work.tasks[0]?.key, card.key);
    assert.equal(readFileSync(filename).equals(before), true);
  } finally { app.close(); }
});

test('task and journal paths invoke no Git and preserve staged and unstaged index contents', t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  initializeWorkspace(filename, root);
  contextFiles(root).create('staged.md', 'base');
  contextGit(root).commit(['staged.md'], 'Seed staged fixture');
  writeFileSync(join(root, 'staged.md'), 'staged');
  const stage = spawnSync('git', ['-C', root, 'add', '--', 'staged.md'], { encoding: 'utf8' });
  assert.equal(stage.status, 0, stage.stderr);
  writeFileSync(join(root, 'staged.md'), 'unstaged');
  const originalIndex = readFileSync(join(root, '.git/index'));
  const originalFile = readFileSync(join(root, 'staged.md'));
  writeFileSync(join(root, '.git/index.lock'), 'other writer');
  const bin = join(dir, 'bin'), marker = join(dir, 'git-invoked');
  mkdirSync(bin);
  const shim = join(bin, 'git');
  writeFileSync(shim, '#!/usr/bin/bash\nprintf invoked >> ' + JSON.stringify(marker) + '\nexit 99\n');
  chmodSync(shim, 0o755);
  const path = process.env.PATH;
  process.env.PATH = bin + ':' + path;
  try {
    // The detector must fail a known Git operation; then discard its marker.
    assert.throws(() => contextGit(root).head());
    assert.equal(existsSync(marker), true);
    rmSync(marker);
    const app = createWorkspace(filename, false, root);
    try {
      app.projects.add('one/project', 'MP');
      const card = app.tasks.create({ project: 'one/project', title: 'Local', status: 'new', slug: 'local', source: 'source' });
      app.tasks.change(card.key, { status: 'planning' }, 'progress');
      app.tasks.progress(card.key, 'result', [{ path: 'result.md', text: 'proof' }]);
      app.tasks.touch(card.key);
      app.journal({ type: 'global' }, 'global note');
      assert.equal(app.history({ type: 'global' })[0]?.text, 'global note');
      assert.equal(app.history({ type: 'task', key: card.key }).length, 3);
    } finally { app.close(); }
    assert.equal(existsSync(marker), false, 'no hidden Git invocation');
    assert.deepEqual(readFileSync(join(root, '.git/index')), originalIndex);
    assert.deepEqual(readFileSync(join(root, 'staged.md')), originalFile);
    assert.equal(readFileSync(join(root, '.git/index.lock'), 'utf8'), 'other writer');
  } finally { process.env.PATH = path; }
});

test('two simultaneous processes retain unique task numbers and independent journal additions after reopen', async t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  initializeWorkspace(filename, root);
  const parent = createWorkspace(filename, false, root);
  parent.projects.add('one/project', 'MP'); parent.close();
  const module = fileURLToPath(new URL('../../src/app/create-workspace.js', import.meta.url));
  const program = `import {createWorkspace} from ${JSON.stringify(module)};
process.send('ready');
process.once('message', () => {
  const app=createWorkspace(process.argv[1],false,process.argv[2]);
  try {
    const card=app.tasks.create({project:'one/project',title:'Child',status:'new',slug:'child',source:process.argv[3]});
    app.journal({type:'global'},process.argv[3]);
    console.log(JSON.stringify({number:card.number,key:card.key,text:process.argv[3]}));
  } finally { app.close(); }
});`;
  const start = (text: string) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, filename, root, text],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    let output = '', errors = '';
    child.stdout!.on('data', b => { output += String(b); }); child.stderr!.on('data', b => { errors += String(b); });
    const ready = new Promise<void>((resolve, reject) => {
      child.once('message', () => resolve()); child.once('error', reject);
      child.once('exit', code => reject(new Error('Writer exited before barrier: ' + code + errors)));
    });
    const result = new Promise<{ number: number; key: string; text: string }>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(errors)));
    });
    return { child, ready, result };
  };
  const writers = [start('first'), start('second')];
  await Promise.all(writers.map(writer => writer.ready));
  for (const writer of writers) writer.child.send('go');
  const result = await Promise.all(writers.map(writer => writer.result));
  assert.deepEqual(result.map(item => item.number).sort(), [1, 2]);
  assert.deepEqual(result.map(item => item.text).sort(), ['first', 'second']);
  const app = createWorkspace(filename, true, root);
  try {
    assert.deepEqual(app.tasks.list().map(c => c.number).sort(), [1, 2]);
    for (const item of result) {
      assert.equal(app.read('projects/one/project/tasks/' + item.key + '-child/source.md'), item.text);
      assert.deepEqual(app.history({ type: 'task', key: item.key }).map(e => e.event_type), ['task_created']);
    }
    assert.deepEqual(app.history({ type: 'global' }).map(e => e.text).sort(), ['first', 'second']);
    assert.equal(app.history('all').length, 4);
  } finally { app.close(); }
});

test('abrupt exit before transaction commit rolls back card and journal but leaves orphaned source', async t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  initializeWorkspace(filename, root);
  const setup = createApp(filename, false);
  const projectId = setup.projects.add('one/project', 'MP').id; setup.close();
  const coreModule = fileURLToPath(new URL('../../src/app/create-app.js', import.meta.url));
  const filesModule = fileURLToPath(new URL('../../src/infrastructure/filesystem/context-files.js', import.meta.url));
  const program = `import {createApp} from ${JSON.stringify(coreModule)};
import {contextFiles} from ${JSON.stringify(filesModule)};
const core=createApp(process.argv[1],false), files=contextFiles(process.argv[2]);
core.serialize(() => {
  const card=core.tasks.create({projectId:Number(process.argv[3]),title:'Interrupted',status:'new',slug:'interrupted'},
    dir=>files.create(dir+'/source.md','original'));
  core.journalStore.append({at:new Date().toISOString(),scope:{type:'task',key:'MP-1'},event_type:'task_created',text:'Created'});
  process.send(card);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program, filename, root, String(projectId)],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const ready = new Promise<void>((resolve, reject) => {
    child.once('message', () => resolve());
    child.once('error', reject);
    child.once('exit', code => reject(new Error('Writer exited before checkpoint: ' + code)));
  });
  await ready;
  const exit = once(child, 'exit');
  child.kill('SIGKILL'); await exit;
  const app = createWorkspace(filename, false, root);
  try {
    assert.equal(app.tasks.list().length, 0);
    assert.equal(app.history('all').length, 0);
    assert.equal(app.read('projects/one/project/tasks/MP-1-interrupted/source.md'), 'original');
  } finally { app.close(); }
});
