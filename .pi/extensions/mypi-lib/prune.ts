import { join } from 'node:path';

export interface Block { type: string; text?: string; id?: string; name?: string; arguments?: unknown }
export interface Message { role: string; content?: string | Block[]; toolCallId?: string; toolName?: string; timestamp?: number }
export interface SessionEntry { type: string; id: string; targetId?: string; message?: Message }
export interface Draft { type: string; targetId?: string; replacement?: { content: Block[] } | null }
export interface TurnEndEvent { entries: Draft[]; context: { contextEntries: { sourceEntry: SessionEntry; messages: unknown[] }[] } }
export interface ContextEvent { messages: Message[] }
export interface PruneContext {
  getContextUsage(): { percent: number | null } | undefined;
  sessionManager: { getBranch(): SessionEntry[] };
}
export interface Skill { id: string; name: 'flow' | 'epic'; location: string; args: string }

type Exec = (command: string, args: string[], options: { cwd: string; timeout: number }) =>
  Promise<{ code: number; killed?: boolean; stderr: string; stdout: string }>;

export const PRUNE_PERCENT = 50, KEEP_REPLIES = 10, MIN_CHARS = 2000, ARGS_LIMIT = 300;

const REPEATABLE = ['codemode', 'read', 'bash', 'grep', 'find', 'ls'];
const SKILL = /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;
const KEY = /^[A-Z]+-[1-9][0-9]*$/;
const SCOPE = /^([A-Z]+)(?:-[1-9][0-9]*)?$/;

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

function text(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((block: Block) => block?.type === 'text' && typeof block.text === 'string').map((block: Block) => block.text).join('');
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

export function lastSkill(branch: SessionEntry[]): Skill | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i]!;
    if (entry.type !== 'message' || entry.message?.role !== 'user') continue;
    const match = SKILL.exec(text(entry.message.content));
    if (match === null || (match[1] !== 'flow' && match[1] !== 'epic')) continue;
    const args = (match[4] ?? '').trim();
    if (args === '') continue;
    return { id: entry.id, name: match[1], location: match[2]!, args };
  }
  return undefined;
}

export function resumeBlock(skill: Skill, projectHome: string | undefined): string {
  const ph = projectHome ?? '<project home>';
  if (skill.name === 'flow') {
    const name = skill.args.split(/\s+/)[0];
    return `[mypi: this session's context was compacted during the run /flow ${skill.args}. Before the next step read the skill file ${skill.location} again, then these files of mypi home, and continue the run from the state they record: the flow score ${ph}/flows/${name}.md, the flow's knowledge ${ph}/flows/${name}/knowledge.md, knowledge.md in the folder of every key of the score ($BIN/mp-task dir <KEY> prints it) and the project's entry ${ph}/INDEX.md.]`;
  }
  return `[mypi: this session's context was compacted during the run /epic ${skill.args}. Before the next step read the skill file ${skill.location} again, then these files of mypi home, and continue the run from the state they record: knowledge.md in the epic's folder ($BIN/mp-task dir ${skill.args} prints it) and the project's entry ${ph}/INDEX.md.]`;
}

export function createPrune(exec: Exec, paths: { root: string; cli: string; home: string }, percent: number,
  scope: () => string | undefined): {
  turnEnd(event: TurnEndEvent, ctx: PruneContext): { entries: Draft[] } | undefined;
  context(event: ContextEvent, ctx: PruneContext): Promise<{ messages: Message[] } | undefined>;
} {
  const homes = new Map<string, string | undefined>();
  const projectHome = async (skill: Skill): Promise<string | undefined> => {
    const code = skill.args.split(/\s+/).find(word => KEY.test(word))?.split('-')[0] ?? SCOPE.exec(scope() ?? '')?.[1];
    if (code === undefined) return undefined;
    try {
      const result = await exec('node', [paths.cli, 'project', 'list'], { cwd: paths.root, timeout: 5000 });
      if (result.code !== 0 || result.killed) return undefined;
      const project = (JSON.parse(result.stdout) as { projects: { org: string; slug: string; code: string }[] }).projects.find(p => p.code === code);
      return project === undefined ? undefined : join(paths.home, 'projects', project.org, project.slug);
    } catch {
      return undefined;
    }
  };
  return {
    turnEnd(event, ctx) {
      const usage = ctx.getContextUsage();
      if (usage === undefined || usage.percent === null || usage.percent < percent) return undefined;
      const drafts = pruneDrafts(event);
      return drafts.length === 0 ? undefined : { entries: [...event.entries, ...drafts] };
    },
    async context(event, ctx) {
      const branch = ctx.sessionManager.getBranch();
      if (!branch.some(entry => entry.type === 'compaction')) return undefined;
      const skill = lastSkill(branch);
      if (skill === undefined) return undefined;
      const i = event.messages.map(message => message.role).lastIndexOf('compactionSummary');
      if (i === -1) return undefined;
      if (!homes.has(skill.id)) homes.set(skill.id, await projectHome(skill));
      const block = { role: 'custom', customType: 'mypi-resume', content: resumeBlock(skill, homes.get(skill.id)), display: false,
        timestamp: event.messages[i]!.timestamp ?? 0 };
      return { messages: [...event.messages.slice(0, i + 1), block, ...event.messages.slice(i + 1)] };
    },
  };
}
