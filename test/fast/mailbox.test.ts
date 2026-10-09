import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMailbox, executeMessageCommand, resolveMailboxDirectory } from '../../src/app/mailbox.js';
import { createSessionCards } from '../../src/app/session-cards.js';
import { canCleanMessage, messageView, parseMessageEnvelope, sameMessage } from '../../src/modules/mailbox/public.js';

const envelope = { version: 1 as const, messageId: 'msg-1', receiverNativeSessionId: 'pi/receiver',
  sender: { kind: 'native' as const, nativeSessionId: 'pi/sender', project: 'one/project' }, receiverProject: 'two/project',
  text: 'Other session: exact\r\nтекст', createdAt: 1000, expiresAt: 2000 };
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

test('mailbox pure envelope, expiry, uncertainty and dedup rules have literal oracles', () => {
  assert.deepEqual(parseMessageEnvelope(envelope), envelope);
  for (const [claimed, handedAt, now, status, clean] of [
    [false, undefined, 1999, 'queued', false], [false, undefined, 2000, 'expired', true],
    [true, undefined, 1999, 'uncertain', false], [true, undefined, 2000, 'uncertain', false],
    [true, 1500, 3000, 'handed-to-pi', true],
  ] as const) {
    const view = messageView(envelope, claimed, handedAt, now);
    assert.equal(view.status, status); assert.equal(canCleanMessage(view), clean);
  }
  assert(sameMessage(envelope, { ...envelope, createdAt: 5000, expiresAt: 6000 }));
  for (const change of [{ text: 'changed' }, { expiresAt: 2001 }, { receiverNativeSessionId: 'different' },
    { receiverProject: 'one/project' }, { sender: { ...envelope.sender, nativeSessionId: 'different' } },
    { sender: { ...envelope.sender, project: 'two/project' } }, { messageId: 'msg-2' }]) {
    assert.equal(sameMessage(envelope, { ...envelope, ...change }), false);
  }
  for (const change of [{ version: 2 }, { messageId: '../escape' }, { receiverNativeSessionId: '' },
    { text: '' }, { text: 'я'.repeat(8193) }, { createdAt: NaN }, { expiresAt: 1000 }, { expiresAt: 604801001 },
    { sender: { kind: 'cli', nativeSessionId: 'invented' } }, { sender: { kind: 'native' } },
    { sender: { kind: 'cli', project: 'MP' } }, { extra: true }]) {
    assert.equal(parseMessageEnvelope({ ...envelope, ...change }), undefined, JSON.stringify(change));
  }
  assert(parseMessageEnvelope({ ...envelope, text: 'я'.repeat(8192) }));
  assert.throws(() => messageView(envelope, false, undefined, NaN));
});

