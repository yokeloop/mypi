import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { executeCommand } from '../app/execute-command.js';
import type { EventTransports } from '../app/delivery.js';
import { tools, toolCommand, readOnly } from './tools.js';
import type { ToolName } from './tools.js';
import { output } from './schemas.js';
import { success, failure } from './result.js';
import { serialCalls } from './serial.js';
import { runSequence } from './sequence.js';

type CallExtra = { signal: AbortSignal; _meta?: { progressToken?: string | number | undefined } | undefined;
  sendNotification: (n: ServerNotification) => Promise<void> };

export function createServer(filename: string, root?: string, env: Readonly<Record<string, string | undefined>> = {},
  transports: EventTransports = {}) {
  const server = new McpServer({ name: 'mypi', version: '0.9.0' });
  const calls = serialCalls();
  const shutdown = new AbortController();
  async function invoke(name: string, args: unknown, extra: CallExtra) {
    try {
      const commands = toolCommand(name, args, env);
      const signal = AbortSignal.any([extra.signal, shutdown.signal]);
      const progressToken = extra._meta?.progressToken;
      let count = 0;
      const onProgress = progressToken === undefined ? undefined : (line: string) => {
        void extra.sendNotification({ method: 'notifications/progress', params: { progressToken, progress: ++count, message: line } })
          .catch(() => undefined);
      };
      return await calls.run(signal, async () => success(await runSequence(commands, command =>
        executeCommand(command, filename, root, transports, { signal, ...(onProgress ? { onProgress } : {}) }))));
    } catch (error) { return failure(error); }
  }
  for (const name of Object.keys(tools) as ToolName[]) {
    const tool = tools[name], readonly = readOnly.has(name);
    server.registerTool(name, {
      description: tool.description, inputSchema: tool.schema, outputSchema: output,
      annotations: { readOnlyHint: readonly, destructiveHint: !readonly,
        idempotentHint: readonly, openWorldHint: false },
    }, (args: unknown, extra: CallExtra) => invoke(name, args, extra));
  }
  // McpServer's default call handler emits text-only validation errors. Keep SDK framing,
  // discovery and JSON-RPC validation, but use our envelope for every well-formed tool call.
  server.server.setRequestHandler(CallToolRequestSchema, (request, extra) =>
    invoke(request.params.name, request.params.arguments ?? {}, extra));
  return { server, stop: async () => { shutdown.abort(); await calls.stop(); } };
}
