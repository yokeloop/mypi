import { unwrap } from '../lib';

export async function apiGet(path: string): Promise<unknown> {
  const res = await fetch(path, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
  return unwrap(res.status, await res.json().catch(() => null));
}

export async function apiSend(method: 'POST' | 'DELETE', path: string, body: unknown): Promise<unknown> {
  const res = await fetch(path, { method, headers: { accept: 'application/json', 'content-type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify(body) });
  return unwrap(res.status, await res.json().catch(() => null));
}
