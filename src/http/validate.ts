import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX } from '../shared/page.js';

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function invalid(message: string): ApiError {
  return new ApiError(400, 'invalid_request', message);
}

export function requestUrl(target: string | undefined): URL | undefined {
  try { return new URL(target ?? '/', 'http://localhost'); } catch { return undefined; }
}

export function query(params: URLSearchParams, allowed: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of new Set(params.keys())) {
    if (!allowed.includes(name)) throw invalid('Unknown query parameter: ' + name);
    const values = params.getAll(name);
    if (values.length > 1) throw invalid('Repeated query parameter: ' + name);
    if (values[0] !== '') result[name] = values[0]!;
  }
  return result;
}

export function limit(value: string | undefined): number {
  if (value === undefined) return PAGE_LIMIT_DEFAULT;
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > PAGE_LIMIT_MAX) throw invalid('Invalid limit');
  return Number(value);
}

export function encodeCursor(id: number): string {
  return Buffer.from('v1:' + id).toString('base64url');
}

export function decodeCursor(value: string): number {
  const text = Buffer.from(value, 'base64url').toString('utf8');
  if (!/^v1:[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(Number(text.slice(3)))) throw invalid('Invalid cursor');
  return Number(text.slice(3));
}

export function jsonBody(contentType: string | undefined, raw: string): Record<string, unknown> {
  if ((contentType ?? '').split(';')[0]!.trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new ApiError(400, 'invalid_json', 'Body is not valid JSON'); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw invalid('Body must be a JSON object');
  return body as Record<string, unknown>;
}

export function fields(body: Record<string, unknown>, required: string[], optional: string[]): void {
  for (const name of Object.keys(body)) if (!required.includes(name) && !optional.includes(name)) throw invalid('Unknown field: ' + name);
  for (const name of required) if (!(name in body)) throw invalid('Missing field: ' + name);
}

export function str(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value !== undefined && typeof value !== 'string') throw invalid('Field must be a string: ' + key);
  return value;
}

export function nullableStr(body: Record<string, unknown>, key: string): string | null | undefined {
  const value = body[key];
  if (value !== undefined && value !== null && typeof value !== 'string') throw invalid('Field must be a string or null: ' + key);
  return value;
}

export function literalTrue(body: Record<string, unknown>, key: string): true | undefined {
  const value = body[key];
  if (value !== undefined && value !== true) throw invalid('Field must be true: ' + key);
  return value;
}
