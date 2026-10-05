import net from 'node:net';
const socket=net.connect('/bridge/api.sock');
socket.on('connect',()=>process.stdin.pipe(socket));
socket.pipe(process.stdout);
socket.on('error',error=>{console.error(error.message);process.exitCode=1;});
process.stdin.on('end',()=>socket.end());
