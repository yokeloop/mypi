import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createApp } from '../../src/app/create-app.js';
import { executeCommand } from '../../src/app/execute-command.js';
import type { WorkContext } from '../../src/modules/work-context/public.js';
import { parseCommand } from '../../src/cli/command.js';
import { run } from '../../src/cli/run.js';
import { toolCommand } from '../../src/mcp/tools.js';
import { createServer } from '../../src/mcp/server.js';
import { state } from '../support/state.js';

// Wiring canary, not a second policy matrix. Shared dispatch transitively uses
// Git adapters, so it belongs in boundary even though diagnostics spawn nothing.
test('CLI and MCP share cooperative diagnostics and ordinary context-bearing operations', async t => {
  const { dir, filename } = state(t), root = join(dir, 'absent-home');
  const registry = createApp(filename, false);
  t.after(() => registry.close());
  registry.projects.add('one/project', 'MP');
  registry.projects.add('other/project', 'OP');
  const context: WorkContext = { scope: { kind: 'project', project: 'one/project' } };
  const text = 'version: 2\nguards: {outsideWorktreeWrite: warn}\n', file = join(dir, 'policy.yaml');
  writeFileSync(file, text);
  const cliValidation = await run(parseCommand(['policy', 'validate', '--file', file]), filename, root, context);
  assert.deepEqual(cliValidation, { valid: true, policy: { version: 2,
    guards: { outsideWorktreeWrite: 'warn', baseCheckoutWrite: 'block', foreignMypiTarget: 'block' } }, diagnostic: 'cooperative' });
  assert.deepEqual(cliValidation, await executeCommand(toolCommand('policy_validate', { text }), filename, root));
  const explanation = { guard: 'outsideWorktreeWrite', behavior: 'warn',
    message: 'Configured to warn when writing outside the selected worktree.', diagnostic: 'cooperative' };
  assert.deepEqual(await run(parseCommand(['policy', 'explain', 'outsideWorktreeWrite', '--file', file]), filename, root, context), explanation);
  await assert.rejects(run(parseCommand(['policy', 'validate', '--file', join(dir, 'missing.yaml')]), filename, root, context), /Policy input unavailable/);

  // MP-9 routing is pending: selection does not silently filter or deny ordinary calls.
  const listed = await executeCommand({ name: 'project_list' }, filename, root);
  assert.equal((listed as { projects: unknown[] }).projects.length, 2);
  assert.deepEqual(await run(parseCommand(['project', 'list']), filename, root, context), listed);
  await run(parseCommand(['status', 'add', 'custom']), filename, root, context);
  assert.ok((await executeCommand({ name: 'status_list' }, filename) as { code: string }[]).some(s => s.code === 'custom'));
  await assert.rejects(executeCommand({ name: 'project_add', identity: 'invalid', code: 'BAD' }, filename, root, context));
  assert.equal(existsSync(root), false, 'diagnostics and DB-only commands do not initialize home');

  const server = createServer(filename, root, context), client = new Client({ name: 'policy-canary', version: '1' });
  t.after(async () => { await client.close(); await server.stop(); await server.server.close(); });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.server.connect(serverTransport); await client.connect(clientTransport);
  const explained = await client.callTool({ name: 'policy_explain', arguments: { guard: 'outsideWorktreeWrite', text } });
  assert.deepEqual(explained.structuredContent, { status: 'ok', data: explanation });
  const ordinaryCall = await client.callTool({ name: 'project_list', arguments: {} });
  assert.deepEqual(ordinaryCall.structuredContent, { status: 'ok', data: listed });
  const invalid = await client.callTool({ name: 'policy_validate', arguments: { text: 'version: 1' } });
  assert.equal(invalid.isError, true);
  assert.match(String((invalid.structuredContent as Record<string, unknown>)['message']), /version 1 is incompatible/);
});
