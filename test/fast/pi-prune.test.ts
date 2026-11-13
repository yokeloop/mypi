import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrune, marker, pruneDrafts, resumeBlock, threshold } from '../../.pi/extensions/mypi-lib/prune.js';
import type { Draft, Message, SessionEntry, TurnEndEvent } from '../../.pi/extensions/mypi-lib/prune.js';

type Item = { sourceEntry: SessionEntry; messages: unknown[] };

const user = (id: string, text: string): Item => ({ sourceEntry: { type: 'message', id, message: { role: 'user', content: [{ type: 'text', text }] } }, messages: [{}] });
const assistant = (id: string, calls: { id: string; name: string; arguments: unknown }[] = []): Item =>
  ({ sourceEntry: { type: 'message', id, message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }, ...calls.map(call => ({ type: 'toolCall', ...call }))] } }, messages: [{}] });
const result = (id: string, toolCallId: string, toolName: string, size: number): Item =>
  ({ sourceEntry: { type: 'message', id, message: { role: 'toolResult', toolCallId, toolName, content: [{ type: 'text', text: 'x'.repeat(size) }] } }, messages: [{}] });
const replies = (count: number, from = 0) => Array.from({ length: count }, (_, i) => assistant(`a${from + i}`));
const event = (contextEntries: Item[], entries: Draft[] = []): TurnEndEvent => ({ entries, context: { contextEntries } });
const tail = ' was removed from the context to save space. What the run learned is in mypi home: the task folder\'s knowledge.md, plan.md and reports, and the project\'s INDEX.md. If you need this output, run the call again.]';
const paths = { root: '/r', cli: '/r/dist/src/cli/main.js', home: '/h' };
const projects = JSON.stringify({ projects: [{ id: 1, org: 'fx', slug: 'fixture', code: 'FX', checkoutPath: '/c', repository: null }] });

function fakeExec(code = 0, tasks: unknown[] = []) {
  const calls: unknown[][] = [];
  const exec = async (command: string, args: string[], options: { cwd: string; timeout: number }) => {
    calls.push([command, args, options]);
    return { code, killed: false, stderr: '', stdout: code !== 0 ? '' : args[1] === 'task' ? JSON.stringify(tasks) : projects };
  };
  return { calls, exec, tasks };
}

const ctx = (percent: number | null | undefined, branch: SessionEntry[] = []) =>
  ({ getContextUsage: () => percent === undefined ? undefined : { percent }, sessionManager: { getBranch: () => branch } });

test('pi prune reads the threshold', () => {
  for (const value of [undefined, '', 'x', '0', '150']) assert.equal(threshold(value), 50);
  assert.equal(threshold('20'), 20);
  assert.equal(threshold(' 8 '), 8);
});

