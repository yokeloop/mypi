import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { startupSections } from '../../src/shared/startup-context.js';

test('startup sections retain exact inherited memory once, before remaining ordinary warmup', () => {
  const warmup = { memory: [
    { path: 'MEMORY.md', text: 'α\nline two\n' },
    { path: 'projects/acme/MEMORY.md', text: 'org fact' },
    { path: 'projects/acme/widget/MEMORY.md', text: 'project fact' },
  ], glossary: 'context', history: [{ text: 'event' }], work: { tasks: [{ key: 'W-1' }] } };
  const result = startupSections(warmup);
  assert.match(result.memory, /MEMORY.md\nα\nline two\n/);
  assert.ok(result.memory.indexOf('org fact') > result.memory.indexOf('line two'));
  assert.ok(result.memory.indexOf('project fact') > result.memory.indexOf('org fact'));
  assert.deepEqual(JSON.parse(result.context), { glossary: 'context', history: [{ text: 'event' }], work: { tasks: [{ key: 'W-1' }] } });
  assert.equal(result.context.includes('org fact'), false);
});

test('oversize memory does not load partial facts but keeps remaining context', () => {
  const result = startupSections({ memory: [{ path: 'MEMORY.md', text: 'я'.repeat(17_000) }], work: { tasks: [] } });
  assert.match(result.memory, /32 KiB/);
  assert.equal(result.memory.includes('я'), false);
  assert.deepEqual(JSON.parse(result.context), { work: { tasks: [] } });
  assert.throws(() => startupSections({ memory: [{ path: 'MEMORY.md', text: 5 }] } as never), /Invalid warmup/);
});
