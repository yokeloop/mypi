import type { createApp } from './create-app.js';
import type { EventType } from '../modules/knowledge/public.js';
import type { Scope } from '../shared/scope.js';

export function keyScope(key: string): Scope {
  if (/^[A-Z]+$/.test(key)) return { type: 'project', key };
  if (/^[A-Z]+-[1-9][0-9]*$/.test(key)) return { type: 'task', key };
  return { type: 'org', key };
}

export function appendFact(app: Pick<ReturnType<typeof createApp>, 'journalStore'>, scope: Scope, type: EventType, text: string): string {
  return app.journalStore.append({ at: new Date().toISOString(), scope, event_type: type, text });
}

export function messageText(id: number, from: string, message: string): string {
  const line = message.split(/\r?\n/, 1)[0]!;
  return 'message ' + id + ' from ' + from + ': ' + (line.length > 120 ? line.slice(0, 120) + '…' : line);
}

export function sendParentMessage(app: ReturnType<typeof createApp>, input: { from: string; to: string; message: string }): number {
  return app.serialize(() => {
    const id = app.events.send(input);
    appendFact(app, keyScope(input.to), 'message_sent', messageText(id, input.from, input.message));
    return id;
  });
}
