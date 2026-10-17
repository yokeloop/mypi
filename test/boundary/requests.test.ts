import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { state } from '../support/state.js';
import { createWorkspace, initializeWorkspace } from '../../src/app/create-workspace.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { PartialError } from '../../src/shared/context.js';

test('requests preserve source, allocate separate numbers, filter parents, extend statuses and surface partial without replay', t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  initializeWorkspace(filename, root);
  let at = '2026-09-30T23:59:00.000Z';
  const app = createWorkspace(filename, false, root, () => at);
  try {
    app.projects.add('one/project', 'MP'); app.projects.add('two/project', 'YM');
    const create = (project?: string) => app.requests.create({ ...(project ? { project } : {}),
      title: 'Task', status: 'research', slug: 'test-task', source: '  source\r\nline\n' });
    const a = create('one/project'), b = create('two/project'), c = create();
    assert.deepEqual([a.key, b.key, c.key], ['MP-1', 'YM-1', 'REQ-1']);
    assert.equal(app.read(a.contextDir + '/source.md'), '  source\r\nline\n');
    assert.equal(app.history({ type: 'org', key: 'one' }).length, 1);
    assert.equal(app.history({ type: 'global' }).length, 0);
    assert.throws(() => app.requests.create({ title: 'bad', status: '', slug: 'bad', source: 'bad' }), /status/);
    at = '2026-10-02T00:00:00.000Z';
    app.requests.change(a.key, { status: 'research' }, 'same');
    assert.equal(app.history({ type: 'request', key: a.key }).length, 1);
    app.statuses.renameStatus('research', 'investigation');
    assert.equal(app.requests.get(a.key).updatedAt, a.updatedAt);
    assert.equal(app.requests.get(a.key).statusId, a.statusId);
    assert.throws(() => app.statuses.setTerminal('investigation', true), /terminality/);
    app.statuses.addStatus('accepted', true);
    app.requests.progress(a.key, 'progress\nline', [{ path: 'research/result.md', text: 'result' }]);
    app.requests.change(a.key, { status: 'accepted' }, 'verified');
    assert.throws(() => app.requests.change(a.key, { status: 'new' }, 'reopen'), /Terminal/);
    assert.equal(app.history({ type: 'project', key: 'MP' }).length, 3);
    assert.equal(app.history({ type: 'org', key: 'two' }).length, 1);
    assert.equal(app.history({ type: 'request', key: 'REQ-1' }).length, 1);
    writeFileSync(join(root, '.git/index.lock'), 'blocked');
    app.requests.change(b.key, { status: 'planning' }, 'plan');
    assert.equal(app.requests.get(b.key).status, 'planning');
    assert.equal(app.history({ type: 'request', key: b.key }).length, 2);
    const failure = openDatabase(filename);
    failure.exec("CREATE TRIGGER fail_event BEFORE INSERT ON knowledge_journal BEGIN SELECT RAISE(ABORT, 'injected journal failure'); END");
    failure.close();
    const prior = app.requests.get(b.key), count = app.history('all').length;
    assert.throws(() => app.requests.change(b.key, { status: 'accepted' }, 'attempt'), /injected journal failure/);
    assert.equal(app.requests.get(b.key).status, prior.status);
    assert.equal(app.requests.get(b.key).updatedAt, prior.updatedAt);
    assert.equal(app.history('all').length, count);
    const release = openDatabase(filename); release.exec('DROP TRIGGER fail_event'); release.close();
    rmSync(join(root, '.git/index.lock'));
    assert.equal(readFileSync(join(root, a.contextDir, 'research/result.md'), 'utf8'), 'result');
    writeFileSync(join(root, a.contextDir, 'research/plot.bin'), Buffer.from([0xff, 0x00, 0x01]));
    app.requests.progress(a.key, 'binary evidence', [{ path: 'research/plot.bin' }]);
    assert.deepEqual(readFileSync(join(root, a.contextDir, 'research/plot.bin')), Buffer.from([0xff, 0x00, 0x01]));
    const beforeRename = app.requests.get(b.key);
    app.requests.change(b.key, { title: 'Renamed task' }, 'clarification');
    const renamed = app.history({ type: 'request', key: b.key }).at(-1)!;
    assert.equal(renamed.event_type, 'note');
    assert.match(renamed.text, /Title.*Task.*Renamed task.*clarification/);
    assert.equal(app.requests.get(b.key).contextDir, beforeRename.contextDir);
    assert.equal(app.requests.get(b.key).status, beforeRename.status);
    const published = a.contextDir + '/research/result.md';
    const eventsBefore = app.history('all').length;
    writeFileSync(join(root, published), 'replacement');
    assert.throws(() => app.requests.progress(a.key, 'replace', [{ path: 'research/result.md' }]), /Registered file changed/);
    assert.equal(app.history('all').length, eventsBefore);
    assert.throws(() => app.complete([published], 'replace proof'), /Registered|Immutable/);
    writeFileSync(join(root, published), 'result');
    app.requests.progress(a.key, 'next version', [{ path: 'research/result-v2.md', text: 'replacement' }]);
    const injection = openDatabase(filename);
    injection.exec("CREATE TRIGGER fail_registration BEFORE INSERT ON requests BEGIN SELECT RAISE(ABORT, 'injected SQL failure'); END");
    injection.close();
    const rows = app.requests.list().length, events = app.history('all').length;
    const interrupted = { title: 'Interrupted', status: 'new', slug: 'interrupted', source: 'kept source\\r\\n' };
    let sourcePath = '';
    assert.throws(() => app.requests.create(interrupted), e => {
      assert(e instanceof PartialError); assert.deepEqual(e.saved, ['source']); assert.equal(e.requestId, undefined);
      sourcePath = e.paths[0]!; return true;
    });
    assert.equal(app.requests.list().length, rows); assert.equal(app.history('all').length, events);
    assert.equal(app.read(sourcePath), interrupted.source);
    const clear = openDatabase(filename); clear.exec('DROP TRIGGER fail_registration'); clear.close();
    assert.throws(() => app.requests.create({ ...interrupted, source: 'changed', adoptSource: true }), /differs/);
    assert.equal(app.read(sourcePath), interrupted.source);
    app.requests.create({ ...interrupted, adoptSource: true });
    assert.equal(app.requests.list().length, rows + 1);
  } finally { app.close(); }
});

