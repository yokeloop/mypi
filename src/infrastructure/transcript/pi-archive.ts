import { basename } from 'node:path';
import { blockText, filled, walkRecords } from './archive-read.js';
import type { ReadEntry, ReadResult } from './archive-read.js';

function nativeId(file: string): string {
  const name = basename(file, '.jsonl');
  const cut = name.indexOf('_');
  return cut < 0 ? name : name.slice(cut + 1);
}

export function piArchive(path: string, offset: number): ReadResult {
  const entries: ReadEntry[] = [];
  let name: string | null = null, cwd: string | null = null, parentNativeId: string | null = null;
  const next = walkRecords(path, offset, r => {
    if (r.type === 'session') {
      if (typeof r.cwd === 'string') cwd = r.cwd;
      if (typeof r.parentSession === 'string') parentNativeId = nativeId(r.parentSession);
      return;
    }
    if (r.type === 'session_info') {
      if (typeof r.name === 'string') name = filled(r.name) ? r.name : null;
      return;
    }
    if (r.type !== 'message' || typeof r.message !== 'object' || r.message === null) return;
    if (typeof r.id !== 'string' || typeof r.timestamp !== 'string') return;
    const message = r.message as { role?: unknown; stopReason?: unknown; content?: unknown };
    const base = { entryId: r.id, parentEntryId: typeof r.parentId === 'string' ? r.parentId : null, at: r.timestamp };
    if (message.role === 'user') {
      const text = blockText(message.content);
      if (filled(text)) entries.push({ ...base, role: 'user', origin: text.startsWith('[mypi: ') ? 'frame' : 'human', text });
    } else if (message.role === 'assistant' && message.stopReason === 'stop') {
      const text = blockText(message.content);
      if (filled(text)) entries.push({ ...base, role: 'assistant', origin: 'human', text });
    }
  });
  return { entries, offset: next, name, cwd, parentNativeId };
}
