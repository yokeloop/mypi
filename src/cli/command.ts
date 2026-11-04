import type { WorkspaceCommand } from './workspace-command.js';
import { parseWorkspaceCommand } from './workspace-command.js';
import { parseArgs } from 'node:util';
import { InputError } from '../shared/errors.js';

export type Command =
  | WorkspaceCommand
  | { type: 'help' }
  | { type: 'initialize' }
  | { type: 'list'; org?: string }
  | { type: 'add'; identity: string; code: string; checkoutPath?: string; repository?: string }
  | { type: 'update'; identity: string; expectedCheckoutPath?: string | null; checkoutPath?: string;
    expectedRepository?: string | null; repository?: string };

export const usage = `mypi db init
mypi project add <org/project> --code <CODE> [--path <checkout>] [--repository <git-url|local>]
mypi project update <org/project> [(--expected-path <previous> | --expected-unset) --path <new-absolute-directory>] [(--expected-repository <previous> | --expected-repository-unset) --repository <git-url|local>]
mypi project list [--org <org>] | resolve <absolute-path>
mypi project flow <CODE|org/project> (the project's branch flow from home/projects/<org>/<project>/flow.json, defaults without it)
mypi project remove <org/project> --expected-code <CODE> | org remove <org> (unreferenced registrations only; home folders stay)
mypi bootstrap | warmup [-s global|CODE|CODE-N] [--max-chars n]
mypi session register --agent claude|pi --pid <pid> (--native-id <id> [--name <name>] [--fork] | --hook) [--socket <path>]
mypi session unregister --pid <pid> | forget <key>
mypi sessions
mypi event emit --from <key> [--to <parent>] [--waiting] [--message text] | --waiting --hook --pid <pid> (records the event for the parent that started the turn, default the task's project, then sends that parent's undelivered events to its live Pi or Claude session)
mypi turn end --pid <pid> (reads Claude's Stop hook input from stdin)
mypi inbox [CODE|CODE-N|global|all] (prints and marks delivered the undelivered events; default: the session's registered key, else MYPI_SCOPE, else global)
mypi send <key> [text | --file source] (a parent's instruction to its child session: delivered live or queued until the next open)
mypi open <key...> [--agent claude|pi] [--permission-mode mode] [--message text]
mypi serve [--listen <IP>] [--port <n>] (HTTP API in the foreground: 127.0.0.1:8737 by default; see docs/HTTP-API.md)
mypi token create <name> --permission read|write [--sender global|CODE] | list | revoke <name> (HTTP API tokens in $XDG_CONFIG_HOME/mypi/api-tokens.json; create prints the token once)
mypi capture [text | --file source]
mypi memory add <text> | show | remove <number> --expected-revision SHA256 [-s scope]
mypi note <title> [text | --file source] [-s scope]
mypi error <org/project> <text>
mypi journal add <text> [-s scope] | read [-s scope | --all] [--from UTC --to UTC --type type --limit n] | import
mypi task create [source | --file source] --title title --status code --slug slug --project org/project [--adopt-source]
mypi task list [--project org/project --status code] | show <key>
mypi task status <key> <code> --reason text | title <key> <title> --reason text
mypi task progress <key> <text> [--artifacts JSON-file] | touch <key> | worktree <key>
mypi status list | add <code> [--terminal] | rename <code> <new> | terminal <code> <true|false> | remove <code>
mypi context read <path> [--revision SHA] | commit <paths...> --message text | restore <path> --revision SHA
mypi backup <directory> | backup --publish [--dry-run] [--file exact-relative-path ...]
mypi restore <backup-directory> | restore --repository <absolute-local-clone> --commit <full-SHA>
mypi home migrate-tasks [--dry-run]
Task and journal saves are local SQLite operations, not Git commits or remote backups.
Import legacy JSONL explicitly after stopping old writers; keep the original files.
Local backup still requires clean, published context files. Publication uses existing home origin/main.
Results and errors are JSON; warmup prints Markdown (scope: -s, else the session's registered key, else MYPI_SCOPE, else global; --max-chars n caps it at n characters instead of 64 KiB).
open keys: a project code (MP), CODE-N, org/project or org/project#N; it needs a running Herdr server.
Set XDG_STATE_HOME to isolated state for development.
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
      args: rest, options: { code: { type: 'string' }, path: { type: 'string' }, repository: { type: 'string' } }, allowPositionals: true,
    });
    if (positionals.length !== 1 || !values.code) throw new InputError('project add requires org/project and --code');
    const command: Command = { type: 'add', identity: positionals[0]!, code: values.code };
    if (values.path !== undefined) command.checkoutPath = values.path;
    if (values.repository !== undefined) command.repository = values.repository;
    return command;
  }
  if (group === 'project' && action === 'update') {
    const { values, positionals } = parseArgs({ args: rest, options: {
      'expected-path': { type: 'string' }, 'expected-unset': { type: 'boolean' }, path: { type: 'string' },
      'expected-repository': { type: 'string' }, 'expected-repository-unset': { type: 'boolean' }, repository: { type: 'string' },
    }, allowPositionals: true });
    const checkout = values.path !== undefined || values['expected-path'] !== undefined || values['expected-unset'] !== undefined;
    const source = values.repository !== undefined || values['expected-repository'] !== undefined
      || values['expected-repository-unset'] !== undefined;
    if (positionals.length !== 1 || (!checkout && !source)) throw new InputError('project update requires org/project and --path or --repository');
    if (checkout && (!values.path || (values['expected-path'] === undefined) !== (values['expected-unset'] === true))) {
      throw new InputError('project update requires org/project, --path and exactly one of --expected-path or --expected-unset');
    }
    if (source && (!values.repository
      || (values['expected-repository'] === undefined) !== (values['expected-repository-unset'] === true))) {
      throw new InputError('project update requires --repository and exactly one of --expected-repository or --expected-repository-unset');
    }
    return { type: 'update', identity: positionals[0]!,
      ...(checkout ? { expectedCheckoutPath: values['expected-path'] ?? null, checkoutPath: values.path! } : {}),
      ...(source ? { expectedRepository: values['expected-repository'] ?? null, repository: values.repository! } : {}) };
  }
  return parseWorkspaceCommand(args);
}
