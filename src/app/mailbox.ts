import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { externalStatePath } from '../infrastructure/filesystem/paths.js';
import { BusyMailbox, InvalidMailbox, mailboxFiles } from '../infrastructure/filesystem/mailbox.js';
import type { MailboxRecord } from '../infrastructure/filesystem/mailbox.js';
import { canCleanMessage, MESSAGE_DEFAULT_TTL, messageId, messageTime, messageView, nativeSessionId, parseMessageEnvelope, sameMessage } from '../modules/mailbox/public.js';
import type { MessageEnvelope, MessageSender, MessageView } from '../modules/mailbox/public.js';
import type { WorkContext } from '../modules/work-context/public.js';
import { sessionProject } from '../modules/session-cards/public.js';
import { createSessionCards } from './session-cards.js';
import { InputError } from '../shared/errors.js';

export type { MessageEnvelope, MessageSender, MessageView } from '../modules/mailbox/public.js';
export { MESSAGE_DEFAULT_TTL, MESSAGE_MAX_TTL, MESSAGE_TEXT_BYTES, parseMessageEnvelope } from '../modules/mailbox/public.js';
/** Ordinary integration metadata, never authentication or a focused-UI inference. */
export interface MessageCaller { nativeSessionId?: string; context?: WorkContext }
export type MessageCommand =
  | { name: 'message_send'; instanceKey: string; messageId: string; text: string; ttlMs?: number }
  | { name: 'message_list'; receiverNativeSessionId: string }
  | { name: 'message_show' | 'message_cleanup'; receiverNativeSessionId: string; messageId: string };
