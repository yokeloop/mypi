import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Host-only. No endpoint, credentials, generic tool dispatch or capability minting reaches the worker.
export async function connectDerive() {
  const config = JSON.parse(readFileSync(join(homedir(), '.pi', 'agent', 'mcp.json'), 'utf8')) as {
    mcpServers?: { derive?: { url?: string; headers?: Record<string, string>; enabled?: boolean } };
  };
  const server = config.mcpServers?.derive;
  if (!server?.url || server.enabled === false) throw new Error('An enabled HTTP Derive MCP connection is required');
  const url = new URL(server.url);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Derive requires HTTPS');
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(server.headers ?? {})) {
    if (typeof value !== 'string' || value.startsWith('!')) throw new Error('Command-derived MCP credentials are not supported');
    headers[key] = value.replace(/\$\{([A-Z_][A-Z_0-9]*)\}/g, (_, name: string) => {
      const resolved = process.env[name]; if (!resolved) throw new Error('Missing configured MCP credential'); return resolved;
    });
  }
  if (!Object.keys(headers).some(k => k.toLowerCase() === 'authorization')) throw new Error('Derive header authentication required; OAuth-only configuration is not supported by this adapter');
  const client = new Client({ name: 'mypi-scoped-host', version: '1' });
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers, redirect: 'error' } });
  try { await client.connect(transport); } catch { await transport.close(); throw new Error('Derive connection failed'); }
  return {
    call: (request: { name: string; arguments: Record<string, unknown> }) => client.callTool(request, undefined, { timeout: 30000, resetTimeoutOnProgress: false }),
    close: () => client.close(),
  };
}
