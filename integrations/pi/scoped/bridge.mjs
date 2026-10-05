import net from 'node:net';
const socket = net.connect('/bridge/mypi.sock');
socket.on('connect', () => process.stdin.pipe(socket));
socket.pipe(process.stdout);
socket.on('error', () => { process.stderr.write('Scoped bridge unavailable\n'); process.exitCode = 1; });
process.stdin.on('end', () => socket.end());
