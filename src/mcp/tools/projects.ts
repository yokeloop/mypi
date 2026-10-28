import { text, externalPath, tool, actions } from '../schemas.js';
export const projects = {
  projects: tool(actions('action', {
    list: { required: [], optional: ['org'] }, add: { required: ['identity', 'code'], optional: ['checkoutPath'] },
    update: { required: ['identity', 'expectedCheckoutPath', 'checkoutPath'] }, resolve: { required: ['path'] },
  }, { org: text, identity: text, code: text, checkoutPath: externalPath, expectedCheckoutPath: externalPath.nullable(), path: externalPath }),
  'Call to read or maintain project registrations: action list (optional org), add (identity org/project, code, optional absolute checkoutPath), update (identity, expectedCheckoutPath = the exact previous path or null, new absolute checkoutPath) or resolve (an absolute existing directory to the deepest registered checkout: project, none or ambiguous). Writes the DB only: never clones, creates context files or registers a project implicitly.',
  a => {
    switch (a.action) {
      case 'list': return [{ name: 'project_list', ...(a.org === undefined ? {} : { org: a.org }) }];
      case 'add': return [{ name: 'project_add', identity: a.identity!, code: a.code!,
        ...(a.checkoutPath === undefined ? {} : { checkoutPath: a.checkoutPath }) }];
      case 'update': return [{ name: 'project_update', identity: a.identity!, expectedCheckoutPath: a.expectedCheckoutPath!, checkoutPath: a.checkoutPath! }];
      case 'resolve': return [{ name: 'project_resolve', path: a.path! }];
    }
  }),
};
