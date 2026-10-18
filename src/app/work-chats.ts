import { randomUUID } from 'node:crypto';
import { InputError } from '../shared/errors.js';
import type { ChatBinding, ChatStore, NativeIdentity, ProcessIdentity, WorkChat, ModelPair, ModelSelection, SavedModel } from '../modules/work-chats/public.js';
import { assertBinding, assertNative, sameModelSelection } from '../modules/work-chats/public.js';
import { selectWorkChatModel } from './work-chat-model.js';
import type { ProjectScope } from '../modules/projects/public.js';

export interface ChatInspection {
  status: 'live' | 'dead' | 'unknown';
  process?: ProcessIdentity;
  binding?: ChatBinding;
  native?: NativeIdentity;
  model?: ModelPair;
  reason?: string;
}
export interface ChatRuntime {
  /** Return canonical Git identity and binding; reject foreign clone/worktree, branch and invalid installation/state. */
  validate(input: { sourceClone: string; worktree: string; installation: string; statePath: string }): Promise<Omit<ChatBinding, 'requestId' | 'projectId'>>;
  /** Exact existing history/header and active branch; missing/corrupt is unavailable, never "none". */
  history(chat: WorkChat): Promise<{ native: NativeIdentity; saved: SavedModel }>;
  /** Observe Herdr pane AND process PID/start plus native session; unknown never grants another writer. */
  inspect(chat: WorkChat): Promise<ChatInspection>;
  /** Checks actual target Pi registry and usable auth without a model request. */
  validateModel(pair: ModelPair, binding: ChatBinding): Promise<void>;
  /** One background Herdr tab. Never automatically retry an uncertain result. */
  launch(input: { chat: WorkChat; model: ModelSelection; resume: boolean; focus: boolean }): Promise<{ process: ProcessIdentity; native: NativeIdentity; model: ModelPair }>;
}
export interface ChatPreview {
  action: 'open' | 'resume';
  binding: ChatBinding;
  chatId?: string;
  name?: string;
  model: ModelSelection;
  /** For resume, exact saved session and the observed pane at preview time. */
  native?: NativeIdentity;
  live?: ProcessIdentity;
}
export interface ChatResult { chat: WorkChat; observation: ChatInspection; outcome: 'ready' | 'existing' | 'partial' | 'blocked' }

