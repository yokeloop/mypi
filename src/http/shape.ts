type ProjectRow = { code: string; org: string; slug: string; repository: string | null; checkoutPath: string | null };
type FlowRow = { project: string; code: string; source: string; integration: string; taskBranch: string; prTarget: string;
  mergeMethod: string; release: unknown };
type CardRow = { projectId: number | null; number: number; title: string; parent: string | null; status: string; isTerminal: boolean; contextDir: string;
  worktreePath: string | null; createdAt: string; updatedAt: string };
type EventRow = { id: number; fromKey: string; toKey: string; kind: string; message: string; createdAt: string; deliveredAt: string | null };
type JournalRow = { id: number; entry: { at: string; scope: { type: 'global' } | { type: string; key: string }; event_type: string; text: string;
  artifacts?: (string | { path: string; commit: string })[] } };
type SessionNode = { key: string; session: { agent: string; nativeId: string; state: string } | null; children: SessionNode[] };
type ContextRow = { path: string; revision?: string; text: string };

export function project(p: ProjectRow) {
  return { code: p.code, org: p.org, slug: p.slug, identity: p.org + '/' + p.slug, repository: p.repository, checkoutPath: p.checkoutPath };
}

export function flow(f: FlowRow) {
  return { project: f.project, code: f.code, source: f.source, integration: f.integration, taskBranch: f.taskBranch,
    prTarget: f.prTarget, mergeMethod: f.mergeMethod, release: f.release };
}

export function task(c: CardRow, key: string) {
  return { key, project: c.projectId === null ? null : key.slice(0, key.indexOf('-')), number: c.number, title: c.title,
    parent: c.parent, status: c.status, isTerminal: c.isTerminal, contextDir: c.contextDir, worktreePath: c.worktreePath,
    createdAt: c.createdAt, updatedAt: c.updatedAt };
}

export function event(e: EventRow) {
  return { id: e.id, from: e.fromKey, to: e.toKey, kind: e.kind, text: e.message, createdAt: e.createdAt, deliveredAt: e.deliveredAt };
}

export function journal({ id, entry }: JournalRow) {
  return { id, at: entry.at, scope: 'key' in entry.scope ? { type: entry.scope.type, key: entry.scope.key } : { type: 'global' },
    type: entry.event_type, text: entry.text,
    artifacts: (entry.artifacts ?? []).map(a => typeof a === 'string' ? { path: a, commit: null } : { path: a.path, commit: a.commit }) };
}

export function session(node: SessionNode): unknown {
  return { key: node.key, session: node.session === null ? null
    : { agent: node.session.agent, nativeId: node.session.nativeId, state: node.session.state }, children: node.children.map(session) };
}

export function context(r: ContextRow) {
  return { path: r.path, revision: r.revision ?? null, text: r.text };
}
