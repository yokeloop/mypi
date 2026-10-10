import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { cloneHome, homeOrigin } from '../infrastructure/git/clone-home.js';
import { contextGit } from '../infrastructure/git/context-git.js';
import { canonicalFuturePath, externalStatePath } from '../infrastructure/filesystem/paths.js';
import { openDatabase } from '../infrastructure/database/database.js';
import { initializeState } from './create-app.js';
import { composeInstallation, validateInstallation } from './installation.js';
import type { InstallationBinding } from './installation.js';
import { InputError } from '../shared/errors.js';

export interface SetupChoices {
  homeMode: 'new' | 'existing' | 'clone';
  homeRoot: string;
  remote?: string;
  databaseMode: 'new' | 'existing';
  database: string;
  stateRoot: string;
  agentSettingsPath?: string;
  refreshProjection?: boolean;
}
interface Stamp { path: string; kind: 'absent' | 'file' | 'link' | 'directory'; digest?: string }
export interface InstallationPlan {
  engineRoot: string;
  choices: SetupChoices;
  binding: InstallationBinding;
  observations: Stamp[];
  settings: string;
  sourceSettings: string;
  localSettingsInput: string;
  sourcesHash: string;
  agentSettingsPath?: string;
  knownGlobalSources: string[];
  appendLink?: string;
  mcpLink?: string;
  remote?: string;
  legacy: boolean;
  existingBinding: boolean;
  changes: string[];
  warnings: string[];
}
function stamp(path: string): Stamp {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, kind: 'absent' }; throw error; }
  if (stat.isSymbolicLink()) return { path, kind: 'link', digest: readlinkSync(path) };
  if (stat.isDirectory()) return { path, kind: 'directory', digest: readdirSync(path).sort().join('\0') };
  if (stat.isFile() && stat.nlink === 1) return { path, kind: 'file', digest: createHash('sha256').update(readFileSync(path)).digest('hex') };
  throw new InputError('Unsupported setup path/hardlink: ' + path);
}
function json(path: string): Record<string, unknown> {
  const data: unknown = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new InputError('Expected JSON object: ' + path);
  return data as Record<string, unknown>;
}
function checkedPath(path: string, name: string): void {
  if (!isAbsolute(path) || path.includes('\0')) throw new InputError(name + ' must be an explicit absolute path');
}
function source(entry: unknown): string {
  const value = typeof entry === 'string' ? entry : entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>)['source'] : undefined;
  if (typeof value !== 'string') throw new InputError('Invalid Pi package source');
  return value;
}
function rebase(value: string, from: string): string {
  const prefix = /^[+!-]/.test(value) ? value[0]! : '';
  const path = prefix ? value.slice(1) : value;
  if (!path) throw new InputError('Invalid empty Pi resource path');
  // Pi interprets ~/ against the native user home, not the source settings directory.
  return prefix + (path.startsWith('~/') || isAbsolute(path) ? path : resolve(from, path));
}
function packageSource(value: string, from: string): string {
  // Registry/URL identities are not filesystem paths and are retained unchanged.
  if (isAbsolute(value) || value.startsWith('.')) return resolve(from, value);
  // A bare local directory is a package path only if its manifest exists at the source.
  return stamp(join(from, value, 'package.json')).kind === 'file' ? resolve(from, value) : value;
}
function enginePackage(value: string): boolean {
  if (!isAbsolute(value) || stamp(join(value, 'package.json')).kind !== 'file') return false;
  try { return json(join(value, 'package.json'))['name'] === 'mypi-pi'; } catch { return false; }
}
function packageEntry(entry: unknown, from: string): unknown {
  const value = source(entry), selected = packageSource(value, from);
  if (typeof entry === 'string') return selected;
  const record = entry as Record<string, unknown>, result: Record<string, unknown> = { ...record, source: selected };
  for (const key of ['extensions', 'skills', 'prompts', 'themes']) {
    if (record[key] !== undefined) {
      if (!Array.isArray(record[key]) || !record[key].every(item => typeof item === 'string')) throw new InputError('Invalid package resource filter: ' + key);
      result[key] = record[key]; // Package filters are relative to their selected package source.
    }
  }
  return result;
}
function selectedPackage(entry: unknown, current: string): unknown {
  return typeof entry === 'string' ? current : { ...(entry as Record<string, unknown>), source: current };
}
function composeSettings(home: Record<string, unknown>, local: Record<string, unknown>, homePi: string, localPi: string,
  current: string, globalKnown: unknown[]): string {
  const result: Record<string, unknown> = { ...home, ...local };
  for (const key of ['extensions', 'skills', 'prompts', 'themes']) {
    const sources = [home[key], local[key]];
    if (sources.some(list => list !== undefined && (!Array.isArray(list) || !list.every(item => typeof item === 'string')))) throw new InputError('Invalid Pi resource array: ' + key);
    result[key] = sources.flatMap((list, index) => (list as string[] | undefined ?? []).map(item => rebase(item, index ? localPi : homePi)));
    if (stamp(join(homePi, key)).kind === 'directory') (result[key] as string[]).push(join(homePi, key));
  }
  const entries = [home['packages'], local['packages']];
  if (entries.some(list => list !== undefined && !Array.isArray(list))) throw new InputError('Pi packages must be arrays');
  const packages = entries.flatMap((list, index) => (list as unknown[] | undefined ?? []).map(entry => packageEntry(entry, index ? localPi : homePi)));
  const known = [...packages.filter(entry => enginePackage(source(entry))), ...globalKnown];
  const filter = (entry: unknown) => JSON.stringify(typeof entry === 'string' ? {} : Object.fromEntries(
    ['extensions', 'skills', 'prompts', 'themes'].filter(key => key in (entry as Record<string, unknown>))
      .map(key => [key, (entry as Record<string, unknown>)[key]])));
  if (new Set(known.map(filter)).size > 1) throw new InputError('Different engine package filters require explicit reconciliation');
  const prior = known.find(entry => source(entry) === current) ?? known[0];
  result['packages'] = [...packages.filter(entry => !enginePackage(source(entry))),
    selectedPackage(prior ?? current, current)];
  return JSON.stringify(result, null, 2) + '\n';
}
/** Read-only plan; inputs are never filled from XDG or a personal DB. */
export function planInstallation(engineRoot: string, choices: SetupChoices): InstallationPlan {
  if (choices.homeMode === 'clone') throw new InputError('Clone requires its separate first-stage review; use planHomeClone, then review existing-home setup');
  const engine = realpathSync(engineRoot), localPi = join(engine, '.pi');
  checkedPath(choices.homeRoot, 'Home'); checkedPath(choices.database, 'Database'); checkedPath(choices.stateRoot, 'State root');
  if (!['new', 'existing', 'clone'].includes(choices.homeMode) || !['new', 'existing'].includes(choices.databaseMode)) throw new InputError('Select home and database modes');
  if (choices.remote !== undefined) throw new InputError('Remote is valid only for the separate clone preview');
  const home = canonicalFuturePath(choices.homeRoot);
  const fromHome = relative(home, engine), fromEngine = relative(engine, home);
  if (fromHome === '' || (!fromHome.startsWith('..' + sep) && fromHome !== '..' && !isAbsolute(fromHome))
    || (home !== join(engine, 'home') && fromEngine !== '..' && !fromEngine.startsWith('..' + sep) && !isAbsolute(fromEngine))) {
    throw new InputError('Home repository must be separate from engine repository or the ignored engine/home');
  }
  const db = externalStatePath(externalStatePath(choices.database, engine, 'Database'), home, 'Database');
  const stateRoot = externalStatePath(externalStatePath(choices.stateRoot, engine, 'Runtime state'), home, 'Runtime state');
  const homePi = join(home, 'pi'), bindingPath = join(engine, '.mypi-local.json');
  const localPiStatus = stamp(localPi);
  if (localPiStatus.kind === 'file') throw new InputError('Nonstandard .pi configuration requires reconciliation');
  if (localPiStatus.kind === 'link' && resolve(engine, readlinkSync(localPi)) !== homePi) {
    throw new InputError('Existing .pi link selects a different home; reconcile explicitly');
  }
  if (choices.agentSettingsPath !== undefined) checkedPath(choices.agentSettingsPath, 'Pi agent settings');
  const observations = [home, join(home, '.git'), join(home, 'USER-INSTRUCTIONS.md'), homePi,
    join(homePi, 'APPEND_SYSTEM.md'), join(homePi, 'mcp.json'), join(homePi, 'settings.json'),
    db, dirname(db), stateRoot, bindingPath, localPi, join(localPi, 'settings.json'),
    join(localPi, 'APPEND_SYSTEM.md'), join(localPi, 'mcp.json'), join(localPi, '.mypi-setup.json'),
    join(engine, 'integrations/pi/package.json'), ...['extensions', 'skills', 'prompts', 'themes'].map(key => join(homePi, key)),
    ...(choices.agentSettingsPath ? [choices.agentSettingsPath] : [])].map(stamp);
  const kind = (path: string) => observations.find(value => value.path === path)!.kind;
  if (choices.homeMode === 'existing') {
    if (kind(home) !== 'directory' || kind(join(home, '.git')) !== 'directory') throw new InputError('Existing home must be its own local Git repository');
    contextGit(home).inspectRepository();
  } else if (kind(home) !== 'absent') throw new InputError('New/clone home destination must be absent');
  if (choices.databaseMode === 'existing') {
    if (kind(db) !== 'file') throw new InputError('Selected existing database must be a regular file');
    const database = openDatabase(db, true);
    try { if (database.pragma('quick_check', { simple: true }) !== 'ok') throw new InputError('Existing database integrity check failed'); }
    finally { database.close(); }
  } else if (kind(db) !== 'absent') throw new InputError('New database destination must be absent');
  if (kind(stateRoot) !== 'absent' && kind(stateRoot) !== 'directory') throw new InputError('State root must be a directory or absent');
  if (kind(join(homePi, 'APPEND_SYSTEM.md')) === 'link' && readlinkSync(join(homePi, 'APPEND_SYSTEM.md')) !== '../USER-INSTRUCTIONS.md') {
    throw new InputError('Nonstandard selected-home instruction link requires reconciliation');
  }
  const binding: InstallationBinding = { version: 1, engineRoot: engine, homeRoot: home, database: db, stateRoot };
  validateInstallation(binding);
  if (kind(home) === 'directory') composeInstallation(binding, engine, bindingPath);
  const existingBinding = kind(bindingPath) === 'file';
  if (existingBinding && JSON.stringify(validateInstallation(json(bindingPath))) !== JSON.stringify(binding)) {
    throw new InputError('Existing installation binding differs; reconcile explicitly before changing selection');
  }
  if (!existingBinding && kind(bindingPath) !== 'absent') throw new InputError('Conflicting installation binding');
  const piKind = kind(localPi), legacy = piKind === 'link';
  const current = join(engine, 'integrations/pi');
  if (!enginePackage(current)) throw new InputError('Missing current mypi Pi package manifest');
  for (const target of [join(localPi, 'settings.json'), join(localPi, '.mypi-setup.json'), join(homePi, 'settings.json'), join(homePi, 'mcp.json')]) {
    if (kind(target) !== 'absent' && kind(target) !== 'file') throw new InputError('Nonstandard configuration file requires reconciliation: ' + target);
  }
  const homeSettings = kind(join(homePi, 'settings.json')) === 'file' ? readFileSync(join(homePi, 'settings.json'), 'utf8') : '{}';
  const sourceSettings = homeSettings;
  const localSettings = piKind === 'directory' && kind(join(localPi, 'settings.json')) === 'file'
    ? readFileSync(join(localPi, 'settings.json'), 'utf8') : '{}';
  const saved = kind(join(localPi, '.mypi-setup.json')) === 'file' ? json(join(localPi, '.mypi-setup.json')) : undefined;
  const localSettingsInput = saved && typeof saved['localSettingsInput'] === 'string' ? saved['localSettingsInput'] : localSettings;
  const warnings: string[] = [];
  const agentSettings = choices.agentSettingsPath && kind(choices.agentSettingsPath) === 'file' ? json(choices.agentSettingsPath) : {};
  if (choices.agentSettingsPath && !['file', 'absent'].includes(kind(choices.agentSettingsPath))) throw new InputError('Pi agent settings must be a regular file or absent');
  if (agentSettings['packages'] !== undefined && !Array.isArray(agentSettings['packages'])) throw new InputError('Invalid agent Pi package list');
  const globalKnown = ((agentSettings['packages'] ?? []) as unknown[]).map(entry => packageEntry(entry, dirname(choices.agentSettingsPath!)))
    .filter(entry => enginePackage(source(entry)));
  const knownGlobalSources = globalKnown.map(source);
  const homeConfig = JSON.parse(homeSettings) as Record<string, unknown>;
  const localConfig = JSON.parse(localSettingsInput) as Record<string, unknown>;
  for (const [config, base] of [[homeConfig, homePi], [localConfig, localPi], [agentSettings, dirname(choices.agentSettingsPath ?? engine)]] as const) {
    const entries = config['packages'];
    if (Array.isArray(entries)) for (const entry of entries) {
      const candidate = packageSource(source(entry), base);
      if (isAbsolute(candidate)) observations.push(stamp(join(candidate, 'package.json')));
    }
  }
  const settings = composeSettings(homeConfig, localConfig, homePi, localPi, current, globalKnown);
  const projected = JSON.parse(settings) as Record<string, unknown>;
  const projectPackages = projected['packages'] as unknown[];
  for (const globalSource of new Set(knownGlobalSources)) {
    if (globalSource !== current) projectPackages.unshift({ source: globalSource, extensions: [], skills: [], prompts: [], themes: [] });
  }
  const projectedSettings = JSON.stringify(projected, null, 2) + '\n';
  const appendLink = kind(join(homePi, 'APPEND_SYSTEM.md')) === 'link' || kind(join(homePi, 'APPEND_SYSTEM.md')) === 'file'
    ? join(homePi, 'APPEND_SYSTEM.md') : kind(join(home, 'USER-INSTRUCTIONS.md')) === 'file' ? join(home, 'USER-INSTRUCTIONS.md') : undefined;
  const mcpLink = kind(join(homePi, 'mcp.json')) === 'file' ? join(homePi, 'mcp.json') : undefined;
  if (mcpLink) {
    const mcp = json(mcpLink);
    if (mcp['mcpServers'] !== undefined && (!mcp['mcpServers'] || typeof mcp['mcpServers'] !== 'object' || Array.isArray(mcp['mcpServers']))) {
      throw new InputError('Selected-home MCP servers must be an object');
    }
    warnings.push('Selected-home MCP configuration retains native relative cwd (session directory) and ~/ expansion (user home) semantics; explicit enabled:false overrides remain authoritative.');
  }
  if (piKind === 'directory' && kind(join(localPi, 'mcp.json')) === 'link'
    && (!mcpLink || resolve(localPi, readlinkSync(join(localPi, 'mcp.json'))) !== mcpLink)) {
    throw new InputError('Unreviewed local MCP configuration link requires reconciliation');
  }
  if (piKind === 'directory' && kind(join(localPi, 'mcp.json')) === 'file' && mcpLink) {
    warnings.push('Existing local mcp.json takes precedence over selected-home mcp.json; selected-home MCP is NOT applied. Reconcile explicitly if you want to change it.');
  }
  if (piKind === 'directory' && kind(join(localPi, 'APPEND_SYSTEM.md')) !== 'absent' && appendLink
    && !(kind(join(localPi, 'APPEND_SYSTEM.md')) === 'link'
      && resolve(localPi, readlinkSync(join(localPi, 'APPEND_SYSTEM.md'))) === appendLink)) {
    warnings.push('Existing project APPEND_SYSTEM.md is retained; selected-home instructions are NOT linked. Reconcile explicitly if you want to change this choice.');
  }
  const consulted = observations.filter(item => item.path === choices.agentSettingsPath || item.path.endsWith('/package.json')
    || ['extensions', 'skills', 'prompts', 'themes'].some(key => item.path === join(homePi, key)));
  const sourcesHash = createHash('sha256').update(JSON.stringify(consulted)).digest('hex');
  const globalChanged = !!saved && (saved['globalSources'] !== JSON.stringify(knownGlobalSources) || saved['sourcesHash'] !== sourcesHash);
  if (saved && saved['settingsHash'] !== observations.find(item => item.path === join(localPi, 'settings.json'))?.digest) {
    throw new InputError('Local settings changed since setup; reconcile explicitly before rerunning');
  }
  const homeChanged = !!saved && saved['homeSettingsHash'] !== createHash('sha256').update(sourceSettings).digest('hex');
  if ((homeChanged || globalChanged) && !choices.refreshProjection) {
    throw new InputError('Selected home/global settings changed; rerun bootstrap with explicit refresh choice to review updated projection');
  }
  const finalSettings = saved && !homeChanged && !globalChanged ? localSettings : projectedSettings;
  const changes = [
    ...(choices.homeMode === 'new' ? ['initialize home Git at ' + home, 'create ' + join(home, 'pi'),
      'create ' + join(home, 'USER-INSTRUCTIONS.md'), 'create ' + join(home, 'pi/APPEND_SYSTEM.md')] : []),
    ...(choices.databaseMode === 'new' ? ['create database'] : []),
    ...(legacy ? ['convert legacy .pi link (target preserved)'] : piKind === 'absent' ? ['create local .pi'] : []),
    ...(appendLink || choices.homeMode === 'new' ? legacy || kind(join(localPi, 'APPEND_SYSTEM.md')) === 'absent' ? ['link project instructions to selected home'] : [] : []),
    ...(mcpLink && (legacy || kind(join(localPi, 'mcp.json')) === 'absent') ? ['link selected-home MCP configuration'] : []),
    ...(kind(join(localPi, 'settings.json')) === 'absent' || localSettings !== finalSettings ? ['write project settings snapshot'] : []),
    ...(saved === undefined || localSettings !== finalSettings || homeChanged || globalChanged ? ['write setup provenance'] : []),
    ...(!existingBinding ? ['publish installation binding'] : []),
  ];
  const remote = choices.homeMode === 'existing' ? homeOrigin(home) : undefined;
  return { engineRoot: engine, choices, binding, observations, settings: finalSettings, sourceSettings, localSettingsInput, sourcesHash,
    ...(appendLink ? { appendLink } : {}), ...(mcpLink ? { mcpLink } : {}),
    knownGlobalSources, ...(choices.agentSettingsPath ? { agentSettingsPath: choices.agentSettingsPath } : {}),
    ...(remote === undefined ? {} : { remote }),
    legacy, existingBinding, changes, warnings };
}

