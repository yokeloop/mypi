import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import type { ServeEvents } from './install.js';

function parse(text: string): { id: number; text: string }[] {
  const events: { id: number; text: string }[] = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    let event: unknown;
    try { event = JSON.parse(line); } catch { break; }
    const { id, text: body } = (event ?? {}) as { id?: unknown; text?: unknown };
    if (typeof id !== 'number' || typeof body !== 'string') break;
    events.push({ id, text: body });
  }
  return events;
}

export const serveEvents: ServeEvents = (path, onBatch) => new Promise((resolve, reject) => {
  const open = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, connection => {
    open.add(connection);
    let received = '';
    connection.setEncoding('utf8');
    connection.on('data', (chunk: string) => { received += chunk; });
    connection.on('end', () => {
      void onBatch(parse(received)).catch(() => []).then(acked => {
        connection.end(acked.map(id => JSON.stringify({ ok: true, id }) + '\n').join(''));
      });
    });
    connection.on('error', () => connection.destroy());
    connection.on('close', () => open.delete(connection));
  });
  server.once('error', reject);
  server.listen(path, () => {
    server.off('error', reject);
    resolve({
      close: () => new Promise<void>(done => {
        for (const connection of open) connection.destroy();
        server.close(() => done());
      }),
    });
  });
});
