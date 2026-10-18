import { createWorkChats } from './work-chats.js';
import { nativeChatRuntime } from './native-chat-runtime.js';
import type { createWorkspace } from './create-workspace.js';

/** Concrete Node24 composition, separate from the fast app's pure/SQLite composition. */
export function createNativeWorkChats(workspace: ReturnType<typeof createWorkspace>, options: {
  pi: string; nodePath: string; statePath: string; installation: string; agentDir: string;
}) {
  const runtime = nativeChatRuntime({ ...options, userHome: workspace.root,
    identity: projectId => {
      const selected = workspace.projects.list().find(project => project.id === projectId);
      if (!selected) throw new Error('Registered project unavailable');
      return selected.org + '/' + selected.slug;
    } });
  return createWorkChats({ store: workspace.chatStore, projects: workspace.projects,
    requests: workspace.chatRequests, userHome: workspace.root, runtime });
}
