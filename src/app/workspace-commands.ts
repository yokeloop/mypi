import { InputError } from '../shared/errors.js';

interface WorkspaceSelection { project: string; baseRoot?: string }
export type WorkspaceOperation =
  | (WorkspaceSelection & { name: 'workspace_prepare'; worktreeRoot: string; branch: string; startPoint: string })
  | (WorkspaceSelection & { name: 'workspace_inspect'; worktreeRoot?: string })
  | (WorkspaceSelection & { name: 'workspace_verify'; worktreeRoot: string; branch: string })
  | (WorkspaceSelection & { name: 'workspace_cleanup_preview'; worktreeRoot: string; branch: string; remote?: string })
  | (WorkspaceSelection & { name: 'workspace_commit'; worktreeRoot: string; branch: string; paths: string[]; message: string })
  | (WorkspaceSelection & { name: 'workspace_publish'; worktreeRoot: string; branch: string; remote: string });

// Literal file names, not pathspec expressions. Git performs authoritative ref validation.
export function validateWorkspaceOperation(command: WorkspaceOperation): void {
  if (!command.project || command.project.split('/').length !== 2) throw new InputError('Explicit project identity required');
  for (const path of [command.baseRoot, command.worktreeRoot]) {
    if (path !== undefined && (!path || /[\0\r\n]/.test(path))) throw new InputError('Invalid workspace root');
  }
  if (command.name === 'workspace_inspect') return;
  if (!command.worktreeRoot) throw new InputError('Explicit worktree required');
  if (!command.branch || command.branch.startsWith('-') || command.branch.startsWith('refs/')
    || ['HEAD', '@'].includes(command.branch) || /[\0\r\n]/.test(command.branch)) throw new InputError('Short local branch required');
  if (command.name === 'workspace_prepare' && !/^(?:[a-f0-9]{40}|[a-f0-9]{64}|refs\/(?:heads|tags)\/[^\s\0]+)$/.test(command.startPoint)) {
    throw new InputError('Start point must be a full heads/tags ref or commit ID');
  }
  if ((command.name === 'workspace_publish' || command.name === 'workspace_cleanup_preview' && command.remote !== undefined)
    && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(command.remote!)) throw new InputError('Configured remote name required');
  if (command.name === 'workspace_commit') {
    if (!command.message.trim() || command.message.includes('\0')) throw new InputError('Commit message required');
    if (!command.paths.length || new Set(command.paths).size !== command.paths.length) throw new InputError('Distinct explicit file paths required');
    for (const path of command.paths) {
      if (!path || /[\0\r\n]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git')) {
        throw new InputError('Normalized relative literal file paths required');
      }
    }
  }
}
