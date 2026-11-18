#!/usr/bin/env node
import { homedir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { deviceSessions, resolveStatePath } from '../app/create-app.js';
import { eventTransports } from '../app/event-transports.js';
import { createServer } from './server.js';
import { configuredServer, remoteBackend, sessionRunner } from '../app/backend.js';
import { subscribeInbox } from '../app/inbox-subscription.js';

try {
  const remote = configuredServer(process.env);
  const backend = remote === undefined ? undefined : remoteBackend(remote);
  const { server, stop } = createServer(resolveStatePath(process.env, homedir()), undefined, process.env, eventTransports, backend);
  const subscription = new AbortController();
  let closing: Promise<void> | undefined;
  const shutdown = () => closing ??= (async () => {
    subscription.abort();
    await stop();
    await server.close();
    process.stdin.pause();
  })();
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  process.stdin.once('end', () => { void shutdown(); });
  server.server.onclose = () => { void shutdown(); };
  await server.connect(new StdioServerTransport());
  if (remote !== undefined && backend !== undefined && process.env['CLAUDE_CODE_SESSION_ID']) {
    const { signal } = subscription;
    void subscribeInbox({ server: remote, pid: process.ppid, agent: 'claude', runner: sessionRunner(backend), device: deviceSessions(process.env['XDG_RUNTIME_DIR']),
      transports: eventTransports, fetch: globalThis.fetch, pause: ms => sleep(ms, undefined, { signal }).catch(() => undefined),
      timer: (ms, fire) => { const t = setTimeout(fire, ms); return () => clearTimeout(t); }, signal }).catch(() => undefined);
  }
} catch {
  // Do not echo tool input or potentially sensitive paths in startup diagnostics.
  process.stderr.write('mypi MCP startup failed; check installation and state path.\n');
  process.exitCode = 1;
}
