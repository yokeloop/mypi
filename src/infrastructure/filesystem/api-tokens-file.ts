import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { InputError } from '../../shared/errors.js';

export type StoredToken = { name: string; permission: 'read' | 'write'; sender: string | null; sha256: string; createdAt: string };

function storedToken(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const t = value as Record<string, unknown>;
  return Object.keys(t).length === 5 && typeof t['name'] === 'string' && (t['permission'] === 'read' || t['permission'] === 'write')
    && (t['sender'] === null || typeof t['sender'] === 'string') && typeof t['sha256'] === 'string'
    && /^[a-f0-9]{64}$/.test(t['sha256']) && typeof t['createdAt'] === 'string';
}

export function readApiTokens(file: string): StoredToken[] {
  let stat;
  try { stat = lstatSync(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new InputError('API token file must be a private regular file (0600): ' + file);
  let data: unknown;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new InputError('Invalid API token file: ' + file); }
  const value = data as { version?: unknown; tokens?: unknown } | null;
  if (!value || typeof value !== 'object' || value.version !== 1 || !Array.isArray(value.tokens) || !value.tokens.every(storedToken)) {
    throw new InputError('Invalid API token file: ' + file);
  }
  return value.tokens as StoredToken[];
}

export function writeApiTokens(file: string, tokens: StoredToken[]): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + process.pid + '.tmp';
  writeFileSync(temporary, JSON.stringify({ version: 1, tokens }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  renameSync(temporary, file);
}
