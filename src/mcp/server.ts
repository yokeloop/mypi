import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { executeCommand } from '../app/execute-command.js';
import type { TrustedExecutionContext } from '../app/execution-context.js';
import { tools, toolCommand, readOnly } from './tools.js';
import type { ToolName } from './tools.js';
import { output } from './schemas.js';
import { success, failure } from './result.js';
import { serialCalls } from './serial.js';

// Only the trusted host may inject context; tool arguments never select a caller.
export function createServer(filename: string, root?: string, context?: TrustedExecutionContext) {
  const server = new McpServer({ name: 'mypi', version: '0.2.1' });
  const calls = serialCalls();
  async function invoke(name: string, args: unknown, signal: AbortSignal) {
    try {
      const command = toolCommand(name, args);
      return await calls.run(signal, async () => success(await executeCommand(command, filename, root, context)));
    } catch (error) { return failure(error); }
  }
  for (const name of Object.keys(tools) as ToolName[]) {
    const tool = tools[name], readonly = readOnly.has(name);
    server.registerTool(name, {
      description: tool.description, inputSchema: tool.schema, outputSchema: output,
      annotations: { readOnlyHint: readonly, destructiveHint: !readonly,
        idempotentHint: readonly, openWorldHint: false },
    }, (args: unknown, extra: { signal: AbortSignal }) => invoke(name, args, extra.signal));
  }
  // McpServer's default call handler emits text-only validation errors. Keep SDK framing,
  // discovery and JSON-RPC validation, but use our envelope for every well-formed tool call.
  server.server.setRequestHandler(CallToolRequestSchema, (request, extra) =>
    invoke(request.params.name, request.params.arguments ?? {}, extra.signal));
  return { server, stop: () => calls.stop() };
}
