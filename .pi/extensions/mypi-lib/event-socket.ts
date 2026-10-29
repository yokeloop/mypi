import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import type { ServeEvents } from './install.js';

export const serveEvents: ServeEvents = (path, onBatch) => new Promise((resolve, reject) => {
  const open = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, connection => {
    open.add(connection);
    const events: { id: number; text: string }[] = [];
    let buffer = '', done = false;
    const answer = () => {
      if (done) return;
      done = true;
      void onBatch(events).catch(() => []).then(acked => {
        connection.end(acked.map(id => JSON.stringify({ ok: true, id }) + '\n').join(''));
      });
    };
    connection.setEncoding('utf8');
    connection.on('data', (chunk: string) => {
      if (done) return;
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line === '') continue;
        let event: unknown;
        try { event = JSON.parse(line); } catch { answer(); return; }
        const { id, text, end } = (event ?? {}) as { id?: unknown; text?: unknown; end?: unknown };
        if (end === true || typeof id !== 'number' || typeof text !== 'string') { answer(); return; }
        events.push({ id, text });
      }
    });
    connection.on('end', answer);
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
