import { z } from 'zod';

const text = z.string().min(1), selection = { project: text, baseRoot: text.optional() };
const worktree = { ...selection, worktreeRoot: text, branch: text };
export const workspace = {
  workspace_prepare: { schema: z.strictObject({ ...worktree, startPoint: text }),
    description: 'Explicitly create a new branch/worktree from a full local ref or commit in an independent registered project repository. No setup, fetch, switch or request creation.' },
  workspace_inspect: { schema: z.strictObject({ ...selection, worktreeRoot: text.optional() }),
    description: 'Inspect actual project worktree status, branch and known Git conflicts/locks. Not an ownership registry or lock.' },
  workspace_commit: { schema: z.strictObject({ ...worktree, paths: z.array(text).min(1), message: text }),
    description: 'Commit only declared literal regular files in a linked task worktree, preserving unrelated staged entries and files. Refuses declared staged/working ambiguity. Inspect partial results before further action.' },
  workspace_publish: { schema: z.strictObject({ ...worktree, remote: text }),
    description: 'Explicit non-force publication of the current selected branch to one configured remote; confirms its exact ref afterward. No automatic retries, merge, rebase or upstream changes.' },
};
