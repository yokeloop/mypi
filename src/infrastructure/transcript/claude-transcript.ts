import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

const block = 64 * 1024;

function turnPrompt(line: Buffer): { origin: string; text: string } | undefined {
  let entry: unknown;
  try { entry = JSON.parse(line.toString('utf8')); } catch { return undefined; }
  if (typeof entry !== 'object' || entry === null) return undefined;
  const { type, turnOrigin, message } = entry as { type?: unknown; turnOrigin?: unknown; message?: unknown };
  if (type !== 'user' || typeof turnOrigin !== 'string') return undefined;
  const content = typeof message === 'object' && message !== null ? (message as { content?: unknown }).content : undefined;
  const text = typeof content === 'string' ? content
    : Array.isArray(content) ? content.filter(part => typeof part === 'object' && part !== null && part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text as string).join('\n')
    : '';
  return { origin: turnOrigin, text };
}

function parsed(line: Buffer): Record<string, unknown> | undefined {
  let entry: unknown;
  try { entry = JSON.parse(line.toString('utf8')); } catch { return undefined; }
  return typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? entry as Record<string, unknown> : undefined;
}

function stopSummary(line: Buffer): boolean {
  const entry = parsed(line);
  return entry?.['type'] === 'system' && entry['subtype'] === 'stop_hook_summary';
}

function lines(data: Buffer): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  let start = 0;
  while (start < data.length) {
    let end = data.indexOf(0x0a, start);
    if (end < 0) end = data.length;
    const entry = parsed(data.subarray(start, end));
    if (entry !== undefined) records.push(entry);
    start = end + 1;
  }
  return records;
}

export function claudeTurnTail(path: string): { prompt: { origin: string; text: string } | undefined; records: Record<string, unknown>[] } | undefined {
  let fd: number;
  try { fd = openSync(path, 'r'); } catch { return undefined; }
  try {
    let position = fstatSync(fd).size, tail = Buffer.alloc(0), after = Buffer.alloc(0);
    let records: Record<string, unknown>[] | undefined;
    while (position > 0) {
      const length = Math.min(block, position);
      position -= length;
      const chunk = Buffer.alloc(length);
      readSync(fd, chunk, 0, length, position);
      const data = Buffer.concat([chunk, tail]);
      let end = data.length;
      while (end > 0) {
        const start = data.lastIndexOf(0x0a, end - 1);
        if (start < 0) break;
        const line = data.subarray(start + 1, end);
        const found = turnPrompt(line);
        if (found !== undefined) return { prompt: found, records: records ?? lines(Buffer.concat([data.subarray(end), after])) };
        if (records === undefined && stopSummary(line)) records = lines(Buffer.concat([data.subarray(end), after]));
        end = start;
      }
      after = Buffer.concat([data.subarray(end), after]);
      tail = data.subarray(0, end);
    }
    const found = turnPrompt(tail);
    return { prompt: found, records: records ?? lines(found === undefined && !stopSummary(tail) ? Buffer.concat([tail, after]) : after) };
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

export function claudeTurnPrompt(path: string): { origin: string; text: string } | undefined {
  return claudeTurnTail(path)?.prompt;
}
