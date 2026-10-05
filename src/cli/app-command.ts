import type { AppCommand, Artifact, TextInput } from '../app/commands.js';
import { readInputFile } from '../app/input-text.js';
import { InputError } from '../shared/errors.js';
import type { Command } from './command.js';

export function appCommand(command: Exclude<Command, { type: 'help' }>): AppCommand {
  if (command.type === 'initialize') return { name: 'db_init' };
  if (command.type === 'list') return { name: 'project_list', ...(command.org === undefined ? {} : { org: command.org }) };
  if (command.type === 'add') return { name: 'project_add', identity: command.identity, code: command.code,
    ...(command.checkoutPath === undefined ? {} : { checkoutPath: command.checkoutPath }) };
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
    case 'run start': return { name: 'run_start', key: a[0]!, seconds: Number(required('seconds')),
      modelCalls: Number(required('model-calls')), fixture: Boolean(o['fixture']),
      ...(opt('derive-artifact') === undefined ? {} : { deriveArtifact: opt('derive-artifact')! }),
      ...(opt('derive-workspace') === undefined ? {} : { deriveWorkspace: opt('derive-workspace')! }),
      ...(opt('model') === undefined ? {} : { model: opt('model')! }), ...(opt('resume') === undefined ? {} : { resume: opt('resume')! }) };
    case 'project resolve': return { name: 'project_resolve', path: a[0]! };
    case 'run export': return { name: 'run_export', id: a[0]! };
    case 'run show': return { name: 'run_show', id: a[0]! };
    case 'run stop': return { name: 'run_stop', id: a[0]! };
    case 'run reconcile': return { name: 'run_reconcile', id: a[0]! };
    case 'run list': return { name: 'run_list', key: a[0]! };
    case 'bootstrap': return { name: 'bootstrap' };
    case 'capture': return { name: 'capture', source: source(0) };
    case 'note': return { name: 'note_add', title: a[0]!, body: source(1), scope };
    case 'error': return { name: 'error_add', project: a[0]!, text: a[1]! };
    case 'warmup': return { name: 'warmup', scope };
    case 'memory show': return { name: 'memory_show', scope };
    case 'memory add': return { name: 'memory_add', text: a[0]!, scope };
    case 'memory remove': return { name: 'memory_remove', number: Number(a[0]), scope };
    case 'journal add': return { name: 'journal_add', text: a[0]!, scope: journalScope };
    case 'journal read': return { name: 'journal_read', scope: o['all'] ? 'all' : journalScope,
      ...(opt('from') === undefined ? {} : { from: opt('from')! }),
      ...(opt('to') === undefined ? {} : { to: opt('to')! }),
      ...(opt('type') === undefined ? {} : { eventType: opt('type') as 'note' | 'request_created' | 'status_changed' }),
      ...(opt('limit') === undefined ? {} : { limit: Number(opt('limit')) }) };
    case 'request create': return { name: 'request_create', title: required('title'), status: required('status'),
      slug: required('slug'), source: source(0), project: opt('project') ?? null, adoptSource: Boolean(o['adopt-source']) };
    case 'request list': return { name: 'request_list',
      ...(opt('project') === undefined ? {} : { project: opt('project')! }),
      ...(opt('status') === undefined ? {} : { status: opt('status')! }) };
    case 'request show': return { name: 'request_show', key: a[0]! };
    case 'request touch': return { name: 'request_touch', key: a[0]! };
    case 'request status': return { name: 'request_status', key: a[0]!, status: a[1]!, reason: required('reason') };
    case 'request title': return { name: 'request_title', key: a[0]!, title: a[1]!, reason: required('reason') };
    case 'request progress': {
      const artifacts: unknown = opt('artifacts') ? JSON.parse(readInputFile(required('artifacts'))) : [];
      if (!Array.isArray(artifacts) || artifacts.some(a => !a || typeof a !== 'object'
        || typeof a.path !== 'string' || (a.text !== undefined && typeof a.text !== 'string')
        || Object.keys(a).some(k => !['path', 'text'].includes(k)))) throw new InputError('Artifacts must be [{path,text?}]');
      return { name: 'request_progress', key: a[0]!, text: a[1]!, artifacts: artifacts as Artifact[] };
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
    case 'backup': return { name: 'backup', destination: a[0]! };
    case 'restore': return { name: 'restore', backupDirectory: a[0]! };
    default: throw new InputError('Unknown workspace command');
  }
}
