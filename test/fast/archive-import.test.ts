import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeFolderName, nativeIdOf, piFolderName } from '../../src/modules/archive/public.js';

test('transcript folder names and native ids follow each agent\'s layout', () => {
  assert.equal(claudeFolderName('/home/u/Projects/mypi'), '-home-u-Projects-mypi');
  assert.equal(claudeFolderName('/a/b.c_d'), '-a-b-c-d');
  assert.equal(piFolderName('/home/u/Projects/mypi'), '--home-u-Projects-mypi--');
  assert.equal(piFolderName('/a/b.c'), '--a-b.c--');
  assert.equal(nativeIdOf('claude', '/x/c1.jsonl'), 'c1');
  assert.equal(nativeIdOf('pi', '/x/2026-11-07T10-00-00-000Z_p1.jsonl'), 'p1');
  assert.equal(nativeIdOf('pi', '/x/p2.jsonl'), 'p2');
});
