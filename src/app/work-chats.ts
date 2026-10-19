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
  readiness?: 'ready' | 'auth-pending';
  authorized?: boolean;
  generation?: number;
  persisted?: boolean;
  reason?: string;
}
export interface ChatRuntime {
  /** Return canonical Git identity and binding; reject foreign clone/worktree, branch and invalid installation/state. */
  validate(input: { sourceClone: string; worktree: string; installation: string; statePath: string }): Promise<Omit<ChatBinding, 'requestId' | 'projectId'>>;
  /** Exact existing history/header and active branch; missing/corrupt is unavailable, never "none". */
  history(chat: WorkChat): Promise<{ native: NativeIdentity; saved: SavedModel }>;
  /** Positive normal-final empty snapshot, exact identity and no history; not mere ENOENT. */
  provenEmpty(chat: WorkChat): Promise<boolean>;
  /** Observe Herdr pane AND process PID/start plus native session; unknown never grants another writer. */
  inspect(chat: WorkChat): Promise<ChatInspection>;
  /** Checks actual target Pi registry and usable auth without a model request. */
  validateModel(pair: ModelPair, binding: ChatBinding): Promise<'ready' | 'auth-pending'>;
  /** Guard the latest native receipt synchronously inside the SQL transition. */
  receiptMatches?(chat: WorkChat, model: ModelPair, generation: number, adopt: boolean): boolean;
  /** One background Herdr tab. Never automatically retry an uncertain result. */
  launch(input: { chat: WorkChat; model: ModelSelection; resume: boolean; focus: boolean }): Promise<
    | { status: 'acknowledged'; process: ProcessIdentity; native: NativeIdentity; model?: ModelPair; readiness: 'ready' | 'auth-pending' }
    | { status: 'partial'; reason: string; pane?: string; processId?: number; processStart?: string; native?: NativeIdentity }
  >;
}
export interface ChatPreview {
  action: 'open' | 'resume' | 'new-empty';
  binding: ChatBinding;
  chatId?: string;
  priorAttempt?: string;
  name?: string;
  model: ModelSelection;
  /** For resume, exact saved session and the observed pane at preview time. */
  native?: NativeIdentity;
  live?: ProcessIdentity;
  readiness?: 'ready' | 'auth-pending';
  persisted?: boolean;
}
export interface ChatResult { chat: WorkChat; observation: ChatInspection; outcome: 'ready' | 'auth-pending' | 'existing' | 'partial' | 'blocked'; nextStep?: string }
const pendingInstruction = 'In this same Pi session, run /login; the exact target becomes ready automatically when selected. For a different selected model use /model for the target or /work-chat adopt-model to confirm it. No work prompt was sent.';

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
    if (model.source !== 'unselected') await runtime.validateModel(model, checked);
    return { action: 'open', binding: checked, model, ...(args.name === undefined ? {} : { name: args.name }) };
  }
  async function previewNewEmpty(id: string, options: { name?: string; model?: ModelPair } = {}): Promise<ChatPreview> {
    const old = store.get(id);
    if (!old || old.phase === 'closed' || !old.sessionId || !old.historyPath || store.byWorktree(old.worktree)?.id !== id) {
      throw new InputError('No occupied managed empty chat to replace');
    }
    const checked = await binding({ identity: projectIdentity(old.projectId), requestId: old.requestId,
      sourceClone: old.sourceClone, worktree: old.worktree, installation: old.installation, statePath: old.statePath });
    assertBinding(old, checked);
    const observed = await runtime.inspect(old);
    if (observed.status !== 'dead' || !await runtime.provenEmpty(old)) throw new InputError('Native empty closure and process death unconfirmed; cannot open a new empty chat');
    const original = old.phase === 'auth-pending' && old.requestedProvider && old.requestedModel
      ? { status: 'selected' as const, selection: { provider: old.requestedProvider, model: old.requestedModel } } : undefined;
    const model = select(projectIdentity(old.projectId), options.model, original);
    if (model.source !== 'unselected') await runtime.validateModel(model, checked);
    return { action: 'new-empty', binding: checked, chatId: id, priorAttempt: old.attemptId, model,
      ...(options.name === undefined ? {} : { name: options.name }) };
  }
  async function previewResume(id: string, invocation?: ModelPair): Promise<ChatPreview> {
    const stored = store.get(id);
    if (!stored) throw new InputError('Unknown work chat');
    const { chat, observation } = await reconcile(stored);
    const checked = await binding({ identity: projectIdentity(chat.projectId), requestId: chat.requestId,
      sourceClone: chat.sourceClone, worktree: chat.worktree, installation: chat.installation, statePath: chat.statePath });
    assertBinding(chat, checked);
    if (observation.status === 'unknown') throw new InputError('Chat ownership unknown; inspect existing pane before retry: ' + (observation.reason ?? 'unknown'));
    if (observation.status === 'live') {
      if (!observation.process || !observation.binding || !observation.native || !chat.sessionId || !chat.historyPath) {
        throw new InputError('Live pane identity/model unconfirmed; do not launch another writer');
      }
      assertBinding(chat, observation.binding);
      assertNative({ sessionId: chat.sessionId, historyPath: chat.historyPath }, observation.native);
      if (chat.pane !== observation.process.pane || chat.processId !== observation.process.processId || chat.processStart !== observation.process.processStart) {
        throw new InputError('Pane occupant changed; inspect before resuming');
      }
      if (invocation && (invocation.provider !== (chat.phase === 'auth-pending' ? chat.requestedProvider : observation.model?.provider)
        || invocation.model !== (chat.phase === 'auth-pending' ? chat.requestedModel : observation.model?.model))) {
        throw new InputError('Live chat has another model; change it there or close it before resuming with override');
      }
      const model = chat.phase === 'auth-pending' && !chat.requestedProvider && !invocation
        ? { source: 'unselected' as const } : select(projectIdentity(chat.projectId), invocation, { status: 'selected', selection:
        chat.phase === 'auth-pending' ? { provider: chat.requestedProvider!, model: chat.requestedModel! } : observation.model! });
      return { action: 'resume', binding: checked, chatId: id, model, native: observation.native,
        live: observation.process, ...(observation.readiness ? { readiness: observation.readiness } : {}), ...(observation.persisted === undefined ? {} : { persisted: observation.persisted }) };
    }
    if (!chat.sessionId || !chat.historyPath || await runtime.provenEmpty(chat)) throw new InputError('Empty chat has no persisted history; explicitly preview a new empty chat for this worktree');
    const saved = await runtime.history(chat);
    assertNative({ sessionId: chat.sessionId, historyPath: chat.historyPath }, saved.native);
    if (saved.saved.status === 'unavailable') throw new InputError(`Native session model unavailable: ${saved.saved.reason}`);
    // A model chosen during a pending session is not implicit consent to change
    // the requested target. Only an explicit resume override can do that.
    const target = chat.phase === 'auth-pending' && chat.requestedProvider && chat.requestedModel
      ? { status: 'selected' as const, selection: { provider: chat.requestedProvider, model: chat.requestedModel } }
      : saved.saved;
    if (chat.phase === 'auth-pending' && chat.requestedProvider !== null && !chat.requestedModel) {
      throw new InputError('Pending chat has no requested model; inspect before resuming');
    }
    const model = select(projectIdentity(chat.projectId), invocation, target);
    if (model.source !== 'unselected') await runtime.validateModel(model, checked);
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
    const override = preview.model.source === 'invocation' ? { provider: preview.model.provider, model: preview.model.model } : undefined;
    const fresh = preview.action === 'open'
      ? await previewOpen({ identity, requestId: preview.binding.requestId, sourceClone: preview.binding.sourceClone,
        worktree: preview.binding.worktree, installation: preview.binding.installation, statePath: preview.binding.statePath,
        ...(preview.name === undefined ? {} : { name: preview.name }), ...(override ? { model: override } : {}) })
      : preview.action === 'new-empty'
        ? await previewNewEmpty(preview.chatId!, { ...(preview.name === undefined ? {} : { name: preview.name }), ...(override ? { model: override } : {}) })
        : await previewResume(preview.chatId!, override);
    assertBinding(preview.binding, fresh.binding);
    if (!sameModelSelection(preview.model, fresh.model) || preview.action !== fresh.action) throw new InputError('Model changed since preview; request a fresh preview');
    if (Boolean(preview.live) !== Boolean(fresh.live)) throw new InputError('Live state changed since preview; request a fresh preview');
    if (preview.action === 'new-empty' && (preview.priorAttempt !== fresh.priorAttempt || preview.chatId !== fresh.chatId)) {
      throw new InputError('Empty chat attempt changed since preview');
    }
    if (preview.action === 'resume' && (preview.native?.sessionId !== fresh.native?.sessionId || preview.native?.historyPath !== fresh.native?.historyPath)) {
      throw new InputError('Native history changed since preview');
    }
    if (fresh.live) {
      if (!preview.live || preview.live.pane !== fresh.live.pane || preview.live.processId !== fresh.live.processId || preview.live.processStart !== fresh.live.processStart) {
        throw new InputError('Live process changed since preview');
      }
      const current = await reconcile(store.get(preview.chatId!)!);
      if (current.observation.status !== 'live' || current.observation.process?.pane !== fresh.live.pane
        || current.observation.process.processId !== fresh.live.processId
        || current.observation.process.processStart !== fresh.live.processStart
        || current.observation.native?.sessionId !== fresh.native?.sessionId
        || current.observation.native?.historyPath !== fresh.native?.historyPath) {
        throw new InputError('Live process/native readiness changed; inspect same pane before retry');
      }
      return { chat: current.chat, observation: current.observation, outcome: 'existing',
        ...(current.chat.phase === 'auth-pending' ? { nextStep: pendingInstruction } : {}) };
    }
    // A launch-only prerequisite must fail before retiring an empty row or reserving a worktree.
    if (process.env.HERDR_ENV !== '1' || !process.env.HERDR_WORKSPACE_ID) {
      throw new InputError('Persistent Herdr environment required');
    }
    const chat = store.transaction(() => {
      if (preview.action !== 'resume') {
        if (preview.action === 'new-empty') {
          const prior = store.get(preview.chatId!);
          if (!prior || prior.attemptId !== preview.priorAttempt || store.byWorktree(prior.worktree)?.id !== prior.id) {
            throw new InputError('Empty chat changed during reservation');
          }
          store.retireEmpty(prior.id, prior.attemptId);
        } else if (store.byWorktree(preview.binding.worktree)) throw new InputError('Worktree reservation already exists');
        const created: WorkChat = { ...preview.binding, id: randomUUID(), name: preview.name ?? null, attemptId: randomUUID(),
          phase: 'reserved', requestedProvider: fresh.model.source === 'unselected' ? null : fresh.model.provider, requestedModel: fresh.model.source === 'unselected' ? null : fresh.model.model, sessionId: null, historyPath: null, pane: null, processId: null, processStart: null };
        store.reserve(created);
        return created;
      }
      const existing = store.get(preview.chatId!);
      if (!existing) throw new InputError('Work chat changed');
      if (existing.phase === 'reserved') throw new InputError('Prior launch uncertain; inspect it first');
      if (existing.phase === 'partial' && (!existing.sessionId || !existing.historyPath)) throw new InputError('Partial launch without confirmed history requires inspection');
      const next = { ...existing, requestedProvider: fresh.model.source === 'unselected' ? null : fresh.model.provider, requestedModel: fresh.model.source === 'unselected' ? null : fresh.model.model, phase: 'reserved' as const, attemptId: randomUUID(), pane: null, processId: null, processStart: null };
      store.update(next, existing.attemptId);
      return next;
    });
    let partial = chat;
    try {
      const launched = await runtime.launch({ chat, model: fresh.model, resume: preview.action === 'resume', focus });
      const actualNative = launched.native;
      const matchingNative = actualNative && (!chat.sessionId || (chat.sessionId === actualNative.sessionId && chat.historyPath === actualNative.historyPath));
      partial = { ...chat,
        ...(matchingNative && actualNative?.sessionId && actualNative.historyPath ? actualNative : {}),
        pane: (launched.status === 'partial' ? launched.pane : launched.process.pane) || null,
        processId: (launched.status === 'partial' ? launched.processId : launched.process.processId) ?? null,
        processStart: (launched.status === 'partial' ? launched.processStart : launched.process.processStart) || null, phase: 'partial' };
      store.transaction(() => {
        if (store.get(chat.id)?.attemptId !== chat.attemptId) throw new InputError('Stale launch attempt');
        store.update(partial);
      });
      if (launched.status === 'partial') throw new InputError(launched.reason);
      if (!matchingNative || !partial.sessionId || !partial.historyPath || !partial.pane || !partial.processId || !partial.processStart) {
        throw new InputError('Native session/history or process identity not persisted; cannot mark ready');
      }
      const observed = await runtime.inspect(partial);
      if (observed.status !== 'live' || !observed.process || !observed.binding || !observed.native
        || observed.process.pane !== launched.process.pane || observed.process.processId !== launched.process.processId
        || observed.process.processStart !== launched.process.processStart || observed.native.sessionId !== launched.native.sessionId
        || observed.native.historyPath !== launched.native.historyPath) {
        throw new InputError('Launch acknowledgement and independent process/native observation disagree');
      }
      if (fresh.model.source !== 'unselected' && launched.readiness === 'ready' && (!observed.model
        || observed.model.provider !== fresh.model.provider || observed.model.model !== fresh.model.model
        || launched.model?.provider !== fresh.model.provider || launched.model.model !== fresh.model.model)) {
        throw new InputError('Launch acknowledgement and independent model/auth observation disagree');
      }
      assertBinding(chat, observed.binding);
      if (preview.action === 'resume') assertNative(preview.native!, launched.native);
      const exact = fresh.model.source !== 'unselected' && observed.model?.provider === fresh.model.provider && observed.model?.model === fresh.model.model;
      const adopted = fresh.model.source === 'unselected' && observed.readiness === 'ready' && observed.model ? observed.model : undefined;
      if (adopted && (!observed.authorized || !observed.generation
        || !runtime.receiptMatches?.(partial, adopted, observed.generation, false))) {
        throw new InputError('Initial native model changed before first-target adoption');
      }
      const ready: WorkChat = { ...chat, ...launched.native,
        ...(adopted ? { requestedProvider: adopted.provider, requestedModel: adopted.model } : {}), pane: launched.process.pane,
        processId: launched.process.processId, processStart: launched.process.processStart,
        phase: !adopted && (observed.readiness === 'auth-pending' || !exact || launched.readiness === 'auth-pending' && observed.readiness !== 'ready')
          ? 'auth-pending' : 'ready' };
      store.transaction(() => {
        if (store.get(chat.id)?.attemptId !== chat.attemptId
          || adopted && (!observed.generation || !runtime.receiptMatches?.(partial, adopted, observed.generation, false))) {
          throw new InputError('Stale launch acknowledgement or first native selection');
        }
        store.update(ready);
      });
      return { chat: ready, observation: observed, outcome: ready.phase === 'auth-pending' ? 'auth-pending' : 'ready',
        ...(ready.phase === 'auth-pending' ? { nextStep: pendingInstruction } : {}) };
    } catch (error) {
      // A launcher can have created a tab before throwing; no automatic release/retry.
      store.transaction(() => {
        if (store.get(chat.id)?.attemptId === chat.attemptId) store.update({ ...partial, phase: 'partial' });
      });
      const current = store.get(chat.id)!;
      const evidence = current.attemptId === chat.attemptId ? ''
        : `; stale attempt ${chat.attemptId} observed pane=${partial.pane ?? 'unknown'} pid=${partial.processId ?? 'unknown'} start=${partial.processStart ?? 'unknown'} (not attached to newer attempt)`;
      return { chat: current, observation: { status: 'unknown', reason: String(error) + evidence }, outcome: 'partial' };
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
  async function reconcile(chat: WorkChat): Promise<{ chat: WorkChat; observation: ChatInspection }> {
    const observation = await runtime.inspect(chat);
    if ((chat.phase === 'auth-pending' || chat.phase === 'ready') && observation.status === 'live') {
      if (!observation.binding || !observation.native || !observation.process
        || observation.process.pane !== chat.pane || observation.process.processId !== chat.processId
        || observation.process.processStart !== chat.processStart || observation.native.sessionId !== chat.sessionId
        || observation.native.historyPath !== chat.historyPath) {
        return { chat, observation: { status: 'unknown', reason: 'Native process/session differs from reserved attempt' } };
      }
      try {
        assertBinding(chat, observation.binding);
        // v3 ready rows had no stored target; their verified live native selection is the only safe target to adopt.
        const requestedProvider = chat.requestedProvider ?? (chat.phase === 'ready' ? observation.model?.provider : undefined);
        const requestedModel = chat.requestedModel ?? (chat.phase === 'ready' ? observation.model?.model : undefined);
        if ((!requestedProvider || !requestedModel) && !(chat.phase === 'auth-pending' && !chat.requestedProvider && !chat.requestedModel)) throw new InputError('Requested native model unconfirmed');
        const adopted = !requestedProvider && observation.readiness === 'ready' && observation.model;
        const targetProvider = adopted ? adopted.provider : requestedProvider ?? null;
        const targetModel = adopted ? adopted.model : requestedModel ?? null;
        const matches = observation.model?.provider === requestedProvider && observation.model?.model === requestedModel;
        const nextPhase = observation.readiness === 'ready' && (adopted || matches)
          ? 'ready' : 'auth-pending';
        if (chat.phase !== nextPhase || chat.requestedProvider !== targetProvider || chat.requestedModel !== targetModel) {
          const updated: WorkChat = { ...chat, requestedProvider: targetProvider, requestedModel: targetModel, phase: nextPhase };
          // The native selection can change between observation and SQL. Only
          // a still-current receipt may choose the first target for this chat.
          const firstTarget = chat.phase === 'auth-pending' && chat.requestedProvider === null && adopted;
          store.transaction(() => {
            const current = store.get(chat.id);
            if (!current || current.attemptId !== chat.attemptId || current.phase !== chat.phase
              || current.requestedProvider !== chat.requestedProvider || current.requestedModel !== chat.requestedModel
              || current.sessionId !== chat.sessionId || current.processId !== chat.processId
              || firstTarget && (!observation.authorized || !observation.model || !observation.generation
                || !runtime.receiptMatches?.(chat, observation.model, observation.generation, false))) {
              throw new InputError('Stale work chat observation');
            }
            store.update(updated);
          });
          return { chat: updated, observation };
        }
      } catch (error) {
        return { chat, observation: { status: 'unknown', reason: 'Readiness transition unconfirmed: ' + String(error) } };
      }
    }
    return { chat, observation };
  }
  async function syncAttempt(input: { attempt: string; sessionId: string; processId: number; generation: number;
    model: ModelPair; adopt: boolean; expectedTarget?: ModelPair }) {
    if (input.adopt !== Boolean(input.expectedTarget)) throw new InputError('Confirmed adoption requires the previewed target');
    const stored = store.list().find(row => row.attemptId === input.attempt);
    if (!stored || !['auth-pending', 'ready'].includes(stored.phase)
      || stored.sessionId !== input.sessionId || stored.processId !== input.processId) throw new InputError('Work chat attempt/session/process changed');
    const checked = await binding({ identity: projectIdentity(stored.projectId), requestId: stored.requestId,
      sourceClone: stored.sourceClone, worktree: stored.worktree, installation: stored.installation, statePath: stored.statePath });
    assertBinding(stored, checked);
    // A model mismatch can demote a previously ready chat. Report only the
    // reconciled phase, not a pending UI state alongside stale ready metadata.
    const { chat, observation } = await reconcile(stored);
    if (observation.status !== 'live' || !observation.authorized || !observation.model
      || observation.model.provider !== input.model.provider || observation.model.model !== input.model.model
      || observation.process?.pane !== chat.pane || observation.process.processId !== chat.processId
      || observation.process.processStart !== chat.processStart || observation.native?.sessionId !== chat.sessionId
      || observation.native.historyPath !== chat.historyPath || !observation.binding) throw new InputError('Native model/auth/process unconfirmed; pending preserved');
    assertBinding(chat, observation.binding);
    if (!runtime.receiptMatches?.(chat, input.model, input.generation, input.adopt)) throw new InputError('Native selection changed; pending preserved');
    const mismatch = chat.requestedProvider !== null && (chat.requestedProvider !== input.model.provider || chat.requestedModel !== input.model.model);
    if (input.adopt && (!mismatch || chat.requestedProvider !== input.expectedTarget?.provider
      || chat.requestedModel !== input.expectedTarget.model)) throw new InputError('Expected target changed while confirming; pending preserved');
    if (mismatch && !input.adopt) return { status: 'mismatch', expected: { provider: chat.requestedProvider, model: chat.requestedModel }, selected: input.model };
    const updated: WorkChat = { ...chat, phase: 'ready', requestedProvider: input.model.provider, requestedModel: input.model.model };
    store.transaction(() => {
      const current = store.get(chat.id);
      if (!current || current.attemptId !== chat.attemptId || current.phase !== chat.phase
        || current.requestedProvider !== chat.requestedProvider || current.requestedModel !== chat.requestedModel
        || input.adopt && (current.requestedProvider !== input.expectedTarget?.provider
          || current.requestedModel !== input.expectedTarget.model)
        || !runtime.receiptMatches?.(chat, input.model, input.generation, input.adopt)) throw new InputError('Native selection/attempt changed; pending preserved');
      store.update(updated);
    });
    return { status: 'ready', expected: input.model, selected: input.model };
  }
  return { previewOpen, previewResume, previewNewEmpty, execute, releaseUnused, syncAttempt,
    async list() { return Promise.all(store.list().map(reconcile)); },
    get: (id: string) => store.get(id),
    async show(id: string) { const chat = store.get(id); if (!chat) throw new InputError('Unknown work chat'); return reconcile(chat); } };
}