export interface HomeClonePlan { engineRoot: string; destination: string; remote: string; preimage: Stamp }
/** First stage: no remote probes or clone side effects before explicit approval. */
export function planHomeClone(engineRoot: string, destination: string, remote: string): HomeClonePlan {
  const engine = realpathSync(engineRoot);
  checkedPath(destination, 'Clone destination');
  if (!remote.trim() || remote.includes('\0')) throw new InputError('Choose an explicit Git remote');
  const home = canonicalFuturePath(destination), rel = relative(engine, home);
  const above = relative(home, engine);
  if (above === '' || (above !== '..' && !above.startsWith('..' + sep) && !isAbsolute(above))
    || (rel !== 'home' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))) {
    throw new InputError('Clone destination must be separate from engine or the ignored engine/home');
  }
  const preimage = stamp(home);
  if (preimage.kind !== 'absent') throw new InputError('Clone destination must be absent; inspect existing data before retrying');
  return { engineRoot: engine, destination: home, remote, preimage };
}
/** Reports partial clone path even if Git returns an error after creating the destination. */
export function applyHomeClone(plan: HomeClonePlan): string {
  if (JSON.stringify(planHomeClone(plan.engineRoot, plan.destination, plan.remote)) !== JSON.stringify(plan)) {
    throw new InputError('Clone destination changed since preview; no clone attempted');
  }
  try { cloneHome(plan.remote, plan.destination); }
  catch (error) { throw new Error(`Clone outcome uncertain at ${plan.destination}: ${String(error)}. Inspect the destination; do not replay blindly.`); }
  return plan.destination;
}

