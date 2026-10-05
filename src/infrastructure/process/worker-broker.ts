import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { chmodSync } from 'node:fs';

const deriveTools = [
  { name: 'derive_read', description: 'Read the granted Derive artifact only', inputSchema: { type: 'object', properties: { format: { enum: ['html', 'text', 'markdown'] }, version: { type: 'integer' }, section: { type: 'string' } }, additionalProperties: false } },
  { name: 'derive_catch_up', description: 'Read feedback/head for the granted artifact, never the global queue', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'derive_publish', description: 'Revise the granted artifact with exact unique edits and expected version. Inspect uncertain effects before retry; never changes sharing or requests acceptance.', inputSchema: { type: 'object', properties: { base_version: { type: 'integer' }, edits: { type: 'array', items: { type: 'object', properties: { old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['old_str', 'new_str'], additionalProperties: false } }, message: { type: 'string' } }, required: ['base_version', 'edits'], additionalProperties: false } },
];
const tools = [
  { name: 'request_show', description: 'Read this task card', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'journal_read', description: 'Read this task history', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: 'context_read', description: 'Read a granted context resource', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { name: 'request_progress', description: 'Save task progress/artifacts (never task acceptance)', inputSchema: { type: 'object', properties: {
    text: { type: 'string' }, artifacts: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  }, required: ['text'], additionalProperties: false } },
];
export async function workerBroker(path: string, invoke: (name: string, args: unknown) => Promise<unknown>,
  ready: (value: unknown) => void, check: () => void, derive = false) {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    if (sockets.size >= 8) { socket.destroy(); return; }
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let buffer = '', pending = 0;
    socket.on('data', chunk => {
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer) > 256_000) { socket.destroy(); return; }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (++pending > 8) { socket.destroy(); return; }
        void (async () => {
          let id: unknown = null;
          try {
            const r = JSON.parse(line) as { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
            if (r.jsonrpc !== '2.0') throw new Error('Invalid RPC');
            id = r.id;
            if (id === undefined) return;
            if (typeof id !== 'number' && typeof id !== 'string') throw new Error('Invalid RPC ID');
            let result: unknown;
            switch (r.method) {
              case 'initialize': result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mypi-scoped', version: '1' } }; break;
              case 'ping': result = {}; break;
              case 'tools/list': result = { tools: derive ? [...tools, ...deriveTools] : tools }; break;
              case 'resources/list': result = { resources: [] }; break;
              case 'resources/templates/list': result = { resourceTemplates: [] }; break;
              case 'mypi/ready': ready(r.params); result = {}; break;
              case 'mypi/check': check(); result = {}; break;
              case 'tools/call': {
                if (typeof r.params?.name !== 'string') throw new Error('Missing tool');
                const data = await invoke(r.params.name, r.params.arguments ?? {});
                result = { content: [{ type: 'text', text: JSON.stringify({ status: 'ok', data }) }], structuredContent: { status: 'ok', data }, isError: false };
                break;
              }
              default: throw new Error('Method denied');
            }
            if (!socket.destroyed) socket.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
          } catch (error) {
            // Do not leak internal host paths or raw exception/credential bodies.
            const partial = !!error && typeof error === 'object' && 'saved' in error;
            if (!socket.destroyed) socket.write(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result: {
              content: [{ type: 'text', text: partial ? 'Partial operation; inspect task state before retry' : 'Operation denied or failed' }],
              structuredContent: { status: partial ? 'partial' : 'error', ...(error && typeof error === 'object' && 'operation' in error ? { operation: error.operation } : {}) }, isError: true,
            } }) + '\n');
          } finally { pending--; }
        })();
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, () => { chmodSync(path, 0o600); resolve(); }); });
  return { close: () => { for (const socket of sockets) socket.destroy(); server.close(); } };
}
