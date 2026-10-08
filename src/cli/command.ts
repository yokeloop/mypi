import type { WorkspaceCommand } from './workspace-command.js';
import { parseWorkspaceCommand } from './workspace-command.js';
import { parseArgs } from 'node:util';
import { InputError } from '../shared/errors.js';

export type Command =
  | WorkspaceCommand
  | { type: 'help' }
  | { type: 'initialize' }
  | { type: 'list'; org?: string }
  | { type: 'add'; identity: string; code: string; checkoutPath?: string };

export const usage = `mypi db init
mypi project add <org/project> --code <CODE> [--path <checkout>]
mypi project list [--org <org>]
mypi bootstrap | warmup [-s org/project]
mypi capture [text | --file source]
mypi memory add <text> | show | remove <number> [-s scope]
mypi note <title> [text | --file source] [-s scope]
mypi error <org/project> <text>
mypi journal add <text> [-s scope] | read [-s scope | --all] [--from UTC --to UTC --type type --limit n]
mypi request create [source | --file source] --title title --status code --slug slug [--project org/project] [--adopt-source]
mypi request list [--project org/project --status code] | show <key>
mypi request status <key> <code> --reason text | title <key> <title> --reason text
mypi request progress <key> <text> [--artifacts JSON-file] | touch <key>
mypi status list | add <code> [--terminal] | rename <code> <new> | terminal <code> <true|false> | remove <code>
mypi context read <path> | commit <paths...> --message text | restore <path> --revision SHA
mypi backup <directory> | restore <backup-directory>
mypi policy validate [YAML | --file path]
mypi policy explain <action> --target JSON
mypi policy preview <action> [YAML | --file path] --scope JSON --target JSON [--profile standard|isolated]
Policy diagnostics do not install or enforce policy. Preview is hypothetical; effective explain needs trusted context.
Legacy commands without trusted context remain unprotected; data scope is not an ACL.
All results and errors are JSON. Set XDG_STATE_HOME to isolated state for development.
`;

export function parseCommand(args: string[]): Command {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) return { type: 'help' };
  const [group, action, ...rest] = args;
  if (group === 'db' && action === 'init' && rest.length === 0) return { type: 'initialize' };
  if (group === 'project' && action === 'list') {
    const { values, positionals } = parseArgs({ args: rest, options: { org: { type: 'string' } }, allowPositionals: true });
    if (positionals.length) throw new InputError('project list takes no positional arguments');
    return values.org === undefined ? { type: 'list' } : { type: 'list', org: values.org };
  }
  if (group === 'project' && action === 'add') {
    const { values, positionals } = parseArgs({
      args: rest, options: { code: { type: 'string' }, path: { type: 'string' } }, allowPositionals: true,
    });
    if (positionals.length !== 1 || !values.code) throw new InputError('project add requires org/project and --code');
    const command: Command = { type: 'add', identity: positionals[0]!, code: values.code };
    if (values.path !== undefined) command.checkoutPath = values.path;
    return command;
  }
  return parseWorkspaceCommand(args);
}
