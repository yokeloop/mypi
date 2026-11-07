import { readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';

export function listTranscripts(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return entries.filter(entry => entry.isFile() && entry.name.endsWith('.jsonl')).map(entry => entry.name).sort().map(name => join(dir, name));
}
