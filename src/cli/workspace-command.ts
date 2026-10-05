import { parseArgs } from 'node:util';
export interface WorkspaceCommand {
  type: 'workspace';
  name: string;
  args: string[];
  options: Record<string, string | boolean | undefined>;
}
import { InputError } from '../shared/errors.js';
const specs: Record<string, [number, number, string[], string[]]> = {
  bootstrap: [0, 0, [], []],
  'run start': [1, 1, ['seconds', 'model-calls', 'model', 'resume', 'derive-artifact', 'derive-workspace'], ['fixture']],
  'project resolve': [1, 1, [], []],
  'run export': [1, 1, [], []],
  'run show': [1, 1, [], []],
  'run stop': [1, 1, [], []],
  'run reconcile': [1, 1, [], []],
  'run list': [1, 1, [], []],
  capture: [0, 1, ['file'], []],
  warmup: [0, 0, ['scope'], []],
  note: [1, 2, ['scope', 'file'], []],
  error: [2, 2, [], []],
  'memory show': [0, 0, ['scope'], []],
  'memory add': [1, 1, ['scope'], []],
  'memory remove': [1, 1, ['scope'], []],
  'journal add': [1, 1, ['scope'], []],
  'journal read': [0, 0, ['scope', 'from', 'to', 'type', 'limit'], ['all']],
  'request create': [0, 1, ['project', 'title', 'status', 'slug', 'file'], ['adopt-source']],
  'request list': [0, 0, ['project', 'status'], []],
  'request show': [1, 1, [], []],
  'request status': [2, 2, ['reason'], []],
  'request title': [2, 2, ['reason'], []],
  'request progress': [2, 2, ['artifacts'], []],
  'request touch': [1, 1, [], []],
  'status list': [0, 0, [], []],
  'status add': [1, 1, [], ['terminal']],
  'status rename': [2, 2, [], []],
  'status terminal': [2, 2, [], []],
  'status remove': [1, 1, [], []],
  'context read': [1, 1, [], []],
  'context commit': [1, Infinity, ['message'], []],
  'context restore': [1, 1, ['revision'], []],
  backup: [1, 1, [], []],
  restore: [1, 1, [], []],
};
export function parseWorkspaceCommand(args: string[]): WorkspaceCommand {
  const simple = specs[args[0]!], name = simple ? args[0]! : args.slice(0, 2).join(' ');
  const spec = specs[name];
  if (!spec) throw new InputError('Unknown command; use --help');
  const [min, max, strings, booleans] = spec;
  const options: Record<string, { type: 'string' | 'boolean'; short?: string }> = {};
  for (const key of strings) options[key] = key === 'scope' ? { type: 'string', short: 's' } : { type: 'string' };
  for (const key of booleans) options[key] = { type: 'boolean' };
  const parsed = parseArgs({ args: args.slice(simple ? 1 : 2), options, allowPositionals: true });
  if (parsed.positionals.length < min || parsed.positionals.length > max) throw new InputError('Wrong argument count for ' + name);
  if (parsed.values['all'] && parsed.values['scope']) throw new InputError('--all and --scope are mutually exclusive');
  return { type: 'workspace', name, args: parsed.positionals, options: parsed.values as WorkspaceCommand['options'] };
}
