import type { NativeHistoryFacts } from './native-chat-facts.js';
import type { ChatInspection, ChatLaunchResult } from './work-chats.js';
import type { ModelPair, ModelSelection, WorkChat } from '../modules/work-chats/public.js';

/** Only explicit shell configuration roots cross into a new tab; never copy caller credentials. */
export function nativeShellEnvironment(env: Readonly<Record<string, string | undefined>>): string[] {
  return ['HOME', 'ZDOTDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']
    .flatMap(key => env[key] === undefined ? [] : ['--env', key + '=' + env[key]]);
}

/** A saved model describes native history; only invocation overrides a resume. */
export function launchPreference(model: ModelSelection, resume: boolean): ModelPair | undefined {
  return model.source !== 'unselected' && (!resume || model.source === 'invocation')
    ? { provider: model.provider, model: model.model } : undefined;
}
export function nativeArguments(input: { chat: WorkChat; model: ModelSelection; resume: boolean; extension: string; scope: string; instructions?: string }): string[] {
  const { chat } = input, preference = launchPreference(input.model, input.resume);
  return ['--offline', '-e', input.extension, '--session-dir', chat.statePath + '/sessions',
    ...(input.resume ? ['--session', chat.historyPath!] : ['--session-id', chat.sessionId!]),
    ...(preference ? ['--provider', preference.provider, '--model', preference.model] : []),
    '--mypi-scope', input.scope, ...(input.instructions ? ['--append-system-prompt', input.instructions] : [])];
}
export function freshNativeModel(before: ReadonlySet<string>, after: NativeHistoryFacts): boolean {
  return after.modelEntryId !== undefined && !before.has(after.modelEntryId);
}
/** Native selection is not inferred from launch argv, a model catalog, or auth. */
export function openingResult(observation: ChatInspection, preference?: ModelPair, modelConfirmed = true): ChatLaunchResult {
  const details = { ...(observation.process ?? {}), ...(observation.native ? { native: observation.native } : {}) };
  if (observation.status !== 'live' || !observation.process || !observation.native) {
    return { status: 'partial', ...details, reason: observation.reason ?? 'Native process/session identity unconfirmed' };
  }
  if (preference && (!modelConfirmed || observation.model?.provider !== preference.provider || observation.model.model !== preference.model)) {
    return { status: 'partial', ...details,
      reason: `Requested ${preference.provider}/${preference.model}; native model selection is ${modelConfirmed && observation.model ? observation.model.provider + '/' + observation.model.model : 'unconfirmed'}. Use /model or /login in this same Pi; no new chat was started.` };
  }
  return { status: 'opened', process: observation.process, native: observation.native,
    ...(observation.model ? { model: observation.model } : {}) };
}
