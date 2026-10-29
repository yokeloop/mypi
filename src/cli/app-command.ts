import type { AppCommand, Artifact, TextInput } from '../app/commands.js';
import { readInputFile } from '../app/input-text.js';
import { hookInput, notificationInput, sessionHint, stopInput } from '../app/session-input.js';
import { InputError } from '../shared/errors.js';
import type { Command } from './command.js';

export function appCommand(command: Exclude<Command, { type: 'help' }>, env: Readonly<Record<string, string | undefined>> = {},
  parentPid = process.ppid): AppCommand {
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
  const runtime = env['XDG_RUNTIME_DIR'] ? { runtime: env['XDG_RUNTIME_DIR'] } : {};
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
    case 'warmup': {
      const hint = sessionHint(env, parentPid);
      return { name: 'warmup', ...(opt('scope') === undefined ? {} : { scope: opt('scope')! }),
        ...(env['MYPI_SCOPE'] === undefined ? {} : { envScope: env['MYPI_SCOPE'] }),
        ...(opt('max-chars') === undefined ? {} : { maxChars: Number(opt('max-chars')) }),
        ...(hint === undefined ? {} : { session: hint }) };
    }
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
    case 'sessions': return { name: 'sessions', ...runtime };
    case 'session register': {
      const agent = required('agent');
      if (agent !== 'claude' && agent !== 'pi') throw new InputError('--agent must be claude or pi');
      let session: { nativeId: string; name?: string; fork: boolean };
      if (o['hook']) {
        if (agent !== 'claude') throw new InputError('--hook is only for --agent claude');
        if (opt('native-id') !== undefined || opt('name') !== undefined || o['fork']) throw new InputError('Use --hook or --native-id, not both');
        session = hookInput(readInputFile(0));
      } else session = { nativeId: required('native-id'), ...(opt('name') === undefined ? {} : { name: opt('name')! }), fork: Boolean(o['fork']) };
      const socket = opt('socket') ?? (agent === 'claude' && env['CLAUDE_CODE_MESSAGING_SOCKET'] ? env['CLAUDE_CODE_MESSAGING_SOCKET'] : undefined);
      return { name: 'session_register', agent, pid: Number(required('pid')), nativeId: session.nativeId,
        ...(session.name === undefined ? {} : { sessionName: session.name }), ...(socket === undefined ? {} : { socket }), fork: session.fork,
        ...(env['MYPI_SCOPE'] === undefined ? {} : { envScope: env['MYPI_SCOPE'] }), ...runtime };
    }
    case 'session unregister': return { name: 'session_unregister', pid: Number(required('pid')), ...runtime };
    case 'session forget': return { name: 'session_forget', key: a[0]!, ...runtime };
    case 'event emit': {
      const envScope = env['MYPI_SCOPE'] === undefined ? {} : { envScope: env['MYPI_SCOPE'] };
      if (o['hook']) {
        if (opt('from') !== undefined || opt('message') !== undefined) throw new InputError('Use --hook or --from, not both');
        if (!o['waiting']) throw new InputError('--hook requires --waiting');
        const pid = Number(required('pid'));
        const input = notificationInput(readInputFile(0));
        return { name: 'event_emit', kind: 'waiting', message: input.message, notification: input.type,
          session: { agent: 'claude', nativeId: input.nativeId, pid, ...runtime }, ...envScope };
      }
      return { name: 'event_emit', kind: o['waiting'] ? 'waiting' : 'turn_end', message: opt('message') ?? '', from: required('from') };
    }
    case 'turn end': {
      const pid = Number(required('pid'));
      const input = stopInput(readInputFile(0));
      return { name: 'turn_end', nativeId: input.nativeId, active: input.active, message: input.message, pid,
        ...(env['MYPI_SCOPE'] === undefined ? {} : { envScope: env['MYPI_SCOPE'] }), ...runtime };
    }
    case 'inbox': {
      const hint = sessionHint(env, parentPid);
      return { name: 'inbox', ...(a[0] === undefined ? {} : { key: a[0] }), ...(hint === undefined ? {} : { session: hint }),
        ...(env['MYPI_SCOPE'] === undefined ? {} : { envScope: env['MYPI_SCOPE'] }) };
    }
    case 'open': {
      const agent = opt('agent');
      if (agent !== undefined && agent !== 'claude' && agent !== 'pi') throw new InputError('--agent must be claude or pi');
      const hint = sessionHint(env, parentPid);
      return { name: 'open_session', keys: a, ...(agent === undefined ? {} : { agent }),
        ...(opt('permission-mode') === undefined ? {} : { permissionMode: opt('permission-mode')! }),
        ...(hint === undefined ? {} : { session: hint }),
        ...(env['HERDR_WORKSPACE_ID'] ? { workspace: env['HERDR_WORKSPACE_ID'] } : {}),
        ...(env['XDG_STATE_HOME'] ? { stateHome: env['XDG_STATE_HOME'] } : {}), ...runtime };
    }
    default: throw new InputError('Unknown workspace command');
  }
}
