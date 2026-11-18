import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { InputError } from '../../shared/errors.js';
import { readPrivateFile } from './private-file.js';

export type StoredToken = { name: string; permission: 'read' | 'write' | 'device'; sender: string | null; sha256: string; createdAt: string };

function storedToken(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const t = value as Record<string, unknown>;
  return Object.keys(t).length === 5 && typeof t['name'] === 'string' && (t['permission'] === 'read' || t['permission'] === 'write' || t['permission'] === 'device')
    && (t['sender'] === null || typeof t['sender'] === 'string') && typeof t['sha256'] === 'string'
    && /^[a-f0-9]{64}$/.test(t['sha256']) && typeof t['createdAt'] === 'string';
}

export function readApiTokens(file: string): StoredToken[] {
  const text = readPrivateFile(file, 'API token file');
  if (text === undefined) return [];
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new InputError('Invalid API token file: ' + file); }
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
