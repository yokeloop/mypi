import { z } from 'zod';

const text = z.string().min(1), selection = { project: text, baseRoot: text.optional() };
const worktree = { ...selection, worktreeRoot: text, branch: text };
export const workspace = {
  workspace_prepare: { schema: z.strictObject({ ...worktree, startPoint: text }),
    description: 'Explicitly create a new branch/worktree from a full local ref or commit in an independent registered project repository. No setup, fetch, switch or request creation.' },
  workspace_inspect: { schema: z.strictObject({ ...selection, worktreeRoot: text.optional() }),
    description: 'Inspect actual project worktree status, branch and known Git conflicts/locks. Not an ownership registry or lock.' },
  workspace_cleanup_preview: { schema: z.strictObject({ ...worktree, remote: text.optional() }),
    description: 'Read-only bounded inventory, optional explicit remote ref observation and advisory session path hints for one task worktree. Always requires manual review; never authorizes or performs deletion.' },
  workspace_verify: { schema: z.strictObject({ ...worktree }),
    description: 'Run required commands from the project-owned .mypi-checks.json in the selected task worktree. Records a local convenience cache, not publication permission or toolchain attestation.' },
  workspace_commit: { schema: z.strictObject({ ...worktree, paths: z.array(text).min(1), message: text }),
    description: 'Require current project checks, then commit only declared literal regular files in a linked task worktree, preserving unrelated staged entries and files. Refuses declared staged/working ambiguity. Inspect partial results before further action.' },
  workspace_publish: { schema: z.strictObject({ ...worktree, remote: text }),
    description: 'Require current checks covering HEAD, then explicitly publish the current selected branch non-force to one configured remote; confirms its exact ref afterward. No automatic retries, merge, rebase or upstream changes.' },
};
