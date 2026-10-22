import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeHistory, nativeHistoryFacts } from '../../src/app/native-chat-facts.js';
import { herdrExit, herdrResponse, HerdrError, localEndpoint, matchedPaneOutput, nativeAgent, nativeProcessIdentity, paneProcesses, resolvedPi } from '../../src/app/native-herdr-facts.js';
import { freshNativeModel, launchPreference, nativeArguments, nativeShellEnvironment, openingResult } from '../../src/app/native-chat-launch.js';
import type { NativeProcessSnapshot } from '../../src/app/native-herdr-facts.js';
import { nativeOwnership, ownershipRoute, type AgentObservation } from '../../src/app/native-chat-ownership.js';
import type { WorkChat } from '../../src/modules/work-chats/public.js';

const chat: WorkChat = { id: 'chat', name: null, attemptId: 'attempt', requestId: 1, projectId: 2,
  sourceClone: '/clone', worktree: '/task', gitCommonDir: '/clone/.git', branch: 'task/one', installation: '/engine', statePath: '/state',
  sessionId: 'session-a', historyPath: '/state/sessions/date_session-a.jsonl', pane: 'w1:p1', processId: 21, processStart: '123',
  processBootId: 'boot-a', herdrEndpoint: '/tmp/herdr.sock', requestedProvider: null, requestedModel: null, phase: 'ready' };
const expected = { pi: '/bin/pi', agentDir: '/agent', scope: 'team/tool', endpoint: '/tmp/herdr.sock', pane: 'w2:p9' };
const snapshot: NativeProcessSnapshot = { pid: 21, start: '123', boot: 'boot-a', executable: '/bin/pi', cwd: '/task',
  argv: ['pi', '--mypi-scope', 'team/tool', '--session-dir', '/state/sessions', '--session', chat.historyPath!],
  env: { XDG_STATE_HOME: '/state', PI_CODING_AGENT_DIR: '/agent', HERDR_SOCKET_PATH: '/tmp/herdr.sock' } };

test('Herdr structured pane absence is distinct from transport failure, never an implicit death fact', () => {
  for (const code of ['pane_not_found', 'agent_pane_not_found']) {
    assert.throws(() => herdrResponse('', JSON.stringify({ error: { code, message: 'missing' } }), 1),
      error => error instanceof HerdrError && error.code === code);
  }
  assert.throws(() => herdrResponse('', 'socket refused', 1), error => error instanceof HerdrError && error.code === undefined);
  assert.deepEqual(herdrResponse('{"result":{"agents":[]}}', '', 0), { agents: [] });
  for (const stdout of ['', 'not-json', '{}', '{"result":null}', '{"result":[]}', '{"error":{"code":"failed"}}']) {
    assert.throws(() => herdrResponse(stdout, '', 0), 'structured observations never accept empty/malformed payloads');
  }
  assert.equal(localEndpoint('/tmp/herdr.sock'), '/tmp/herdr.sock');
  for (const value of ['https://server/path?token=x', '/tmp/../run/socket', 'relative', '/tmp/socket?token=x']) assert.throws(() => localEndpoint(value));
});

test('pane input exit status is separate from structured completion and focus observations', () => {
  assert.doesNotThrow(() => herdrExit('', 0));
  for (const status of [1, null]) assert.throws(() => herdrExit('', status), HerdrError);
  assert.throws(() => herdrExit('{"error":{"code":"pane_not_found"}}', 1), error => error instanceof HerdrError && error.code === 'pane_not_found');
  const matched = { type: 'output_matched', pane_id: 'w1:p2' };
  assert.doesNotThrow(() => matchedPaneOutput(herdrResponse(JSON.stringify({ result: matched }), '', 0), 'w1:p2'));
  for (const result of [{}, { ...matched, type: 'ok' }, { ...matched, pane_id: 'w1:p3' }]) {
    assert.throws(() => matchedPaneOutput(result, 'w1:p2'), /completion unconfirmed/);
  }
  // Herdr 0.8.2 agent focus uses print_response, not the empty-output pane-run contract.
  assert.deepEqual(herdrResponse('{"result":{"type":"ok"}}', '', 0), { type: 'ok' });
});