/** External observations happen outside SQL transactions. Only short reservation/transition writes are atomic. */
export function createWorkChats(input: {
  store: ChatStore;
  projects: { resolveScope(identity: string): ProjectScope; list(): { id: number; org: string; slug: string }[] };
  requests: { get(id: number): { projectId: number | null } };
  userHome: string;
  runtime: ChatRuntime;
}) {
  const { store, projects, requests, runtime } = input;
  async function binding(args: { identity: string; requestId: number; sourceClone: string; worktree: string; installation: string; statePath: string }): Promise<ChatBinding> {
    const scope = projects.resolveScope(args.identity);
    if (scope.type !== 'project' || !scope.project.checkoutPath) throw new InputError('Registered project and source clone required');
    if (scope.project.checkoutPath !== args.sourceClone) throw new InputError('Source clone must equal registered project checkout');
    if (requests.get(args.requestId).projectId !== scope.project.id) throw new InputError('Request belongs to a different project');
    const checked = await runtime.validate(args);
    if (!checked.gitCommonDir || !checked.branch || !checked.sourceClone || !checked.worktree || !checked.installation || !checked.statePath
      || checked.sourceClone !== scope.project.checkoutPath || checked.worktree !== args.worktree
      || checked.installation !== args.installation || checked.statePath !== args.statePath) {
      throw new InputError('Runtime binding differs from explicit project/worktree/installation/state');
    }
    return { ...checked, projectId: scope.project.id, requestId: args.requestId };
  }
  function select(identity: string, invocation?: ModelPair, saved?: SavedModel) {
    return selectWorkChatModel({ identity, ...(invocation ? { invocation } : {}), ...(saved ? { saved } : {}), userHome: input.userHome, projects });
  }
  async function previewOpen(args: Parameters<typeof binding>[0] & { name?: string; model?: ModelPair }): Promise<ChatPreview> {
    const checked = await binding(args);
    if (store.byWorktree(checked.worktree)) throw new InputError('Worktree already has a managed chat; inspect/resume it');
    const model = select(args.identity, args.model);
    await runtime.validateModel(model, checked);
    return { action: 'open', binding: checked, model, ...(args.name === undefined ? {} : { name: args.name }) };
  }
  async function previewResume(id: string, invocation?: ModelPair): Promise<ChatPreview> {
    const chat = store.get(id);
    if (!chat) throw new InputError('Unknown work chat');
    const checked = await binding({ identity: projectIdentity(chat.projectId), requestId: chat.requestId,
      sourceClone: chat.sourceClone, worktree: chat.worktree, installation: chat.installation, statePath: chat.statePath });
    assertBinding(chat, checked);
    const observation = await runtime.inspect(chat);
    if (observation.status === 'unknown') throw new InputError('Chat ownership unknown; inspect existing pane before retry: ' + (observation.reason ?? 'unknown'));
    if (observation.status === 'live') {
      if (!observation.process || !observation.binding || !observation.native || !observation.model || !chat.sessionId || !chat.historyPath) {
        throw new InputError('Live pane identity/model unconfirmed; do not launch another writer');
      }
      assertBinding(chat, observation.binding);
      assertNative({ sessionId: chat.sessionId, historyPath: chat.historyPath }, observation.native);
      if (chat.pane !== observation.process.pane || chat.processId !== observation.process.processId || chat.processStart !== observation.process.processStart) {
        throw new InputError('Pane occupant changed; inspect before resuming');
      }
      if (invocation && (invocation.provider !== observation.model.provider || invocation.model !== observation.model.model)) {
        throw new InputError('Live chat has another model; change it there or close it before resuming with override');
      }
      const model = select(projectIdentity(chat.projectId), invocation, { status: 'selected', selection: observation.model });
      return { action: 'resume', binding: checked, chatId: id, model, native: observation.native, live: observation.process };
    }
    if (!chat.sessionId || !chat.historyPath) throw new InputError('Empty chat has no persisted history; explicitly open a new empty chat in another worktree');
    const saved = await runtime.history(chat);
    assertNative({ sessionId: chat.sessionId, historyPath: chat.historyPath }, saved.native);
    const model = select(projectIdentity(chat.projectId), invocation, saved.saved);
    await runtime.validateModel(model, checked);
    return { action: 'resume', binding: checked, chatId: id, native: saved.native, model };
  }
  function projectIdentity(projectId: number): string {
    // resolveScope has no ID lookup; supplied registry is the only identity authority.
    const project = projects.list().find(p => p.id === projectId);
    if (!project) throw new InputError('Registered project unavailable');
    return project.org + '/' + project.slug;
  }
  async function execute(preview: ChatPreview, focus = false): Promise<ChatResult> {
    const identity = projectIdentity(preview.binding.projectId);
    const fresh = preview.action === 'open'
      ? await previewOpen({ identity, requestId: preview.binding.requestId, sourceClone: preview.binding.sourceClone,
        worktree: preview.binding.worktree, installation: preview.binding.installation, statePath: preview.binding.statePath,
        ...(preview.name === undefined ? {} : { name: preview.name }),
        ...(preview.model.source === 'invocation' ? { model: { provider: preview.model.provider, model: preview.model.model } } : {}) })
      : await previewResume(preview.chatId!, preview.model.source === 'invocation' ? { provider: preview.model.provider, model: preview.model.model } : undefined);
    assertBinding(preview.binding, fresh.binding);
    if (!sameModelSelection(preview.model, fresh.model) || preview.action !== fresh.action) throw new InputError('Model changed since preview; request a fresh preview');
    if (Boolean(preview.live) !== Boolean(fresh.live)) throw new InputError('Live state changed since preview; request a fresh preview');
    if (preview.action === 'resume' && (preview.native?.sessionId !== fresh.native?.sessionId || preview.native?.historyPath !== fresh.native?.historyPath)) {
      throw new InputError('Native history changed since preview');
    }
    if (fresh.live) {
      if (!preview.live || preview.live.pane !== fresh.live.pane || preview.live.processId !== fresh.live.processId || preview.live.processStart !== fresh.live.processStart) {
        throw new InputError('Live process changed since preview');
      }
      return { chat: store.get(preview.chatId!)!, observation: { status: 'live', binding: fresh.binding, process: fresh.live, native: fresh.native!, model: fresh.model }, outcome: 'existing' };
    }
    const chat = store.transaction(() => {
      if (preview.action === 'open') {
        if (store.byWorktree(preview.binding.worktree)) throw new InputError('Worktree reservation already exists');
        const created: WorkChat = { ...preview.binding, id: randomUUID(), name: preview.name ?? null, attemptId: randomUUID(),
          phase: 'reserved', sessionId: null, historyPath: null, pane: null, processId: null, processStart: null };
        store.reserve(created);
        return created;
      }
      const existing = store.get(preview.chatId!);
      if (!existing) throw new InputError('Work chat changed');
      if (existing.phase === 'reserved') throw new InputError('Prior launch uncertain; inspect it first');
      if (existing.phase === 'partial' && (!existing.sessionId || !existing.historyPath)) throw new InputError('Partial launch without confirmed history requires inspection');
      const next = { ...existing, phase: 'reserved' as const, attemptId: randomUUID() };
      store.update(next, existing.attemptId);
      return next;
    });
    let partial = chat;
    try {
      const launched = await runtime.launch({ chat, model: fresh.model, resume: preview.action === 'resume', focus });
      partial = { ...chat,
        ...(launched.native.sessionId && launched.native.historyPath ? launched.native : {}),
        pane: launched.process.pane || null,
        processId: Number.isSafeInteger(launched.process.processId) && launched.process.processId > 0 ? launched.process.processId : null,
        processStart: launched.process.processStart || null, phase: 'partial' };
      store.transaction(() => {
        if (store.get(chat.id)?.attemptId !== chat.attemptId) throw new InputError('Stale launch attempt');
        store.update(partial);
      });
      if (!partial.sessionId || !partial.historyPath || !partial.pane || !partial.processId || !partial.processStart) {
        throw new InputError('Native session/history or process identity not persisted; cannot mark ready');
      }
      const observed = await runtime.inspect(partial);
      if (observed.status !== 'live' || !observed.process || !observed.binding || !observed.native || !observed.model
        || observed.process.pane !== launched.process.pane || observed.process.processId !== launched.process.processId
        || observed.process.processStart !== launched.process.processStart || observed.native.sessionId !== launched.native.sessionId
        || observed.native.historyPath !== launched.native.historyPath || observed.model.provider !== fresh.model.provider
        || observed.model.model !== fresh.model.model || launched.model.provider !== fresh.model.provider || launched.model.model !== fresh.model.model) {
        throw new InputError('Launch acknowledgement and independent process/native/model observation disagree');
      }
      assertBinding(chat, observed.binding);
      if (preview.action === 'resume') assertNative(preview.native!, launched.native);
      const ready: WorkChat = { ...chat, ...launched.native, pane: launched.process.pane,
        processId: launched.process.processId, processStart: launched.process.processStart, phase: 'ready' };
      store.transaction(() => {
        if (store.get(chat.id)?.attemptId !== chat.attemptId) throw new InputError('Stale launch acknowledgement');
        store.update(ready);
      });
      return { chat: ready, observation: observed, outcome: 'ready' };
    } catch (error) {
      // A launcher can have created a tab before throwing; no automatic release/retry.
      store.transaction(() => {
        if (store.get(chat.id)?.attemptId === chat.attemptId) store.update({ ...partial, phase: 'partial' });
      });
      return { chat: store.get(chat.id)!, observation: { status: 'unknown', reason: String(error) }, outcome: 'partial' };
    }
  }
  async function releaseUnused(id: string): Promise<void> {
    const chat = store.get(id);
    if (!chat || chat.phase !== 'partial' || chat.sessionId || chat.historyPath) {
      throw new InputError('Only a partial attempt without persisted history may be released');
    }
    const observation = await runtime.inspect(chat);
    if (observation.status !== 'dead') throw new InputError('Ownership not proven dead; preserve reservation');
    store.transaction(() => store.releaseUnused(id, chat.attemptId));
  }
  return { previewOpen, previewResume, execute, releaseUnused,
    async list() { return Promise.all(store.list().map(async chat => ({ chat, observation: await runtime.inspect(chat) }))); },
    get: (id: string) => store.get(id),
    async show(id: string) { const chat = store.get(id); if (!chat) throw new InputError('Unknown work chat'); return { chat, observation: await runtime.inspect(chat) }; } };
}
