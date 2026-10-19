import { isAbsolute } from 'node:path';
import { InputError } from '../shared/errors.js';
import { validateModelPair } from '../modules/work-chats/public.js';
import type { ChatPreview } from './work-chats.js';

export function parseCliModel(provider?: string, model?: string) {
  if (provider !== undefined && model === undefined) throw new InputError('--provider requires --model');
  if (model === undefined) return undefined;
  if (provider !== undefined) return validateModelPair({ provider, model }, '--provider/--model');
  const slash = model.indexOf('/');
  if (slash < 1) throw new InputError('Use --model provider/model-id or --provider provider-id --model model-id');
  return validateModelPair({ provider: model.slice(0, slash), model: model.slice(slash + 1) }, '--model');
}

/** CLI JSON is untrusted; execution additionally re-previews every binding and model. */
export function parseChatPreview(value: unknown): ChatPreview {
  const object = (candidate: unknown): Record<string, unknown> => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new InputError('Expected work-chat preview object');
    return candidate as Record<string, unknown>;
  };
  const fields = (candidate: Record<string, unknown>, allowed: string[]) => {
    if (Object.keys(candidate).some(key => !allowed.includes(key))) throw new InputError('Unexpected work-chat preview field');
  };
  const string = (candidate: unknown) => typeof candidate === 'string' && candidate.length > 0;
  const preview = object(value), binding = object(preview.binding), model = object(preview.model);
  fields(preview, ['action', 'binding', 'chatId', 'priorAttempt', 'name', 'model', 'native', 'live', 'readiness', 'persisted']);
  fields(binding, ['projectId', 'requestId', 'sourceClone', 'worktree', 'gitCommonDir', 'branch', 'installation', 'statePath']);
  fields(model, ['provider', 'model', 'source']);
  if (!['open', 'resume', 'new-empty'].includes(String(preview.action))
    || !Number.isSafeInteger(binding.projectId) || !Number.isSafeInteger(binding.requestId)
    || Number(binding.projectId) <= 0 || Number(binding.requestId) <= 0
    || !['sourceClone', 'worktree', 'gitCommonDir', 'installation', 'statePath'].every(key => string(binding[key]) && isAbsolute(binding[key] as string))
    || !string(binding.branch) || !string(model.source)
    || !['invocation', 'saved session', 'project', 'organization', 'default', 'unselected'].includes(String(model.source))) {
    throw new InputError('Invalid work-chat preview binding or source');
  }
  if (model.source === 'unselected') {
    if (Object.keys(model).length !== 1 || !['open', 'new-empty', 'resume'].includes(String(preview.action))) throw new InputError('Invalid unselected preview');
  } else validateModelPair({ provider: model.provider, model: model.model }, 'preview.model');
  for (const key of ['chatId', 'priorAttempt', 'name']) if (preview[key] !== undefined && !string(preview[key])) throw new InputError('Invalid preview ' + key);
  if (preview.readiness !== undefined && !['ready', 'auth-pending'].includes(String(preview.readiness))) throw new InputError('Invalid preview readiness');
  if (preview.persisted !== undefined && typeof preview.persisted !== 'boolean') throw new InputError('Invalid preview persistence');
  if (preview.native !== undefined) {
    const native = object(preview.native); fields(native, ['sessionId', 'historyPath']);
    if (!string(native.sessionId) || !string(native.historyPath) || !isAbsolute(native.historyPath as string)) throw new InputError('Invalid native preview');
  }
  if (preview.live !== undefined) {
    const live = object(preview.live); fields(live, ['pane', 'processId', 'processStart']);
    if (!string(live.pane) || !string(live.processStart) || !Number.isSafeInteger(live.processId) || Number(live.processId) <= 0) throw new InputError('Invalid live preview');
  }
  if (preview.action === 'resume' && !string(preview.chatId) || preview.action === 'new-empty' && (!string(preview.chatId) || !string(preview.priorAttempt))) throw new InputError('Incomplete preview');
  return value as ChatPreview;
}

/** A caller-supplied observation never grants authority: the runtime independently checks Pi/Herdr/auth. */
export function parseSyncReceipt(value: unknown): { attempt: string; sessionId: string; processId: number; generation: number;
  model: { provider: string; model: string }; expectedTarget?: { provider: string; model: string } } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Invalid native sync receipt');
  const entry = value as Record<string, unknown>;
  if (!['attempt,generation,model,processId,sessionId', 'attempt,expectedTarget,generation,model,processId,sessionId'].includes(Object.keys(entry).sort().join(','))
    || typeof entry.attempt !== 'string' || !/^[0-9a-f-]{36}$/.test(entry.attempt)
    || typeof entry.sessionId !== 'string' || !entry.sessionId
    || !Number.isSafeInteger(entry.processId) || Number(entry.processId) <= 0
    || !Number.isSafeInteger(entry.generation) || Number(entry.generation) <= 0) throw new InputError('Invalid native sync receipt');
  return { attempt: entry.attempt, sessionId: entry.sessionId, processId: entry.processId as number,
    generation: entry.generation as number, model: validateModelPair(entry.model, 'native receipt model'),
    ...(entry.expectedTarget === undefined ? {} : { expectedTarget: validateModelPair(entry.expectedTarget, 'expected target') }) };
}
