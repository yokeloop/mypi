import { InputError } from '../../shared/errors.js';
import type { Project } from './model.js';

export const LOCAL_REPOSITORY = 'local';

export type CheckoutState =
  | { kind: 'missing' }
  | { kind: 'empty' }
  | { kind: 'repository'; origin: string | null }
  | { kind: 'other'; reason: string };

function repositoryProblem(value: string): string | undefined {
  if (value === LOCAL_REPOSITORY) return undefined;
  if (value === '') return 'must not be empty';
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return 'must not contain spaces or control characters';
  if (value.startsWith('-')) return 'must not start with -';
  if (value.includes('::')) return 'transport helpers (::) are not allowed';
  if (value.startsWith('/')) return undefined;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(value);
  if (scheme) {
    const name = scheme[1]!.toLowerCase();
    return ['https', 'ssh', 'file'].includes(name) ? undefined : 'scheme ' + name + ' is not allowed';
  }
  return /^(?:[^@/:]+@)?[^/:]+:.+$/.test(value) ? undefined : 'is not a Git remote URL';
}

export function validateRepository(value: string): void {
  const reason = repositoryProblem(value);
  if (reason !== undefined) {
    throw new InputError('Invalid repository ' + JSON.stringify(value) + ': ' + reason
      + '; use https://, ssh://, file://, [user@]host:path, an absolute path or local');
  }
}

export function checkoutTarget(projectsRoot: string, project: { org: string; slug: string }): string {
  return projectsRoot.replace(/\/$/, '') + '/' + project.org + '/' + project.slug;
}

export function cloneStaging(target: string, pid: number): string {
  const cut = target.lastIndexOf('/');
  return target.slice(0, cut) + '/.' + target.slice(cut + 1) + '.mypi-clone-' + pid;
}

export function stagingPid(target: string, name: string): number | null {
  const prefix = '.' + target.slice(target.lastIndexOf('/') + 1) + '.mypi-clone-';
  if (!name.startsWith(prefix)) return null;
  const digits = name.slice(prefix.length);
  return /^[0-9]+$/.test(digits) && Number(digits) >= 1 ? Number(digits) : null;
}

export function noRepositoryError(project: { org: string; slug: string; code: string }): InputError {
  const identity = project.org + '/' + project.slug;
  return new InputError('Project ' + identity + ' (' + project.code + ') has no clone and no repository to clone it from; '
    + 'set it with projects {"action":"update","identity":"' + identity + '","expectedRepository":null,"repository":"<git-url|local>"} '
    + '(CLI: mypi project update ' + identity + ' --expected-repository-unset --repository <git-url|local>), then open it again');
}

export function planCheckout(project: Pick<Project, 'org' | 'slug' | 'code' | 'repository'>, target: string,
  state: CheckoutState): 'clone' | 'init' | 'adopt' {
  const { repository } = project;
  if (repository === null) throw noRepositoryError(project);
  const local = repository === LOCAL_REPOSITORY;
  if (state.kind === 'missing' || state.kind === 'empty') return local ? 'init' : 'clone';
  let why: string;
  if (state.kind === 'other') why = state.reason;
  else if (local) {
    if (state.origin === null) return 'adopt';
    why = 'is a Git repository with origin ' + state.origin + ', but the project is local';
  } else {
    if (state.origin === repository) return 'adopt';
    why = 'is a Git repository with origin ' + (state.origin ?? 'none') + ', not ' + repository;
  }
  const identity = project.org + '/' + project.slug;
  throw new InputError('Cannot prepare the clone of ' + identity + ': ' + target + ' ' + why
    + '; nothing was changed. Move it away, or register an existing clone with mypi project update '
    + identity + ' --expected-unset --path <checkout>');
}
