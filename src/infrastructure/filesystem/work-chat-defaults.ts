import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InputError } from '../../shared/errors.js';

/** Missing optional defaults file is equivalent to no configured choices. */
export function readWorkChatDefaultsJson(userHome: string): unknown {
  const filename = join(userHome, 'pi', 'work-chats.json');
  let text: string;
  try { text = readFileSync(filename, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new InputError(`Cannot read ${filename}: ${(error as Error).message}`);
  }
  try { return JSON.parse(text) as unknown; }
  catch (error) { throw new InputError(`Invalid JSON in ${filename}: ${(error as Error).message}`); }
}
