import type { Database } from 'better-sqlite3';
import { InputError } from '../../../shared/errors.js';
import type { Project } from '../model.js';
import type { ProjectStore } from '../ports.js';

const select = `SELECT p.id, o.slug AS org, p.slug, p.code, p.checkout_path AS checkoutPath, p.repository
  FROM projects p JOIN organizations o ON o.id = p.org_id`;

export function sqliteProjectStore(db: Database): ProjectStore {
  return {
    add: db.transaction((input: Parameters<ProjectStore['add']>[0]) => {
      db.prepare('INSERT INTO organizations(slug) VALUES (?) ON CONFLICT(slug) DO NOTHING').run(input.org);
      const org = db.prepare('SELECT id FROM organizations WHERE slug = ?').get(input.org) as { id: number };
      if (db.prepare('SELECT id FROM projects WHERE code = ? OR (org_id = ? AND slug = ?)')
        .get(input.code, org.id, input.slug)) {
        throw new InputError('Project identity or code already exists');
      }
      const { lastInsertRowid } = db.prepare(
        'INSERT INTO projects(org_id, slug, code, checkout_path, repository) VALUES (?, ?, ?, ?, ?)',
      ).run(org.id, input.slug, input.code, input.checkoutPath, input.repository);
      return db.prepare(select + ' WHERE p.id = ?').get(lastInsertRowid) as Project;
    }).immediate,
    update: db.transaction((input: Parameters<ProjectStore['update']>[0]) => {
      const project = db.prepare(select + ' WHERE o.slug = ? AND p.slug = ?')
        .get(input.org, input.slug) as Project | undefined;
      if (!project) throw new InputError('Unknown project');
      if (input.checkout) {
        if (project.checkoutPath !== input.checkout.expected) throw new InputError('Stale project checkout path');
        if (db.prepare('SELECT id FROM projects WHERE checkout_path = ? AND id <> ?')
          .get(input.checkout.path, project.id)) throw new InputError('Checkout path already registered to another project');
      }
      if (input.repository && project.repository !== input.repository.expected) throw new InputError('Stale project repository');
      db.prepare('UPDATE projects SET checkout_path = ?, repository = ? WHERE id = ?').run(
        input.checkout?.path ?? project.checkoutPath, input.repository?.value ?? project.repository, project.id);
      return db.prepare(select + ' WHERE p.id = ?').get(project.id) as Project;
    }).immediate,
    remove: db.transaction((input: Parameters<ProjectStore['remove']>[0]) => {
      const project = db.prepare(select + ' WHERE o.slug = ? AND p.slug = ?')
        .get(input.org, input.slug) as Project | undefined;
      if (!project) throw new InputError('Unknown project');
      if (project.code !== input.expectedCode) throw new InputError('Stale project code');
      const counts = db.prepare(`SELECT
        (SELECT count(*) FROM tasks WHERE project_id = @id) AS tasks,
        (SELECT count(*) FROM sessions WHERE project_id = @id) AS sessions,
        (SELECT count(*) FROM knowledge_journal WHERE scope_type = 'project' AND scope_key = @code) AS projectJournal,
        (SELECT count(*) FROM knowledge_journal WHERE scope_type = 'task' AND scope_key GLOB @code || '-[1-9]*') AS taskJournal,
        (SELECT count(*) FROM events WHERE to_key = @code OR from_key GLOB @code || '-[1-9]*') AS events`)
        .get({ id: project.id, code: project.code }) as Record<'tasks' | 'sessions' | 'projectJournal' | 'taskJournal' | 'events', number>;
      const parts = ([['tasks', counts.tasks], ['sessions', counts.sessions],
        ['project journal entries', counts.projectJournal], ['task journal entries', counts.taskJournal],
        ['events', counts.events]] as const).filter(([, n]) => n > 0).map(([label, n]) => label + ' ' + n);
      if (parts.length > 0) throw new InputError('Project ' + project.code + ' is referenced by: ' + parts.join(', '));
      db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
      return project;
    }).immediate,
    removeOrganization: db.transaction((slug: string) => {
      const org = db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug) as { id: number } | undefined;
      if (!org) throw new InputError('Unknown organization');
      const counts = db.prepare(`SELECT
        (SELECT count(*) FROM sessions WHERE org_id = @id) AS sessions,
        (SELECT count(*) FROM events WHERE to_key = @slug OR from_key = @slug) AS events`)
        .get({ id: org.id, slug }) as Record<'sessions' | 'events', number>;
      const parts = ([['sessions', counts.sessions], ['events', counts.events]] as const)
        .filter(([, n]) => n > 0).map(([label, n]) => label + ' ' + n);
      if (parts.length > 0) throw new InputError('Organization ' + slug + ' is referenced by: ' + parts.join(', '));
      const { n } = db.prepare('SELECT count(*) AS n FROM projects WHERE org_id = ?').get(org.id) as { n: number };
      if (n > 0) throw new InputError('Organization ' + slug + ' has projects: ' + n);
      db.prepare('DELETE FROM organizations WHERE id = ?').run(org.id);
    }).immediate,
    list(org) {
      return (org === undefined
        ? db.prepare(select + ' ORDER BY o.slug, p.slug').all()
        : db.prepare(select + ' WHERE o.slug = ? ORDER BY p.slug').all(org)) as Project[];
    },
    find(org, slug) {
      return db.prepare(select + ' WHERE o.slug = ? AND p.slug = ?').get(org, slug) as Project | undefined;
    },
    findOrganization(slug) {
      return db.prepare('SELECT id, slug FROM organizations WHERE slug = ?').get(slug) as
        { id: number; slug: string } | undefined;
    },
  };
}
