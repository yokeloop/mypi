import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { InputError } from '../../shared/errors.js';

export const MAILBOX_RECORD_BYTES = 32 * 1024;
export const MAILBOX_SCAN_ENTRIES = 1000;
export const MAILBOX_MESSAGES = 100;
export const MAILBOX_RECEIVERS = 1000;
const keyPattern = /^[a-f0-9]{64}$/;
export class InvalidMailbox extends Error {}
export class BusyMailbox extends Error {}
function absent(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
function exists(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'EEXIST'; }
function key(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function directory(path: string): boolean {
  try { if (!lstatSync(path).isDirectory()) throw new InvalidMailbox('Expected mailbox directory'); return true; }
  catch (error) { if (absent(error)) return false; throw error; }
}
function scan(path: string): { keys: string[]; occupied: number; invalid: number; truncated: boolean } {
  const result = { keys: [] as string[], occupied: 0, invalid: 0, truncated: false };
  if (!directory(path)) return result;
  const dir = opendirSync(path);
  try {
    while (result.occupied < MAILBOX_SCAN_ENTRIES) {
      const entry = dir.readSync();
      if (!entry) return result;
      result.occupied++;
      if (keyPattern.test(entry.name) && entry.isDirectory()) result.keys.push(entry.name);
      else result.invalid++;
    }
    result.truncated = true;
    return result;
  } finally { dir.closeSync(); }
}
function json(path: string): unknown | undefined {
  let fd: number;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAILBOX_RECORD_BYTES) throw new InvalidMailbox('Invalid mailbox record');
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) { if (absent(error)) return undefined; throw error; }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAILBOX_RECORD_BYTES) throw new InvalidMailbox('Invalid mailbox record');
    const buffer = Buffer.alloc(MAILBOX_RECORD_BYTES + 1);
    let size = 0, n: number;
    while (size < buffer.length && (n = readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += n;
    if (size > MAILBOX_RECORD_BYTES) throw new InvalidMailbox('Mailbox record exceeds 32KiB');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))) as unknown; }
    catch { throw new InvalidMailbox('Invalid mailbox JSON'); }
  } finally { closeSync(fd); }
}
function marker(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size !== 0) throw new InvalidMailbox('Invalid mailbox marker');
    return true;
  } catch (error) { if (absent(error)) return false; throw error; }
}
function publish(path: string, name: string, value: unknown): void {
  const data = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(data) > MAILBOX_RECORD_BYTES) throw new InputError('Mailbox record exceeds 32KiB');
  const temporary = join(path, '.' + randomUUID() + '.tmp');
  // Never create parents: a missing reservation must not be silently recreated.
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    try { writeFileSync(fd, data); } finally { closeSync(fd); }
    renameSync(temporary, join(path, name));
  } finally { try { unlinkSync(temporary); } catch (error) { if (!absent(error)) throw error; } }
}
export interface MailboxRecord { envelope: unknown; claimed: boolean; outcome: unknown; busy: boolean }
/** One concrete local file protocol. Admission counts are observed, not transactions. */
export function mailboxFiles(root: string, nativeId: string) {
  const receiver = join(root, key(nativeId));
  const recordPath = (id: string) => join(receiver, key(id));
  const guardPath = (id: string) => join(receiver, '.' + key(id) + '.busy');
  function area(): boolean { return directory(root) && directory(receiver); }
  function readKey(recordKey: string): MailboxRecord | undefined {
    if (!keyPattern.test(recordKey)) throw new InvalidMailbox('Invalid record key');
    if (!area()) return;
    const path = join(receiver, recordKey);
    if (!directory(path)) return;
    return { envelope: json(join(path, 'envelope.json')), claimed: marker(join(path, 'claim')),
      outcome: json(join(path, 'outcome.json')), busy: marker(join(receiver, '.' + recordKey + '.busy')) };
  }
  return {
    scan() { return area() ? scan(receiver) : { keys: [], occupied: 0, invalid: 0, truncated: false }; },
    read(id: string) { return readKey(key(id)); },
    readKey,
    matchesKey(id: string, recordKey: string) { return key(id) === recordKey; },
    reserve(id: string, envelope: unknown): boolean {
      // Validate byte admission before creating even an incomplete reservation.
      if (Buffer.byteLength(JSON.stringify(envelope) + '\n') > MAILBOX_RECORD_BYTES) throw new InputError('Mailbox record exceeds 32KiB');
      if (area() && directory(recordPath(id))) return false;
      if (!directory(root)) mkdirSync(root, { recursive: true, mode: 0o700 });
      if (!directory(receiver)) {
        const receivers = scan(root);
        if (receivers.truncated || receivers.occupied >= MAILBOX_RECEIVERS) throw new InputError('Mailbox receiver admission limit');
        try { mkdirSync(receiver, { mode: 0o700 }); } catch (error) { if (!exists(error) || !directory(receiver)) throw error; }
      }
      const records = scan(receiver);
      // A racing identical creator must remain inspectable even at capacity.
      if (directory(recordPath(id))) return false;
      if (records.truncated || records.occupied >= MAILBOX_MESSAGES) throw new InputError('Mailbox message admission limit');
      try { mkdirSync(recordPath(id), { mode: 0o700 }); }
      catch (error) { if (exists(error) && directory(recordPath(id))) return false; throw error; }
      publish(recordPath(id), 'envelope.json', envelope);
      return true;
    },
    guard<T>(id: string, action: () => T): T {
      if (!area()) throw new InputError('Missing mailbox');
      const path = guardPath(id);
      try { writeFileSync(path, '', { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (exists(error)) throw new BusyMailbox('Mailbox record busy or incomplete'); throw error; }
      try { return action(); } finally { unlinkSync(path); }
    },
    claim(id: string): boolean {
      try { writeFileSync(join(recordPath(id), 'claim'), '', { flag: 'wx', mode: 0o600 }); return true; }
      catch (error) { if (exists(error)) return false; throw error; }
    },
    complete(id: string, handedAt: number): void { publish(recordPath(id), 'outcome.json', { version: 1, handedAt }); },
    remove(id: string): void { rmSync(recordPath(id), { recursive: true }); },
  };
}