export type MessageIssue = 'missing' | 'incomplete' | 'invalid' | 'unavailable';
export interface MessageRead { message: MessageView | null; issue?: MessageIssue }
export interface MessageList { messages: MessageView[]; issues: { recordKey?: string; issue: MessageIssue }[]; truncated: boolean }
export interface MailboxOptions {
  env?: Readonly<Record<string, string | undefined>>;
  home?: string;
  contextRoot?: string;
  clock?: () => number;
}
const engineRoot = fileURLToPath(new URL('../../../', import.meta.url));
export function resolveMailboxDirectory(env: Readonly<Record<string, string | undefined>>, home: string, contextRoot = join(engineRoot, 'home')): string {
  const state = env['XDG_STATE_HOME'] || join(home, '.local', 'state');
  if (env['MYPI_MAILBOX_DIR'] === undefined && !isAbsolute(state)) throw new InputError('XDG_STATE_HOME must be absolute');
  return externalStatePath(externalStatePath(env['MYPI_MAILBOX_DIR'] ?? join(state, 'mypi', 'mailbox'), engineRoot, 'Mailbox'), contextRoot, 'Mailbox');
}
function issue(error: unknown): MessageIssue {
  return error instanceof InvalidMailbox ? 'invalid' : error instanceof BusyMailbox ? 'incomplete' : 'unavailable';
}
function project(context?: WorkContext): string | undefined {
  return context?.selectedProject ?? (context?.scope.kind === 'project' ? context.scope.project : undefined);
}
export function createMailbox(options: MailboxOptions = {}) {
  const directory = resolveMailboxDirectory(options.env ?? process.env, options.home ?? homedir(), options.contextRoot);
  const clock = options.clock ?? Date.now;
  function receiver(id: string) {
    nativeSessionId(id);
    const files = mailboxFiles(directory, id);
    function observe(raw: MailboxRecord | undefined, expectedId?: string, recordKey?: string): MessageRead {
      if (!raw) return { message: null, issue: 'missing' };
      if (raw.envelope === undefined) return { message: null, issue: 'incomplete' };
      const envelope = parseMessageEnvelope(raw.envelope);
      if (!envelope || envelope.receiverNativeSessionId !== id || (expectedId !== undefined && envelope.messageId !== expectedId)
        || (recordKey !== undefined && !files.matchesKey(envelope.messageId, recordKey))) return { message: null, issue: 'invalid' };
      let handedAt: number | undefined;
      if (raw.outcome !== undefined) {
        const outcome = raw.outcome as { version?: unknown; handedAt?: unknown } | null;
        if (!raw.claimed || !outcome || typeof outcome !== 'object' || Array.isArray(outcome)
          || Object.keys(outcome).some(k => k !== 'version' && k !== 'handedAt') || outcome.version !== 1
          || typeof outcome.handedAt !== 'number' || !Number.isSafeInteger(outcome.handedAt) || outcome.handedAt < envelope.createdAt) {
          return { message: messageView(envelope, true, undefined, clock()), issue: 'invalid' };
        }
        handedAt = outcome.handedAt;
      }
      return { message: messageView(envelope, raw.claimed, handedAt, clock()), ...(raw.busy ? { issue: 'incomplete' as const } : {}) };
    }
    function show(selectedId: string): MessageRead {
      messageId(selectedId);
      try { return observe(files.read(selectedId), selectedId); }
      catch (error) { return { message: null, issue: issue(error) }; }
    }
    return {
      show,
      list(): MessageList {
        const result: MessageList = { messages: [], issues: [], truncated: false };
        try {
          const scan = files.scan(); result.truncated = scan.truncated;
          for (let n = 0; n < scan.invalid; n++) result.issues.push({ issue: 'invalid' });
          for (const recordKey of scan.keys) {
            let found: MessageRead;
            try { found = observe(files.readKey(recordKey), undefined, recordKey); }
            catch (error) { found = { message: null, issue: issue(error) }; }
            if (found.message) result.messages.push(found.message);
            if (found.issue) result.issues.push({ recordKey, issue: found.issue });
          }
        } catch (error) { result.issues.push({ issue: issue(error) }); }
        result.messages.sort((a, b) => a.envelope.createdAt - b.envelope.createdAt || a.envelope.messageId.localeCompare(b.envelope.messageId));
        return result;
      },
      claim(selectedId: string) {
        messageId(selectedId);
        const envelope = files.guard(selectedId, () => {
          const before = files.read(selectedId);
          // Our own exclusion marker is expected while inside the critical section.
          const found = observe(before && { ...before, busy: false }, selectedId);
          if (found.issue || found.message?.status !== 'queued') return undefined;
          if (!files.claim(selectedId)) return undefined;
          const after = files.read(selectedId);
          const claimed = observe(after && { ...after, busy: false }, selectedId);
          if (claimed.issue || claimed.message?.status !== 'uncertain' || clock() >= claimed.message.envelope.expiresAt) return undefined;
          return claimed.message.envelope;
        });
        if (!envelope) return undefined;
        let attempted = false;
        return {
          envelope,
          /** One synchronous public handoff only; errors leave the persisted claim uncertain. */
          handoff(currentNativeId: () => string | undefined, forward: (message: MessageEnvelope) => void): boolean {
            if (attempted) throw new InputError('Message claim handoff already attempted');
            attempted = true;
            const now = clock(); messageTime(now);
            if (now < envelope.createdAt || now >= envelope.expiresAt || currentNativeId() !== id) return false;
            forward(envelope);
            const handedAt = clock(); messageTime(handedAt);
            files.complete(selectedId, handedAt);
            return true;
          },
        };
      },
      cleanup(selectedId: string) {
        messageId(selectedId);
        return files.guard(selectedId, () => {
          const raw = files.read(selectedId);
          const found = observe(raw && { ...raw, busy: false }, selectedId);
          if (found.issue || !found.message || !canCleanMessage(found.message)) throw new InputError('Only handed-to-Pi or expired unclaimed messages can be cleaned');
          files.remove(selectedId);
          return { receiverNativeSessionId: id, messageId: selectedId, removed: true as const };
        });
      },
    };
  }
  return {
    directory,
    receiver,
    send(input: Extract<MessageCommand, { name: 'message_send' }>, caller: MessageCaller = {}) {
      messageId(input.messageId);
      const cards = createSessionCards(options);
      const destination = cards.show({ instanceKey: input.instanceKey, all: true });
      if (!destination.session) throw new InputError('Cannot resolve destination observation: ' + destination.issue);
      const id = destination.session.card.nativeSessionId;
      const senderProject = project(caller.context), receiverProject = sessionProject(destination.session.card);
      const sender: MessageSender = caller.nativeSessionId === undefined ? { kind: 'cli' } : { kind: 'native', nativeSessionId: caller.nativeSessionId };
      if (senderProject !== undefined) sender.project = senderProject;
      const createdAt = clock();
      const envelope = parseMessageEnvelope({ version: 1, messageId: input.messageId, receiverNativeSessionId: id,
        sender, ...(receiverProject === undefined ? {} : { receiverProject }), text: input.text,
        createdAt, expiresAt: createdAt + (input.ttlMs ?? MESSAGE_DEFAULT_TTL) });
      if (!envelope) throw new InputError('Invalid message envelope, text size, identity or TTL');
      const files = mailboxFiles(directory, id);
      const target = receiver(id);
      const saved = files.reserve(input.messageId, envelope);
      const observed = target.show(input.messageId);
      if (!observed.message || observed.issue) throw new InputError('Message reservation is ' + (observed.issue ?? 'incomplete') + '; inspect before retrying');
      if (!sameMessage(observed.message.envelope, envelope)) throw new InputError('Message ID conflict');
      return { message: observed.message, duplicate: !saved };
    },
  };
}
export function executeMessageCommand(command: MessageCommand, caller?: MessageCaller, options?: MailboxOptions) {
  const mailbox = createMailbox(options);
  if (command.name === 'message_send') return mailbox.send(command, caller);
  const receiver = mailbox.receiver(command.receiverNativeSessionId);
  switch (command.name) {
    case 'message_list': return receiver.list();
    case 'message_show': return receiver.show(command.messageId);
    case 'message_cleanup': return receiver.cleanup(command.messageId);
  }
}