test('native shell configuration forwarding is explicit, filtered and does not override pinned resources', () => {
  const allowed = { HOME: '/target home', ZDOTDIR: '', XDG_CONFIG_HOME: '/target/config', XDG_CACHE_HOME: '/target/cache' };
  assert.deepEqual(nativeShellEnvironment({ ...allowed, PATH: '/wrong', XDG_STATE_HOME: '/wrong', PI_CODING_AGENT_DIR: '/wrong',
    PI_OFFLINE: '0', MYPI_WORK_CHAT_PI: '/wrong', API_KEY: 'synthetic-test-only', HERDR_SOCKET_PATH: '/wrong' }),
  ['--env', 'HOME=/target home', '--env', 'ZDOTDIR=', '--env', 'XDG_CONFIG_HOME=/target/config', '--env', 'XDG_CACHE_HOME=/target/cache']);
  assert.deepEqual(nativeShellEnvironment({ HOME: undefined, UNRELATED: 'value' }), []);
});

test('stock native session metadata is independent of mutable labels and readiness', () => {
  const agent = { pane_id: 'w2:p9', name: 'renamed', agent: 'pi', foreground_cwd: '/task', interactive_ready: true };
  assert.equal(nativeAgent(agent).sessionPath, undefined, 'trust UI readiness has no native identity');
  const session = { agent: 'pi', source: 'herdr:pi', kind: 'path', value: chat.historyPath };
  assert.deepEqual(nativeAgent({ ...agent, agent_session: session }), { pane: 'w2:p9', kind: 'pi', cwd: '/task', sessionPath: chat.historyPath });
  for (const change of [{ kind: 'id' }, { source: 'custom:ack' }, { agent: 'claude' }]) {
    assert.equal(nativeAgent({ ...agent, agent_session: { ...session, ...change } }).sessionPath, undefined);
  }
  assert.throws(() => paneProcesses({ process_info: { shell_pid: 10 } }));
  assert.equal(paneProcesses({ process_info: { shell_pid: 10, foreground_process_group_id: 10, foreground_processes: [{ pid: 10, cwd: '/task' }] } }).shellPid, 10);
});

test('live process matches exact executable, cwd, argv, resources, PID/start/boot/server; moved pane is accepted', () => {
  const process = nativeProcessIdentity(snapshot, chat, expected);
  assert.equal(process.pane, 'w2:p9');
  assert.equal(process.processBootId, 'boot-a');
  for (const change of [{ pid: 22 }, { start: '124' }, { boot: 'boot-b' }, { executable: '/bin/pi-wrapper' }, { cwd: '/other' },
    { argv: [...snapshot.argv, '--mypi-scope', 'team/other'] },
    { argv: snapshot.argv.map(value => value === chat.historyPath ? '/state/sessions/fork.jsonl' : value) }]) {
    assert.throws(() => nativeProcessIdentity({ ...snapshot, ...change }, chat, expected));
  }
  for (const key of ['XDG_STATE_HOME', 'PI_CODING_AGENT_DIR', 'HERDR_SOCKET_PATH']) {
    assert.throws(() => nativeProcessIdentity({ ...snapshot, env: { ...snapshot.env, [key]: '/other' } }, chat, expected));
  }
  assert.throws(() => nativeProcessIdentity(snapshot, { ...chat, herdrEndpoint: '/tmp/other.sock' }, expected));
  const reserved = { ...chat, historyPath: null, pane: null, processId: null, processStart: null, processBootId: null, herdrEndpoint: null };
  assert.equal(nativeProcessIdentity({ ...snapshot, argv: ['pi', '--session-id', 'session-a', '--session-dir', '/state/sessions', '--mypi-scope', 'team/tool'] }, reserved, expected).processId, 21);
  assert.throws(() => nativeProcessIdentity({ ...snapshot, argv: ['pi', '--session-id', 'foreign'] }, reserved, expected));
});

