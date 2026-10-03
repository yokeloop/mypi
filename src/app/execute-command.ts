import { readFileSync } from 'node:fs';
import type { WorkspaceCommand } from './commands.js';
import { createWorkspace, initializeWorkspace } from './create-workspace.js';
import { backupState, restoreState } from './backup.js';
import { importLegacy } from './import-legacy.js';
import { InputError } from '../shared/errors.js';
import { scopeValue } from '../shared/scope.js';
import type { Scope } from '../shared/scope.js';
import type { EventType } from '../modules/knowledge/public.js';
const reads = new Set(['warmup', 'memory show', 'journal read', 'request list', 'request show', 'status list', 'context read']);

export function readInputFile(path: string): string {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
}
export async function executeCommand(command: WorkspaceCommand, filename: string, root?: string): Promise<unknown> {
  const { name, args, options } = command;
  const opt = (key: string) => typeof options[key] === 'string' ? options[key] as string : undefined;
  const required = (key: string) => { const value = opt(key); if (!value) throw new InputError('--' + key + ' required'); return value; };
  function text(index: number): string {
    if (opt('file') && args[index] !== undefined) throw new InputError('Use text or --file, not both');
    const value = opt('file') ? readInputFile(required('file')) : args[index];
    if (value === undefined) throw new InputError('Text or --file required');
    return value;
  }
  if (name === 'bootstrap') { initializeWorkspace(filename, root); return { status: 'ok' }; }
  if (name === 'backup') return backupState(filename, args[0]!, root);
  if (name === 'restore') return restoreState(args[0]!, filename, root);
  if (name === 'import legacy') {
    const codes: unknown = JSON.parse(readInputFile(required('codes')));
    if (!codes || typeof codes !== 'object' || Array.isArray(codes) || Object.values(codes).some(c => typeof c !== 'string')) throw new InputError('Codes must map project identities to codes');
    return importLegacy(filename, args[0]!, codes as Record<string, string>, root);
  }
  const app = createWorkspace(filename, reads.has(name), root);
  function scope(): Scope {
    const input = opt('scope');
    if (!input || input === 'global') return { type: 'global' };
    if (input.includes(':')) { const [type, key, extra] = input.split(':'); if (extra !== undefined) throw new InputError('Invalid scope'); return scopeValue({ type, key }); }
    const resolved = app.projects.resolveScope(input);
    if (resolved.type === 'project') return { type: 'project', key: resolved.project.code };
    if (resolved.type === 'org') return { type: 'org', key: resolved.slug };
    return { type: 'global' };
  }
  try {
    switch (name) {
      case 'capture': return { path: app.capture(text(0)) };
      case 'note': return { path: app.note(args[0]!, text(1), opt('scope')) };
      case 'error': return { path: app.error(args[0]!, args[1]!) };
      case 'warmup': return app.warmup(opt('scope'));
      case 'memory show': return app.memory.show(opt('scope'));
      case 'memory add': return { path: app.memory.add(args[0]!, opt('scope')) };
      case 'memory remove': return { removed: app.memory.remove(Number(args[0]), opt('scope')) };
      case 'journal add': return { commit: app.journal(scope(), args[0]!) };
      case 'journal read': return app.history(options['all'] ? 'all' : scope(), {
        ...(opt('from') === undefined ? {} : { from: opt('from')! }),
        ...(opt('to') === undefined ? {} : { to: opt('to')! }),
        ...(opt('type') === undefined ? {} : { type: opt('type') as EventType }),
        ...(opt('limit') === undefined ? {} : { limit: Number(opt('limit')) }),
      });
      case 'request create': return app.requests.create({
        title: required('title'), status: required('status'), slug: required('slug'), source: text(0),
        ...(opt('project') === undefined ? {} : { project: opt('project')! }),
        adoptSource: Boolean(options['adopt-source']),
      });
      case 'request list': return app.requests.list({ project: opt('project'), status: opt('status') });
      case 'request show': return app.requests.get(args[0]!);
      case 'request status': return app.requests.change(args[0]!, { status: args[1]! }, required('reason'));
      case 'request title': return app.requests.change(args[0]!, { title: args[1]! }, required('reason'));
      case 'request touch': return app.requests.touch(args[0]!);
      case 'request progress': {
        const artifacts: unknown = opt('artifacts') ? JSON.parse(readInputFile(required('artifacts'))) : [];
        if (!Array.isArray(artifacts) || artifacts.some(a => !a || typeof a !== 'object'
          || typeof a.path !== 'string' || (a.text !== undefined && typeof a.text !== 'string')
          || Object.keys(a).some(k => !['path', 'text'].includes(k)))) throw new InputError('Artifacts must be [{path,text?}]');
        return app.requests.progress(args[0]!, args[1]!, artifacts);
      }
      case 'status list': return app.statuses.statuses();
      case 'status add': app.statuses.addStatus(args[0]!, Boolean(options['terminal'])); break;
      case 'status rename': app.statuses.renameStatus(args[0]!, args[1]!); break;
      case 'status terminal':
        if (!['true', 'false'].includes(args[1]!)) throw new InputError('Use true or false');
        app.statuses.setTerminal(args[0]!, args[1] === 'true'); break;
      case 'status remove': app.statuses.removeStatus(args[0]!); break;
      case 'context read': {
        const content = app.read(args[0]!);
        if (content === undefined) throw new InputError('Missing context file');
        return { path: args[0], text: content };
      }
      case 'context commit': return { commit: app.complete(args, required('message')) };
      case 'context restore': return { commit: app.restoreContext(args[0]!, required('revision')) };
      default: throw new InputError('Unknown workspace command');
    }
    return { status: 'ok' };
  } finally { app.close(); }
}
