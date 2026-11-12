import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { TestContext } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerCompact } from '../../.pi/extensions/mypi-lib/compact.js';
import type { CompactOptions } from '../../.pi/extensions/mypi-lib/compact.js';

const contextDir = 'projects/fx/fixture/tasks/FX-1-one';
const moment = new Date('2026-11-12T10:00:00.000Z');
const settled = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function fixture(t: TestContext) {
  const home = mkdtempSync(join(tmpdir(), 'mypi-compact-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, contextDir), { recursive: true });
  const calls: unknown[][] = [], sent: unknown[][] = [], notes: [string, string][] = [], compactions: CompactOptions[] = [];
  const tools = new Map<string, any>();
  const state = { show: { code: 0, stderr: '' }, status: '', commit: { code: 0, stderr: '' }, idle: true, throws: undefined as Error | undefined, refuseSend: false };
  const pi = {
    registerTool(tool: any) { tools.set(tool.name, tool); },
    async exec(command: string, args: string[], options: { cwd: string; timeout: number }) {
      calls.push([command, args, options]);
      if (command === 'node') return { code: state.show.code, killed: false, stderr: state.show.stderr, stdout: state.show.code === 0 ? JSON.stringify({ contextDir }) : '' };
      if (command === 'git') return { code: 0, killed: false, stderr: '', stdout: state.status };
      return { code: state.commit.code, killed: false, stderr: state.commit.stderr, stdout: '' };
    },
    sendUserMessage(content: string, options: unknown) { if (state.refuseSend) throw new Error('busy'); sent.push([content, options]); },
  };
  const compactor = registerCompact(pi, { root: '/r', cli: '/r/dist/src/cli/main.js', home }, () => moment);
  const ctx = { hasUI: true, ui: { notify(message: string, level: 'info' | 'warning') { notes.push([message, level]); } }, isIdle: () => state.idle,
    compact(options: CompactOptions) { if (state.throws) throw state.throws; compactions.push(options); } };
  const tool = tools.get('mypi_compact');
  const call = (params: { key: string; resume: string; focus: string }) => tool.execute('call-1', params);
  return { home, folder: join(home, contextDir), calls, sent, notes, compactions, state, compactor, ctx, tool, call };
}

test('mypi_compact refuses a malformed resume or key without a request', async t => {
  const f = fixture(t);
  assert.equal(f.tool.label, 'mypi compact');
  assert.equal(f.tool.executionMode, 'sequential');
  assert.equal('exposure' in f.tool, false);
  assert.deepEqual(f.tool.parameters.required, ['key', 'resume', 'focus']);
  for (const resume of ['flow fx', '/ship flow/fx']) {
    const result = await f.call({ key: 'FX-1', resume, focus: 'f' });
    assert.equal(result.details.error, 'resume');
    assert.equal(result.isError, true);
    assert.equal('terminate' in result, false);
    assert.ok(result.content[0].text.startsWith('Error: '));
  }
  const malformed = await f.call({ key: 'fx-1', resume: '/flow fx FX-1', focus: 'f' });
  assert.equal(malformed.details.error, 'key');
  assert.equal(malformed.isError, true);
  assert.equal('terminate' in malformed, false);
  assert.deepEqual(f.calls, []);
  f.state.show = { code: 1, stderr: 'Unknown task FX-1' };
  const unknown = await f.call({ key: 'FX-1', resume: '/flow fx FX-1', focus: 'f' });
  assert.equal(unknown.details.error, 'key');
  assert.equal(unknown.isError, true);
  assert.equal('terminate' in unknown, false);
  assert.ok(unknown.details.message.includes('Unknown task FX-1'));
  f.compactor.settle(f.ctx);
  assert.equal(f.compactions.length, 0);
});

test('mypi_compact refuses while the project\'s home is dirty', async t => {
  const f = fixture(t);
  f.state.status = ' M projects/fx/fixture/tasks/FX-1-one/knowledge.md\n';
  const dirty = await f.call({ key: 'FX-1', resume: '/flow fx FX-1', focus: 'f' });
  assert.equal(dirty.details.error, 'dirty');
  assert.equal(dirty.isError, true);
  assert.equal('terminate' in dirty, false);
  assert.ok(dirty.content[0].text.includes('projects/fx/fixture/tasks/FX-1-one/knowledge.md'));
  assert.ok(dirty.content[0].text.includes('mp-home-commit'));
  assert.deepEqual(f.calls[1], ['git', ['-C', f.home, 'status', '--porcelain', '--', 'projects/fx/fixture'], { cwd: '/r', timeout: 5000 }]);
  f.compactor.settle(f.ctx);
  assert.equal(f.compactions.length, 0);
  f.state.status = '';
  const clean = await f.call({ key: 'FX-1', resume: '/flow fx FX-1', focus: 'f' });
  assert.equal(clean.terminate, true);
  assert.equal(clean.isError, undefined);
  assert.equal(clean.details.folder, join(f.home, 'projects/fx/fixture/tasks/FX-1-one'));
});

test('mypi_compact compacts after the turn settles, saves and commits the summary, then resumes', async t => {
  const f = fixture(t);
  const result = await f.call({ key: 'FX-1', resume: ' /flow fx FX-1 FX-2 ', focus: 'next FX-2' });
  assert.equal(result.terminate, true);
  assert.deepEqual(result.details, { key: 'FX-1', resume: '/flow fx FX-1 FX-2', focus: 'next FX-2', folder: f.folder });
  let quiet = false;
  void f.compactor.quiet().then(() => { quiet = true; });
  f.state.idle = false;
  f.compactor.settle(f.ctx);
  assert.equal(f.compactions.length, 0);
  f.state.idle = true;
  f.compactor.settle(f.ctx);
  assert.equal(f.compactions.length, 1);
  const options = f.compactions[0]!;
  for (const part of ['"/flow fx FX-1 FX-2"', 'flows/fx.md', 'knowledge.md', 'Point at the files', 'next FX-2']) assert.ok(options.customInstructions.includes(part), part);
  await settled();
  assert.equal(quiet, false);
  const commits = f.calls.length;
  options.onComplete({ summary: 'S', tokensBefore: 900, estimatedTokensAfter: 100 });
  await settled();
  const text = readFileSync(join(f.folder, 'compactions.md'), 'utf8');
  assert.ok(text.includes('## 2026-11-12T10:00:00.000Z — /flow fx FX-1 FX-2'));
  assert.ok(text.includes('Токены: 900 → 100'));
  assert.ok(text.includes('S'));
  assert.deepEqual(f.calls.slice(commits), [['bash', ['/r/scripts/pipeline/mp-home-commit', 'FX-1', 'FX-1: compaction summary'], { cwd: '/r', timeout: 60000 }]]);
  assert.deepEqual(f.sent, [['/skill:flow fx FX-1 FX-2', { deliverAs: 'followUp', expandPromptTemplates: true }]]);
  assert.equal(quiet, false);
  f.compactor.started();
  await settled();
  assert.equal(quiet, true);
  assert.deepEqual(f.notes, []);
  f.compactor.settle(f.ctx);
  assert.equal(f.compactions.length, 1);
});

test('mypi_compact warns when the summary is not committed and still resumes', async t => {
  const f = fixture(t);
  f.state.commit = { code: 1, stderr: 'push failed' };
  await f.call({ key: 'FX-1', resume: '/flow fx FX-1 FX-2', focus: 'next FX-2' });
  f.compactor.settle(f.ctx);
  f.compactions[0]!.onComplete({ summary: 'S', tokensBefore: 900 });
  await settled();
  assert.ok(readFileSync(join(f.folder, 'compactions.md'), 'utf8').includes('Токены: 900 → ?'));
  assert.equal(f.notes.length, 1);
  assert.ok(f.notes[0]![0].includes('not committed: push failed'));
  assert.equal(f.notes[0]![1], 'warning');
  assert.deepEqual(f.sent, [['/skill:flow fx FX-1 FX-2', { deliverAs: 'followUp', expandPromptTemplates: true }]]);
});

test('mypi_compact resumes after nothing to compact and after a failed compaction', async t => {
  const f = fixture(t);
  const resume = ['/skill:epic FX-1', { deliverAs: 'followUp', expandPromptTemplates: true }];
  for (const message of ['Nothing to compact (session too small)', 'Already compacted', 'boom']) {
    await f.call({ key: 'FX-1', resume: '/epic FX-1', focus: 'next step 2' });
    f.compactor.settle(f.ctx);
    f.compactions.at(-1)!.onError(new Error(message));
    await settled();
    assert.deepEqual(f.sent.at(-1), resume);
  }
  assert.equal(f.sent.length, 3);
  assert.equal(f.compactions[0]!.customInstructions.includes('flows/'), false);
  assert.equal(existsSync(join(f.folder, 'compactions.md')), false);
  assert.equal(f.calls.some(call => call[0] === 'bash'), false);
  assert.deepEqual(f.notes, [['mypi compact failed: boom. The run continues without compaction.', 'warning']]);
  f.state.throws = new Error('no model');
  await f.call({ key: 'FX-1', resume: '/epic FX-1', focus: 'next step 2' });
  f.compactor.settle(f.ctx);
  assert.equal(f.sent.length, 4);
  assert.deepEqual(f.sent.at(-1), resume);
  assert.ok(f.notes.at(-1)![0].includes('no model'));
  f.state.throws = undefined;
  await f.call({ key: 'FX-1', resume: '/epic FX-1', focus: 'next step 2' });
  f.compactor.reset();
  f.compactor.settle(f.ctx);
  assert.equal(f.compactions.length, 3);
  assert.equal(f.sent.length, 4);
});

test('mypi_compact holds event batches from the request until the resumed run starts, with fallbacks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  const watch = () => {
    const seen = { quiet: false };
    void f.compactor.quiet().then(() => { seen.quiet = true; });
    return seen;
  };
  assert.equal(watch().quiet, false);
  await settled();
  const request = { key: 'FX-1', resume: '/epic FX-1', focus: 'next step 2' };
  await f.call(request);
  const dropped = watch();
  f.compactor.started();
  await settled();
  assert.equal(dropped.quiet, false);
  f.compactor.reset();
  await settled();
  assert.equal(dropped.quiet, true);
  await f.call(request);
  const timed = watch();
  f.compactor.settle(f.ctx);
  f.compactor.reset();
  await settled();
  assert.equal(timed.quiet, false);
  f.compactions.at(-1)!.onError(new Error('Already compacted'));
  await settled();
  assert.equal(timed.quiet, false);
  t.mock.timers.tick(4999);
  await settled();
  assert.equal(timed.quiet, false);
  t.mock.timers.tick(1);
  await settled();
  assert.equal(timed.quiet, true);
  await f.call(request);
  const refused = watch();
  f.state.refuseSend = true;
  f.compactor.settle(f.ctx);
  f.compactions.at(-1)!.onError(new Error('Already compacted'));
  await settled();
  assert.equal(refused.quiet, true);
});
