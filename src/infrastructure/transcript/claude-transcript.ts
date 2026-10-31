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

export function claudeTurnPrompt(path: string): { origin: string; text: string } | undefined {
  let fd: number;
  try { fd = openSync(path, 'r'); } catch { return undefined; }
  try {
    let position = fstatSync(fd).size, tail = Buffer.alloc(0);
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
        const found = turnPrompt(data.subarray(start + 1, end));
        if (found !== undefined) return found;
        end = start;
      }
      tail = data.subarray(0, end);
    }
    return turnPrompt(tail);
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}
