import { text, externalPath, storedPath, tool, actions } from '../schemas.js';
export const projects = {
  projects: tool(actions('action', {
    list: { required: [], optional: ['org'] }, add: { required: ['identity', 'code', 'repository'], optional: ['checkoutPath'] },
    update: { required: ['identity'], optional: ['expectedCheckoutPath', 'checkoutPath', 'expectedRepository', 'repository'] },
    resolve: { required: ['path'] }, flow: { required: ['project'] },
  }, { org: text, project: text, identity: text, code: text, checkoutPath: externalPath, expectedCheckoutPath: storedPath.nullable(),
    path: externalPath, repository: text, expectedRepository: text.nullable() }).superRefine((a, ctx) => {
    if (a.action !== 'update') return;
    for (const [value, expected] of [['checkoutPath', 'expectedCheckoutPath'], ['repository', 'expectedRepository']] as const) {
      if (a[value] !== undefined && a[expected] === undefined)
        ctx.addIssue({ code: 'custom', path: [expected], message: expected + ' is required for action update with ' + value });
      if (a[value] === undefined && a[expected] !== undefined)
        ctx.addIssue({ code: 'custom', path: [value], message: value + ' is required for action update with ' + expected });
    }
    if (a.checkoutPath === undefined && a.repository === undefined)
      ctx.addIssue({ code: 'custom', path: ['action'], message: 'action update needs checkoutPath or repository' });
  }),
  'Call to read or maintain project registrations: action list (optional org), add (identity org/project, code, repository, optional absolute checkoutPath), update (identity, checkoutPath with expectedCheckoutPath (the stored text or null: an absolute path, or projects/<org>/<project> for a clone under the mypi root) and/or repository with expectedRepository (the exact previous value or null)), resolve (an absolute existing directory to the deepest registered checkout: project, none or ambiguous; matched on this device against the listed checkout paths) or flow (project: a code or org/project) returns the project\'s branch flow from home/projects/<org>/<project>/flow.json with defaults and source file|default; an invalid file is refused. list and resolve return repository. repository is the project\'s Git remote URL (https://, ssh://, file://, [user@]host:path or an absolute path), required for add; local is refused in add and update. Ask the user for the URL if unknown, never derive it — /open clones a project without a clone from it. add and update write the DB only, flow only reads: never clones, creates context files or registers a project implicitly.',
  a => {
    switch (a.action) {
      case 'list': return [{ name: 'project_list', ...(a.org === undefined ? {} : { org: a.org }) }];
      case 'add': return [{ name: 'project_add', identity: a.identity!, code: a.code!,
        ...(a.checkoutPath === undefined ? {} : { checkoutPath: a.checkoutPath }), repository: a.repository! }];
      case 'update': return [{ name: 'project_update', identity: a.identity!,
        ...(a.checkoutPath === undefined ? {} : { expectedCheckoutPath: a.expectedCheckoutPath ?? null, checkoutPath: a.checkoutPath }),
        ...(a.repository === undefined ? {} : { expectedRepository: a.expectedRepository ?? null, repository: a.repository }) }];
      case 'resolve': return [{ name: 'project_resolve', path: a.path! }];
      case 'flow': return [{ name: 'project_flow', project: a.project! }];
    }
  }),
};
