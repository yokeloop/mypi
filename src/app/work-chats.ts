import { createHash, randomUUID } from 'node:crypto';
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
  persisted?: boolean;
  reason?: string;
}
export interface ChatRuntime {
  /** Canonical Git/worktree and installation/state checks; no worktree creation. */
  validate(input: { sourceClone: string; worktree: string; installation: string; statePath: string }): Promise<Omit<ChatBinding, 'requestId' | 'projectId'>>;
  /** Exact existing header/cwd/tree; absent or corrupt history is an error, never a new session. */
  history(chat: WorkChat): Promise<{ native: NativeIdentity; saved: SavedModel }>;
  /** Positive empty-closure evidence only. Without native continuity evidence return false. */
  provenEmpty(chat: WorkChat): Promise<boolean>;
  /** Read-only. Live requires exact native/cwd/process/resource identity, not name/readiness.
   * Dead requires positive absence of the old writer AND no conflicting worktree writer.
   * Missing pane/server/metadata alone is unknown. Legacy provenance may be absent: positive
   * local process absence is usable, but a reused/ambiguous live PID is not identity.
   * For incomplete launches, correlate the reserved native UUID/attempt before reporting live. */
  inspect(chat: WorkChat): Promise<ChatInspection>;
  /** Validate an exact launch preference, never credentials. Auth-filtered catalog omission
   * is not invalidity. Missing auth must not prevent opening; unconfirmed application of an
   * explicit choice must produce partial, never silent fallback success. */
  validateModel(pair: ModelPair, binding: ChatBinding): Promise<void>;
  /** Recheck actionable identity before focusing: a stale pane must never focus another chat. */
  focus(chat: WorkChat, observation: ChatInspection): Promise<void>;
  /** Read-only launch preparation, before reservation. Returns one dispatch operation;
   * invoke only after committing this exact chat/UUID. Setup errors leave SQL unchanged.
   * No new-launch prerequisites belong on existing-live focus or diagnostic reads. */
  prepareLaunch(input: { chat: WorkChat; model: ModelSelection; resume: boolean; focus: boolean }): Promise<PreparedChatLaunch>;
}
/** One native launch, no prompt/replay/retry. Saved model is diagnostic only; only
 * invocation overrides resume. Opened means native identity, not provider readiness. */
export type PreparedChatLaunch = () => Promise<ChatLaunchResult>;
export type ChatLaunchResult =
  | { status: 'opened'; process: ProcessIdentity; native: NativeIdentity; model?: ModelPair }
  // Include native only when its path/ID were independently validated.
  | { status: 'partial'; reason: string; pane?: string; processId?: number; processStart?: string; processBootId?: string; herdrEndpoint?: string; native?: NativeIdentity };
export interface ChatPreview {
  action: 'open' | 'resume' | 'new-empty';
  binding: ChatBinding;
  chatId?: string;
  priorAttempt?: string;
  /** Fingerprint of the exact row inspected; execution compares it again inside reservation. */
  priorRevision?: string;
  name?: string;
  model: ModelSelection;
  native?: NativeIdentity;
  live?: ProcessIdentity;
  persisted?: boolean;
}
export interface ChatResult { chat: WorkChat; observation: ChatInspection; outcome: 'opened' | 'existing' | 'partial' }
export interface OpenForRequestInput {
  identity: string;
  requestId: number;
  chatId?: string;
  /** Required only when no chat exists; existing worktrees only. */
  association?: { sourceClone: string; worktree: string; installation: string; statePath: string };
  name?: string;
  model?: ModelPair;
  focus?: boolean;
}
export type OpenForRequestResult = ChatResult
  | { outcome: 'choice-needed'; chats: WorkChat[] }
  | { outcome: 'setup-needed'; reason: string };

// Hash a stable field list, not object insertion order. This is a concurrency token, not authority.
function revision(chat: WorkChat): string {
  const fields: (keyof WorkChat)[] = ['id', 'name', 'attemptId', 'requestId', 'projectId', 'sourceClone', 'worktree',
    'gitCommonDir', 'branch', 'installation', 'statePath', 'sessionId', 'historyPath', 'pane', 'processId',
    'processStart', 'processBootId', 'herdrEndpoint', 'requestedProvider', 'requestedModel', 'phase'];
  return createHash('sha256').update(JSON.stringify(fields.map(field => chat[field] ?? null))).digest('hex');
}
function sameProcess(a: ProcessIdentity, b: ProcessIdentity): boolean {
  // Pane movement alone does not change native process identity.
  return a.processId === b.processId && a.processStart === b.processStart
    && (!a.processBootId || a.processBootId === b.processBootId)
    && (!a.herdrEndpoint || a.herdrEndpoint === b.herdrEndpoint);
}

