import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL('../../../integrations/prompts/' + name + '.md', import.meta.url), 'utf8');

test('how-to stays within 2,200 characters and every role within 1,300', () => {
  for (const [name, limit] of [['howto', 2200], ['global', 1300], ['org', 1300], ['project', 1300], ['task', 1300]] as const) {
    const length = read(name).length;
    assert.ok(length <= limit, name + ' is ' + length + ' characters, over ' + limit);
  }
});

test('how-to ends with the knowledge concepts paragraph', () => {
  const text = read('howto');
  assert.ok(text.includes('Knowledge in mypi is kept by progressive disclosure.'));
  assert.ok(text.endsWith('Check a fact against the world before relying on it.\n'));
});