test('pi prune edits nothing below the threshold or without a usage', () => {
  const prune = createPrune(fakeExec().exec, paths, 50, () => undefined);
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
  const prune = createPrune(fakeExec().exec, paths, 50, () => undefined);
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

const skillEntry = (id: string, name: string, args: string): SessionEntry =>
  ({ type: 'message', id, message: { role: 'user', content: `<skill name="${name}" location="/e/integrations/skills/${name}/SKILL.md">\nbody\n</skill>\n\n${args}` } });
const compaction: SessionEntry = { type: 'compaction', id: 'cp' };
const summary: Message = { role: 'compactionSummary', timestamp: 7 };
const next: Message = { role: 'user', content: 'go on' };

test('pi prune adds the mypi block after a compaction of a flow run', async () => {
  const { calls, exec } = fakeExec();
  const prune = createPrune(exec, paths, 50, () => undefined);
  const branch = [skillEntry('s1', 'flow', 'fx FX-1 FX-2'), compaction];
  const output = await prune.context({ messages: [summary, next] }, ctx(10, branch));
  const block = output!.messages[1] as unknown as Record<string, unknown>;
  assert.deepEqual(output!.messages[0], summary);
  assert.deepEqual(output!.messages[2], next);
  assert.equal(block['role'], 'custom');
  assert.equal(block['customType'], 'mypi-resume');
  assert.equal(block['display'], false);
  assert.equal(block['timestamp'], 7);
  const expected = resumeBlock({ id: 's1', name: 'flow', location: '/e/integrations/skills/flow/SKILL.md', args: 'fx FX-1 FX-2' }, '/h/projects/fx/fixture');
  assert.equal(block['content'], expected);
  for (const part of ['/h/projects/fx/fixture/flows/fx.md', '/h/projects/fx/fixture/flows/fx/knowledge.md', '/h/projects/fx/fixture/INDEX.md', '/e/integrations/skills/flow/SKILL.md'])
    assert.ok(expected.includes(part), part);
  assert.deepEqual(calls, [['node', ['/r/dist/src/cli/main.js', 'project', 'list'], { cwd: '/r', timeout: 5000 }]]);
  await prune.context({ messages: [summary, next] }, ctx(10, branch));
  assert.equal(calls.length, 1);
});

test('pi prune adds no block without a compaction, a flow or epic skill or a summary', async () => {
  const { calls, exec } = fakeExec();
  const prune = createPrune(exec, paths, 50, () => 'FX');
  assert.equal(await prune.context({ messages: [summary, next] }, ctx(10, [skillEntry('s1', 'flow', 'fx FX-1')])), undefined);
  assert.equal(await prune.context({ messages: [summary, next] }, ctx(10, [skillEntry('s1', 'inbox', 'FX'), compaction])), undefined);
  assert.equal(await prune.context({ messages: [next] }, ctx(10, [skillEntry('s1', 'flow', 'fx FX-1'), compaction])), undefined);
  assert.deepEqual(calls, []);
});

test('pi prune names the epic folder and falls back to the project home placeholder', async () => {
  const failing = fakeExec(1);
  const epic = await createPrune(failing.exec, paths, 50, () => undefined).context({ messages: [summary] }, ctx(10, [skillEntry('s1', 'epic', 'FX-3'), compaction]));
  const text = (epic!.messages[1] as unknown as { content: string }).content;
  assert.ok(text.includes('$BIN/mp-task dir FX-3'));
  assert.ok(text.includes('<project home>/INDEX.md'));
  const scoped = fakeExec();
  const flow = await createPrune(scoped.exec, paths, 50, () => 'FX').context({ messages: [summary] }, ctx(10, [skillEntry('s2', 'flow', 'fx'), compaction]));
  assert.ok((flow!.messages[1] as unknown as { content: string }).content.includes('/h/projects/fx/fixture/flows/fx.md'));
});

test('pi prune adds no block when another skill followed the flow', async () => {
  const { exec } = fakeExec();
  const prune = createPrune(exec, paths, 50, () => undefined);
  const flow = skillEntry('s1', 'flow', 'fx FX-1 FX-2');
  assert.equal(await prune.context({ messages: [summary, next] }, ctx(10, [flow, skillEntry('s2', 'plan', 'MP-140'), compaction])), undefined);
  const output = await prune.context({ messages: [summary, next] }, ctx(10, [flow, compaction]));
  assert.equal((output!.messages[1] as unknown as { customType: string }).customType, 'mypi-resume');
});

test('pi prune adds no block for a finished flow or epic', async t => {
  const home = mkdtempSync(join(tmpdir(), 'mypi-prune-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const project = join(home, 'projects/fx/fixture');
  mkdirSync(join(project, 'flows'), { recursive: true });
  const score = join(project, 'flows/fx.md');
  const flow = skillEntry('s1', 'flow', 'fx FX-1 FX-2');
  const flowPrune = createPrune(fakeExec().exec, { ...paths, home }, 50, () => undefined);
  writeFileSync(score, '# Flow fx\n\n- Command: `/flow fx FX-1 FX-2`\n');
  const open = await flowPrune.context({ messages: [summary, next] }, ctx(10, [flow, compaction]));
  const text = (open!.messages[1] as unknown as { content: string }).content;
  assert.ok(text.includes('If that run is already finished, ignore this note.'));
  writeFileSync(score, '# Flow fx\n\n- Command: `/flow fx FX-1 FX-2`\n- Релиз: нет 2026-11-13 10:00\n');
  assert.notEqual(await flowPrune.context({ messages: [summary, next] }, ctx(10, [flow, compaction])), undefined);
  assert.equal(await flowPrune.context({ messages: [summary, next] }, ctx(10, [flow, compaction, { type: 'compaction', id: 'cp2' }])), undefined);
  const fresh = createPrune(fakeExec().exec, { ...paths, home }, 50, () => undefined);
  assert.equal(await fresh.context({ messages: [summary, next] }, ctx(10, [flow, compaction])), undefined);
  const epic = skillEntry('e1', 'epic', 'FX-3');
  const listing = fakeExec(0, []);
  const epicPrune = createPrune(listing.exec, { ...paths, home }, 50, () => undefined);
  const block = await epicPrune.context({ messages: [summary] }, ctx(10, [epic, compaction]));
  assert.ok((block!.messages[1] as unknown as { content: string }).content.includes('If that run is already finished, ignore this note.'));
  const taskLists = () => listing.calls.filter(call => (call[1] as string[])[1] === 'task');
  assert.deepEqual(taskLists(), [['node', ['/r/dist/src/cli/main.js', 'task', 'list', '--project', 'fx/fixture'], { cwd: '/r', timeout: 5000 }]]);
  listing.tasks.push({ key: 'FX-4', parent: 'FX-3' });
  assert.notEqual(await epicPrune.context({ messages: [summary] }, ctx(10, [epic, compaction])), undefined);
  assert.equal(taskLists().length, 1);
  assert.equal(await epicPrune.context({ messages: [summary] }, ctx(10, [epic, compaction, { type: 'compaction', id: 'cp2' }])), undefined);
  assert.equal(taskLists().length, 2);
  await epicPrune.context({ messages: [summary] }, ctx(10, [epic, compaction, { type: 'compaction', id: 'cp3' }]));
  assert.equal(taskLists().length, 2);
});
