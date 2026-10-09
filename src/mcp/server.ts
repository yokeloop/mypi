import type { MessageCaller } from '../app/mailbox.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { executeCommand, isManagedHomeCommand } from '../app/execute-command.js';
import type { SelectedGuardPolicy } from '../app/execute-command.js';
import { loadSelectedGuardPolicy } from '../app/guard-policy-config.js';
import type { WorkContext } from '../app/commands.js';
import { tools, toolCommand, readOnly } from './tools.js';
import type { ToolName } from './tools.js';
import { sessionOutputSchema, sessionResultSchema } from './tools/sessions.js';
import { success, failure } from './result.js';
import { serialCalls } from './serial.js';

// Composition supplies the working selection; tool arguments remain ordinary data.
export function createServer(filename: string, root?: string, context?: WorkContext, caller?: MessageCaller) {
  const server = new McpServer({ name: 'mypi', version: '0.2.1' });
  const calls = serialCalls();
  let policy: SelectedGuardPolicy | undefined;
  if (context && context.scope.kind !== 'unrestricted') {
    try { policy = loadSelectedGuardPolicy(process.env); }
    catch (error) { policy = error instanceof Error ? error : new Error(String(error)); }
  }
  async function invoke(name: string, args: unknown, signal: AbortSignal) {
    try {
      const command = toolCommand(name, args);
      return await calls.run(signal, async () => {
        const data = await executeCommand(command, filename, root, context, policy, caller);
        const schema = sessionResultSchema(name);
        return success(schema ? schema.parse(data) : data);
      });
    } catch (error) { return failure(error); }
  }
  for (const name of Object.keys(tools) as ToolName[]) {
    const tool = tools[name], readonly = readOnly.has(name);
    server.registerTool(name, {
      description: tool.description, inputSchema: tool.schema, outputSchema: sessionOutputSchema(name),
      annotations: { readOnlyHint: readonly, destructiveHint: !readonly && name !== 'session_archive',
        idempotentHint: readonly || name === 'session_archive', openWorldHint: name === 'workspace_cleanup_preview' || name === 'workspace_verify' || name === 'workspace_publish' || name === 'home_status' || name === 'home_reconcile' || isManagedHomeCommand(name) },
    }, (args: unknown, extra: { signal: AbortSignal }) => invoke(name, args, extra.signal));
  }
  // McpServer's default call handler emits text-only validation errors. Keep SDK framing,
  // discovery and JSON-RPC validation, but use our envelope for every well-formed tool call.
  server.server.setRequestHandler(CallToolRequestSchema, (request, extra) =>
    invoke(request.params.name, request.params.arguments ?? {}, extra.signal));
  return { server, stop: () => calls.stop() };
}
