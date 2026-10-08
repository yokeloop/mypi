import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createApp } from '../../src/app/create-app.js';
import { executeCommand } from '../../src/app/execute-command.js';
import { createRevisionedPolicySnapshot, validatePolicyText } from '../../src/app/policy-config.js';
import type { TrustedExecutionContext } from '../../src/app/execution-context.js';
import { parseCommand } from '../../src/cli/command.js';
import { run } from '../../src/cli/run.js';
import { toolCommand } from '../../src/mcp/tools.js';
import { createServer } from '../../src/mcp/server.js';
import { state } from '../support/state.js';

// Wiring canary, not a second decision matrix. Shared dispatch transitively uses
// Git adapters, so it belongs in boundary even though diagnostics spawn nothing.
test('policy diagnostics share revisions, preserve trusted context and reject protected legacy calls before effects', async t => {
  const { dir, filename } = state(t), root = join(dir, 'absent-home');
  const registry = createApp(filename, false);
  t.after(() => registry.close());
  registry.projects.add('one/project', 'MP');
  registry.projects.add('secret/foreign', 'SF');
  const text = 'version: 1\n', file = join(dir, 'preview.yaml');
  writeFileSync(file, text);
  const configuration = validatePolicyText(text);
  const cliValidation = await run(parseCommand(['policy', 'validate', '--file', file]), filename, root);
  assert.deepEqual(cliValidation, await executeCommand(toolCommand('policy_validate', { text }), filename, root));
  assert.deepEqual(cliValidation, { valid: true, revision: configuration.revision, revisionKind: 'configuration', enforced: false });
  const scope = { kind: 'project' as const, project: 'one/project' }, target = { kind: 'project', project: 'one/project' };
  const previewCommand = toolCommand('policy_preview', { text, action: 'data.read', target, scope, profile: 'isolated' });
  const preview = await executeCommand(previewCommand, filename, root) as Record<string, unknown>;
  assert.equal(preview['allowed'], true); assert.equal(preview['preview'], true); assert.equal(preview['enforced'], false);
  assert.match(String(preview['revision']), /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(preview['revision'], configuration.revision, 'effective and configuration revisions differ');
  assert.deepEqual(await run(parseCommand(['policy', 'preview', 'data.read', '--file', file, '--scope', JSON.stringify(scope),
    '--target', JSON.stringify(target), '--profile', 'isolated']), filename, root), preview);
  const snapshot = createRevisionedPolicySnapshot({ policy: configuration.policy, scope, profile: 'isolated', bindings: [],
    identity: { principal: { kind: 'agent', id: 'trusted' }, sessionId: 's', runtimeId: 'r' } });
  const context: TrustedExecutionContext = { caller: { ...snapshot.identity, snapshot, profile: snapshot.profile, capabilities: [], ownedBindingIds: [] },
    resolveDataTarget: selector => {
      if (selector.kind !== 'project') throw new Error('secret resolver path /private/foreign');
      const resolved = registry.projects.resolveScope(selector.project);
      return resolved.type === 'project' ? { kind: 'data', record: 'other',
        owner: { kind: 'project', project: resolved.project.org + '/' + resolved.project.slug } } : undefined;
    } };
  const explain = toolCommand('policy_explain', { action: 'data.read', target });
  assert.deepEqual(await executeCommand(explain, filename, root), {
    allowed: false, revision: null, reason: 'context-unavailable', rule: 'context-unavailable', preview: false, enforced: false,
  });
  // Source changes do not silently replace the caller's already evaluated snapshot.
  writeFileSync(file, 'version: 1\ndefaults: {allow: []}\n');
  const effective = await executeCommand(explain, filename, root, context);
  assert.deepEqual(effective, { allowed: true, revision: snapshot.revision, reason: 'allowed', rule: 'allowed', preview: false, enforced: false });
  for (const selected of [{ kind: 'project', project: 'secret/foreign' }, { kind: 'project', project: 'missing/project' }, { kind: 'request', key: 'SF-1' }]) {
    assert.deepEqual(await executeCommand(toolCommand('policy_explain', { action: 'data.read', target: selected }), filename, root, context), {
      allowed: false, revision: snapshot.revision, reason: 'target-unavailable', rule: 'target-unavailable', preview: false, enforced: false,
    });
  }
  await assert.rejects(executeCommand({ name: 'db_init' }, join(dir, 'forbidden.sqlite3'), root, context), /Scoped command dispatch unavailable/);
  await assert.rejects(run(parseCommand(['request', 'progress', 'MP-1', 'x', '--artifacts', join(dir, 'missing.json')]), filename, root, context), /Scoped command dispatch unavailable/);
  await assert.rejects(run(parseCommand(['policy', 'validate', '--file', join(dir, 'missing.yaml')]), filename, root, context), /Scoped command dispatch unavailable/);
  assert.deepEqual(await run(parseCommand(['policy', 'validate', text]), filename, root, context), cliValidation);
  assert.equal(existsSync(join(dir, 'forbidden.sqlite3')), false); assert.equal(existsSync(root), false);
  assert.equal((await executeCommand({ name: 'project_list' }, filename) as { projects: unknown[] }).projects.length, 2, 'legacy no-context behavior is retained, not protected');
  const server = createServer(filename, root, context), client = new Client({ name: 'policy-canary', version: '1' });
  t.after(async () => { await client.close(); await server.stop(); await server.server.close(); });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.server.connect(serverTransport); await client.connect(clientTransport);
  const explained = await client.callTool({ name: 'policy_explain', arguments: { action: 'data.read', target } });
  assert.deepEqual(explained.structuredContent, { status: 'ok', data: effective });
  const protectedCall = await client.callTool({ name: 'project_list', arguments: {} });
  assert.equal(protectedCall.isError, true);
  assert.match(String((protectedCall.structuredContent as Record<string, unknown>)['message']), /Scoped command dispatch unavailable/);
});