test('local task and journal saves never require a context Git repository', t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  initializeWorkspace(filename, root);
  rmSync(join(root, '.git'), { recursive: true });
  const app = createWorkspace(filename, false, root);
  try {
    const card = app.requests.create({ title: 'No Git', status: 'new', slug: 'local', source: 'exact\r\n' });
    app.requests.change(card.key, { status: 'planning' }, 'working');
    app.requests.progress(card.key, 'result', [{ path: 'result.md', text: 'proof' }]);
    app.journal({ type: 'global' }, 'another entry');
    assert.equal(app.read(card.contextDir + '/source.md'), 'exact\r\n');
    assert.deepEqual(app.history({ type: 'request', key: card.key }).map(x => x.event_type),
      ['request_created', 'status_changed', 'note']);
    assert.equal(app.history('all').length, 4);
  } finally { app.close(); }
});

test('two independent request writers retain distinct committed numbers and journal records', async t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  initializeWorkspace(filename, root);
  const module = fileURLToPath(new URL('../../src/app/create-workspace.js', import.meta.url));
  const program = `import {createWorkspace} from ${JSON.stringify(module)};
const app=createWorkspace(process.argv[1],false,process.argv[2]);
try { console.log(JSON.stringify(app.requests.create({title:'Child',status:'new',slug:'child',source:'source'}))); }
finally { app.close(); }`;
  const run = () => new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, filename, root], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', b => { output += String(b); }); child.stderr.on('data', b => { errors += String(b); });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(output) : reject(new Error(errors)));
  });
  const result = await Promise.all([run(), run()]);
  assert.deepEqual(result.map(s => JSON.parse(s).number).sort(), [1, 2]);
  const app = createWorkspace(filename, true, root);
  try { assert.equal(app.requests.list().length, 2); assert.equal(app.history('all').length, 2); }
  finally { app.close(); }
});

test('abrupt exit after DB commit preserves identity/source; reconciliation adds a factual note, never a fabricated transition', async t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  initializeWorkspace(filename, root);
  const coreModule = fileURLToPath(new URL('../../src/app/create-app.js', import.meta.url));
  const filesModule = fileURLToPath(new URL('../../src/infrastructure/filesystem/context-files.js', import.meta.url));
  const program = `import {createApp} from ${JSON.stringify(coreModule)};
import {contextFiles} from ${JSON.stringify(filesModule)};
const core=createApp(process.argv[1],false), files=contextFiles(process.argv[2]);
core.serialize(() => {
  const card=core.requests.create({projectId:null,title:'Interrupted',status:'new',slug:'interrupted'},
    dir=>files.create(dir+'/source.md','original'));
  core.journalStore.append({at:new Date().toISOString(),scope:{type:'request',key:'REQ-1'},event_type:'request_created',text:'Created'});
  process.send(card);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program, filename, root],
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
    assert.equal(app.requests.list().length, 0);
    assert.equal(app.history('all').length, 0);
    assert.equal(app.read('requests/REQ-1-interrupted/source.md'), 'original');
  } finally { app.close(); }
});
