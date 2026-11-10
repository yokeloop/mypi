export interface AskParams { question: string; options: string[] }

export interface AskContext {
  hasUI: boolean;
  ui: {
    select(title: string, options: string[], opts?: { signal?: AbortSignal }): Promise<string | undefined>;
    input(title: string, placeholder?: string, opts?: { signal?: AbortSignal }): Promise<string | undefined>;
  };
}

type AskDetails = { answer: string; custom: boolean } | { answer: null; cancelled: true } | { answer: null; error: 'no-ui' };

export interface AskTool {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  executionMode: 'sequential';
  execute(toolCallId: string, params: AskParams, signal: AbortSignal, onUpdate: unknown, ctx: AskContext):
    Promise<{ content: { type: 'text'; text: string }[]; details: AskDetails; isError?: boolean }>;
}

const OWN_WORD = 'Своё слово';

export function registerAsk(pi: { registerTool(tool: AskTool): void }): void {
  pi.registerTool({
    name: 'mypi_ask',
    label: 'mypi ask',
    description: 'Ask the engineer one question and wait for the answer. options: 2–4 short labels, the recommended one first; the tool marks it «(рекомендую)» and adds «Своё слово» for a typed answer. Put the facts and one line of reasoning per option into question. Returns {"answer","custom"}; {"answer":null,"cancelled":true} when the engineer cancels — then stop; record no answer to it.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question with its facts and the reasoning per option' },
        options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4, description: 'Option labels, the recommended one first' },
      },
      required: ['question', 'options'],
      additionalProperties: false,
    },
    executionMode: 'sequential',
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!ctx.hasUI) return { content: [{ type: 'text', text: 'Error: mypi_ask needs the interactive Pi UI; nothing was asked.' }],
        details: { answer: null, error: 'no-ui' }, isError: true };
      const list = [params.options[0] + ' (рекомендую)', ...params.options.slice(1), OWN_WORD];
      const done = (details: AskDetails) => ({ content: [{ type: 'text' as const, text: JSON.stringify(details) }], details });
      const cancelled = done({ answer: null, cancelled: true });
      const choice = await ctx.ui.select(params.question, list, { signal });
      if (choice === undefined) return cancelled;
      const index = list.indexOf(choice);
      if (index === list.length - 1) {
        const typed = (await ctx.ui.input(OWN_WORD + ':', undefined, { signal }))?.trim();
        return typed ? done({ answer: typed, custom: true }) : cancelled;
      }
      return done({ answer: params.options[index]!, custom: false });
    },
  });
}
