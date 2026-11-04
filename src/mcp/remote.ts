import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { AppCommand } from '../app/commands.js';
import { runSequence } from '../app/task-sequence.js';
import { bearer } from '../shared/bearer.js';
import { output } from './schemas.js';
import { success, failure } from './result.js';
import { remoteTools, remoteToolNames, remoteToolCommand, remoteReadOnly } from './remote-tools.js';
import type { RemoteToken } from './remote-tools.js';

export type RemoteDeps = { token(value: string): RemoteToken | undefined;
  execute(command: AppCommand): Promise<unknown>; runtime: string | undefined; version: string;
  log(line: string): void };
export type RemoteResult = { response: Response; token?: string };

function rpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }),
    { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function createRemoteMcp(deps: RemoteDeps): (request: Request) => Promise<RemoteResult> {
  return async request => {
    const value = bearer(request.headers.get('authorization') ?? undefined);
    let token: RemoteToken | undefined;
    try { token = value === undefined ? undefined : deps.token(value); } catch (error) {
      deps.log(error instanceof Error ? error.message : String(error));
      return { response: rpcError(500, -32603, 'API token file is unreadable') };
    }
    if (token === undefined) {
      return { response: rpcError(401, -32001, 'Missing or unknown bearer token', { 'www-authenticate': 'Bearer realm="mypi"' }) };
    }
    if (request.method !== 'POST') {
      return { response: rpcError(405, -32000, 'Method not allowed: this MCP endpoint is stateless and answers POST only', { allow: 'POST' }),
        token: token.name };
    }
    const caller = token;
    try {
      const server = new McpServer({ name: 'mypi', version: deps.version });
      async function invoke(name: string, args: unknown) {
        try { return success(await runSequence(remoteToolCommand(name, args, caller, deps.runtime), deps.execute)); } catch (error) {
          return failure(error);
        }
      }
      for (const name of remoteToolNames(caller.permission)) {
        const tool = remoteTools[name], readonly = remoteReadOnly.has(name);
        server.registerTool(name, {
          description: tool.description, inputSchema: tool.schema, outputSchema: output,
          annotations: { readOnlyHint: readonly, destructiveHint: !readonly,
            idempotentHint: readonly, openWorldHint: false },
        }, (args: unknown) => invoke(name, args));
      }
      server.server.setRequestHandler(CallToolRequestSchema, request => invoke(request.params.name, request.params.arguments ?? {}));
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      await server.connect(transport);
      try { return { response: await transport.handleRequest(request), token: caller.name }; } finally { await server.close(); }
    } catch {
      return { response: rpcError(500, -32603, 'Internal error'), token: caller.name };
    }
  };
}