/** Observations are read-only. Only explicit mutations perform short SQL transactions. */
export function createWorkChats(input: {
  store: ChatStore;
  projects: { resolveScope(identity: string): ProjectScope; list(): { id: number; org: string; slug: string }[] };
  requests: { get(id: number): { projectId: number | null } };
  userHome: string;
  runtime: ChatRuntime;
}) {
  const { store, projects, requests, runtime } = input;
  function projectScope(identity: string, requestId: number) {
    const scope = projects.resolveScope(identity);
    if (scope.type !== 'project') throw new InputError('Registered project required');
    if (requests.get(requestId).projectId !== scope.project.id) throw new InputError('Request belongs to a different project');
    return scope.project;
  }
  async function binding(args: { identity: string; requestId: number; sourceClone: string; worktree: string; installation: string; statePath: string }): Promise<ChatBinding> {
    const project = projectScope(args.identity, args.requestId);
    if (!project.checkoutPath) throw new InputError('Registered project and source clone required');
    if (project.checkoutPath !== args.sourceClone) throw new InputError('Source clone must equal registered project checkout');
    const checked = await runtime.validate(args);
    if (!checked.gitCommonDir || !checked.branch || !checked.sourceClone || !checked.worktree || !checked.installation || !checked.statePath
      || checked.sourceClone !== project.checkoutPath || checked.worktree !== args.worktree
      || checked.installation !== args.installation || checked.statePath !== args.statePath) {
      throw new InputError('Runtime binding differs from explicit project/worktree/installation/state');
    }
    return { ...checked, projectId: project.id, requestId: args.requestId };
  }
  function select(identity: string, invocation?: ModelPair, saved?: SavedModel) {
    return selectWorkChatModel({ identity, ...(invocation ? { invocation } : {}), ...(saved ? { saved } : {}), userHome: input.userHome, projects });
  }
  function projectIdentity(projectId: number): string {
    const project = projects.list().find(p => p.id === projectId);
    if (!project) throw new InputError('Registered project unavailable');
    return project.org + '/' + project.slug;
  }
  function expected(preview: ChatPreview): WorkChat {
    const chat = preview.chatId ? store.get(preview.chatId) : undefined;
    if (!chat || chat.attemptId !== preview.priorAttempt || revision(chat) !== preview.priorRevision) {
      throw new InputError('Work chat changed since inspection');
    }
    const occupant = store.byWorktree(chat.worktree);
    if (occupant && occupant.id !== chat.id) throw new InputError('Worktree has another managed chat');
    return chat;
  }
  function updateExact(before: WorkChat, after: WorkChat) {
    if (!store.get(before.id) || revision(store.get(before.id)!) !== revision(before)) throw new InputError('Stale launch attempt or association');
    store.update(after, before.attemptId);
  }
  async function observe(chat: WorkChat): Promise<{ chat: WorkChat; observation: ChatInspection }> {
    let observation: ChatInspection;
    try {
      observation = await runtime.inspect(chat);
      if (observation.status === 'live') {
        if (!observation.binding || !observation.native || !observation.process || !chat.sessionId
          || !observation.native.historyPath || !observation.process.pane || !observation.process.processStart
          || !Number.isSafeInteger(observation.process.processId) || observation.process.processId <= 0
          || observation.native.sessionId !== chat.sessionId
          || chat.historyPath && observation.native.historyPath !== chat.historyPath
          || chat.processId !== null && (observation.process.processId !== chat.processId
            || observation.process.processStart !== chat.processStart)
          || chat.processBootId && observation.process.processBootId !== chat.processBootId
          || chat.herdrEndpoint && observation.process.herdrEndpoint !== chat.herdrEndpoint) {
          throw new InputError('Native process/session differs from reserved association');
        }
        assertBinding(chat, observation.binding);
      }
    } catch (error) { observation = { status: 'unknown', reason: String(error) }; }
    return { chat, observation };
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
    if (!old || old.phase === 'closed' || old.phase === 'reserved' || !old.sessionId || !old.historyPath || store.byWorktree(old.worktree)?.id !== id) {
      throw new InputError('No occupied managed empty chat to replace');
    }
    const checked = await binding({ ...old, identity: projectIdentity(old.projectId) });
    assertBinding(old, checked);
    const { observation } = await observe(old);
    if (observation.status !== 'dead' || !await runtime.provenEmpty(old)) throw new InputError('Native empty closure and process death unconfirmed; cannot open a new empty chat');
    const model = select(projectIdentity(old.projectId), options.model);
    if (model.source !== 'unselected') await runtime.validateModel(model, checked);
    return { action: 'new-empty', binding: checked, chatId: id, priorAttempt: old.attemptId, priorRevision: revision(old), model,
      ...(options.name === undefined ? {} : { name: options.name }) };
  }
  async function previewResume(id: string, invocation?: ModelPair): Promise<ChatPreview> {
    const chat = store.get(id);
    if (!chat) throw new InputError('Unknown work chat');
    const checked = await binding({ ...chat, identity: projectIdentity(chat.projectId) });
    assertBinding(chat, checked);
    const { observation } = await observe(chat);
    if (observation.status === 'unknown') throw new InputError('Chat ownership unknown; inspect existing pane before retry: ' + (observation.reason ?? 'unknown'));
    const prior = { chatId: id, priorAttempt: chat.attemptId, priorRevision: revision(chat) };
    if (observation.status === 'live') {
      if (invocation && (invocation.provider !== observation.model?.provider || invocation.model !== observation.model?.model)) {
        throw new InputError('Live chat has another or unconfirmed model; use /model in that chat');
      }
      const model = select(projectIdentity(chat.projectId), invocation, observation.model
        ? { status: 'selected', selection: observation.model } : { status: 'none' });
      return { action: 'resume', binding: checked, ...prior, model, native: observation.native!, live: observation.process!,
        ...(observation.persisted === undefined ? {} : { persisted: observation.persisted }) };
    }
    if (chat.phase === 'reserved') throw new InputError('Prior launch uncertain; inspect it first');
    if (!chat.sessionId || !chat.historyPath) throw new InputError('Exact native history unavailable; no automatic empty replacement');
    const saved = await runtime.history(chat);
    assertNative({ sessionId: chat.sessionId, historyPath: chat.historyPath }, saved.native);
    const model = select(projectIdentity(chat.projectId), invocation, saved.saved);
    // Pi restores its saved model itself; only a deliberate override needs launch validation.
    if (model.source === 'invocation') await runtime.validateModel(model, checked);
    return { action: 'resume', binding: checked, ...prior, native: saved.native, model };
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
    if (preview.action !== 'open' && (preview.priorAttempt !== fresh.priorAttempt || preview.priorRevision !== fresh.priorRevision)) {
      throw new InputError('Work chat changed since inspection');
    }
    if (preview.action === 'resume' && (preview.native?.sessionId !== fresh.native?.sessionId || preview.native?.historyPath !== fresh.native?.historyPath)) {
      throw new InputError('Native history changed since preview');
    }
    if (fresh.live) {
      if (!preview.live || !sameProcess(preview.live, fresh.live)) throw new InputError('Live process changed since preview');
      const chat = expected(fresh);
      const { observation } = await observe(chat);
      if (observation.status !== 'live' || !observation.process || !sameProcess(fresh.live, observation.process)
        || observation.native?.sessionId !== fresh.native?.sessionId || observation.native?.historyPath !== fresh.native?.historyPath) {
        throw new InputError('Live process/native identity changed; inspect before retry');
      }
      if (focus) await runtime.focus(chat, observation);
      // Explicit opening may record recovered launch/pane facts. show/list/preview never do.
      const updated: WorkChat = { ...chat, ...observation.native, ...observation.process, phase: 'ready' };
      store.transaction(() => { expected(fresh); updateExact(chat, updated); });
      return { chat: store.get(chat.id)!, observation, outcome: 'existing' };
    }
    if (process.env.HERDR_ENV !== '1' || !process.env.HERDR_WORKSPACE_ID) throw new InputError('Persistent Herdr environment required');
    const previous = fresh.action === 'resume' ? expected(fresh) : undefined;
    if (previous?.phase === 'reserved') throw new InputError('Prior launch uncertain; inspect it first');
    const chat: WorkChat = {
      ...(previous ?? { ...fresh.binding, id: randomUUID(), name: fresh.name ?? null,
        sessionId: randomUUID(), historyPath: null }),
      requestedProvider: fresh.model.source === 'unselected' ? null : fresh.model.provider,
      requestedModel: fresh.model.source === 'unselected' ? null : fresh.model.model,
      phase: 'reserved', attemptId: randomUUID(), pane: null, processId: null, processStart: null,
      processBootId: null, herdrEndpoint: null,
    };
    const launch = await runtime.prepareLaunch({ chat, model: fresh.model, resume: fresh.action === 'resume', focus });
    store.transaction(() => {
      if (previous) {
        expected(fresh); // Preparation may have yielded while another caller changed the row.
        updateExact(previous, chat);
      } else {
        if (fresh.action === 'new-empty') {
          const prior = expected(fresh);
          if (store.byWorktree(prior.worktree)?.id !== prior.id) throw new InputError('Empty chat changed during reservation');
          store.retireEmpty(prior.id, prior.attemptId);
        } else if (store.byWorktree(fresh.binding.worktree)) throw new InputError('Worktree reservation already exists');
        store.reserve(chat);
      }
    });
    let partial = chat;
    let committed = chat;
    try {
      const launched = await launch();
      const actualNative = launched.native;
      const matchingNative = actualNative && chat.sessionId === actualNative.sessionId && (!chat.historyPath || chat.historyPath === actualNative.historyPath);
      const process = launched.status === 'opened' ? launched.process : launched;
      partial = { ...chat, ...(matchingNative ? actualNative : {}), pane: process.pane || null,
        processId: process.processId ?? null, processStart: process.processStart || null,
        processBootId: process.processBootId ?? null, herdrEndpoint: process.herdrEndpoint ?? null, phase: 'partial' };
      store.transaction(() => updateExact(committed, partial));
      committed = partial;
      if (launched.status === 'partial') throw new InputError(launched.reason);
      if (!matchingNative || !partial.historyPath || !partial.pane || !partial.processId || !partial.processStart) throw new InputError('Native session/history or process identity unconfirmed');
      const { observation } = await observe(partial);
      if (observation.status !== 'live' || !observation.process || !sameProcess(launched.process, observation.process)
        || observation.native?.sessionId !== launched.native.sessionId || observation.native.historyPath !== launched.native.historyPath) {
        throw new InputError('Launch and independent process/native observation disagree');
      }
      // Launch preferences are not permanent model targets. Check only the opening result.
      if (fresh.model.source !== 'unselected' && fresh.model.source !== 'saved session'
        && (launched.model?.provider !== fresh.model.provider || launched.model.model !== fresh.model.model)) {
        throw new InputError('Requested launch model was not confirmed; use /model in the same Pi');
      }
      const opened: WorkChat = { ...partial, ...observation.process, phase: 'ready' };
      store.transaction(() => updateExact(committed, opened));
      return { chat: store.get(chat.id)!, observation, outcome: 'opened' };
    } catch (error) {
      // Never attach late results to a changed row, or retry/clean up a potentially live tab.
      store.transaction(() => {
        const current = store.get(chat.id);
        if (current && revision(current) === revision(committed)) store.update({ ...partial, phase: 'partial' });
      });
      const current = store.get(chat.id);
      const stale = !current || revision(current) !== revision({ ...partial, phase: 'partial' });
      const evidence = stale ? `; stale attempt ${chat.attemptId} observed pane=${partial.pane ?? 'unknown'} pid=${partial.processId ?? 'unknown'} (not attached to changed row)` : '';
      return { chat: current ?? partial, observation: { status: 'unknown', reason: String(error) + evidence }, outcome: 'partial' };
    }
  }
  async function openForRequest(args: OpenForRequestInput): Promise<OpenForRequestResult> {
    const project = projectScope(args.identity, args.requestId);
    const chats = store.list().filter(chat => chat.projectId === project.id && chat.requestId === args.requestId);
    if (args.chatId) {
      if (!chats.some(chat => chat.id === args.chatId)) throw new InputError('Selected chat belongs to another request/project');
      return execute(await previewResume(args.chatId, args.model), args.focus ?? true);
    }
    if (chats.length > 1) return { outcome: 'choice-needed', chats };
    if (chats.length === 1) return execute(await previewResume(chats[0]!.id, args.model), args.focus ?? true);
    if (!args.association || !project.checkoutPath) return { outcome: 'setup-needed', reason: 'Supply an existing registered source clone and task worktree/installation/state association' };
    return execute(await previewOpen({ ...args.association, identity: args.identity, requestId: args.requestId,
      ...(args.name === undefined ? {} : { name: args.name }), ...(args.model ? { model: args.model } : {}) }), args.focus ?? true);
  }
  return { previewOpen, previewResume, previewNewEmpty, execute, openForRequest,
    async list() { return Promise.all(store.list().map(observe)); },
    get: (id: string) => store.get(id),
    async show(id: string) { const chat = store.get(id); if (!chat) throw new InputError('Unknown work chat'); return observe(chat); } };
}
