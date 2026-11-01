import { text, externalPath, tool, actions } from '../schemas.js';
export const projects = {
  projects: tool(actions('action', {
    list: { required: [], optional: ['org'] }, add: { required: ['identity', 'code'], optional: ['checkoutPath'] },
    update: { required: ['identity', 'expectedCheckoutPath', 'checkoutPath'] }, resolve: { required: ['path'] },
    flow: { required: ['project'] },
  }, { org: text, project: text, identity: text, code: text, checkoutPath: externalPath, expectedCheckoutPath: externalPath.nullable(), path: externalPath }),
  'Call to read or maintain project registrations: action list (optional org), add (identity org/project, code, optional absolute checkoutPath), update (identity, expectedCheckoutPath = the exact previous path or null, new absolute checkoutPath) resolve (an absolute existing directory to the deepest registered checkout: project, none or ambiguous) or flow (project: a code or org/project) returns the project\'s branch flow from home/projects/<org>/<project>/flow.json with defaults and source file|default; an invalid file is refused. add and update write the DB only, flow only reads: never clones, creates context files or registers a project implicitly.',
  a => {
    switch (a.action) {
      case 'list': return [{ name: 'project_list', ...(a.org === undefined ? {} : { org: a.org }) }];
      case 'add': return [{ name: 'project_add', identity: a.identity!, code: a.code!,
        ...(a.checkoutPath === undefined ? {} : { checkoutPath: a.checkoutPath }) }];
      case 'update': return [{ name: 'project_update', identity: a.identity!, expectedCheckoutPath: a.expectedCheckoutPath!, checkoutPath: a.checkoutPath! }];
      case 'resolve': return [{ name: 'project_resolve', path: a.path! }];
      case 'flow': return [{ name: 'project_flow', project: a.project! }];
    }
  }),
};
