import test from 'node:test';
import assert from 'node:assert/strict';
import { keyScope, messageText } from '../../src/app/journal-facts.js';

test('journal facts map a key to its scope and keep the first message line within 120 characters', () => {
  assert.deepEqual(keyScope('MP'), { type: 'project', key: 'MP' });
  assert.deepEqual(keyScope('MP-12'), { type: 'task', key: 'MP-12' });
  assert.deepEqual(keyScope('tb-ff'), { type: 'org', key: 'tb-ff' });
  assert.equal(messageText(1, 'MP', 'go'), 'message 1 from MP: go');
  assert.equal(messageText(2, 'one', 'первая\r\nвторая'), 'message 2 from one: первая');
  assert.equal(messageText(3, 'MP', 'a'.repeat(130) + '\nnext'), 'message 3 from MP: ' + 'a'.repeat(120) + '…');
  assert.equal(messageText(4, 'MP', 'a'.repeat(120)), 'message 4 from MP: ' + 'a'.repeat(120));
});
