import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMemory } from '../../src/modules/memory/public.js';

test('memory manages only JSON-string facts and preserves other Markdown as context', () => {
  const context = '# Memory\n\n- (2026-09-01) dated prose\n- ordinary prose\n';
  let text = context + '- "first\\nline"\n';
  const memory = createMemory({
    read: () => text,
    edit: (_path, update) => { text = update(text); },
  }, value => createHash('sha256').update(value).digest('hex'));
  assert.deepEqual(memory.show('').items, [{ number: 1, text: 'first\nline' }]);
  memory.add('', 'second\nline');
  const revision = memory.show('').revision;
  assert.throws(() => memory.remove('', 1, '0'.repeat(64)), /revision/);
  assert.equal(memory.remove('', 1, revision), 'first\nline');
  assert.throws(() => memory.remove('', 1, revision), /revision/);
  assert.equal(text, context + '- "second\\nline"\n');
  assert.deepEqual(memory.show('').items, [{ number: 1, text: 'second\nline' }]);
});
