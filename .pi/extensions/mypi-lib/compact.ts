import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface CompactParams { key: string; resume: string; focus: string }

type CompactDetails = { key: string; resume: string; focus: string; folder: string }
  | { error: 'resume' | 'key' | 'dirty'; message: string };

export interface CompactTool {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  executionMode: 'sequential';
  execute(toolCallId: string, params: CompactParams):
    Promise<{ content: { type: 'text'; text: string }[]; details: CompactDetails; isError?: boolean; terminate?: boolean }>;
}

export interface CompactResult { summary: string; tokensBefore: number; estimatedTokensAfter?: number }

export interface CompactOptions { customInstructions: string; onComplete: (result: CompactResult) => void; onError: (error: Error) => void }

export interface CompactContext {
  hasUI: boolean;
  ui: { notify(message: string, level: 'info' | 'warning'): void };
  isIdle(): boolean;
  compact(options: CompactOptions): void;
}

type Exec = (command: string, args: string[], options: { cwd: string; timeout: number }) =>
  Promise<{ code: number; killed?: boolean; stderr: string; stdout: string }>;

type Request = { key: string; resume: string; focus: string; folder: string; project: string };

const RESUME = /^\/(flow|epic) [^\n]+$/;
const KEY = /^[A-Z]+-[1-9][0-9]*$/;

const reason = (error: unknown) => error instanceof Error ? error.message : String(error);

