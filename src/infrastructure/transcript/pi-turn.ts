import { existsSync } from 'node:fs';
import type { TurnAction } from '../../shared/turn-actions.js';
import { walkRecords } from './archive-read.js';

const literal = /\/tmp\/[\w./-]+\.(?:md|html)(?![\w./-])/gi;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function toAction(name: unknown, args: Record<string, unknown>, cwd: string | undefined): TurnAction | undefined {
  const at = cwd === undefined ? {} : { cwd };
  const text = (field: string) => typeof args[field] === 'string' ? args[field] as string : undefined;
  const path = text('path'), content = text('content'), title = text('title'), command = text('command');
  if (name === 'write' && path !== undefined) return { kind: 'write', path, ...at, ...(content === undefined ? {} : { content }) };
  if (name === 'edit' && path !== undefined) return { kind: 'write', path, ...at };
  if (name === 'bash' && command !== undefined) return { kind: 'bash', command, ...at };
  if (name === 'mcp__derive__publish') return { kind: 'publish', ...(content === undefined ? {} : { content }), ...(title === undefined ? {} : { title }) };
  const paths = args['paths'];
  if (name === 'mcp__mypi__context_write' && Array.isArray(paths) && paths.every(p => typeof p === 'string')) return { kind: 'context_write', paths };
  return undefined;
}

function literals(code: string, cwd: string | undefined): TurnAction[] {
  const at = cwd === undefined ? {} : { cwd };
  return [...new Set(code.match(literal) ?? [])].map(path => ({ kind: 'write', path, ...at }));
}

export function piTurnActions(path: string, since?: string): TurnAction[] | undefined {
  if (!existsSync(path)) return undefined;
  let cwd: string | undefined, started = since === undefined;
  const messages: Record<string, unknown>[] = [];
  walkRecords(path, 0, r => {
    if (r.type === 'session') {
      if (typeof r.cwd === 'string') cwd = r.cwd;
      return;
    }
    if (!started) {
      if (r.id === since) started = true;
      return;
    }
    if (r.type === 'message' && isObject(r.message)) messages.push(r.message);
  });
  if (!started) return undefined;
  const nested = new Map<string, { calls: unknown[]; complete: boolean }>();
  for (const message of messages) {
    if (message.role !== 'toolResult' || typeof message.toolCallId !== 'string') continue;
    const record = isObject(message.nestedCalls) ? message.nestedCalls : undefined;
    if (record !== undefined && Array.isArray(record.calls)) nested.set(message.toolCallId, { calls: record.calls, complete: record.complete === true });
  }
  const actions: TurnAction[] = [];
  const add = (found: TurnAction | undefined) => { if (found !== undefined) actions.push(found); };
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!isObject(part) || part.type !== 'toolCall' || !isObject(part.arguments)) continue;
      const args = part.arguments;
      if (part.name !== 'codemode' || typeof args.code !== 'string') {
        add(toAction(part.name, args, cwd));
        continue;
      }
      const recorded = typeof part.id === 'string' ? nested.get(part.id) : undefined;
      if (recorded === undefined) {
        actions.push(...literals(args.code, cwd));
        continue;
      }
      let scanned = false;
      for (const call of recorded.calls) {
        if (!isObject(call)) continue;
        if (isObject(call.arguments)) add(toAction(call.name, call.arguments, cwd));
        else if ((call.name === 'write' || call.name === 'edit') && !scanned) {
          scanned = true;
          actions.push(...literals(args.code, cwd));
        }
      }
      if (!recorded.complete && !scanned) actions.push(...literals(args.code, cwd));
    }
  }
  return actions;
}
