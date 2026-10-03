import { closeSync, openSync, readSync, constants } from 'node:fs';
import { contextFiles } from '../../../infrastructure/filesystem/context-files.js';
import { entryValue } from '../model.js';
import type { JournalStore } from '../ports.js';

export function jsonlJournal(root: string): JournalStore {
  const files = contextFiles(root);
  return {
    append(entry) {
      const path = 'journal/' + entry.at.slice(0, 7) + '.jsonl';
      // Refuse an interrupted append rather than joining a new record to damaged bytes.
      const fdPath = files.path(path);
      let fd: number | undefined;
      try {
        fd = openSync(fdPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        const tail = Buffer.alloc(1);
        // Reading forward is unnecessary here; fstat gives the physical end of the file.
        const size = fileSize(fd);
        if (size && (readSync(fd, tail, 0, 1, size - 1) !== 1 || tail[0] !== 10)) throw new Error('Incomplete journal tail; inspect before append');
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      finally { if (fd !== undefined) closeSync(fd); }
      files.append(path, JSON.stringify(entryValue(entry)) + '\n');
      return path;
    },
    *entries(from, to) {
      for (const name of files.list('journal')) {
        if (!/^\d{4}-(0[1-9]|1[0-2])\.jsonl$/.test(name)) throw new Error('Unexpected journal file: ' + name);
        const month = name.slice(0, 7);
        if ((from && month < from) || (to && month > to)) continue;
        const fd = openSync(files.path('journal/' + name), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }), buffer = Buffer.alloc(65536);
          let pending = '', n = 0, line = 0;
          while ((n = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
            pending += decoder.decode(buffer.subarray(0, n), { stream: true });
            let end: number;
            while ((end = pending.indexOf('\n')) !== -1) {
              const text = pending.slice(0, end); pending = pending.slice(end + 1); line++;
              try {
                const value = entryValue(JSON.parse(text));
                if (!value.at.startsWith(month + '-')) throw new Error('Wrong rotation month');
                yield value;
              } catch (e) { throw new Error(name + ':' + line + ': ' + String(e)); }
            }
          }
          pending += decoder.decode();
          if (pending) throw new Error(name + ': incomplete final line');
        } finally { closeSync(fd); }
      }
    },
  };
}
import { fstatSync as fileSizeStat } from 'node:fs';
function fileSize(fd: number): number { return fileSizeStat(fd).size; }
