export interface AskParams { question: string; options: string[] }

export interface AskTui { terminal: { rows: number; columns: number }; requestRender(): void }

export interface AskTheme { fg(color: string, text: string): string; bold(text: string): string }

export interface AskKeybindings { matches(data: string, id: string): boolean }

export interface AskComponent { render(width: number): string[]; handleInput?(data: string): void; invalidate(): void; capturesViewportInput?: boolean }

export interface AskContext {
  hasUI: boolean;
  mode?: string;
  ui: {
    select(title: string, options: string[], opts?: { signal?: AbortSignal }): Promise<string | undefined>;
    input(title: string, placeholder?: string, opts?: { signal?: AbortSignal }): Promise<string | undefined>;
    custom?<T>(factory: (tui: AskTui, theme: AskTheme, keybindings: AskKeybindings, done: (value: T) => void) => AskComponent,
      options?: { overlay?: boolean; overlayOptions?: { width?: string; maxHeight?: string; anchor?: string }; blocked?: { kind: 'question'; message: string } }): Promise<T>;
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

const WIDE: [number, number][] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615],
  [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce],
  [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
  [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
];

export function cellWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    width += WIDE.some(([from, to]) => code >= from && code <= to) ? 2 : 1;
  }
  return width;
}

function clean(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b./g, '').replace(/\t/g, '  ').replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '');
}

function chop(text: string, width: number): string[] {
  const chunks: string[] = [];
  let chunk = '';
  for (const char of text) {
    if (chunk && cellWidth(chunk + char) > width) { chunks.push(chunk); chunk = ''; }
    chunk += char;
  }
  return [...chunks, chunk];
}

export function wrapQuestion(text: string, width: number): string[] {
  const limit = Math.max(1, width);
  const out: string[] = [];
  for (const line of clean(text).split('\n')) {
    if (line === '') { out.push(''); continue; }
    const lead = line.match(/^ */)![0];
    const words = line.slice(lead.length).split(' ').filter(word => word !== '');
    if (words.length === 0) { out.push(...chop(lead, limit)); continue; }
    let current = lead, filled = false;
    for (const word of words) {
      const candidate = filled ? current + ' ' + word : current + word;
      if (cellWidth(candidate) <= limit) { current = candidate; filled = true; continue; }
      const pieces = chop(filled ? word : candidate, limit);
      if (filled) out.push(current);
      out.push(...pieces.slice(0, -1));
      current = pieces[pieces.length - 1]!;
      filled = true;
    }
    out.push(current);
  }
  return out;
}

function fit(text: string, width: number): string {
  if (cellWidth(text) <= width) return text;
  let out = '';
  for (const char of text) {
    if (cellWidth(out + char) > width - 1) break;
    out += char;
  }
  return width < 1 ? '' : out + '…';
}

function askComponent(question: string, list: string[], tui: AskTui, theme: AskTheme, kb: AskKeybindings, done: (value: string | undefined) => void): AskComponent {
  let cursor = 0, offset = 0, win = 1;
  let cachedWidth: number | undefined, cachedRows: number | undefined, cachedLines: string[] | undefined;
  const invalidate = () => { cachedWidth = undefined; cachedRows = undefined; cachedLines = undefined; };
  const dim = (text: string) => theme.fg('dim', text);
  return {
    capturesViewportInput: true,
    render(width: number): string[] {
      const rows = tui.terminal.rows;
      if (cachedLines && cachedWidth === width && cachedRows === rows) return cachedLines;
      const lines = wrapQuestion(question, width);
      const framed = rows > 10;
      const avail = rows - list.length - 1 - (framed ? 2 : 0);
      const body: string[] = [];
      if (lines.length <= avail) {
        offset = 0;
        win = Math.max(1, lines.length);
        body.push(...lines.map(line => fit(line, width)));
      } else {
        win = avail >= 3 ? avail - 2 : Math.max(1, avail - 1);
        offset = Math.min(Math.max(0, offset), lines.length - win);
        const below = lines.length - offset - win;
        const shown = lines.slice(offset, offset + win).map(line => fit(line, width));
        if (avail >= 3) body.push(dim(fit(offset ? `↑ ещё ${offset} строк` : '', width)), ...shown,
          dim(fit(below ? `↓ ещё ${below} строк` : '— конец вопроса —', width)));
        else body.push(...shown, dim(fit(`↑${offset} ↓${below}`, width)));
      }
      const options = list.map((option, index) => index === cursor ? theme.fg('accent', fit('› ' + option, width)) : fit('  ' + option, width));
      const out = [
        ...(framed ? [dim('─'.repeat(Math.max(0, width)))] : []),
        ...body,
        ...(framed ? [''] : []),
        ...options,
        dim(fit('↑↓ выбор · ←→ текст · Enter · Esc', width)),
      ];
      cachedWidth = width;
      cachedRows = rows;
      cachedLines = out.length > rows ? out.slice(out.length - Math.max(0, rows)) : out;
      return cachedLines;
    },
    handleInput(data: string): void {
      if (kb.matches(data, 'tui.select.up')) cursor = (cursor - 1 + list.length) % list.length;
      else if (kb.matches(data, 'tui.select.down')) cursor = (cursor + 1) % list.length;
      else if (kb.matches(data, 'tui.editor.cursorLeft') || kb.matches(data, 'tui.select.pageUp')) offset = Math.max(0, offset - win);
      else if (kb.matches(data, 'tui.editor.cursorRight') || kb.matches(data, 'tui.select.pageDown')) offset += win;
      else if (kb.matches(data, 'tui.select.confirm')) { done(list[cursor]); return; }
      else if (kb.matches(data, 'tui.select.cancel')) { done(undefined); return; }
      else return;
      invalidate();
      tui.requestRender();
    },
    invalidate,
  };
}

export function registerAsk(pi: { registerTool(tool: AskTool): void }): void {
  pi.registerTool({
    name: 'mypi_ask',
    label: 'mypi ask',
    description: 'Ask the engineer one question and wait for the answer. options: 2–4 short labels, the recommended one first; the tool marks it «(рекомендую)» and adds «Своё слово» for a typed answer. Write question as short paragraphs separated by a blank line: the facts first, then one line of reasoning per option; the engineer may read it on a phone-sized screen. Returns {"answer","custom"}; {"answer":null,"cancelled":true} when the engineer cancels — then stop; record no answer to it.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question: short paragraphs separated by a blank line — the facts, then one line per option' },
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
      const choose = async (): Promise<string | undefined> => {
        if (ctx.mode !== 'tui' || typeof ctx.ui.custom !== 'function') return ctx.ui.select(params.question, list, { signal });
        if (signal.aborted) return undefined;
        return ctx.ui.custom<string | undefined>((tui, theme, kb, finish) => {
          let finished = false;
          const close = (value: string | undefined) => {
            if (finished) return;
            finished = true;
            signal.removeEventListener('abort', abort);
            finish(value);
          };
          const abort = () => close(undefined);
          signal.addEventListener('abort', abort, { once: true });
          return askComponent(params.question, list, tui, theme, kb, close);
        }, { overlay: true, overlayOptions: { width: '100%', maxHeight: '100%', anchor: 'bottom-center' }, blocked: { kind: 'question', message: 'mypi_ask' } });
      };
      const choice = await choose();
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
