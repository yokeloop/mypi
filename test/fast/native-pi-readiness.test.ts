import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeStartupObservation } from '../../src/app/native-startup-match.js';
import type { SessionList } from '../../src/app/session-cards.js';

const receipt = { status: 'submitted' as const, herdrSocketPath: '/run/test.sock', tabId: 'target', paneId: 'pane' };
const context = { scope: { kind: 'organization' as const, organization: 'one' } };
const plan = { cwd: '/tmp/project', args: [], context: { version: 1 as const, cwd: '/tmp/project', context } };
const token = 'bdbb6ae3-68d5-4335-8df7-79f4806e22ee';
const card = { version: 1 as const, instanceKey: token, nativeSessionId: 'new-native', cwd: plan.cwd,
  launchToken: token, context, herdrSocketPath: receipt.herdrSocketPath, herdrTabId: receipt.tabId,
  herdrPaneId: receipt.paneId, state: 'starting' as const, startedAt: 100, lastSeen: 100 };
const inventory = (change: Partial<typeof card> = {}): SessionList => ({ sessions: [{ card: { ...card, ...change },
  status: 'starting', ageMs: 0, archived: false }], issues: [], truncated: false });

test('native startup requires fresh token, exact target and scope; a correlated exit is not readiness', () => {
  assert.equal(nativeStartupObservation(inventory(), receipt, plan, token), 'ready');
  for (const changed of [{ launchToken: 'fdbb6ae3-68d5-4335-8df7-79f4806e22ee' },
    { nativeSessionId: '' }, { herdrPaneId: 'another' }, { herdrTabId: 'another' },
    { herdrSocketPath: '/run/another.sock' }, { cwd: '/tmp/other' },
    { context: { scope: { kind: 'organization' as const, organization: 'two' } } }]) {
    assert.equal(nativeStartupObservation(inventory(changed), receipt, plan, token), 'pending');
  }
  assert.equal(nativeStartupObservation({ ...inventory(), sessions: [{ ...inventory().sessions[0]!, status: 'stale' }] }, receipt, plan, token), 'pending');
  assert.equal(nativeStartupObservation({ ...inventory(), truncated: true }, receipt, plan, token), 'unavailable');
  assert.equal(nativeStartupObservation({ ...inventory(), sessions: [] }, receipt, plan, token), 'pending');
  assert.equal(nativeStartupObservation({ ...inventory(), sessions: [{ ...inventory().sessions[0]!,
    card: { ...card, state: 'closed' }, status: 'closed' }] }, receipt, plan, token), 'closed');
});
