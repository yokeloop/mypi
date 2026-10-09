import { closeSync, constants, fstatSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { relativeContextPath } from './context-files.js';
import type { HomePending } from '../../shared/home-writer.js';
import { InputError } from '../../shared/errors.js';

const limit = 64 * 1024;
const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export function homePending(root: string) {
  const path = join(root, '.git/mypi-home-pending.json');
  function validate(value: unknown): HomePending {
    if (!value || typeof value !== 'object') throw new InputError('Invalid home pending record; inspect explicitly');
    const p = value as HomePending;
    if (Object.keys(p).some(key => !['id', 'operation', 'paths', 'beforeHead', 'phase', 'commit', 'destinationId'].includes(key))
      || typeof p.id !== 'string' || !/^[a-f0-9-]{36}$/.test(p.id)
      || typeof p.operation !== 'string' || !/^[a-z_]+$/.test(p.operation)
      || typeof p.beforeHead !== 'string' || !oid.test(p.beforeHead)
      || typeof p.destinationId !== 'string' || !/^[a-f0-9]{64}$/.test(p.destinationId)
      || !['mutating', 'committed', 'publishing'].includes(p.phase)
      || (p.commit !== undefined && (typeof p.commit !== 'string' || !oid.test(p.commit)))
      || (p.phase !== 'mutating' && p.commit === undefined)
      || !Array.isArray(p.paths) || !p.paths.length || new Set(p.paths).size !== p.paths.length) {
      throw new InputError('Invalid home pending record; inspect explicitly');
    }
    for (const file of p.paths) { if (typeof file !== 'string') throw new InputError('Invalid home pending paths'); relativeContextPath(file); }
    return p;
  }
  return {
    read(): HomePending | null {
      let fd: number;
      try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit) throw new InputError('Unsupported home pending record; inspect explicitly');
        try { return validate(JSON.parse(readFileSync(fd, 'utf8'))); }
        catch { throw new InputError('Invalid home pending record; inspect explicitly'); }
      } finally { closeSync(fd); }
    },
    write(pending: HomePending, initial = false) {
      const text = JSON.stringify(validate(pending)) + '\n';
      if (Buffer.byteLength(text) > limit) throw new InputError('Home pending record exceeds 64 KiB');
      const target = initial ? path : path + '.' + randomUUID() + '.tmp';
      const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, text); fsyncSync(fd); }
      finally { closeSync(fd); }
      if (!initial) {
        try { renameSync(target, path); }
        finally { try { unlinkSync(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
      }
    },
    clear() { unlinkSync(path); },
  };
}
