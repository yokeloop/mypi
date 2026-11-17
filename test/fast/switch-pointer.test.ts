import test from 'node:test';
import assert from 'node:assert/strict';
import { POINTER_PREFIX, pointerLine, stripPointer } from '../../src/shared/switch-pointer.js';

const PREFIX = '[mypi: с вашего прошлого хода в ';

test('pointer line names the session, the journal entries and the commits', () => {
  assert.equal(POINTER_PREFIX, PREFIX);
  assert.equal(pointerLine({ key: 'MP-1', agent: 'claude', device: 'laptop', entries: 1, commits: 1 }),
    '[mypi: с вашего прошлого хода в MP-1 работала сессия claude на laptop: 1 записей журнала, 1 коммитов в ветке; подробнее — journal MP-1]');
  assert.equal(pointerLine({ key: 'MP-1', agent: 'claude', device: 'laptop', entries: 1, commits: 'pull' }),
    '[mypi: с вашего прошлого хода в MP-1 работала сессия claude на laptop: 1 записей журнала, сначала git pull; подробнее — journal MP-1]');
  assert.equal(pointerLine({ key: 'MP', agent: 'pi', device: 'laptop', entries: 0, commits: null }),
    '[mypi: с вашего прошлого хода в MP работала сессия pi на laptop: 0 записей журнала; подробнее — journal MP]');
});

test('pointer line is at most 200 characters', () => {
  const line = pointerLine({ key: 'MP-1', agent: 'claude', device: 'д'.repeat(300), entries: 1, commits: 1 });
  assert.notEqual(line, '');
  assert.ok([...line].length <= 200);
  assert.ok(line.startsWith(PREFIX));
  assert.ok(line.endsWith('; подробнее — journal MP-1]'));
  assert.ok(line.includes('…: 1 записей журнала'));
  assert.equal(pointerLine({ key: 'a'.repeat(190), agent: 'claude', device: 'laptop', entries: 1, commits: 1 }), '');
  const alphabet = [...'abcXYZабвЖЮя😀🚀🧭'];
  for (let i = 0; i < 50; i++) {
    const device = Array.from({ length: Math.floor(Math.random() * 401) }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    const random = pointerLine({ key: 'MP-1', agent: 'claude', device, entries: 12, commits: 3 });
    assert.ok([...random].length <= 200, device);
  }
});

test('stripPointer removes the pointer line with its blank neighbour and nothing else', () => {
  const line = pointerLine({ key: 'MP-1', agent: 'claude', device: 'laptop', entries: 1, commits: 1 });
  assert.equal(stripPointer(line + '\n\nпривет'), 'привет');
  assert.equal(stripPointer('/skill:review x\n\n' + line), '/skill:review x');
  assert.equal(stripPointer('привет'), 'привет');
  const frame = '[mypi: сообщение родительской сессии MP для MP-12. Ниже — поручение]\ngo';
  assert.equal(stripPointer(frame), frame);
  assert.equal(stripPointer('посмотри ' + line), 'посмотри ' + line);
});
