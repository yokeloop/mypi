import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTask } from '../../src/cli/task-command.js';

interface Context { cwd: string; ui: { notify(message: string, type: string): void } }
test('host /task preserves exact source and creates only a card, never a worker or flow', async () => {
  const calls: string[][] = [], notices: string[] = [];
  let handler!: (args: string, ctx: Context) => Promise<void>;
  // Same adapter registered by the runtime-loaded extension, with an inert process port.
  registerTask({
    registerCommand(name: string, command: { handler: typeof handler }) { assert.equal(name, 'task'); handler = command.handler; },
    async exec(program: string, args: string[]) {
      assert.equal(program, 'mise'); calls.push(args);
      return { code: 0, stderr: '', stdout: JSON.stringify(args.includes('resolve')
        ? { match: 'project', identity: 'one/project' } : { key: 'MP-1' }) };
    },
  }, '/engine', '/engine/dist/src/cli/main.js');
  const ctx = { cwd: '/selected', ui: { notify: (message: string) => { notices.push(message); } } };
  const source = '\ufeff --literal source\r\nsecond line\n';
  await handler(JSON.stringify({ title: 'Title', status: 'planning', slug: 'task', source }), ctx);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]!.slice(-3), ['project', 'resolve', '/selected']);
  assert.deepEqual(calls[1]!.slice(4), ['request', 'create', '--title', 'Title', '--status', 'planning', '--slug', 'task', '--project', 'one/project', '--', source]);
  assert.match(notices[0]!, /card only; no run launched/);
  await handler(JSON.stringify({ title: 'T', status: 'planning', slug: 'task', source, launch: true }), ctx);
  assert.equal(calls.length, 2); assert.match(notices.at(-1)!, /Expected/);
});