test('mailbox disposable files preserve dedup, claim exclusivity, outcomes and selected cleanup', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-mailbox-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'runtime'), contextRoot = join(dir, 'context'), home = join(dir, 'home');
  const env = { MYPI_MAILBOX_DIR: root, MYPI_SESSION_DIR: join(dir, 'sessions') };
  let now = 1000;
  const options = { env, contextRoot, home, clock: () => now };
  const mailbox = createMailbox(options), receiver = mailbox.receiver('pi/receiver');
  assert.equal(resolveMailboxDirectory({}, home, contextRoot), join(home, '.local/state/mypi/mailbox'));
  assert.throws(() => resolveMailboxDirectory({ MYPI_MAILBOX_DIR: contextRoot }, home, contextRoot), /outside/);
  assert.throws(() => resolveMailboxDirectory({ XDG_STATE_HOME: 'relative' }, home, contextRoot), /absolute/);
  assert.deepEqual(receiver.list(), { messages: [], issues: [], truncated: false });
  assert.deepEqual(receiver.show('msg-1'), { message: null, issue: 'missing' });
  assert.deepEqual(readdirSync(dir), [], 'reads create no mailbox, DB, home or context');
  const history = join(dir, 'native.jsonl'); writeFileSync(history, 'native history remains exact\n');
  const cards = createSessionCards(options);
  const card = cards.start({ nativeSessionId: 'pi/receiver', cwd: dir, nativeSessionFile: history,
    context: { scope: { kind: 'project', project: 'two/project' } } });
  card.update('close'); cards.archive({ instanceKey: card.instanceKey, all: true });
  const sender = { nativeSessionId: 'pi/sender', context: { scope: { kind: 'project' as const, project: 'one/project' } } };
  const input = { name: 'message_send' as const, instanceKey: card.instanceKey, messageId: 'msg-1', text: envelope.text, ttlMs: 1000 };
  const saved = mailbox.send(input, sender);
  assert.deepEqual(saved, { message: { envelope, status: 'queued' }, duplicate: false });
  const receiverPath = join(root, digest('pi/receiver'));
  const record = (id: string) => join(receiverPath, digest(id));
  assert.deepEqual(JSON.parse(readFileSync(join(record('msg-1'), 'envelope.json'), 'utf8')), envelope);
  now = 1200;
  assert.deepEqual(mailbox.send(input, sender), { message: { envelope, status: 'queued' }, duplicate: true });
  assert.throws(() => mailbox.send({ ...input, text: 'conflict' }, sender), /conflict/);
  assert.throws(() => mailbox.send(input), /conflict/, 'changing sender cannot overwrite an ID');
  assert.deepEqual(mailbox.receiver(card.instanceKey).list().messages, [], 'MP11 instance key is not native address');
  assert.deepEqual(mailbox.receiver('other-native').show('msg-1'), { message: null, issue: 'missing' });
  const cli = executeMessageCommand({ ...input, messageId: 'cli', text: 'operator', ttlMs: 1 }, undefined, options);
  assert.deepEqual(cli, { message: { envelope: { version: 1, messageId: 'cli', receiverNativeSessionId: 'pi/receiver',
    sender: { kind: 'cli' }, receiverProject: 'two/project', text: 'operator', createdAt: 1200, expiresAt: 1201 }, status: 'queued' }, duplicate: false });
  assert.throws(() => receiver.cleanup('msg-1'), /Only handed/);

  // Interleave real competing admission/cleanup while the stable per-ID exclusion exists.
  const originalWrite = fs.writeFileSync;
  let guarded = 0;
  const writeMock = t.mock.method(fs, 'writeFileSync', (...args: Parameters<typeof writeFileSync>) => {
    const result = originalWrite(...args);
    if (args[0] === join(receiverPath, '.' + digest('msg-1') + '.busy')) {
      guarded++;
      assert.throws(() => createMailbox(options).receiver('pi/receiver').claim('msg-1'), /busy or incomplete/);
      assert.throws(() => receiver.cleanup('msg-1'), /busy or incomplete/);
    }
    return result;
  });
  let claim: ReturnType<typeof receiver.claim>;
  try { syncBuiltinESMExports(); claim = receiver.claim('msg-1'); }
  finally { writeMock.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(guarded, 1); assert(claim);
  assert.equal(receiver.show('msg-1').message?.status, 'uncertain');
  assert.equal(readFileSync(join(record('msg-1'), 'claim'), 'utf8'), '');
  assert.equal(receiver.claim('msg-1'), undefined, 'ordinary competing receiver cannot forward again');
  const forwarded: unknown[] = [];
  assert.equal(claim.handoff(() => 'pi/receiver', value => forwarded.push(value)), true);
  assert.deepEqual(forwarded, [envelope]);
  assert.deepEqual(JSON.parse(readFileSync(join(record('msg-1'), 'outcome.json'), 'utf8')), { version: 1, handedAt: 1200 });
  assert.deepEqual(receiver.show('msg-1'), { message: { envelope, status: 'handed-to-pi', handedAt: 1200 } });
  assert.throws(() => claim.handoff(() => 'pi/receiver', () => assert.fail()), /already attempted/);

  for (const id of ['crash', 'failure', 'switched', 'late']) mailbox.send({ ...input, messageId: id }, sender);
  receiver.claim('crash'); // Deliberate crash gap: no outcome operation.
  const failure = receiver.claim('failure')!;
  assert.throws(() => failure.handoff(() => 'pi/receiver', () => { throw new Error('Pi call failed'); }), /Pi call failed/);
  assert.equal(receiver.claim('switched')!.handoff(() => 'other-native', () => assert.fail()), false);
  const late = receiver.claim('late')!;
  now = 2200;
  assert.equal(late.handoff(() => 'pi/receiver', () => assert.fail()), false, 'exact expiry forbids forwarding');
  for (const id of ['crash', 'failure', 'switched', 'late']) {
    assert.equal(receiver.show(id).message?.status, 'uncertain');
    assert.equal(receiver.claim(id), undefined);
    assert.throws(() => receiver.cleanup(id), /Only handed/, 'uncertain is never cleaned, even after expiry');
    assert.equal(existsSync(join(record(id), 'outcome.json')), false);
  }
  assert.equal(receiver.claim('cli'), undefined, 'expired unclaimed cannot be admitted');
  assert.deepEqual(receiver.cleanup('cli'), { receiverNativeSessionId: 'pi/receiver', messageId: 'cli', removed: true });
  assert.equal(receiver.show('cli').issue, 'missing');

  // A second cleaner cannot delete the new queued incarnation during the first cleanup.
  const originalRemove = fs.rmSync;
  let cleaned = 0;
  const removeMock = t.mock.method(fs, 'rmSync', (...args: Parameters<typeof rmSync>) => {
    if (args[0] === record('msg-1')) {
      cleaned++;
      assert.throws(() => receiver.claim('msg-1'), /busy or incomplete/);
      assert.throws(() => receiver.cleanup('msg-1'), /busy or incomplete/);
      const result = originalRemove(...args);
      // Send does not take the guard. Publication succeeds, but reports the concurrent busy observation.
      assert.throws(() => mailbox.send(input, sender), /incomplete/);
      assert.throws(() => receiver.cleanup('msg-1'), /busy or incomplete/);
      return result;
    }
    return originalRemove(...args);
  });
  try { syncBuiltinESMExports(); receiver.cleanup('msg-1'); }
  finally { removeMock.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(cleaned, 1);
  assert.equal(receiver.show('msg-1').message?.status, 'queued');
  assert.equal(receiver.show('msg-1').message?.envelope.createdAt, 2200);
  assert.equal(mailbox.send(input, sender).duplicate, true);

  mkdirSync(record('partial'));
  assert.deepEqual(receiver.show('partial'), { message: null, issue: 'incomplete' });
  assert.throws(() => mailbox.send({ ...input, messageId: 'partial' }, sender), /incomplete/);
  writeFileSync(join(record('partial'), 'envelope.json'), 'x'.repeat(32769));
  assert.deepEqual(receiver.show('partial'), { message: null, issue: 'invalid' });
  const busy = join(receiverPath, '.' + digest('msg-1') + '.busy');
  writeFileSync(busy, '');
  assert.equal(receiver.show('msg-1').issue, 'incomplete');
  assert.throws(() => receiver.claim('msg-1'), /busy or incomplete/);
  rmSync(busy);
  // Malformed/partial entries occupy admission quota, not just valid envelopes.
  for (let i = readdirSync(receiverPath).length; i < 100; i++) mkdirSync(join(receiverPath, digest('reservation-' + i)));
  assert.equal(mailbox.send(input, sender).duplicate, true, 'dedup is still available at capacity');
  assert.throws(() => mailbox.send({ ...input, text: 'changed' }, sender), /conflict/);
  assert.throws(() => mailbox.send({ ...input, messageId: 'over-capacity' }, sender), /admission limit/);
  for (let i = 100; i < 1001; i++) mkdirSync(join(receiverPath, digest('reservation-' + i)));
  const incomplete = receiver.list();
  assert.equal(incomplete.truncated, true);
  assert.equal(incomplete.messages.length + incomplete.issues.length, 1000, 'hard scan bound, no complete-inventory claim');
  assert.equal(readFileSync(history, 'utf8'), 'native history remains exact\n');
  assert.equal(existsSync(contextRoot), false); assert.equal(existsSync(home), false);
});
