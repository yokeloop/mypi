import test from 'node:test';
import assert from 'node:assert/strict';
import { insert, editKey, complete, displayEditor } from '../../src/cli/bootstrap-editor.js';

test('Unicode edits and pasted text respect cursor and code points', () => {
  let editor = { text: 'дом😀', cursor: 4 };
  editor = editKey(editor, 'left');
  editor = insert(editor, ' путь');
  assert.equal(editor.text, 'дом путь😀');
  assert.equal(editKey(editor, 'backspace').text, 'дом пут😀');
  assert.equal(editKey({ text: '😀', cursor: 0 }, 'delete').text, '');
  assert.equal(displayEditor(editKey(editor, 'home')).startsWith('▏'), true);
});
test('completion preserves suffix and exposes ambiguous names', () => {
  assert.deepEqual(complete({ text: './до/end', cursor: 4 }, ['дом', 'доска']).matches, ['дом', 'доска']);
  assert.deepEqual(complete({ text: './до/end', cursor: 4 }, ['дом']).editor, { text: './дом/end', cursor: 5 });
});
