import { parseArgs } from 'node:util';
export interface WorkspaceCommand {
  type: 'workspace';
  name: string;
  args: string[];
  options: Record<string, string | string[] | boolean | undefined>;
}
import { InputError } from '../shared/errors.js';
const specs: Record<string, [number, number, string[], string[]]> = {
  bootstrap: [0, 0, [], []],
  'project resolve': [1, 1, [], []],
  capture: [0, 1, ['file'], []],
  warmup: [0, 0, ['scope', 'max-chars'], []],
  note: [1, 2, ['scope', 'file'], []],
  error: [2, 2, [], []],
  'memory show': [0, 0, ['scope'], []],
  'memory add': [1, 1, ['scope'], []],
  'memory remove': [1, 1, ['scope', 'expected-revision'], []],
  'journal add': [1, 1, ['scope'], []],
  'journal import': [0, 0, [], []],
  'journal read': [0, 0, ['scope', 'from', 'to', 'type', 'limit'], ['all']],
  'task create': [0, 1, ['project', 'title', 'status', 'slug', 'file'], ['adopt-source']],
  'task list': [0, 0, ['project', 'status'], []],
  'task show': [1, 1, [], []],
  'task status': [2, 2, ['reason'], []],
  'task title': [2, 2, ['reason'], []],
  'task progress': [2, 2, ['artifacts'], []],
  'task touch': [1, 1, [], []],
  'task worktree': [1, 1, [], []],
  'status list': [0, 0, [], []],
  'status add': [1, 1, [], ['terminal']],
  'status rename': [2, 2, [], []],
  'status terminal': [2, 2, [], []],
  'status remove': [1, 1, [], []],
  'context read': [1, 1, [], []],
  'context commit': [1, Infinity, ['message'], []],
  'context restore': [1, 1, ['revision'], []],
  backup: [0, 1, ['file'], ['publish', 'dry-run']],
  restore: [0, 1, ['repository', 'commit'], []],
  'home migrate-tasks': [0, 0, [], ['dry-run']],
  sessions: [0, 0, [], []],
  'session register': [0, 0, ['agent', 'pid', 'native-id', 'name', 'socket'], ['hook', 'fork']],
  'session unregister': [0, 0, ['pid'], []],
  'session forget': [1, 1, [], []],
  'event emit': [0, 0, ['from', 'message', 'pid'], ['waiting', 'hook']],
  'turn end': [0, 0, ['pid'], []],
  inbox: [0, 1, [], []],
  open: [1, Infinity, ['agent', 'permission-mode'], []],
};
export function parseWorkspaceCommand(args: string[]): WorkspaceCommand {
  const simple = specs[args[0]!], name = simple ? args[0]! : args.slice(0, 2).join(' ');
  const spec = specs[name];
  if (!spec) throw new InputError('Unknown command; use --help');
  const [min, max, strings, booleans] = spec;
  const options: Record<string, { type: 'string' | 'boolean'; short?: string; multiple?: boolean }> = {};
  for (const key of strings) options[key] = key === 'scope' ? { type: 'string', short: 's' } : { type: 'string', ...(key === 'file' && name === 'backup' ? { multiple: true } : {}) };
  for (const key of booleans) options[key] = { type: 'boolean' };
  const parsed = parseArgs({ args: args.slice(simple ? 1 : 2), options, allowPositionals: true });
  if (parsed.positionals.length < min || parsed.positionals.length > max) throw new InputError('Wrong argument count for ' + name);
  if (name === 'backup' && (parsed.values['publish'] ? parsed.positionals.length !== 0 :
    parsed.positionals.length !== 1 || parsed.values['dry-run'] !== undefined || parsed.values['file'] !== undefined))
    throw new InputError('Use backup <directory> or backup --publish [--dry-run] [--file path]');
  if (name === 'restore' && (parsed.values['repository'] !== undefined || parsed.values['commit'] !== undefined ?
    parsed.positionals.length !== 0 || !parsed.values['repository'] || !parsed.values['commit'] : parsed.positionals.length !== 1))
    throw new InputError('Use restore <directory> or restore --repository <clone> --commit <SHA>');
  if (parsed.values['all'] && parsed.values['scope']) throw new InputError('--all and --scope are mutually exclusive');
  return { type: 'workspace', name, args: parsed.positionals, options: parsed.values as WorkspaceCommand['options'] };
}
