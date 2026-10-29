import { appendFileSync, chmodSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';

const [path, mode, log] = process.argv.slice(2) as [string, 'ack' | 'silent' | 'claude', string];
rmSync(path, { force: true });
const server = createServer({ allowHalfOpen: true }, connection => {
  let received = '';
  connection.setEncoding('utf8');
  connection.on('data', (chunk: string) => { received += chunk; });
  connection.on('end', () => {
    const lines = received.split('\n').filter(line => line !== '');
    appendFileSync(log, lines.map(line => line + '\n').join(''));
    if (mode === 'claude') { connection.end(); return; }
    if (mode !== 'ack') return;
    for (const line of lines) connection.write(JSON.stringify({ ok: true, id: (JSON.parse(line) as { id: number }).id }) + '\n');
    connection.end();
  });
  connection.on('error', () => connection.destroy());
});
server.listen(path, () => {
  chmodSync(path, 0o600);
  process.stdout.write('ready\n');
});
