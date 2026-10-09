import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkspaceCheckConfig, workspaceCheckState } from '../../src/shared/workspace-check.js';
import type { WorkspaceCheckCache } from '../../src/shared/workspace-check.js';

test('workspace check freshness distinguishes absent, interrupted, failed and changed content without using commit IDs', () => {
  const passed: WorkspaceCheckCache = { version: 1, binding: 'task', state: 'passed', content: 'checked',
    startedAt: '2026-01-01T00:00:00Z', outcomes: [{ argv: ['check'], exitCode: 0, outcome: 'passed' }] };
  for (const [cache, binding, content, expected] of [
    [null, 'task', 'checked', 'absent'],
    [passed, 'task', 'checked', 'current'],
    [passed, 'other', 'checked', 'stale'],
    [passed, 'task', 'changed', 'stale'],
    [passed, 'task', null, 'unavailable'],
    [{ ...passed, state: 'running' }, 'task', 'checked', 'interrupted'],
    [{ ...passed, state: 'failed' }, 'task', 'checked', 'failed'],
    [{ ...passed, state: 'unavailable' }, 'task', 'checked', 'unavailable'],
  ] as const) assert.equal(workspaceCheckState(cache, binding, content), expected);
});

test('workspace checks require explicit project commands, not empty or unknown-field defaults', () => {
  const config = { version: 1, commands: [{ argv: ['mise', 'exec', '--', 'pnpm', 'verify'] }] };
  assert.deepEqual(parseWorkspaceCheckConfig(config), config);
  for (const value of [null, {}, { ...config, version: 2 }, { ...config, commands: [] },
    { ...config, green: true }, { ...config, commands: [{ argv: [] }] },
    { ...config, commands: [{ argv: ['check'], shell: true }] },
    { ...config, commands: [{ argv: ['check', '\0'] }] },
    { ...config, commands: Array(9).fill({ argv: ['check'] }) }]) {
    assert.throws(() => parseWorkspaceCheckConfig(value), /invalid .mypi-checks.json/);
  }
});
