import { parseArgs } from 'node:util';
import type { HerdrControl } from '../app/herdr.js';
import { InputError } from '../shared/errors.js';

export type SessionControlCommand = HerdrControl & { type: 'session-control' };
export function parseSessionControl(action: 'focus' | 'title', args: string[]): SessionControlCommand {
  const { values, positionals, tokens } = parseArgs({ args, allowPositionals: true, tokens: true,
    options: { project: { type: 'string' }, all: { type: 'boolean' } } });
  const seen = new Set<string>();
  for (const token of tokens) if (token.kind === 'option') {
    if (seen.has(token.name)) throw new InputError('Repeated session control option');
    seen.add(token.name);
  }
  if (positionals.length !== (action === 'focus' ? 1 : 2) || (values.all && values.project !== undefined)) {
    throw new InputError('Session control requires an instance key, title for rename, and project or all selection');
  }
  const selection = { ...(values.project === undefined ? {} : { project: values.project }), ...(values.all ? { all: true } : {}) };
  return { type: 'session-control', instanceKey: positionals[0]!, ...selection,
    ...(action === 'focus' ? { action } : { action, title: positionals[1]! }) };
}
