import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { createApp } from './create-app.js';
import { createWorkspace } from './create-workspace.js';
import { InputError } from '../shared/errors.js';
import type { WorkerGrant } from './worker-command.js';

export function taskBinding(filename: string, key: string, root?: string) {
  const app = createWorkspace(filename, true, root);
  try {
    const card = app.requests.get(key);
    if (card.isTerminal) throw new InputError('Terminal requests cannot launch or own active grants');
    const project = app.projects.list().find(p => p.id === card.projectId);
    if (!project?.checkoutPath) throw new InputError('A registered project checkout is required for this flow');
    const grant: WorkerGrant = { requestKey: key, contextDir: card.contextDir, contextReads: [
      'MEMORY.md', 'projects/' + project.org + '/MEMORY.md',
      'projects/' + project.org + '/' + project.slug + '/MEMORY.md',
      'projects/' + project.org + '/' + project.slug + '/context.md',
    ] };
    return { card, project, grant, contextRoot: app.root };
  } finally { app.close(); }
}
export function newRunId(): string { return randomUUID().replaceAll('-', ''); }
export function runDirectory(filename: string, id: string): string { return join(dirname(filename), 'runs', id); }
export function withRuns<T>(filename: string, readonly: boolean, operation: (runs: ReturnType<typeof createApp>['runs']) => T): T {
  const app = createApp(filename, readonly);
  try { return operation(app.runs); } finally { app.close(); }
}
