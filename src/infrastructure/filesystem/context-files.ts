import { constants, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ContextFiles } from '../../shared/context.js';
import { InputError } from '../../shared/errors.js';

export function relativeContextPath(path: string): void {
  if (!path || isAbsolute(path) || path.includes('\\') || /[\x00-\x1f:]/.test(path)
    || path.split('/').some(p => !p || p === '.' || p === '..' || p === '.git')) {
    throw new InputError('Invalid context-relative path');
  }
}

export function contextFiles(root: string): ContextFiles & { path(path: string): string } {
  root = resolve(root);
  // Also reject symlink ancestors of the supplied root, not only its descendants.
  function safe(path: string): string {
    relativeContextPath(path);
    const target = join(root, path);
    let current = target;
    while (true) {
      if (existsSync(current) || (() => { try { lstatSync(current); return true; } catch { return false; } })()) {
        const stat = lstatSync(current);
        if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) throw new InputError('Symlink/hardlink in context path');
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return target;
  }
  function write(path: string, text: string, flags: number): void {
    if (typeof text !== 'string' || Buffer.from(text, 'utf8').toString('utf8') !== text) throw new InputError('Invalid Unicode text');
    const target = safe(path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const fd = openSync(safe(path), flags | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, text, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
  }
  return {
    path: safe,
    isFile(path) { const target = safe(path); return existsSync(target) && lstatSync(target).isFile(); },
    read(path) { const target = safe(path); return existsSync(target) ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(target)) : undefined; },
    list(path) { const target = safe(path); return existsSync(target) ? readdirSync(target).sort() : []; },
    create(path, text) { write(path, text, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL); },
    append(path, text) { write(path, text, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND); },
    replace(path, text, expected) {
      if (this.read(path) !== expected) throw new InputError('Context changed; re-read before editing');
      const temp = path + '.' + randomUUID() + '.tmp';
      try {
        this.create(temp, text);
        if (this.read(path) !== expected) throw new InputError('Context changed; re-read before editing');
        renameSync(safe(temp), safe(path));
      } finally { if (existsSync(safe(temp))) unlinkSync(safe(temp)); }
    },
  };
}
