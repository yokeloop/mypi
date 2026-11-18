import { InputError } from '../../shared/errors.js';
import { readPrivateFile } from './private-file.js';

export type ServerConfig = { url: string; token: string; device?: string };

function serverUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') return undefined;
  return url.origin;
}

export function readServerConfig(file: string): ServerConfig | undefined {
  const text = readPrivateFile(file, 'Server file');
  if (text === undefined) return undefined;
  const invalid = new InputError('Invalid server file: ' + file);
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw invalid; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid;
  const value = data as Record<string, unknown>;
  const keys = Object.keys(value);
  if (!keys.includes('url') || !keys.includes('token') || keys.some(key => key !== 'url' && key !== 'token' && key !== 'device')) throw invalid;
  const url = serverUrl(value['url']), token = value['token'], device = value['device'];
  if (url === undefined) throw invalid;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+$/.test(token)) throw invalid;
  if (device !== undefined && (typeof device !== 'string' || !/^[^\x00-\x1f\x7f]{1,255}$/.test(device))) throw invalid;
  return { url, token, ...(device === undefined ? {} : { device }) };
}
