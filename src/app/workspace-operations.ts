import { fileURLToPath } from 'node:url';
import { createApp } from './create-app.js';
import { createRepositoryBindings } from './repository-bindings.js';
import { validateWorkspaceOperation } from './workspace-commands.js';
import type { WorkspaceOperation } from './workspace-commands.js';
import { repositoryIdentityReader } from '../infrastructure/git/repository-identity.js';
import { workspaceGit } from '../infrastructure/git/workspace-git.js';
import { InputError } from '../shared/errors.js';
import { PartialError } from '../shared/context.js';

/** Effectful composition, deliberately separate from command parsing and registry creation. */
export function executeWorkspaceOperation(command: WorkspaceOperation, filename: string,
  installedEngineRoot = fileURLToPath(new URL('../../../', import.meta.url))) {
  validateWorkspaceOperation(command);
  const app = createApp(filename, true);
  try {
    const selected = app.projects.resolveScope(command.project);
    if (selected.type !== 'project') throw new InputError('Explicit registered project required');
    const baseRoot = command.baseRoot ?? selected.project.checkoutPath;
    if (!baseRoot) throw new InputError('Supply an explicit base or registered checkout');
    const bindings = createRepositoryBindings(app.projects, installedEngineRoot);
    const base = bindings.verify({ project: command.project, baseRoot, worktreeRoot: baseRoot });
    const reader = repositoryIdentityReader(), worktrees = reader.worktrees(base.baseRoot);
    if (command.name === 'workspace_prepare') {
      const result = workspaceGit(base.baseRoot).prepare(command.worktreeRoot, command.branch, command.startPoint,
        [...worktrees.map(tree => tree.root), base.commonDir, reader.inspect(installedEngineRoot).commonDir]);
      try {
        return { ...result, binding: bindings.verify({ project: command.project, baseRoot: base.baseRoot,
          worktreeRoot: result.worktreeRoot, expectedBranch: command.branch }) };
      } catch {
        throw new PartialError('Worktree creation returned success but association could not be confirmed; inspect before continuing',
          ['branch=' + command.branch, 'start=' + result.start], ['confirmed binding'], [result.worktreeRoot]);
      }
    }
    const root = command.worktreeRoot ?? base.baseRoot;
    if (command.name === 'workspace_inspect') {
      const candidate = reader.inspect(root);
      if (candidate.commonDir !== base.commonDir || !worktrees.some(tree => tree.root === candidate.root)) {
        throw new InputError('Selected root is not an associated worktree');
      }
      let mutationUnavailable: string | null = candidate.root === base.baseRoot ? 'Base checkout is read-only for commit/publish' : null;
      try { bindings.verify({ project: command.project, baseRoot: base.baseRoot, worktreeRoot: root }); }
      catch { mutationUnavailable = 'Selected worktree binding is unusable (for example locked, detached or prunable)'; }
      const git = workspaceGit(candidate.root);
      let status: ReturnType<typeof git.status> | null = null, statusUnavailable: string | null = null;
      try { status = git.status(); } catch { statusUnavailable = 'Status unavailable (including unsupported configured filters)'; }
      return { project: command.project, baseRoot: base.baseRoot, worktreeRoot: candidate.root,
        branch: candidate.branch, head: candidate.head, worktrees, status, statusUnavailable,
        operationState: git.operationState(), mutationUnavailable };
    }
    const binding = bindings.verify({ project: command.project, baseRoot: base.baseRoot,
      worktreeRoot: root, expectedBranch: command.branch });
    if (binding.worktreeRoot === binding.baseRoot) throw new InputError('Select a linked task worktree, not the base checkout');
    const git = workspaceGit(binding.worktreeRoot);
    return command.name === 'workspace_commit' ? git.commit(command.paths, command.message) : git.publish(command.branch, command.remote);
  } finally { app.close(); }
}
