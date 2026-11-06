export interface CompletionItem { value: string; label: string; description?: string }
export interface OpenProject { id: number; org: string; slug: string; code: string }
export interface OpenTask { projectId: number | null; number: number; title: string; status: string; isTerminal: boolean; key: string }
export interface OpenCatalog { projects: OpenProject[]; tasks: OpenTask[] }

export const COMPLETION_TTL = 15000;
export const COMPLETION_LIMIT = 50;

export function scopeCodes(key: string | undefined, projects: OpenProject[]): string[] | undefined {
  if (key === undefined || key === 'global') return undefined;
  const code = /^([A-Z]+)(?:-[1-9][0-9]*)?$/.exec(key)?.[1];
  if (code !== undefined) return [code];
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(key)) return undefined;
  return projects.filter(project => project.org === key).map(project => project.code).sort();
}

export function openCompletions(prefix: string, catalog: OpenCatalog, scope: string[] | undefined): CompletionItem[] | null {
  if (/(?:^|\s)--message(?:\s|$)/.test(prefix)) return null;
  const token = /\S*$/.exec(prefix)![0];
  const head = prefix.slice(0, prefix.length - token.length);
  const words = head.trim().split(/\s+/).filter(Boolean);
  if (token.startsWith('-') || ['--agent', '--permission-mode'].includes(words.at(-1) ?? '')) return null;
  const matched = scope === undefined ? [] : catalog.projects.filter(project => scope.includes(project.code));
  const own = matched.length === 0 ? undefined : new Set(matched.map(project => project.id));
  const projects = (own === undefined ? catalog.projects : matched).slice().sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  const codes = new Map(catalog.projects.map(project => [project.id, project.code]));
  const tasks = catalog.tasks
    .filter(task => task.projectId !== null && !task.isTerminal && (own === undefined || own.has(task.projectId!)))
    .map(task => ({ task, code: codes.get(task.projectId!) ?? '' }))
    .sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : a.task.number - b.task.number);
  const entries = [
    ...projects.map(project => ({ label: project.code, description: project.org + '/' + project.slug, text: project.org + '/' + project.slug })),
    ...tasks.map(({ task }) => ({ label: task.key, description: task.status + ' · ' + task.title, text: task.title })),
  ].filter(entry => !words.includes(entry.label));
  const typed = token.toLowerCase();
  const starts = entries.filter(entry => entry.label.toLowerCase().startsWith(typed));
  const found = typed === '' ? entries
    : [...starts, ...entries.filter(entry => !starts.includes(entry) && entry.text.toLowerCase().includes(typed))];
  const items = found.slice(0, COMPLETION_LIMIT).map(entry => ({ value: head + entry.label + ' ', label: entry.label, description: entry.description }));
  return items.length === 0 ? null : items;
}

export function completionSource(load: () => Promise<OpenCatalog | undefined>, now: () => number): () => Promise<OpenCatalog | undefined> {
  let cache: { at: number; catalog: OpenCatalog } | undefined;
  let loading: Promise<OpenCatalog | undefined> | undefined;
  return () => {
    if (cache !== undefined && now() - cache.at < COMPLETION_TTL) return Promise.resolve(cache.catalog);
    if (loading !== undefined) return loading;
    const current = (async () => {
      try {
        const catalog = await load();
        if (catalog !== undefined) cache = { at: now(), catalog };
        return catalog;
      } catch {
        return undefined;
      }
    })();
    loading = current;
    void current.then(() => { if (loading === current) loading = undefined; });
    return current;
  };
}
