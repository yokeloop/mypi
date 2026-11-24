import type { TurnAction, TurnActionReader } from '../../shared/turn-actions.js';
import { claudeTurnTail } from './claude-transcript.js';

function action(name: unknown, input: Record<string, unknown>, cwd: string | undefined): TurnAction | undefined {
  const at = cwd === undefined ? {} : { cwd };
  const text = (field: string) => typeof input[field] === 'string' ? input[field] as string : undefined;
  const path = text('file_path'), content = text('content'), title = text('title'), command = text('command');
  if (name === 'Write' && path !== undefined) return { kind: 'write', path, ...at, ...(content === undefined ? {} : { content }) };
  if (name === 'Edit' && path !== undefined) return { kind: 'write', path, ...at };
  if (name === 'Bash' && command !== undefined) return { kind: 'bash', command, ...at };
  if (name === 'mcp__derive__publish') return { kind: 'publish', ...(content === undefined ? {} : { content }), ...(title === undefined ? {} : { title }) };
  const paths = input['paths'];
  if (name === 'mcp__mypi__context_write' && Array.isArray(paths) && paths.every(p => typeof p === 'string')) return { kind: 'context_write', paths };
  return undefined;
}

export const claudeTurnActions: TurnActionReader = path => {
  const tail = claudeTurnTail(path);
  if (tail === undefined) return undefined;
  const actions: TurnAction[] = [];
  for (const record of tail.records) {
    if (record['type'] !== 'assistant') continue;
    const message = record['message'];
    const content = typeof message === 'object' && message !== null ? (message as { content?: unknown }).content : undefined;
    if (!Array.isArray(content)) continue;
    const cwd = typeof record['cwd'] === 'string' ? record['cwd'] : undefined;
    for (const part of content) {
      if (typeof part !== 'object' || part === null || part.type !== 'tool_use') continue;
      const input = part.input;
      if (typeof input !== 'object' || input === null || Array.isArray(input)) continue;
      const found = action(part.name, input as Record<string, unknown>, cwd);
      if (found !== undefined) actions.push(found);
    }
  }
  return actions;
};