export function registerCompact(pi: {
  registerTool(tool: CompactTool): void;
  exec: Exec;
  sendUserMessage(content: string, options: { deliverAs: 'followUp'; expandPromptTemplates: true }): void;
}, paths: { root: string; cli: string; home: string }, now: () => Date = () => new Date()):
  { settle(ctx: CompactContext): void; quiet(): Promise<void>; reset(): void } {
  let request: Request | undefined;
  let running: Promise<void> | undefined;
  const refuse = (error: 'resume' | 'key' | 'dirty', message: string) =>
    ({ content: [{ type: 'text' as const, text: 'Error: ' + message }], details: { error, message }, isError: true });
  pi.registerTool({
    name: 'mypi_compact',
    label: 'mypi compact',
    description: 'Compact this session\'s context at a stage boundary of a Pi /flow or /epic run. Before the call write the stage\'s knowledge into the task\'s knowledge.md and the project\'s memory and commit home; the tool refuses while the project\'s home has uncommitted changes. Call it only when no background subagent run of this chat is active, directly and alone, as the last call of the turn. After the turn the extension compacts the context, saves the summary to the task\'s compactions.md, commits it, and sends the resume command as /skill:flow or /skill:epic, which continues from the recorded state; «Nothing to compact» and a failed compaction resume too.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The task key whose folder holds this stage\'s knowledge: the key just recorded by /flow, the epic\'s key for /epic' },
        resume: { type: 'string', description: 'The run\'s command: `/flow <name> <KEY> [<KEY>…]` as the flow score\'s «- Command:» line, or `/epic <KEY>`' },
        focus: { type: 'string', description: 'What the summary must point at beyond the files: the key that comes next and its stage, run ids still needed' },
      },
      required: ['key', 'resume', 'focus'],
      additionalProperties: false,
    },
    executionMode: 'sequential',
    async execute(_toolCallId, params) {
      const resume = params.resume.trim();
      const key = params.key;
      const focus = params.focus;
      if (!RESUME.test(resume)) return refuse('resume', 'resume must be the run\'s command, "/flow <name> <KEY> [<KEY>…]" or "/epic <KEY>"; no compaction was requested.');
      const missing = (detail: string) => refuse('key', `the task ${key} is not found: ${detail.trim().slice(0, 500)}; no compaction was requested.`);
      if (!KEY.test(key)) return missing('not a task key');
      let contextDir: unknown;
      try {
        const shown = await pi.exec('node', [paths.cli, 'task', 'show', key], { cwd: paths.root, timeout: 5000 });
        if (shown.code !== 0 || shown.killed) return missing(shown.stderr || 'timeout or nonzero exit');
        contextDir = (JSON.parse(shown.stdout) as { contextDir?: unknown }).contextDir;
      } catch (error) {
        return missing(reason(error));
      }
      if (typeof contextDir !== 'string' || contextDir === '') return missing('no contextDir in mypi task show');
      const project = dirname(dirname(contextDir));
      let status;
      try {
        status = await pi.exec('git', ['-C', paths.home, 'status', '--porcelain', '--', project], { cwd: paths.root, timeout: 5000 });
      } catch (error) {
        return refuse('dirty', `git status of the project's home failed: ${reason(error).slice(0, 500)}; no compaction was requested.`);
      }
      if (status.code !== 0 || status.killed) return refuse('dirty', `git status of the project's home failed: ${(status.stderr.trim() || 'timeout or nonzero exit').slice(0, 500)}; no compaction was requested.`);
      if (status.stdout.trim() !== '') return refuse('dirty', `the project's home has uncommitted changes:\n${status.stdout.slice(0, 2000)}\nWrite down what is missing, commit with mp-home-commit (and context commit for the project's entry and branches), then call mypi_compact again; no compaction was requested.`);
      const folder = join(paths.home, contextDir);
      request = { key, resume, focus, folder, project };
      return {
        content: [{ type: 'text', text: 'Compaction requested: end this turn now, without another tool call. After the turn the extension compacts the context, saves the summary to ' + folder + '/compactions.md and sends /skill:' + resume.slice(1) + ', which continues from the recorded state.' }],
        details: { key, resume, focus, folder },
        terminate: true,
      };
    },
  });
  const instructions = (run: Request) => {
    const words = run.resume.split(' ');
    const score = words[0] === '/flow' ? `the run name and, for /flow, the path of its score ${join(paths.home, run.project, 'flows', words[1] + '.md')}` : 'the run name';
    return `This compaction is a stage boundary of a mypi run. The stage's knowledge is written and committed in mypi home: the task folder ${run.folder} (knowledge.md, plan.md, reports, progress.md) and the project's entry ${join(paths.home, run.project, 'INDEX.md')} with its branches. After the summary the extension sends "${run.resume}" and the skill continues from those files. Keep: the command "${run.resume}", ${score}; the key just finished and the key that comes next with its stage; the paths of the task folders; the subagent run ids still needed; decisions and answers of the engineer not yet written to a file. Point at the files for everything written there instead of restating it. Drop tool outputs, diffs, logs and reports of the finished stage.\n\n${run.focus}`;
  };
  return {
    settle(ctx) {
      const run = request;
      if (run === undefined || !ctx.isIdle()) return;
      request = undefined;
      let finished = false;
      let release: () => void = () => {};
      running = new Promise<void>(resolve => { release = resolve; });
      const warn = (message: string) => { if (ctx.hasUI) ctx.ui.notify(message, 'warning'); };
      const finish = () => {
        pi.sendUserMessage('/skill:' + run.resume.slice(1), { deliverAs: 'followUp', expandPromptTemplates: true });
        running = undefined;
        release();
      };
      const onComplete = (result: CompactResult) => {
        if (finished) return;
        finished = true;
        void (async () => {
          const file = join(run.folder, 'compactions.md');
          try {
            appendFileSync(file, `## ${now().toISOString()} — ${run.resume}\n\nТокены: ${result.tokensBefore} → ${result.estimatedTokensAfter ?? '?'}\n\n${result.summary}\n\n`);
          } catch (error) {
            warn(`mypi compact: could not save the summary: ${reason(error)}`);
            finish();
            return;
          }
          let failure: string | undefined;
          try {
            const commit = await pi.exec('bash', [join(paths.root, 'scripts/pipeline/mp-home-commit'), run.key, run.key + ': compaction summary'], { cwd: paths.root, timeout: 60000 });
            if (commit.code !== 0 || commit.killed) failure = commit.stderr.trim() || 'timeout or nonzero exit';
          } catch (error) {
            failure = reason(error);
          }
          if (failure !== undefined) warn(`mypi compact: the summary is saved in ${file} but not committed: ${failure.slice(0, 500)}. The next mp-home-commit of the run commits it.`);
          finish();
        })();
      };
      const onError = (error: Error) => {
        if (finished) return;
        finished = true;
        if (!/Nothing to compact|Already compacted/.test(error.message)) warn('mypi compact failed: ' + error.message + '. The run continues without compaction.');
        finish();
      };
      try {
        ctx.compact({ customInstructions: instructions(run), onComplete, onError });
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    },
    quiet() {
      return running ?? Promise.resolve();
    },
    reset() {
      request = undefined;
    },
  };
}
