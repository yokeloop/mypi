import { createConnection } from 'node:net';

export function piEventSocket(socket: string, events: { id: number; text: string }[]): Promise<number[]> {
  return new Promise(resolve => {
    const sent = new Set(events.map(e => e.id));
    const acked: number[] = [];
    let buffer = '', done = false;
    const connection = createConnection(socket);
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      connection.destroy();
      resolve(acked);
    };
    const deadline = setTimeout(finish, 2000);
    connection.setEncoding('utf8');
    connection.on('connect', () => {
      for (const e of events) connection.write(JSON.stringify({ id: e.id, text: e.text }) + '\n');
      connection.write(JSON.stringify({ end: true }) + '\n');
    });
    connection.on('data', (chunk: string) => {
      if (done) return;
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let answer: unknown;
        try { answer = JSON.parse(line); } catch { answer = undefined; }
        const id = (answer as { ok?: unknown; id?: unknown } | null | undefined)?.id;
        if ((answer as { ok?: unknown } | null | undefined)?.ok !== true || typeof id !== 'number') { finish(); return; }
        if (sent.delete(id)) acked.push(id);
        if (sent.size === 0) { finish(); return; }
      }
    });
    connection.on('end', finish);
    connection.on('close', finish);
    connection.on('error', finish);
  });
}
