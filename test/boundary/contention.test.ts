import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { state } from '../support/state.js';
import { createApp } from '../../src/app/create-app.js';

test('writer reservation blocks a second source callback before number allocation completes', async t => {
  const { filename } = state(t);
  const module = fileURLToPath(new URL('../../src/app/create-app.js', import.meta.url));
  const program = `import {createApp} from ${JSON.stringify(module)};
const app=createApp(process.argv[1],false);
app.requests.create({projectId:null,title:'Held',status:'new',slug:'held'},()=>{
  process.send('inside-source-before-insert');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program, filename],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await new Promise<void>((resolve, reject) => {
    child.once('message', () => resolve()); child.once('error', reject);
    child.once('exit', code => reject(new Error('Early writer exit: ' + code)));
  });
  const second = createApp(filename, false);
  try {
    let sourceCalled = false;
    assert.throws(() => second.requests.create({projectId:null,title:'Other',status:'new',slug:'other'},
      () => { sourceCalled = true; }), /locked/);
    assert.equal(sourceCalled, false, 'reservation must precede source side effects');
    assert.equal(second.requests.list().length, 0);
  } finally {
    second.close();
    const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
  }
});
