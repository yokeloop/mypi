import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

const block = 64 * 1024;

export interface ReadEntry { entryId: string; parentEntryId: string | null; at: string; role: 'user' | 'assistant'; origin: 'human' | 'peer' | 'task_notification' | 'frame'; text: string }
export interface ReadResult { entries: ReadEntry[]; offset: number; name: string | null; cwd: string | null; parentNativeId: string | null }

function record(line: Buffer, visit: (record: Record<string, unknown>) => void): void {
  let entry: unknown;
  try { entry = JSON.parse(line.toString('utf8')); } catch { return; }
  if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) visit(entry as Record<string, unknown>);
}

export function walkRecords(path: string, offset: number, visit: (record: Record<string, unknown>) => void): number {
  let fd: number;
  try { fd = openSync(path, 'r'); } catch { return offset; }
  try {
    const size = fstatSync(fd).size;
    let position = size < offset ? 0 : offset, done = position, tail = Buffer.alloc(0);
    while (position < size) {
      const chunk = Buffer.alloc(Math.min(block, size - position));
      const length = readSync(fd, chunk, 0, chunk.length, position);
      if (length === 0) break;
      position += length;
      const data = Buffer.concat([tail, chunk.subarray(0, length)]);
      let start = 0, end = data.indexOf(0x0a, tail.length);
      while (end >= 0) {
        record(data.subarray(start, end), visit);
        start = end + 1;
        end = data.indexOf(0x0a, start);
      }
      done = position - (data.length - start);
      tail = data.subarray(start);
    }
    return done;
  } finally {
    closeSync(fd);
  }
}

export function blockText(content: unknown): string {
  return typeof content === 'string' ? content
    : Array.isArray(content) ? content.filter(part => typeof part === 'object' && part !== null && part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text as string).join('\n')
    : '';
}

export function filled(text: string): boolean {
  return text.trim() !== '';
}
