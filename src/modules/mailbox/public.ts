import { InputError } from '../../shared/errors.js';

export const MESSAGE_TEXT_BYTES = 16 * 1024;
export const MESSAGE_DEFAULT_TTL = 24 * 60 * 60 * 1000;
export const MESSAGE_MAX_TTL = 7 * MESSAGE_DEFAULT_TTL;
export interface MessageSender { kind: 'cli' | 'native'; nativeSessionId?: string; project?: string }
export interface MessageEnvelope {
  version: 1;
  messageId: string;
  receiverNativeSessionId: string;
  sender: MessageSender;
  receiverProject?: string;
  text: string;
  createdAt: number;
  expiresAt: number;
}
export type MessageStatus = 'queued' | 'handed-to-pi' | 'uncertain' | 'expired';
export interface MessageView { envelope: MessageEnvelope; status: MessageStatus; handedAt?: number }
export function messageId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new InputError('Invalid message ID');
}
export function nativeSessionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) throw new InputError('Invalid native session ID');
}
export function messageTime(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new InputError('Invalid message time');
}
function project(value: unknown): boolean {
  return typeof value === 'string' && /^[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value);
}
function mapping(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
// UTF-8 size without importing IO/runtime adapters into the pure rules.
function utf8Bytes(text: string): number {
  let size = 0;
  for (const char of text) { const point = char.codePointAt(0)!; size += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4; }
  return size;
}
export function parseMessageEnvelope(value: unknown): MessageEnvelope | undefined {
  if (!mapping(value) || Object.keys(value).some(k => !['version', 'messageId', 'receiverNativeSessionId', 'sender', 'receiverProject', 'text', 'createdAt', 'expiresAt'].includes(k))) return;
  const sender = value['sender'];
  if (value['version'] !== 1 || !mapping(sender) || Object.keys(sender).some(k => !['kind', 'nativeSessionId', 'project'].includes(k))) return;
  if (sender['kind'] !== 'cli' && sender['kind'] !== 'native') return;
  if (sender['kind'] === 'cli' && 'nativeSessionId' in sender) return;
  if ('project' in sender && !project(sender['project'])) return;
  if ('receiverProject' in value && !project(value['receiverProject'])) return;
  if (typeof value['text'] !== 'string' || value['text'].length === 0 || utf8Bytes(value['text']) > MESSAGE_TEXT_BYTES) return;
  try {
    messageId(value['messageId']); nativeSessionId(value['receiverNativeSessionId']);
    if (sender['kind'] === 'native') nativeSessionId(sender['nativeSessionId']);
    if (typeof value['createdAt'] !== 'number' || typeof value['expiresAt'] !== 'number') return;
    messageTime(value['createdAt']); messageTime(value['expiresAt']);
    const ttl = value['expiresAt'] - value['createdAt'];
    if (ttl <= 0 || ttl > MESSAGE_MAX_TTL) return;
  } catch { return; }
  return value as unknown as MessageEnvelope;
}
export function sameMessage(a: MessageEnvelope, b: MessageEnvelope): boolean {
  return a.messageId === b.messageId && a.receiverNativeSessionId === b.receiverNativeSessionId
    && a.sender.kind === b.sender.kind && a.sender.nativeSessionId === b.sender.nativeSessionId
    && a.sender.project === b.sender.project && a.receiverProject === b.receiverProject && a.text === b.text
    && a.expiresAt - a.createdAt === b.expiresAt - b.createdAt;
}
export function messageView(envelope: MessageEnvelope, claimed: boolean, handedAt: number | undefined, now: number): MessageView {
  messageTime(now);
  if (handedAt !== undefined) return { envelope, status: 'handed-to-pi', handedAt };
  if (claimed) return { envelope, status: 'uncertain' };
  return { envelope, status: now >= envelope.expiresAt ? 'expired' : 'queued' };
}
export function canCleanMessage(view: MessageView): boolean { return view.status === 'handed-to-pi' || view.status === 'expired'; }