test('shell resolution accepts one absolute executable path, not alias/function/multiline output', () => {
  assert.equal(resolvedPi('/safe path/pi\n'), '/safe path/pi');
  for (const output of ['pi', "pi='bad'", 'pi () { bad; }', '/safe/pi\n/unsafe/pi', '']) assert.throws(() => resolvedPi(output));
});

test('native launch uses durable UUID, installed extension and exact preferences; resume never applies saved/config defaults', () => {
  const base = { chat, resume: false, extension: '/stock/herdr.ts', scope: 'team/tool' };
  const model = { source: 'invocation' as const, provider: 'custom', model: 'path/model-id' };
  assert.deepEqual(nativeArguments({ ...base, model }), ['--offline', '-e', '/stock/herdr.ts', '--session-dir', '/state/sessions',
    '--session-id', 'session-a', '--provider', 'custom', '--model', 'path/model-id', '--mypi-scope', 'team/tool']);
  for (const source of ['saved session', 'project', 'default'] as const) {
    const args = nativeArguments({ ...base, resume: true, model: { ...model, source } });
    assert(args.includes(chat.historyPath!));
    assert(!args.includes('--model')); assert(!args.includes('--session-id'));
  }
  const override = nativeArguments({ ...base, resume: true, model });
  assert(override.includes('--model')); assert(override.includes('--session'));
  const defaults = nativeArguments({ ...base, model: { source: 'unselected' } });
  assert(!defaults.includes('--model')); assert(!defaults.some(arg => arg.includes('chat-attempt') || arg.includes('chat-unpinned')));
  assert.equal(launchPreference({ source: 'unselected' }, false), undefined);
});

test('explicit model is a launch preference, not readiness: exact/fuzzy/unknown selection cannot silently succeed', () => {
  const native = { sessionId: chat.sessionId!, historyPath: chat.historyPath! };
  const process = nativeProcessIdentity(snapshot, chat, expected);
  const live = { status: 'live' as const, native, process };
  const preference = { provider: 'custom', model: 'path/model-id' };
  assert.equal(openingResult(live).status, 'opened', 'native default does not need an auth/catalog/model receipt');
  assert.equal(openingResult({ ...live, model: preference }, preference).status, 'opened');
  const historicalMatch = openingResult({ ...live, model: preference }, preference, false);
  assert.equal(historicalMatch.status, 'partial');
  if (historicalMatch.status === 'partial') assert.match(historicalMatch.reason, /unconfirmed/);
  for (const selected of [undefined, { provider: 'custom', model: 'path/model-id-larger' }, { provider: 'other', model: 'path/model-id' }]) {
    const result = openingResult({ ...live, ...(selected ? { model: selected } : {}) }, preference);
    assert.equal(result.status, 'partial');
    if (result.status === 'partial') {
      assert.equal(result.pane, 'w2:p9'); assert.equal(result.processId, 21); assert.deepEqual(result.native, native);
      assert.match(result.reason, /Requested custom\/path\/model-id/);
    }
  }
  assert.equal(openingResult({ status: 'unknown', reason: 'trust unresolved' }).status, 'partial');
});

