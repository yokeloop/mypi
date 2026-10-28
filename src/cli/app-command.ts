import type { AppCommand, Artifact, TextInput } from '../app/commands.js';
import { readInputFile } from '../app/input-text.js';
import { InputError } from '../shared/errors.js';
import type { Command } from './command.js';

export function appCommand(command: Exclude<Command, { type: 'help' }>, env: Readonly<Record<string, string | undefined>> = {}): AppCommand {
  if (command.type === 'initialize') return { name: 'db_init' };
  if (command.type === 'list') return { name: 'project_list', ...(command.org === undefined ? {} : { org: command.org }) };
  if (command.type === 'add') return { name: 'project_add', identity: command.identity, code: command.code,
    ...(command.checkoutPath === undefined ? {} : { checkoutPath: command.checkoutPath }) };
  if (command.type === 'update') return { name: 'project_update', identity: command.identity,
    expectedCheckoutPath: command.expectedCheckoutPath, checkoutPath: command.checkoutPath };
  const { name, args: a, options: o } = command;
  const opt = (key: string) => typeof o[key] === 'string' ? o[key] as string : undefined;
  const required = (key: string) => { const value = opt(key); if (!value) throw new InputError('--' + key + ' required'); return value; };
  const scope = opt('scope') === undefined ? { type: 'global' as const } : { reference: opt('scope')! };
  const journalScope = opt('scope') ? { reference: opt('scope')! } : { type: 'global' as const };
  function source(index: number): TextInput {
    if (opt('file') && a[index] !== undefined) throw new InputError('Use text or --file, not both');
    if (opt('file')) return { file: required('file') };
    if (a[index] === undefined) throw new InputError('Text or --file required');
    return { text: a[index] };
  }
  switch (name) {
    case 'bootstrap': return { name: 'bootstrap' };
    case 'capture': return { name: 'capture', source: source(0) };
    case 'note': return { name: 'note_add', title: a[0]!, body: source(1), scope };
    case 'error': return { name: 'error_add', project: a[0]!, text: a[1]! };
    case 'project resolve': return { name: 'project_resolve', path: a[0]! };
    case 'warmup': return { name: 'warmup', ...(opt('scope') === undefined ? {} : { scope: opt('scope')! }),
      ...(env['MYPI_SCOPE'] === undefined ? {} : { envScope: env['MYPI_SCOPE'] }),
      ...(opt('max-chars') === undefined ? {} : { maxChars: Number(opt('max-chars')) }) };
    case 'memory show': return { name: 'memory_show', scope };
    case 'memory add': return { name: 'memory_add', text: a[0]!, scope };
    case 'memory remove': return { name: 'memory_remove', number: Number(a[0]), expectedRevision: required('expected-revision'), scope };
    case 'journal add': return { name: 'journal_add', text: a[0]!, scope: journalScope };
    case 'journal import': return { name: 'journal_import' };
    case 'journal read': return { name: 'journal_read', scope: o['all'] ? 'all' : journalScope,
      ...(opt('from') === undefined ? {} : { from: opt('from')! }),
      ...(opt('to') === undefined ? {} : { to: opt('to')! }),
      ...(opt('type') === undefined ? {} : { eventType: opt('type') as 'note' | 'task_created' | 'status_changed' }),
      ...(opt('limit') === undefined ? {} : { limit: Number(opt('limit')) }) };
    case 'task create': return { name: 'task_create', title: required('title'), status: required('status'),
      slug: required('slug'), source: source(0), project: required('project'), adoptSource: Boolean(o['adopt-source']) };
    case 'task list': return { name: 'task_list',
      ...(opt('project') === undefined ? {} : { project: opt('project')! }),
      ...(opt('status') === undefined ? {} : { status: opt('status')! }) };
    case 'task show': return { name: 'task_show', key: a[0]! };
    case 'task touch': return { name: 'task_touch', key: a[0]! };
    case 'task worktree': return { name: 'task_worktree', key: a[0]! };
    case 'task status': return { name: 'task_status', key: a[0]!, status: a[1]!, reason: required('reason') };
    case 'task title': return { name: 'task_title', key: a[0]!, title: a[1]!, reason: required('reason') };
    case 'task progress': {
      const artifacts: unknown = opt('artifacts') ? JSON.parse(readInputFile(required('artifacts'))) : [];
      if (!Array.isArray(artifacts) || artifacts.some(a => !a || typeof a !== 'object'
        || typeof a.path !== 'string' || (a.text !== undefined && typeof a.text !== 'string')
        || Object.keys(a).some(k => !['path', 'text'].includes(k)))) throw new InputError('Artifacts must be [{path,text?}]');
      return { name: 'task_progress', key: a[0]!, text: a[1]!, artifacts: artifacts as Artifact[] };
    }
    case 'status list': return { name: 'status_list' };
    case 'status add': return { name: 'status_add', code: a[0]!, terminal: Boolean(o['terminal']) };
    case 'status rename': return { name: 'status_rename', code: a[0]!, newCode: a[1]! };
    case 'status terminal':
      if (!['true', 'false'].includes(a[1]!)) throw new InputError('Use true or false');
      return { name: 'status_terminal', code: a[0]!, terminal: a[1] === 'true' };
    case 'status remove': return { name: 'status_remove', code: a[0]! };
    case 'context read': return { name: 'context_read', path: a[0]! };
    case 'context commit': return { name: 'context_commit', paths: a, message: required('message') };
    case 'context restore': return { name: 'context_restore', path: a[0]!, revision: required('revision') };
    case 'backup': return o['publish'] ? { name: 'backup_publish', dryRun: Boolean(o['dry-run']), selectedPaths: o['file'] as string[] ?? [] } :
      { name: 'backup', destination: a[0]! };
    case 'restore': return opt('repository') ? { name: 'restore_published', repository: required('repository'), commit: required('commit') } :
      { name: 'restore', backupDirectory: a[0]! };
    case 'home migrate-tasks': return { name: 'home_migrate_tasks', dryRun: Boolean(o['dry-run']) };
    default: throw new InputError('Unknown workspace command');
  }
}
