import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

type Tree = { read(path: string): string | undefined; exists(path: string): boolean };

const ROOTS = new Set(['AGENTS.md', 'README.md', 'PLAN.md', 'CHANGELOG.md', 'mise.toml', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', '.mcp.json', '.dependency-cruiser.cjs', '.dependency-cruiser.web.cjs', 'docs', 'src', 'test', 'scripts', 'integrations', 'web', 'tui', '.pi', '.claude', '.github', '.yoke']);
const IGNORED = ['dist', 'node_modules', 'tui/target', 'tui/bin', '.claude/settings.local.json'];
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const SPAN = /`([^`]+)`/g;

const clean = (path: string) => normalize(path).replace(/\/$/, '');

function unfenced(text: string): [number, string][] {
  const lines: [number, string][] = [];
  let fence: string | undefined;
  text.split('\n').forEach((line, index) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]?.slice(0, 3);
    if (marker !== undefined && (fence === undefined || fence === marker)) {
      fence = fence === undefined ? marker : undefined;
      return;
    }
    if (fence === undefined) lines.push([index + 1, line]);
  });
  return lines;
}

function slugs(text: string): Set<string> {
  const seen = new Map<string, number>();
  const result = new Set<string>();
  for (const [, line] of unfenced(text)) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading === null) continue;
    const base = (heading[1] ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count === 0 ? base : base + '-' + count);
  }
  return result;
}

function missingPaths(sources: string[], tree: Tree): string[] {
  const missing: string[] = [];
  for (const source of sources) {
    const text = tree.read(source) ?? '';
    const spans = !source.startsWith('docs/evidence/') && source !== 'docs/FILEMAP.md';
    for (const [number, line] of unfenced(text)) {
      for (const [, target = ''] of line.matchAll(LINK)) {
        if (SCHEME.test(target) || target.startsWith('#')) continue;
        const [path = '', anchor] = target.split('#');
        const full = clean(join(dirname(source), decodeURI(path)));
        if (!tree.exists(full)) missing.push(`${source}:${number} link ${target}`);
        else if (anchor !== undefined && full.endsWith('.md') && !slugs(tree.read(full) ?? '').has(anchor)) {
          missing.push(`${source}:${number} anchor ${target}`);
        }
      }
      if (!spans) continue;
      for (const [, span = ''] of line.replace(/\]\([^)]*\)/g, ']').matchAll(SPAN)) {
        if (/[\s<>{}*…$~]/u.test(span) || span.startsWith('/')) continue;
        const path = span.replace(/:\d+(?:[-,]\d+)*$/, '');
        if (!ROOTS.has(path.split('/')[0] ?? '')) continue;
        const full = clean(path);
        if (IGNORED.some(prefix => full === prefix || full.startsWith(prefix + '/'))) continue;
        if (!tree.exists(full)) missing.push(`${source}:${number} path ${path}`);
      }
    }
  }
  return missing;
}

const root = fileURLToPath(new URL('../../../', import.meta.url));

test('AGENTS.md core stays within 8,000 characters', () => {
  assert([...readFileSync(join(root, 'AGENTS.md'), 'utf8')].length <= 8000);
});

test('doc path check reports a missing link, a missing anchor and a missing repository path, and passes URLs, ignored outputs, fenced code and paths outside the repository', () => {
  const files = new Map([
    ['docs/a.md', [
      'See [b](b.md#missing), [b](b.md#title), [c](c.md) and [site](https://example.com/x.md).',
      'Paths `src/a.ts:12`, `dist/x.js`, `home/projects/x`, `~/.pi/agent/`, `scripts/gone.sh`.',
      '```',
      '`src/nope.ts` and [d](d.md)',
      '```',
    ].join('\n')],
    ['docs/b.md', '# Title\n'],
    ['src/a.ts', ''],
  ]);
  const dirs = new Set(['docs', 'src']);
  const tree: Tree = { read: path => files.get(path), exists: path => files.has(path) || dirs.has(path) };
  assert.deepEqual(missingPaths(['docs/a.md'], tree), [
    'docs/a.md:1 anchor b.md#missing',
    'docs/a.md:1 link c.md',
    'docs/a.md:2 path scripts/gone.sh',
  ]);
});

test('every link, anchor and repository path named in AGENTS.md and docs exists', () => {
  const docs = readdirSync(join(root, 'docs'), { recursive: true, encoding: 'utf8' }).filter(path => path.endsWith('.md')).map(path => 'docs/' + path);
  const tree: Tree = {
    read: path => existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : undefined,
    exists: path => existsSync(join(root, path)),
  };
  assert.deepEqual(missingPaths(['AGENTS.md', ...docs.sort()], tree), []);
});
