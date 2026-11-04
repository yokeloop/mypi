import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { executeCommand } from '../app/execute-command.js';
import { eventTransports } from '../app/event-transports.js';
import { engineRoot, engineVersion, SCHEMA_VERSION } from '../app/create-app.js';
import { createChangeFeed } from '../app/change-feed.js';
import { listApiTokens, verifyApiToken } from '../app/api-tokens.js';
import { InputError } from '../shared/errors.js';
import { bearer } from '../shared/bearer.js';
import { API_VERSION, createApi } from './api.js';
import { readSessionCookie } from './session.js';
import { readWebAssets, webResponse } from './web.js';
import { requestUrl } from './validate.js';
import { createRemoteMcp } from '../mcp/remote.js';

export const DEFAULT_PORT = 8737, POLL_MS = 1000, KEEPALIVE_MS = 25_000, MAX_BODY = 1_048_576;

const json = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function error(res: ServerResponse, status: number, code: string, message: string): void {
  res.writeHead(status, json).end(JSON.stringify({ apiVersion: API_VERSION, error: { code, message } }));
}

function readBody(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) { resolve(undefined); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function forwardedProto(req: IncomingMessage): string | undefined {
  const h = req.headers['x-forwarded-proto'];
  return typeof h === 'string' ? h.split(',')[0]!.trim().toLowerCase() : undefined;
}

export async function serve(options: { filename: string; tokensFile: string; listen: string; port: string;
  env: Readonly<Record<string, string | undefined>>; signal: AbortSignal;
  out: (line: string) => void; log: (line: string) => void }): Promise<void> {
  const host = options.listen;
  if (isIP(host) === 0) throw new InputError('--listen must be an IP address');
  if (!/^[0-9]+$/.test(options.port) || Number(options.port) > 65535) throw new InputError('--port must be a number from 0 to 65535');
  if (listApiTokens(options.tokensFile).tokens.length === 0) {
    throw new InputError('No API tokens in ' + options.tokensFile + '; create one with mypi token create <name> --permission read|write');
  }
  const assets = readWebAssets(join(engineRoot(), 'dist', 'ui'));
  const feed = createChangeFeed(options.filename);
  const instance = randomUUID(), version = engineVersion();
  const api = createApi({ token: v => verifyApiToken(options.tokensFile, v),
    execute: c => executeCommand(c, options.filename, undefined, eventTransports),
    info: () => ({ version, schemaVersion: SCHEMA_VERSION, changeId: feed.changeId(), instance }), runtime: options.env['XDG_RUNTIME_DIR'],
    log: options.log });
  const remoteMcp = createRemoteMcp({ token: v => verifyApiToken(options.tokensFile, v),
    execute: c => executeCommand(c, options.filename, undefined, eventTransports), runtime: options.env['XDG_RUNTIME_DIR'], version,
    log: options.log });
  const streams = new Map<ServerResponse, string>();
  const change = () => 'id: ' + feed.changeId() + '\nevent: change\ndata: ' + JSON.stringify({ changeId: feed.changeId() }) + '\n\n';

  async function v1(req: IncomingMessage, res: ServerResponse, url: URL, token: (name: string) => void): Promise<void> {
    const method = req.method ?? 'GET';
    let body = '';
    if (method === 'POST' || method === 'PATCH') {
      const read = await readBody(req);
      if (read === undefined) { error(res, 413, 'payload_too_large', 'Body exceeds ' + MAX_BODY + ' bytes'); req.destroy(); return; }
      body = read;
    }
    const result = await api({ method, path: url.pathname, query: url.searchParams, authorization: req.headers.authorization,
      contentType: req.headers['content-type'], body, cookie: req.headers.cookie, forwardedProto: forwardedProto(req) });
    if (result.token !== undefined) token(result.token);
    if ('stream' in result) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write('retry: 2000\n' + change());
      streams.set(res, req.headers.authorization !== undefined ? bearer(req.headers.authorization)! : readSessionCookie(req.headers.cookie)!);
      res.on('close', () => streams.delete(res));
      return;
    }
    if (result.setCookie !== undefined) res.setHeader('set-cookie', result.setCookie);
    res.writeHead(result.status, json).end(JSON.stringify(result.body));
  }

  async function mcp(req: IncomingMessage, res: ServerResponse, url: URL, token: (name: string) => void): Promise<void> {
    if (url.pathname !== '/mcp') { error(res, 404, 'not_found', 'Unknown path: ' + url.pathname); return; }
    let body = '';
    if (req.method === 'POST') {
      const read = await readBody(req);
      if (read === undefined) { error(res, 413, 'payload_too_large', 'Body exceeds ' + MAX_BODY + ' bytes'); req.destroy(); return; }
      body = read;
    }
    const headers = new Headers();
    for (const name of ['authorization', 'accept', 'content-type', 'mcp-protocol-version']) {
      const value = req.headers[name];
      if (typeof value === 'string') headers.set(name, value);
    }
    const result = await remoteMcp(new Request('http://localhost/mcp', { method: req.method ?? 'GET', headers, ...(req.method === 'POST' ? { body } : {}) }));
    if (result.token !== undefined) token(result.token);
    res.writeHead(result.response.status, { ...Object.fromEntries(result.response.headers), 'cache-control': 'no-store' });
    res.end(Buffer.from(await result.response.arrayBuffer()));
  }

  async function web(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const r = webResponse(assets, req.method ?? 'GET', url.pathname);
    res.writeHead(r.status, r.headers);
    res.end(req.method === 'HEAD' ? undefined : r.body);
  }

  const mounts: { prefix: string; handle(req: IncomingMessage, res: ServerResponse, url: URL, token: (name: string) => void): Promise<void> }[] = [
    { prefix: '/v1/', handle: v1 },
    { prefix: '/mcp', handle: mcp },
    { prefix: '/', handle: web },
  ];
  const server = createServer((req, res) => {
    const url = requestUrl(req.url), method = req.method ?? 'GET';
    let tokenName: string | undefined;
    res.on('close', () => options.log(new Date().toISOString() + ' ' + method + ' ' + (url?.pathname ?? '-') + ' ' + res.statusCode + ' ' + (tokenName ?? '-')));
    if (url === undefined) { error(res, 400, 'invalid_request', 'Invalid request target'); return; }
    const mount = mounts.find(m => url.pathname.startsWith(m.prefix));
    if (mount === undefined) { error(res, 404, 'not_found', 'Unknown path: ' + url.pathname); return; }
    mount.handle(req, res, url, name => { tokenName = name; }).catch((e: unknown) => {
      if (!res.headersSent) error(res, 500, 'internal', e instanceof Error ? e.message : String(e));
      else res.end();
    });
  });
  const poll = setInterval(() => {
    const changed = feed.poll();
    let failure: string | undefined;
    const valid = (presented: string) => {
      try { return verifyApiToken(options.tokensFile, presented) !== undefined; } catch (e) {
        failure ??= e instanceof Error ? e.message : String(e);
        return false;
      }
    };
    for (const [res, presented] of streams) {
      if (!valid(presented)) { streams.delete(res); res.end(); } else if (changed) res.write(change());
    }
    if (failure !== undefined) options.log(failure);
  }, POLL_MS);
  const keepalive = setInterval(() => { for (const res of streams.keys()) res.write(': keepalive\n\n'); }, KEEPALIVE_MS);
  const stop = () => {
    clearInterval(poll); clearInterval(keepalive);
    for (const res of streams.keys()) res.end();
    server.close(); server.closeAllConnections(); feed.close();
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(Number(options.port), host, () => { server.off('error', reject); resolve(); });
    });
  } catch (e) { clearInterval(poll); clearInterval(keepalive); feed.close(); throw e; }
  const address = server.address() as AddressInfo;
  options.out(JSON.stringify({ status: 'listening', url: 'http://' + (isIP(host) === 6 ? '[' + host + ']' : host) + ':' + address.port }));
  await new Promise<void>(resolve => {
    server.once('close', () => resolve());
    if (options.signal.aborted) stop(); else options.signal.addEventListener('abort', stop, { once: true });
  });
}
