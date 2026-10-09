import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InputError } from '../../shared/errors.js';

export const SESSION_CARD_BYTES = 32 * 1024;
export const SESSION_CARD_ENTRIES = 1000;
export const SESSION_INSTANCE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function validateSessionKey(key: string): void {
  if (!SESSION_INSTANCE_KEY.test(key)) throw new InputError('Invalid session instance key');
}
export class InvalidSessionCache extends Error {}
function absent(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
function directory(path: string): boolean {
  try {
    if (!lstatSync(path).isDirectory()) throw new InvalidSessionCache('Expected session cache directory');
    return true;
  } catch (error) { if (absent(error)) return false; throw error; }
}

/** Concrete observation files only; no native history or database access. */
export function sessionCardFiles(root: string) {
  const cards = join(root, 'cards'), archives = join(root, 'archives');
  function area(path: string, create = false): boolean {
    if (!directory(root)) {
      if (!create) return false;
      mkdirSync(root, { recursive: true, mode: 0o700 });
    }
    if (!directory(path)) {
      if (!create) return false;
      mkdirSync(path, { mode: 0o700 });
    }
    return true;
  }
  function archived(key: string): boolean {
    validateSessionKey(key);
    if (!area(archives)) return false;
    try {
      const stat = lstatSync(join(archives, key));
      if (!stat.isFile() || stat.size !== 0) throw new InvalidSessionCache('Invalid archive marker');
      return true;
    } catch (error) { if (absent(error)) return false; throw error; }
  }
  return {
    scan(): { keys: string[]; invalid: number; truncated: boolean } {
      if (!area(cards)) return { keys: [], invalid: 0, truncated: false };
      const dir = opendirSync(cards), keys: string[] = [];
      let invalid = 0, visited = 0;
      try {
        while (visited < SESSION_CARD_ENTRIES) {
          const entry = dir.readSync();
          if (!entry) return { keys, invalid, truncated: false };
          visited++;
          if (/^\.[0-9a-f-]+\.[0-9a-f-]+\.tmp$/.test(entry.name)) continue;
          const key = entry.name.endsWith('.json') ? entry.name.slice(0, -5) : '';
          if (!SESSION_INSTANCE_KEY.test(key) || !entry.isFile()) { invalid++; continue; }
          keys.push(key);
        }
        // Conservatively incomplete at the bound, without inspecting a 1001st entry.
        return { keys, invalid, truncated: true };
      } finally { dir.closeSync(); }
    },
    read(key: string): unknown | undefined {
      validateSessionKey(key);
      if (!area(cards)) return undefined;
      const filename = join(cards, key + '.json');
      let fd: number;
      try {
        const stat = lstatSync(filename);
        if (!stat.isFile() || stat.size > SESSION_CARD_BYTES) throw new InvalidSessionCache('Invalid session card file');
        fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      } catch (error) { if (absent(error)) return undefined; throw error; }
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > SESSION_CARD_BYTES) throw new InvalidSessionCache('Invalid session card file');
        const buffer = Buffer.alloc(SESSION_CARD_BYTES + 1);
        let size = 0, n: number;
        while (size < buffer.length && (n = readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += n;
        if (size > SESSION_CARD_BYTES) throw new InvalidSessionCache('Session card exceeds size bound');
        try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))) as unknown; }
        catch { throw new InvalidSessionCache('Invalid session card JSON'); }
      } finally { closeSync(fd); }
    },
    write(key: string, card: unknown): void {
      validateSessionKey(key);
      const data = JSON.stringify(card) + '\n';
      if (Buffer.byteLength(data) > SESSION_CARD_BYTES) throw new InputError('Session card exceeds 32KiB');
      area(cards, true);
      const temporary = join(cards, '.' + key + '.' + randomUUID() + '.tmp');
      const fd = openSync(temporary, 'wx', 0o600);
      try {
        try { writeFileSync(fd, data); } finally { closeSync(fd); }
        renameSync(temporary, join(cards, key + '.json'));
      } finally {
        try { unlinkSync(temporary); } catch (error) { if (!absent(error)) throw error; }
      }
    },
    archived,
    archive(key: string): void {
      if (archived(key)) return;
      area(archives, true);
      try { writeFileSync(join(archives, key), '', { flag: 'wx', mode: 0o600 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        archived(key); // Existing unexpected types are not an idempotent success.
      }
    },
  };
}
