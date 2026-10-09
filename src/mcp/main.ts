#!/usr/bin/env node
import { homedir } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveStatePath } from '../app/create-app.js';
import { createServer } from './server.js';
import { MYPI_MCP_CONTEXT, mcpWorkContext } from '../app/pi-context.js';
import { MYPI_MCP_NATIVE_SESSION_ID, decodeNativeCaller } from '../app/pi-message-caller.js';

try {
  const context = mcpWorkContext(process.env[MYPI_MCP_CONTEXT]);
  const nativeSessionId = decodeNativeCaller(process.env[MYPI_MCP_NATIVE_SESSION_ID]);
  const caller = { ...(nativeSessionId === undefined ? {} : { nativeSessionId }), ...(context === undefined ? {} : { context }) };
  const { server, stop } = createServer(resolveStatePath(process.env, homedir()), undefined, context, caller);
  let closing: Promise<void> | undefined;
  const shutdown = () => closing ??= (async () => {
    await stop();
    await server.close();
    process.stdin.pause();
  })();
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  process.stdin.once('end', () => { void shutdown(); });
  server.server.onclose = () => { void shutdown(); };
  await server.connect(new StdioServerTransport());
} catch {
  // Do not echo tool input or potentially sensitive paths in startup diagnostics.
  process.stderr.write('mypi MCP startup failed; check installation and state path.\n');
  process.exitCode = 1;
}