test('explicit resume confirmation requires a newly appended model entry on the active branch, not historical equality', () => {
  const lines = [
    { type: 'session', version: 3, id: 'session-a', cwd: '/task' },
    { type: 'model_change', id: 'old', parentId: null, provider: 'custom', modelId: 'exact' },
    { type: 'model_change', id: 'old-offbranch', parentId: 'old', provider: 'custom', modelId: 'exact' },
    { type: 'custom', id: 'leaf', parentId: 'old' },
  ];
  const parse = (rows: object[]) => nativeHistoryFacts(rows.map(row => JSON.stringify(row)).join('\n'), 'session-a', '/task');
  const before = parse(lines);
  assert.equal(freshNativeModel(before.entryIds, before), false);
  assert.equal(freshNativeModel(before.entryIds, parse([...lines, { type: 'custom', id: 'nav', parentId: 'old-offbranch' }])), false);
  const change = { type: 'model_change', id: 'fresh', parentId: 'leaf', provider: 'custom', modelId: 'exact' };
  const fresh = parse([...lines, change]);
  assert.equal(freshNativeModel(before.entryIds, fresh), true);
  assert.deepEqual(fresh.saved, { status: 'selected', selection: { provider: 'custom', model: 'exact' } });
  const mismatch = parse([...lines, { ...change, modelId: 'fuzzy-fallback' }]);
  assert.equal(freshNativeModel(before.entryIds, mismatch), true, 'freshness alone does not prove equality');
  assert.deepEqual(mismatch.saved, { status: 'selected', selection: { provider: 'custom', model: 'fuzzy-fallback' } });
  assert.equal(freshNativeModel(before.entryIds, parse([...lines, change, { type: 'custom', id: 'back', parentId: 'leaf' }])), false);
  assert.equal(freshNativeModel(before.entryIds, parse([...lines, { type: 'custom', customType: 'mypi-model', id: 'custom', parentId: 'leaf', data: change }])), false);
});

test('saved model follows native active branch; legacy binding entries are optional but conflicting bindings refuse', () => {
  const row = (value: object) => JSON.stringify(value);
  const header = row({ type: 'session', version: 3, id: 'session-a', cwd: '/task' });
  const one = row({ type: 'model_change', id: 'a', parentId: null, provider: 'custom', modelId: 'first' });
  const foreign = row({ type: 'model_change', id: 'b', parentId: 'a', provider: 'custom', modelId: 'foreign' });
  const leaf = row({ type: 'custom', id: 'c', parentId: 'a' });
  assert.deepEqual(nativeHistory([header, one, foreign, leaf].join('\n'), 'session-a', '/task'),
    { status: 'selected', selection: { provider: 'custom', model: 'first' } });
  const binding = { installation: '/engine', state: '/state', scope: 'team/tool' };
  assert.deepEqual(nativeHistory(header, 'session-a', '/task', binding), { status: 'none' });
  const scoped = row({ type: 'custom', customType: 'mypi-startup-binding', data: binding, id: 'bound', parentId: 'a' });
  assert.deepEqual(nativeHistory([header, one, scoped].join('\n'), 'session-a', '/task', binding),
    { status: 'selected', selection: { provider: 'custom', model: 'first' } });
  assert.throws(() => nativeHistory([header, one, scoped].join('\n'), 'session-a', '/task', { ...binding, scope: 'team/other' }), /another installation/);
  const newer = row({ type: 'model_change', id: 'new', parentId: 'bound', provider: 'custom', modelId: 'native-choice' });
  assert.deepEqual(nativeHistory([header, one, scoped, newer].join('\n'), 'session-a', '/task', binding),
    { status: 'selected', selection: { provider: 'custom', model: 'native-choice' } });
  for (const text of [header + '\n{bad', [header, one, one].join('\n'),
    [header, row({ type: 'custom', id: 'c', parentId: 'absent' })].join('\n')]) assert.throws(() => nativeHistory(text, 'session-a', '/task'));
  assert.throws(() => nativeHistory(header, 'session-b', '/task'));
  assert.throws(() => nativeHistory(header, 'session-a', '/foreign'));
});


