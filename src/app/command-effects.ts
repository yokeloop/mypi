import type { AppCommand } from './commands.js';
import type { Action } from '../modules/authorization/public.js';

export interface CommandEffect {
  readonly category: 'scoped-data' | 'workspace' | 'runtime-control' | 'administrative';
  readonly action: Action;
  readonly resources: string;
}
const data = (action: 'data.read' | 'data.write', resources: string): CommandEffect => ({ category: 'scoped-data', action, resources });
const workspace = (action: Action, resources: string): CommandEffect => ({ category: 'workspace', action, resources });
const admin = (resources: string): CommandEffect => ({ category: 'administrative', action: 'administration', resources });
const homeWrite = [data('data.write', 'Resolved managed-home files; requires future HomeWriter'),
  workspace('workspace.commit', 'Compound exact-path context Git commit and shared Git metadata')] as const;
const requestRead = data('data.read', 'Resolve request key through DB to project or standalone global ownership; source, artifacts and journal may be indirect');
const hostInput = workspace('filesystem.read', 'Optional host-file text input; CLI progress also reads artifact JSON before dispatch');

/**
 * Exhaustive effect INVENTORY, not an authorization switch or enforcement boundary.
 * MP-9 must resolve each resource, authorize all compound effects and filter broad
 * results before disclosure. Legacy no-context dispatch is still unprotected.
 * There are no runtime-control commands yet; the category is reserved by this contract.
 */
export const commandEffects = {
  db_init: [admin('Create/migrate external SQLite database and parent directories')],
  bootstrap: [admin('Initialize DB and managed home'), ...homeWrite],
  project_list: [data('data.read', 'Broad registry listing, optional organization filter; includes checkout metadata')],
  project_add: [admin('Register project and organization in DB'), workspace('filesystem.read', 'Optional checkout path canonicalization')],
  project_resolve: [data('data.read', 'Registry lookup and checkout metadata'), workspace('filesystem.read', 'Host checkout path canonicalization; convenience only')],
  status_list: [data('data.read', 'Global status dictionary')],
  status_add: [admin('Insert global status dictionary entry')],
  status_terminal: [admin('Update global status dictionary terminality')],
  status_rename: [admin('Rename global status dictionary entry referenced by requests')],
  status_remove: [admin('Remove unused global status dictionary entry')],
  warmup: [data('data.read', 'Scope, inherited parent memory, child project/request indexes and context paths; not a blanket parent grant')],
  memory_show: [data('data.read', 'Resolved scope memory')],
  memory_add: [data('data.read', 'Existing resolved scope memory'), ...homeWrite],
  memory_remove: [data('data.read', 'Existing resolved scope memory'), ...homeWrite],
  capture: [hostInput, ...homeWrite, data('data.write', 'Global immutable inbox capture')],
  note_add: [hostInput, ...homeWrite, data('data.write', 'Resolved scope note')],
  error_add: [...homeWrite, data('data.write', 'Resolved project append-only errors')],
  journal_add: [requestRead, ...homeWrite, data('data.write', 'Resolved scope monthly append-only journal')],
  journal_read: [data('data.read', 'Broad history including all/org/project/request descendants; request ownership, artifacts and shared journal files require filtering')],
  request_list: [data('data.read', 'Broad request registry listing, optional project/status filters; includes standalone global requests')],
  request_show: [requestRead],
  request_create: [hostInput, data('data.read', 'Project/status registry and optional existing immutable source adoption'),
    data('data.write', 'DB request allocation plus project/global source and journal'), ...homeWrite],
  request_status: [requestRead, data('data.write', 'DB status/activity plus append-only journal'), ...homeWrite],
  request_title: [requestRead, data('data.write', 'DB title/activity plus append-only journal'), ...homeWrite],
  request_touch: [requestRead, data('data.write', 'DB request activity only; no Git commit')],
  request_progress: [requestRead, hostInput, data('data.write', 'Request artifacts, journal and DB activity'), ...homeWrite],
  context_read: [data('data.read', 'Home-relative file must resolve to resource ownership; path guard is not ACL')],
  context_commit: [data('data.read', 'Named existing home files, journal and Git history for reconciliation'), ...homeWrite],
  context_restore: [data('data.read', 'Named mutable context file at historical Git revision'), ...homeWrite],
  backup: [admin('Read all DB/home data and Git history; emit DB snapshot, bundle and manifest'),
    workspace('filesystem.write', 'New external backup directory and files')],
  restore: [admin('Read backup DB/bundle/manifest and restore absent DB/home'),
    workspace('filesystem.read', 'External backup input directory'), workspace('filesystem.write', 'Absent DB/home and restored Git repository')],
  policy_validate: [{ category: 'administrative', action: 'policy.validate', resources: 'Supplied YAML text only; CLI --file reads host input, never installs' }],
  policy_explain: [{ category: 'administrative', action: 'policy.explain', resources: 'Trusted effective snapshot and resolver lookup; only redacted decision is returned' }],
  policy_preview: [{ category: 'administrative', action: 'policy.explain', resources: 'Supplied YAML/hypothetical selectors only; CLI --file reads host input, never a live grant' }],
} satisfies Record<AppCommand['name'], readonly CommandEffect[]>;
