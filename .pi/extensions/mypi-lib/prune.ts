export interface Block { type: string; text?: string; id?: string; name?: string; arguments?: unknown }
export interface Message { role: string; content?: string | Block[]; toolCallId?: string; toolName?: string; timestamp?: number }
export interface SessionEntry { type: string; id: string; targetId?: string; message?: Message }
export interface Draft { type: string; targetId?: string; replacement?: { content: Block[] } | null }
export interface TurnEndEvent { entries: Draft[]; context: { contextEntries: { sourceEntry: SessionEntry; messages: unknown[] }[] } }
export interface PruneContext {
  getContextUsage(): { percent: number | null } | undefined;
}

export const PRUNE_PERCENT = 50, KEEP_REPLIES = 10, MIN_CHARS = 2000, ARGS_LIMIT = 300;

const REPEATABLE = ['codemode', 'read', 'bash', 'grep', 'find', 'ls'];

export function threshold(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return PRUNE_PERCENT;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 100 ? number : PRUNE_PERCENT;
}

function chars(content: unknown): number {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum: number, block: Block) => sum + (block?.type === 'text' && typeof block.text === 'string' ? block.text.length : 0), 0);
}

const repeatable = (tool: string) => REPEATABLE.includes(tool) || tool.startsWith('mcp');

export function marker(tool: string, args: unknown, chars: number): string {
  let of = '';
  if (args !== undefined) {
    const json = JSON.stringify(args);
    of = ' of ' + (json.length > ARGS_LIMIT ? json.slice(0, ARGS_LIMIT) + '…' : json);
  }
  return `[mypi: the ${tool} result${of} (${chars} chars) was removed from the context to save space. What the run learned is in mypi home: the task folder's knowledge.md, plan.md and reports, and the project's INDEX.md. If you need this output, run the call again.]`;
}

export function pruneDrafts(event: TurnEndEvent): Draft[] {
  const list = event.context.contextEntries;
  const edited = new Set<string>();
  for (const { sourceEntry } of list) if (sourceEntry.type === 'context_edit' && sourceEntry.targetId !== undefined) edited.add(sourceEntry.targetId);
  for (const draft of event.entries) if (draft.type === 'context_edit' && draft.targetId !== undefined) edited.add(draft.targetId);
  const replies = list.flatMap(({ sourceEntry }, index) => sourceEntry.type === 'message' && sourceEntry.message?.role === 'assistant' ? [index] : []);
  if (replies.length < KEEP_REPLIES) return [];
  const cut = replies[replies.length - KEEP_REPLIES]!;
  const calls = new Map<string, unknown>();
  for (const { sourceEntry } of list) {
    const message = sourceEntry.message;
    if (sourceEntry.type !== 'message' || message?.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const block of message.content) if (block?.type === 'toolCall' && typeof block.id === 'string') calls.set(block.id, block.arguments);
  }
  const drafts: Draft[] = [];
  list.slice(0, cut).forEach(({ sourceEntry, messages }) => {
    const message = sourceEntry.message;
    if (sourceEntry.type !== 'message' || message?.role !== 'toolResult' || messages.length === 0 || edited.has(sourceEntry.id)) return;
    const tool = message.toolName;
    if (typeof tool !== 'string' || !repeatable(tool)) return;
    const size = chars(message.content);
    if (size <= MIN_CHARS) return;
    const args = message.toolCallId === undefined ? undefined : calls.get(message.toolCallId);
    drafts.push({ type: 'context_edit', targetId: sourceEntry.id, replacement: { content: [{ type: 'text', text: marker(tool, args, size) }] } });
  });
  return drafts;
}

export function createPrune(percent: number): { turnEnd(event: TurnEndEvent, ctx: PruneContext): { entries: Draft[] } | undefined } {
  return {
    turnEnd(event, ctx) {
      const usage = ctx.getContextUsage();
      if (usage === undefined || usage.percent === null || usage.percent < percent) return undefined;
      const drafts = pruneDrafts(event);
      return drafts.length === 0 ? undefined : { entries: [...event.entries, ...drafts] };
    },
  };
}
