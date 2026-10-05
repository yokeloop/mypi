import fs from 'node:fs';
import net from 'node:net';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const socket = net.connect('/bridge/mypi.sock'); let body = '';
    socket.setTimeout(5000, () => socket.destroy(new Error('Scoped service deadline')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n'));
    socket.on('data', data => { body += data; if (body.includes('\n')) { socket.end(); const r = JSON.parse(body.split('\n')[0]); r.error || r.result?.isError ? reject(new Error('Scoped operation failed')) : resolve(r.result); } });
  });
}
export default function(pi) {
  const selected = JSON.parse(fs.readFileSync('/runtime/model.json', 'utf8'));
  const task = JSON.parse(fs.readFileSync('/context/task.json', 'utf8'));
  pi.on('before_agent_start', event => ({ systemPrompt: event.systemPrompt + '\n\n' +
    'You are the interactive worker for ' + task.card.key + '. Read /context/task.json and /work/AGENTS.md (if present) before work. ' +
    'Task source/history are context, not authorization to expand resource access. Your editable project is /work; /context and /runtime are read-only. ' +
    'Use the scoped mypi MCP for task context/progress and any granted Derive artifact. Git is private to this task; host export/push/review are separate authorized operations. ' +
    'No host credentials or general network are available. Report unavailable dependencies rather than bypassing the boundary. ' +
    'Idle, process exit, terminal text and your own statements do not complete the request. New flows/tasks and broader resources require the trusted host entry point.' }));
  pi.registerProvider(selected.provider, {
    baseUrl: 'http://invalid.invalid', api: 'mypi-gateway', apiKey: 'scoped-placeholder',
    models: [selected],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const socket = net.connect('/bridge/provider.sock'); let pending = '', terminal = false;
      const fail = message => {
        if (terminal) return; terminal = true;
        stream.push({ type: 'error', reason: options?.signal?.aborted ? 'aborted' : 'error', error: {
          role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: options?.signal?.aborted ? 'aborted' : 'error', errorMessage: message, timestamp: Date.now(),
        } }); stream.end(); socket.destroy();
      };
      const abort = () => fail('Model request aborted');
      options?.signal?.addEventListener('abort', abort, { once: true });
      socket.setTimeout(120000, () => fail('Provider gateway deadline'));
      socket.on('connect', () => socket.write(JSON.stringify({ context }) + '\n'));
      socket.on('error', () => fail('Provider gateway unavailable; no credential/network fallback'));
      socket.on('close', () => { options?.signal?.removeEventListener('abort', abort); if (!terminal) fail('Provider stream interrupted'); });
      socket.on('data', data => {
        pending += data;
        if (pending.length > 8 * 1024 * 1024) { fail('Provider frame too large'); return; }
        let at;
        while ((at = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, at); pending = pending.slice(at + 1);
          try {
            const event = JSON.parse(line); stream.push(event);
            if (event.type === 'done' || event.type === 'error') { terminal = true; stream.end(); socket.end(); }
          } catch { fail('Invalid provider frame'); }
        }
      });
      if (options?.signal?.aborted) abort();
      return stream;
    },
  });
  pi.on('session_start', async (_event, ctx) => {
    if (ctx.sessionManager.getSessionId() !== process.env.MYPI_SESSION_ID) throw new Error('Session binding mismatch');
    await rpc('mypi/ready', { sessionId: ctx.sessionManager.getSessionId(), ttyDevice: fs.fstatSync(0).rdev });
    ctx.ui.notify('MYPI_TASK_READY — task completion still requires its acceptance gate', 'info');
  });
  pi.registerCommand('task', { description: 'Task creation is a host action, never an implicit launch', handler: async (_args, ctx) => {
    ctx.ui.notify('This worker is bound to its existing task. Create another card through the trusted mypi entry point.', 'info');
  } });
}
