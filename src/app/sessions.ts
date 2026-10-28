import type { AppCommand } from './commands.js';
import { createApp } from './create-app.js';
import type { SessionHint } from './session-input.js';

type Of<N extends AppCommand['name']> = Extract<AppCommand, { name: N }>;

export function registerSession(filename: string, c: Of<'session_register'>, proc = '/proc') {
  const app = createApp(filename, false);
  try {
    return app.sessions(c.runtime, proc).register({ agent: c.agent, nativeId: c.nativeId, pid: c.pid, name: c.sessionName ?? null,
      socket: c.socket ?? null, fork: c.fork, ...(c.envScope === undefined ? {} : { envScope: c.envScope }) });
  } finally { app.close(); }
}

export function unregisterSession(filename: string, c: Of<'session_unregister'>, proc = '/proc') {
  const app = createApp(filename, false);
  try { return app.sessions(c.runtime, proc).unregister(c.pid); } finally { app.close(); }
}

export function forgetSession(filename: string, c: Of<'session_forget'>, proc = '/proc') {
  const app = createApp(filename, false);
  try { return app.sessions(c.runtime, proc).forget(c.key); } finally { app.close(); }
}

export function listSessions(filename: string, c: Of<'sessions'>, proc = '/proc') {
  const app = createApp(filename, true);
  try { return { tree: app.sessions(c.runtime, proc).tree() }; } finally { app.close(); }
}

export function sessionKey(filename: string, hint: SessionHint, proc = '/proc'): string | undefined {
  const app = createApp(filename, true);
  try { return app.sessions(hint.runtime, proc).resolve(hint); } finally { app.close(); }
}