/** Re-plan before effects; never overwrite a changed target. Partial effects are reported, not rolled back. */
export function applyInstallation(plan: InstallationPlan): string[] {
  if (JSON.stringify(planInstallation(plan.engineRoot, plan.choices)) !== JSON.stringify(plan)) throw new InputError('Installation changed since preview; rerun setup');
  const saved: string[] = [], home = plan.binding.homeRoot, pi = join(plan.engineRoot, '.pi');
  const createFile = (path: string, text: string) => {
    if (stamp(path).kind !== 'absent') throw new InputError('Setup target changed: ' + path);
    writeFileSync(path, text, { flag: 'wx', mode: 0o600 }); saved.push(path);
  };
  try {
    if (plan.choices.homeMode === 'new') { contextGit(home).initialize(); saved.push(home); }
    if (plan.choices.databaseMode === 'new') { initializeState(plan.binding.database, true); saved.push(plan.binding.database); }
    if (plan.legacy) { unlinkSync(pi); mkdirSync(pi, { mode: 0o700 }); saved.push(pi); }
    else if (stamp(pi).kind === 'absent') { mkdirSync(pi, { mode: 0o700 }); saved.push(pi); }
    const append = plan.appendLink ?? (plan.choices.homeMode === 'new' ? join(home, 'pi/APPEND_SYSTEM.md') : undefined);
    if (plan.choices.homeMode === 'new') {
      mkdirSync(join(home, 'pi'), { mode: 0o700 }); saved.push(join(home, 'pi'));
      createFile(join(home, 'USER-INSTRUCTIONS.md'), '# Personal instructions\n\n');
      symlinkSync('../USER-INSTRUCTIONS.md', join(home, 'pi/APPEND_SYSTEM.md')); saved.push(join(home, 'pi/APPEND_SYSTEM.md'));
    }
    if (append && stamp(join(pi, 'APPEND_SYSTEM.md')).kind === 'absent') {
      symlinkSync(append, join(pi, 'APPEND_SYSTEM.md')); saved.push(join(pi, 'APPEND_SYSTEM.md'));
    }
    if (plan.mcpLink && stamp(join(pi, 'mcp.json')).kind === 'absent') {
      symlinkSync(plan.mcpLink, join(pi, 'mcp.json')); saved.push(join(pi, 'mcp.json'));
    }
    const settingsPath = join(pi, 'settings.json');
    if (stamp(settingsPath).kind === 'absent') createFile(settingsPath, plan.settings);
    else if (readFileSync(settingsPath, 'utf8') !== plan.settings) {
      const next = settingsPath + '.mypi-next'; createFile(next, plan.settings); renameSync(next, settingsPath); saved.push(settingsPath);
    }
    const provenance = join(pi, '.mypi-setup.json');
    const record = JSON.stringify({ version: 1, settingsHash: createHash('sha256').update(plan.settings).digest('hex'),
      homeSettingsHash: createHash('sha256').update(plan.sourceSettings).digest('hex'),
      globalSources: JSON.stringify(plan.knownGlobalSources), localSettingsInput: plan.localSettingsInput,
      sourcesHash: plan.sourcesHash }) + '\n';
    if (stamp(provenance).kind === 'absent') createFile(provenance, record);
    else if (readFileSync(provenance, 'utf8') !== record) {
      const next = provenance + '.mypi-next'; createFile(next, record); renameSync(next, provenance); saved.push(provenance);
    }
    const bindingPath = join(plan.engineRoot, '.mypi-local.json');
    if (!plan.existingBinding) { createFile(bindingPath, JSON.stringify(plan.binding, null, 2) + '\n'); }
    return saved;
  } catch (error) {
    throw new Error(`Setup stopped: ${String(error)}. Saved: ${saved.join(', ') || 'nothing'}. Inspect partial effects before retrying; nothing was rolled back.`);
  }
}
