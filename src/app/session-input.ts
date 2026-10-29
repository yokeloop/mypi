import { InputError } from '../shared/errors.js';

export type SessionHint = { agent: 'claude' | 'pi'; nativeId: string; pid: number; runtime?: string };

export function sessionHint(env: Readonly<Record<string, string | undefined>>, pid: number): SessionHint | undefined {
  const runtime = env['XDG_RUNTIME_DIR'] ? { runtime: env['XDG_RUNTIME_DIR'] } : {};
  if (env['CLAUDE_CODE_SESSION_ID']) return { agent: 'claude', nativeId: env['CLAUDE_CODE_SESSION_ID'], pid, ...runtime };
  if (env['PI_SESSION_ID']) return { agent: 'pi', nativeId: env['PI_SESSION_ID'], pid, ...runtime };
  return undefined;
}

export function hookInput(text: string): { nativeId: string; name?: string; fork: boolean } {
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new InputError('Invalid SessionStart hook input'); }
  const value = input as Record<string, unknown>;
  if (typeof input !== 'object' || input === null || Array.isArray(input) || typeof value['session_id'] !== 'string' || value['session_id'] === ''
    || !['startup', 'resume', 'clear', 'compact', 'fork'].includes(value['source'] as string)
    || (value['session_title'] !== undefined && typeof value['session_title'] !== 'string')) throw new InputError('Invalid SessionStart hook input');
  return { nativeId: value['session_id'], ...(value['session_title'] ? { name: value['session_title'] as string } : {}), fork: value['source'] === 'fork' };
}

export const WAITING_NOTIFICATIONS = ['permission_prompt', 'idle_prompt', 'elicitation_dialog'] as const;

function hookObject(text: string, event: string): Record<string, unknown> {
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new InputError('Invalid ' + event + ' hook input'); }
  const value = input as Record<string, unknown>;
  if (typeof input !== 'object' || input === null || Array.isArray(input) || value['hook_event_name'] !== event
    || typeof value['session_id'] !== 'string' || value['session_id'] === '') throw new InputError('Invalid ' + event + ' hook input');
  return value;
}

export function stopInput(text: string): { nativeId: string; active: boolean; message: string } {
  const value = hookObject(text, 'Stop');
  if (typeof value['stop_hook_active'] !== 'boolean'
    || (value['last_assistant_message'] !== undefined && typeof value['last_assistant_message'] !== 'string')) throw new InputError('Invalid Stop hook input');
  return { nativeId: value['session_id'] as string, active: value['stop_hook_active'], message: (value['last_assistant_message'] as string | undefined) ?? '' };
}

export function notificationInput(text: string): { nativeId: string; type: string; message: string } {
  const value = hookObject(text, 'Notification');
  if (typeof value['message'] !== 'string' || typeof value['notification_type'] !== 'string') throw new InputError('Invalid Notification hook input');
  return { nativeId: value['session_id'] as string, type: value['notification_type'], message: value['message'] };
}
