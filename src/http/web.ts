import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

export type WebAsset = { body: Buffer; type: string };
export type WebResponse = { status: number; headers: Record<string, string>; body: Buffer | string };

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; "
  + "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const common = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

export function readWebAssets(dir: string): ReadonlyMap<string, WebAsset> {
  const assets = new Map<string, WebAsset>();
  const visit = (path: string, key: string) => {
    let entries;
    try { entries = readdirSync(path, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) visit(join(path, entry.name), key + entry.name + '/');
      else if (entry.isFile()) assets.set(key + entry.name, { body: readFileSync(join(path, entry.name)), type: TYPES[extname(entry.name)] ?? 'application/octet-stream' });
    }
  };
  visit(dir, '/');
  return assets;
}

function text(status: number, body: string, headers: Record<string, string> = {}): WebResponse {
  return { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...common, 'cache-control': 'no-cache', ...headers }, body };
}

export function webResponse(assets: ReadonlyMap<string, WebAsset>, method: string, pathname: string): WebResponse {
  if (method !== 'GET' && method !== 'HEAD') return text(405, 'Method Not Allowed', { allow: 'GET, HEAD' });
  if (!assets.has('/index.html')) return text(404, 'Web UI is not built; run pnpm build');
  let key = pathname === '/' ? '/index.html' : pathname;
  if (!assets.has(key)) {
    if (pathname.startsWith('/assets/') || pathname.split('/').at(-1)!.includes('.')) return text(404, 'Not Found');
    key = '/index.html';
  }
  const asset = assets.get(key)!;
  const headers: Record<string, string> = { 'content-type': asset.type, ...common,
    'cache-control': key.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' };
  if (key === '/index.html') Object.assign(headers, { 'content-security-policy': CSP, 'x-frame-options': 'DENY' });
  return { status: 200, headers, body: asset.body };
}
