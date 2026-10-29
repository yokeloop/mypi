import { createConnection } from 'node:net';

export function claudeInboxSocket(socket: string, events: { id: number; text: string }[]): Promise<number[]> {
  return new Promise(resolve => {
    let done = false;
    const connection = createConnection(socket);
    const finish = (accepted: number[]) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      connection.destroy();
      resolve(accepted);
    };
    const deadline = setTimeout(() => finish([]), 2000);
    connection.resume();
    connection.on('connect', () => {
      for (const e of events) connection.write(JSON.stringify({ type: 'user', message: { role: 'user', content: e.text } }) + '\n');
      connection.end();
    });
    connection.on('end', () => finish(events.map(e => e.id)));
    connection.on('close', () => finish([]));
    connection.on('error', () => finish([]));
  });
}
