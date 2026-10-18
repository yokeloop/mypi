import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { emptyContinuity } from './native-chat-facts.js';

// Invoked by the native Pi extension through Node 24; it never opens SQLite.
const [state, attempt, serialized] = process.argv.slice(2);
if (!state || !attempt || !/^[-\w]{36}$/.test(attempt) || !serialized || !state.startsWith('/')) throw new Error('Invalid work chat acknowledgement');
const message: unknown = JSON.parse(serialized);
if (!message || typeof message !== 'object' || (message as { attempt?: unknown }).attempt !== attempt) throw new Error('Invalid work chat attempt');
const directory = resolve(state, 'mypi', 'work-chat-acks');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const target = join(directory, attempt + '.json');
const current = message as Record<string, unknown>;
const previous: Record<string, unknown> | undefined = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : undefined;
const derived = { ...current, ...emptyContinuity(previous, current) };
const temporary = join(directory, attempt + '.' + process.pid);
writeFileSync(temporary, JSON.stringify(derived), { mode: 0o600, flag: 'wx' });
renameSync(temporary, target);
if (current.lifecycle === 'start:startup') {
  // Immutable startup receipt is separate from subsequent native model/tree changes.
  writeFileSync(join(directory, attempt + '-start.json'), JSON.stringify(derived), { mode: 0o600, flag: 'wx' });
}
