import type { Database } from 'better-sqlite3';
import { InputError } from '../../../shared/errors.js';
import type { Project } from '../model.js';
import type { ProjectStore } from '../ports.js';

const select = `SELECT p.id, o.slug AS org, p.slug, p.code, p.checkout_path AS checkoutPath
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
        'INSERT INTO projects(org_id, slug, code, checkout_path) VALUES (?, ?, ?, ?)',
      ).run(org.id, input.slug, input.code, input.checkoutPath);
      return db.prepare(select + ' WHERE p.id = ?').get(lastInsertRowid) as Project;
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
