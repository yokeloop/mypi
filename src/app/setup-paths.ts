import { createHash } from 'node:crypto';
import { basename, isAbsolute, join, resolve } from 'node:path';

/** Text is resolved against the displayed checkout, never the process cwd. */
export function normalizeSetupPath(text: string, engineRoot: string, userHome: string): string {
  if (!text || text.includes('\0')) throw new Error('Enter a path without NUL');
  if (text === '~') return resolve(userHome);
  if (text.startsWith('~/')) return resolve(userHome, text.slice(2));
  if (text.startsWith('~')) throw new Error('Only ~/ paths are supported');
  return resolve(engineRoot, text);
}

export interface SetupSuggestions {
  homeRoot: string;
  database?: string;
  stateRoot?: string;
  problem?: { code: 'invalid-xdg'; field: 'stateRoot'; message: string; actions: readonly ['choose-path'] };
}
/** engineRoot must be the canonical checkout path supplied by setup observation. */
export function suggestSetupPaths(engineRoot: string, userHome: string, xdgStateHome: string | undefined): SetupSuggestions {
  const homeRoot = join(engineRoot, 'home');
  if (xdgStateHome !== undefined && (!isAbsolute(xdgStateHome) || xdgStateHome.includes('\0'))) {
    return { homeRoot, problem: { code: 'invalid-xdg', field: 'stateRoot', message: 'XDG_STATE_HOME must be an absolute path without NUL', actions: ['choose-path'] } };
  }
  const stateBase = xdgStateHome ?? join(userHome, '.local', 'state');
  const id = `${basename(engineRoot)}-${createHash('sha256').update(engineRoot).digest('hex').slice(0, 8)}`;
  const installation = join(stateBase, 'mypi', 'installations', id);
  return { homeRoot, database: join(installation, 'state.sqlite3'), stateRoot: join(installation, 'runtime') };
}
