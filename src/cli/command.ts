import { parseSessionControl } from './session-control-command.js';
import type { SessionControlCommand } from './session-control-command.js';
import type { WorkspaceCommand } from './workspace-command.js';
import type { PiCommand } from './pi-command.js';
import { parsePiCommand } from './pi-command.js';
import { parseWorkspaceCommand } from './workspace-command.js';
import { parseArgs } from 'node:util';
import { InputError } from '../shared/errors.js';

export type Command =
  | WorkspaceCommand
  | PiCommand
  | SessionControlCommand
  | { type: 'help' }
  | { type: 'initialize' }
  | { type: 'list'; org?: string }
  | { type: 'add'; identity: string; code: string; checkoutPath?: string };

export const usage = `mypi pi [--project org/project | --org org | --unrestricted] [--cwd directory] [--base clone] [--allow-observed-session] [--herdr-tab [--title text]] [-- Pi arguments...]
mypi db init
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
mypi workspace prepare <path> --project org/project [--base clone] --branch task/name --start refs/heads/main
mypi workspace inspect [path] --project org/project [--base clone]
mypi workspace verify --project org/project [--base clone] --worktree path --branch task/name
mypi workspace cleanup-preview --project org/project [--base clone] --worktree path --branch task/name [--remote origin]
mypi workspace commit <files...> --project org/project [--base clone] --worktree path --branch task/name --message text
mypi workspace publish --project org/project [--base clone] --worktree path --branch task/name --remote origin
mypi message send <instance-key> <message-id> <text> [--ttl-ms milliseconds]
mypi message list <native-session-id> | show <native-session-id> <message-id> | cleanup <native-session-id> <message-id>
mypi session list [--project org/project | --all] [--archived]
mypi session show <instance-key> | archive <instance-key> [--project org/project | --all]
mypi session focus <instance-key> | title <instance-key> <text> [--project org/project | --all]
mypi home document-patch <path> <text> --expected SHA256
mypi home status | reconcile
mypi context read <path> | commit <paths...> --message text | restore <path> --revision SHA
mypi backup <directory> | restore <backup-directory>
mypi policy validate [YAML | --file path]
mypi policy explain <guard> [YAML | --file path]
Guards: outsideWorktreeWrite, baseCheckoutWrite, foreignMypiTarget (warn or block).
Policy commands are diagnostics, not policy installation.
Supported contextual operations use cooperative guards; working context is not an ACL.
Data commands return JSON. pi inherits native terminal IO and exit status (native help: pi -- --help).
Project --cwd must be an existing checkout/worktree root; --base requires --project.
Session commands default to the selected project; otherwise choose --project or --all.
Session cards are observations, not transcripts or process-death evidence.
Messages queue without waking Pi; CLI sender has no inferred native ID. Cleanup forgets selected dedup evidence.
Run pnpm bootstrap once in this installation to explicitly choose home, external database and state root.
MYPI_INSTALLATION_FILE selects an absolute binding associated with this engine; no personal XDG data is adopted.
MYPI_SESSION_DIR and MYPI_MAILBOX_DIR must match the selected runtime directories or be unset.
`;

export function parseCommand(args: string[]): Command {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) return { type: 'help' };
  const [group, action, ...rest] = args;
  if (group === 'session' && (action === 'focus' || action === 'title')) return parseSessionControl(action, rest);
  if (group === 'pi') return parsePiCommand(args.slice(1));
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