test('production ownership decision observes origin and current server before using local process absence', () => {
  const current = '/tmp/current.sock', origin = chat.herdrEndpoint!;
  const moved = nativeAgent({ pane_id: 'w2:p9', name: 'renamed', agent: 'pi', foreground_cwd: chat.worktree,
    agent_session: { source: 'herdr:pi', agent: 'pi', kind: 'path', value: chat.historyPath } });
  const route = ownershipRoute(chat, current, 'boot-a');
  const observations = new Map<string, AgentObservation>([[origin, { agents: [moved] }], [current, { agents: [] }]]);
  const decision = nativeOwnership(chat, route, observations, { status: 'dead' });
  assert.equal(decision.status, 'candidate', 'an empty current server must not erase an originating-server writer');
  if (decision.status !== 'candidate') throw new Error('Expected exact live candidate');
  assert.equal(decision.endpoint, origin); assert.equal(decision.agent.pane, 'w2:p9');
  assert.equal(nativeProcessIdentity(snapshot, chat, { ...expected, endpoint: decision.endpoint, pane: decision.agent.pane }).processId, 21);
  observations.set(current, { agents: [{ ...moved, sessionPath: '/state/sessions/fork.jsonl' }] });
  assert.equal(nativeOwnership(chat, route, observations, { status: 'dead' }).status, 'unknown');
  observations.set(current, { agents: [] });
  observations.set(origin, { error: 'socket unreachable' });
  const unavailable = nativeOwnership(chat, route, observations, { status: 'dead' });
  assert.equal(unavailable.status, 'unknown');
  if (unavailable.status === 'unknown') assert.match(unavailable.reason!, /Originating Herdr unavailable.*socket unreachable/);
  observations.delete(origin);
  assert.equal(nativeOwnership(chat, route, observations, { status: 'dead' }).status, 'unknown');
  observations.set(origin, { agents: [] });
  assert.equal(nativeOwnership(chat, route, observations, { status: 'unknown', reason: 'PID still present' }).status, 'unknown');
  assert.equal(nativeOwnership(chat, route, observations, { status: 'dead' }).status, 'dead', 'both servers observed empty plus positive local absence');
  observations.set(current, { error: 'current server unreachable' });
  assert.equal(nativeOwnership(chat, route, observations, { status: 'dead' }).status, 'unknown');
});

test('production ownership decision handles reboot, legacy absence and moved versus switched native associations', () => {
  const current = '/tmp/current.sock';
  const moved = { pane: 'w2:p9', kind: 'pi', cwd: chat.worktree, sessionPath: chat.historyPath! };
  const reboot = ownershipRoute(chat, current, 'boot-b');
  const observations = new Map<string, AgentObservation>([[current, { agents: [] }]]);
  assert.equal(nativeOwnership(chat, reboot, observations, { status: 'unknown' }).status, 'dead', 'prior-boot process cannot survive; current server positively empty');
  observations.set(current, { agents: [{ ...moved, sessionPath: '/state/sessions/fork.jsonl' }] });
  assert.equal(nativeOwnership(chat, reboot, observations, { status: 'dead' }).status, 'unknown', 'reboot never licenses a second current writer');
  observations.set(current, { error: 'unreachable' });
  assert.equal(nativeOwnership(chat, reboot, observations, { status: 'dead' }).status, 'unknown');
  const legacy = { ...chat, processBootId: null, herdrEndpoint: null };
  const route = ownershipRoute(legacy, current, 'boot-b');
  observations.set(current, { agents: [] });
  assert.equal(nativeOwnership(legacy, route, observations, { status: 'dead' }).status, 'dead');
  assert.equal(nativeOwnership(legacy, route, observations, { status: 'unknown' }).status, 'unknown');
  observations.set(current, { agents: [moved] });
  assert.equal(nativeOwnership(legacy, route, observations, { status: 'unknown' }).status, 'candidate');
  for (const change of [{ sessionPath: '/state/sessions/switched.jsonl' }, { sessionPath: '/state/sessions/fork.jsonl' },
    { sessionPath: '' }, { cwd: '/foreign' }, { kind: 'other' }]) {
    observations.set(current, { agents: [{ ...moved, ...change }] });
    assert.equal(nativeOwnership(legacy, route, observations, { status: 'dead' }).status, 'unknown', JSON.stringify(change));
  }
  observations.set(current, { agents: [moved, { ...moved, pane: 'second' }] });
  assert.equal(nativeOwnership(legacy, route, observations, { status: 'dead' }).status, 'unknown');
  observations.set(current, { agents: [] });
  assert.equal(nativeOwnership({ ...legacy, processId: null, processStart: null }, route, observations, { status: 'dead' }).status, 'unknown');
});
