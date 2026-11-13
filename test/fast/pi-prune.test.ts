import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrune, marker, pruneDrafts, threshold } from '../../.pi/extensions/mypi-lib/prune.js';
import type { Draft, SessionEntry, TurnEndEvent } from '../../.pi/extensions/mypi-lib/prune.js';

type Item = { sourceEntry: SessionEntry; messages: unknown[] };

const user = (id: string, text: string): Item => ({ sourceEntry: { type: 'message', id, message: { role: 'user', content: [{ type: 'text', text }] } }, messages: [{}] });
const assistant = (id: string, calls: { id: string; name: string; arguments: unknown }[] = []): Item =>
  ({ sourceEntry: { type: 'message', id, message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }, ...calls.map(call => ({ type: 'toolCall', ...call }))] } }, messages: [{}] });
const result = (id: string, toolCallId: string, toolName: string, size: number): Item =>
  ({ sourceEntry: { type: 'message', id, message: { role: 'toolResult', toolCallId, toolName, content: [{ type: 'text', text: 'x'.repeat(size) }] } }, messages: [{}] });
const replies = (count: number, from = 0) => Array.from({ length: count }, (_, i) => assistant(`a${from + i}`));
const event = (contextEntries: Item[], entries: Draft[] = []): TurnEndEvent => ({ entries, context: { contextEntries } });
const tail = ' was removed from the context to save space. What the run learned is in mypi home: the task folder\'s knowledge.md, plan.md and reports, and the project\'s INDEX.md. If you need this output, run the call again.]';
const ctx = (percent: number | null | undefined) => ({ getContextUsage: () => percent === undefined ? undefined : { percent } });

test('pi prune reads the threshold', () => {
  for (const value of [undefined, '', 'x', '0', '150']) assert.equal(threshold(value), 50);
  assert.equal(threshold('20'), 20);
  assert.equal(threshold(' 8 '), 8);
});

test('pi prune edits nothing below the threshold or without a usage', () => {
  const prune = createPrune(50);
  const items = [assistant('c', [{ id: 'k1', name: 'read', arguments: { path: '/x' } }]), result('r1', 'k1', 'read', 3000), ...replies(10)];
  for (const percent of [undefined, null, 49]) assert.equal(prune.turnEnd(event(items), ctx(percent)), undefined);
  assert.equal(prune.turnEnd(event(items), ctx(50))!.entries.length, 1);
});

test('pi prune replaces old large results of repeatable tools', () => {
  const tools = ['read', 'bash', 'codemode', 'mcp__derive__read', 'grep', 'subagent', 'mypi_ask'];
  const calls = tools.map((name, i) => ({ id: `k${i}`, name, arguments: name === 'read' ? { path: '/x' } : { n: i } }));
  const items = [user('u', 'go'), assistant('c', [...calls, { id: 'k7', name: 'read', arguments: { path: '/y' } }]),
    ...tools.map((name, i) => result(`r${i}`, `k${i}`, name, 2500)), result('r7', 'k7', 'read', 2000),
    assistant('a', [{ id: 'k8', name: 'read', arguments: { path: '/z' } }]), result('r8', 'k8', 'read', 3000), ...replies(9)];
  const before = structuredClone(items);
  const drafts = pruneDrafts(event(items));
  assert.deepEqual(drafts.map(draft => draft.targetId), ['r0', 'r1', 'r2', 'r3', 'r4']);
  for (const draft of drafts) assert.deepEqual(Object.keys(draft), ['type', 'targetId', 'replacement']);
  assert.deepEqual(drafts[0], { type: 'context_edit', targetId: 'r0', replacement: { content: [{ type: 'text',
    text: '[mypi: the read result of {"path":"/x"} (2500 chars) was removed from the context to save space. What the run learned is in mypi home: the task folder\'s knowledge.md, plan.md and reports, and the project\'s INDEX.md. If you need this output, run the call again.]' }] } });
  assert.deepEqual(items, before);
});

test('pi prune keeps the proposals before it and skips edited targets', () => {
  const prune = createPrune(50);
  const calls = ['a', 'b', 'c'].map(id => ({ id: `k${id}`, name: 'bash', arguments: { id } }));
  const items = [assistant('c', calls), result('A', 'ka', 'bash', 2500), result('B', 'kb', 'bash', 2500), result('C', 'kc', 'bash', 2500),
    { sourceEntry: { type: 'context_edit', id: 'e1', targetId: 'B' }, messages: [] }, ...replies(10)];
  const foreign: Draft[] = [{ type: 'custom' }, { type: 'context_edit', targetId: 'A', replacement: null }];
  const output = prune.turnEnd(event(items, foreign), ctx(80))!;
  assert.deepEqual(output.entries.slice(0, 2), foreign);
  assert.deepEqual(output.entries.slice(2).map(draft => draft.targetId), ['C']);
});

test('pi prune clips the arguments and names a call missing from the context', () => {
  const long = { text: 'y'.repeat(400) };
  const json = JSON.stringify(long);
  assert.equal(marker('read', long, 2500), `[mypi: the read result of ${json.slice(0, 300)}… (2500 chars)${tail}`);
  const drafts = pruneDrafts(event([result('r', 'gone', 'bash', 2500), ...replies(10)]));
  assert.equal(drafts[0]!.replacement!.content[0]!.text, `[mypi: the bash result (2500 chars)${tail}`);
});
