import { parseArgs } from 'node:util';
import type { PiLaunchOptions } from '../app/pi-launcher.js';
import { InputError } from '../shared/errors.js';

export type PiCommand = PiLaunchOptions & { readonly type: 'pi' };

export function parsePiCommand(args: string[]): PiCommand {
  const separator = args.indexOf('--');
  const launcherArgs = separator < 0 ? args : args.slice(0, separator);
  const nativeArgs = separator < 0 ? [] : args.slice(separator + 1);
  const { values, tokens } = parseArgs({ args: launcherArgs, tokens: true, options: {
    project: { type: 'string' }, org: { type: 'string' }, unrestricted: { type: 'boolean' },
    cwd: { type: 'string' }, base: { type: 'string' },
    'allow-observed-session': { type: 'boolean' }, 'herdr-tab': { type: 'boolean' }, title: { type: 'string' },
  } });
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'option') throw new InputError('Native Pi arguments must follow --');
    if (seen.has(token.name)) throw new InputError('Repeated launcher option: --' + token.name);
    seen.add(token.name);
    if (token.value !== undefined && !token.value.trim()) throw new InputError('Empty launcher option: --' + token.name);
  }
  if ([values.project, values.org, values.unrestricted].filter(value => value !== undefined).length > 1) {
    throw new InputError('Choose only one of --project, --org or --unrestricted');
  }
  if (values.base !== undefined && values.project === undefined) throw new InputError('--base requires --project');
  if (values.title !== undefined && !values['herdr-tab']) throw new InputError('--title requires --herdr-tab');
  return { type: 'pi', args: nativeArgs,
    ...(values['allow-observed-session'] ? { allowObservedSession: true } : {}),
    ...(values['herdr-tab'] ? { herdrTab: true } : {}),
    ...(values.title === undefined ? {} : { title: values.title }),
    ...(values.project === undefined ? {} : { selection: { kind: 'project' as const, project: values.project } }),
    ...(values.org === undefined ? {} : { selection: { kind: 'organization' as const, organization: values.org } }),
    ...(values.unrestricted ? { selection: { kind: 'unrestricted' as const } } : {}),
    ...(values.cwd === undefined ? {} : { cwd: values.cwd }),
    ...(values.base === undefined ? {} : { base: values.base }),
  };
}
