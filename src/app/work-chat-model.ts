import { readWorkChatDefaultsJson } from '../infrastructure/filesystem/work-chat-defaults.js';
import { parseModelDefaults, resolveModelSelection } from '../modules/work-chats/public.js';
import type { ModelPair, ModelSelection, SavedModel } from '../modules/work-chats/public.js';
import type { ProjectScope } from '../modules/projects/public.js';

/** Registry checks use the existing projects public API; runtime validates target Pi model/auth separately. */
export function selectWorkChatModel(input: {
  identity: string;
  userHome: string;
  invocation?: ModelPair;
  saved?: SavedModel;
  projects: { resolveScope(identity: string): ProjectScope };
}): ModelSelection {
  const registered = {
    organization: (slug: string) => {
      try { return input.projects.resolveScope(slug).type === 'org'; } catch { return false; }
    },
    project: (identity: string) => {
      try { return input.projects.resolveScope(identity).type === 'project'; } catch { return false; }
    },
  };
  return resolveModelSelection({ ...input, readDefaults: () => parseModelDefaults(readWorkChatDefaultsJson(input.userHome), registered) });
}
