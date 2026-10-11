#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveInstallation, installationEnvironment } from '../app/installation.js';
import { createServer } from './server.js';
import { MYPI_MCP_CONTEXT, mcpWorkContext } from '../app/pi-context.js';
import { MYPI_MCP_NATIVE_SESSION_ID, decodeNativeCaller } from '../app/pi-message-caller.js';

try {
  const context = mcpWorkContext(process.env[MYPI_MCP_CONTEXT]);
  const nativeSessionId = decodeNativeCaller(process.env[MYPI_MCP_NATIVE_SESSION_ID]);
  const caller = { ...(nativeSessionId === undefined ? {} : { nativeSessionId }), ...(context === undefined ? {} : { context }) };
  const installation = resolveInstallation(fileURLToPath(new URL('../../../', import.meta.url)), process.env);
  const { server, stop } = createServer(installation.database, installation.homeRoot, context, caller,
    { env: installationEnvironment(installation, process.env), contextRoot: installation.homeRoot });
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
} catch (error) {
  // Caller/context parse errors and raw configuration are never echoed to the MCP transport.
  const detail = error instanceof Error && /^(Installation not configured|Invalid or unreadable installation binding|Installation belongs to a different engine|MYPI_INSTALLATION_FILE must be)/.test(error.message)
    ? ' Run pnpm bootstrap for this engine, or check MYPI_INSTALLATION_FILE.' : '';
  process.stderr.write(`mypi MCP startup failed; check installation and state path.${detail}\n`);
  process.exitCode = 1;
}
