export interface AskParams { question: string; options: string[] }

export interface AskTui { terminal: { rows: number; columns: number }; requestRender(): void }

export interface AskTheme { fg(color: string, text: string): string; bold(text: string): string }

export interface AskEvents { emit(channel: string, data: unknown): void }

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
  [0x2630, 0x2637], [0x2648, 0x2653], [0x267f, 0x267f], [0x268a, 0x268f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be],
  [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd],
  [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0x2e99], [0x2e9b, 0x2ef3], [0x2f00, 0x2fd5],
  [0x2ff0, 0x2fff], [0x3000, 0x3000], [0x3001, 0x303e], [0x3041, 0x3096], [0x3099, 0x30ff], [0x3105, 0x312f], [0x3131, 0x318e], [0x3190, 0x31e5],
  [0x31ef, 0x321e], [0x3220, 0x3247], [0x3250, 0xa48c], [0xa490, 0xa4c6], [0xa960, 0xa97c], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19],
  [0xfe30, 0xfe52], [0xfe54, 0xfe66], [0xfe68, 0xfe6b], [0xff01, 0xff60], [0xffe0, 0xffe6], [0x16fe0, 0x16fe4], [0x16ff0, 0x16ff6], [0x17000, 0x18cd5],
  [0x18cff, 0x18d1e], [0x18d80, 0x18df2], [0x1aff0, 0x1aff3], [0x1aff5, 0x1affb], [0x1affd, 0x1affe], [0x1b000, 0x1b122], [0x1b132, 0x1b132], [0x1b150, 0x1b152],
  [0x1b155, 0x1b155], [0x1b164, 0x1b167], [0x1b170, 0x1b2fb], [0x1d300, 0x1d356], [0x1d360, 0x1d376], [0x1f000, 0x1faff], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f202], [0x1f210, 0x1f23b], [0x1f240, 0x1f248], [0x1f250, 0x1f251], [0x1f260, 0x1f265], [0x1f300, 0x1f320],
  [0x1f32d, 0x1f335], [0x1f337, 0x1f37c], [0x1f37e, 0x1f393], [0x1f3a0, 0x1f3ca], [0x1f3cf, 0x1f3d3], [0x1f3e0, 0x1f3f0], [0x1f3f4, 0x1f3f4], [0x1f3f8, 0x1f43e],
  [0x1f440, 0x1f440], [0x1f442, 0x1f4fc], [0x1f4ff, 0x1f53d], [0x1f54b, 0x1f54e], [0x1f550, 0x1f567], [0x1f57a, 0x1f57a], [0x1f595, 0x1f596], [0x1f5a4, 0x1f5a4],
  [0x1f5fb, 0x1f64f], [0x1f680, 0x1f6c5], [0x1f6cc, 0x1f6cc], [0x1f6d0, 0x1f6d2], [0x1f6d5, 0x1f6d8], [0x1f6dc, 0x1f6df], [0x1f6eb, 0x1f6ec], [0x1f6f4, 0x1f6fc],
  [0x1f7e0, 0x1f7eb], [0x1f7f0, 0x1f7f0], [0x1f90c, 0x1f93a], [0x1f93c, 0x1f945], [0x1f947, 0x1f9ff], [0x1fa70, 0x1fa7c], [0x1fa80, 0x1fa8a], [0x1fa8e, 0x1fac6],
  [0x1fac8, 0x1fac8], [0x1facd, 0x1fadc], [0x1fadf, 0x1faea], [0x1faef, 0x1faf8], [0x20000, 0x2fffd], [0x30000, 0x3fffd],
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

export function registerAsk(pi: { registerTool(tool: AskTool): void; events?: AskEvents }): void {
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
      const blocked = (data: { active: true; label: string } | { active: false }) => pi.events?.emit('herdr:blocked', data);
      blocked({ active: true, label: 'mypi_ask' });
      try {
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
      } finally {
        blocked({ active: false });
      }
    },
  });
}
