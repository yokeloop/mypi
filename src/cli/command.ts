import type { WorkspaceCommand } from './workspace-command.js';
import { parseWorkspaceCommand } from './workspace-command.js';
import { parseArgs } from 'node:util';
import { InputError } from '../shared/errors.js';

export type Command =
  | WorkspaceCommand
  | { type: 'help' }
  | { type: 'initialize' }
  | { type: 'list'; org?: string }
  | { type: 'add'; identity: string; code: string; checkoutPath?: string }
  | { type: 'update'; identity: string; expectedCheckoutPath: string | null; checkoutPath: string };

export const usage = `mypi db init
mypi work-chat open-request --project org/project --request-id N [--chat-id ID] [--source-clone /absolute/clone --worktree /absolute/task] [--name label] [--model provider/model-id | --provider provider-id --model model-id] [--no-focus]
mypi work-chat open --project org/project --request-id N --source-clone /absolute/clone --worktree /absolute/task-worktree [--name label] [--model provider/model-id | --provider provider-id --model model-id]
mypi work-chat resume <chat-id> [--model provider/model-id | --provider provider-id --model model-id]
mypi work-chat new-empty <chat-id> [--name label] [--model provider/model-id | --provider provider-id --model model-id]
mypi work-chat list | show <chat-id> | execute --preview '<exact-preview-JSON>' [--focus]
mypi project add <org/project> --code <CODE> [--path <checkout>]
mypi project update <org/project> (--expected-path <previous> | --expected-unset) --path <new-absolute-directory>
mypi project list [--org <org>] | resolve <absolute-path>
mypi bootstrap | warmup [-s org/project]
mypi capture [text | --file source]
mypi memory add <text> | show | remove <number> --expected-revision SHA256 [-s scope]
mypi note <title> [text | --file source] [-s scope]
mypi error <org/project> <text>
mypi journal add <text> [-s scope] | read [-s scope | --all] [--from UTC --to UTC --type type --limit n] | import
mypi request create [source | --file source] --title title --status code --slug slug [--project org/project] [--adopt-source]
mypi request list [--project org/project --status code] | show <key>
mypi request status <key> <code> --reason text | title <key> <title> --reason text
mypi request progress <key> <text> [--artifacts JSON-file] | touch <key>
mypi status list | add <code> [--terminal] | rename <code> <new> | terminal <code> <true|false> | remove <code>
mypi context read <path> | commit <paths...> --message text | restore <path> --revision SHA
mypi backup <directory> | backup --publish [--dry-run] [--file exact-relative-path ...]
mypi restore <backup-directory> | restore --repository <absolute-local-clone> --commit <full-SHA>
Task and journal saves are local SQLite operations, not Git commits or remote backups.
Import legacy JSONL explicitly after stopping old writers; keep the original files.
Local backup still requires clean, published context files. Publication uses existing home origin/main.
Work-chat open-request opens/focuses now; multiple saved chats require --chat-id.
With no association, supply an existing registered clone/task worktree. Nothing is created implicitly.
Low-level open/resume/new-empty and list/show are read-only. Execute exact preview JSON separately.
Opened/existing means verified native identity, not provider/auth readiness; partial is non-success.
Models: home/pi/work-chats.json: default, organizations, projects (complete launch preferences).
New-chat precedence: invocation > project > organization > default > native Pi choice.
Resume uses native saved choice unless explicitly overridden; current config never overrides history.
Use native /model and /login in that same Pi. adopt-model was removed; no mypi adoption is needed.
Set MYPI_WORK_CHAT_PI to the direct absolute Linux Pi executable (not a shell wrapper),
PI_CODING_AGENT_DIR to configured resources and XDG_STATE_HOME to target state.
Requires persistent Herdr (HERDR_ENV/HERDR_WORKSPACE_ID/HERDR_SOCKET_PATH), installed stock Herdr
Pi session integration (optional MYPI_WORK_CHAT_HERDR_EXTENSION), Node 24 and installed mypi package.
The owned shell must resolve pi to that same executable; shell aliases/functions are refused.
Missing saved history cannot be resumed or silently replaced. Stock native empty-closure proof
is unavailable, so low-level new-empty conservatively refuses rather than inventing history.
Historical SQL ready/auth-pending is not current liveness; list/show never reconcile it.
No credential isolation, global history lock, automatic setup, prompt, daemon or retry is provided.
See docs/WORK-CHATS.md for setup, partial-result recovery limits and schema migration.
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
  if (group === 'project' && action === 'update') {
    const { values, positionals } = parseArgs({ args: rest, options: {
      'expected-path': { type: 'string' }, 'expected-unset': { type: 'boolean' }, path: { type: 'string' },
    }, allowPositionals: true });
    if (positionals.length !== 1 || !values.path ||
      (values['expected-path'] === undefined) !== (values['expected-unset'] === true)) {
      throw new InputError('project update requires org/project, --path and exactly one of --expected-path or --expected-unset');
    }
    return { type: 'update', identity: positionals[0]!,
      expectedCheckoutPath: values['expected-path'] ?? null, checkoutPath: values.path };
  }
  return parseWorkspaceCommand(args);
}
