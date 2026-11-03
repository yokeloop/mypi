import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { readApiTokens, writeApiTokens } from '../infrastructure/filesystem/api-tokens-file.js';
import { InputError } from '../shared/errors.js';

export type ApiToken = { name: string; permission: 'read' | 'write'; sender: string | null };

function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function resolveApiTokensPath(env: Readonly<Record<string, string | undefined>>): string {
  const root = env['XDG_CONFIG_HOME'] || join(env['HOME'] ?? '', '.config');
  if (!isAbsolute(root)) throw new InputError('XDG_CONFIG_HOME or HOME must be absolute; API tokens live in $XDG_CONFIG_HOME/mypi/api-tokens.json');
  return join(root, 'mypi', 'api-tokens.json');
}

export function createApiToken(file: string, input: { tokenName: string; permission: string; sender?: string },
  clock = () => new Date().toISOString()) {
  const name = input.tokenName;
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) throw new InputError('Invalid API token name');
  if (input.permission !== 'read' && input.permission !== 'write') throw new InputError('Permission must be read or write');
  const permission = input.permission;
  if (permission === 'read' && input.sender !== undefined) throw new InputError('--sender is only for write tokens');
  const sender = permission === 'read' ? null : input.sender ?? 'global';
  if (sender !== null && !/^(global|[A-Z]+)$/.test(sender)) throw new InputError('Sender must be global or a project code');
  const tokens = readApiTokens(file);
  if (tokens.some(t => t.name === name)) throw new InputError('API token name exists: ' + name);
  const token = 'mypi_' + randomBytes(32).toString('base64url'), createdAt = clock();
  writeApiTokens(file, [...tokens, { name, permission, sender, sha256: sha256(token), createdAt }]);
  return { name, permission, sender, createdAt, token };
}

export function listApiTokens(file: string) {
  return { tokens: readApiTokens(file).map(t => ({ name: t.name, permission: t.permission, sender: t.sender, createdAt: t.createdAt })) };
}

export function revokeApiToken(file: string, tokenName: string) {
  const tokens = readApiTokens(file);
  if (!tokens.some(t => t.name === tokenName)) throw new InputError('Unknown API token: ' + tokenName);
  writeApiTokens(file, tokens.filter(t => t.name !== tokenName));
  return { revoked: tokenName };
}

export function verifyApiToken(file: string, presented: string): ApiToken | undefined {
  const digest = Buffer.from(sha256(presented), 'hex');
  const found = readApiTokens(file).find(t => timingSafeEqual(Buffer.from(t.sha256, 'hex'), digest));
  return found === undefined ? undefined : { name: found.name, permission: found.permission, sender: found.sender };
}
