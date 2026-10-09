import { fileURLToPath } from 'node:url';
import { createApp } from './create-app.js';
import { createRepositoryBindings } from './repository-bindings.js';
import { validateWorkspaceOperation } from './workspace-commands.js';
import type { WorkspaceOperation } from './workspace-commands.js';
import { repositoryIdentityReader } from '../infrastructure/git/repository-identity.js';
import { workspaceGit } from '../infrastructure/git/workspace-git.js';
import { workspaceCheck } from '../infrastructure/git/workspace-check.js';
import { createSessionCards } from './session-cards.js';
import type { SessionList } from './session-cards.js';
import { cleanupCardHints } from './workspace-cleanup-preview.js';
import type { CleanupPublication } from './workspace-cleanup-preview.js';
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
      let verification: ReturnType<ReturnType<typeof workspaceCheck>['inspect']> = { state: 'unavailable', cache: null };
      try {
        const binding = bindings.verify({ project: command.project, baseRoot: base.baseRoot, worktreeRoot: root });
        if (!mutationUnavailable) verification = workspaceCheck(candidate.root, binding.id).inspect();
      } catch { mutationUnavailable = 'Selected worktree binding is unusable (for example locked, detached or prunable)'; }
      const git = workspaceGit(candidate.root);
      let status: ReturnType<typeof git.status> | null = null, statusUnavailable: string | null = null;
      try { status = git.status(); } catch { statusUnavailable = 'Status unavailable (including unsupported configured filters)'; }
      return { project: command.project, baseRoot: base.baseRoot, worktreeRoot: candidate.root,
        branch: candidate.branch, head: candidate.head, worktrees, status, statusUnavailable,
        operationState: git.operationState(), mutationUnavailable, verification };
    }
    const binding = bindings.verify({ project: command.project, baseRoot: base.baseRoot,
      worktreeRoot: root, expectedBranch: command.branch });
    if (binding.worktreeRoot === binding.baseRoot) throw new InputError('Select a linked task worktree, not the base checkout');
    const git = workspaceGit(binding.worktreeRoot);
    if (command.name === 'workspace_cleanup_preview') {
      const head = git.head(), inventory = git.cleanupInventory();
      let operationState: string[] | null = null;
      try { operationState = git.operationState(); }
      catch { inventory.state = 'incomplete'; inventory.issues.push('Git operation state unavailable'); }
      const publication: CleanupPublication = { state: 'not-observed', ref: 'refs/heads/' + command.branch,
        ...(command.remote === undefined ? {} : { remote: command.remote }) };
      if (command.remote !== undefined) {
        try {
          publication.remoteHead = git.observePublication(command.branch, command.remote);
          publication.state = publication.remoteHead === null ? 'missing-ref' : publication.remoteHead === head ? 'matches-head' : 'different-head';
        } catch { publication.state = 'unavailable'; }
      }
      let observations: SessionList;
      try { observations = createSessionCards().list({ all: true, includeArchived: true }); }
      catch { observations = { sessions: [], issues: [{ issue: 'unavailable' as const }], truncated: false }; }
      const cards = cleanupCardHints(binding.worktreeRoot, observations);
      try {
        if (git.head() !== head) { inventory.state = 'incomplete'; inventory.issues.push('HEAD changed during preview'); }
      } catch { inventory.state = 'incomplete'; inventory.issues.push('Final HEAD observation unavailable'); }
      const diagnostics = ['Unsafe cleanup requires a separate manual decision; this preview never authorizes deletion.',
        'Inventory is a bounded observation, not a backup or proof of content preservation.',
        'Card hints match stored cwd text only, not symlink aliases. Absent, stale, closed or archived cards never prove writer absence.'];
      if (inventory.state === 'incomplete') diagnostics.push('Incomplete inventory: stop and inspect unavailable material.');
      if (inventory.changes.length || inventory.untracked.length) diagnostics.push('Local changed/new material may be unique: preserve it before any cleanup decision.');
      if (inventory.ignored.length) diagnostics.push('Ignored material has unknown value; do not assume it is disposable.');
      if (publication.state !== 'matches-head') diagnostics.push('Publication is missing, different or unknown: stop and establish preservation independently.');
      else diagnostics.push('Selected remote ref matched observed HEAD only; working files and other refs are not certified published.');
      if (operationState === null || operationState.length) diagnostics.push('Git operation state needs manual inspection.');
      if (cards.hints.length) diagnostics.push('Known session observations match this worktree path; inspect activity before deciding.');
      if (cards.issues.length || cards.truncated) diagnostics.push('Session observations are incomplete; no conclusion about other writers is possible.');
      return { project: command.project, baseRoot: binding.baseRoot, worktreeRoot: binding.worktreeRoot,
        branch: command.branch, head, inventory, operationState, publication, cards, diagnostics,
        decision: 'manual-review' as const, deletionAuthorized: false as const };
    }
    const check = workspaceCheck(binding.worktreeRoot, binding.id);
    if (command.name === 'workspace_verify') return check.verify();
    if (command.name === 'workspace_commit') return git.commit(command.paths, command.message, () => check.requireCurrent());
    check.requireCurrent(true);
    return git.publish(command.branch, command.remote);
  } finally { app.close(); }
}
