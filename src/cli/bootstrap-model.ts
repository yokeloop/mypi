// Pure dialogue answers: structurally compatible with application setup choices,
// without importing the effectful planning graph into fast state tests.
export interface WizardAnswers {
  homeMode: 'new' | 'existing' | 'clone';
  homeRoot: string;
  remote?: string;
  databaseMode: 'new' | 'existing';
  database: string;
  stateRoot: string;
  agentSettingsPath?: string;
  refreshProjection?: boolean;
}

export type Screen = 'start' | 'homeMode' | 'homeRoot' | 'remote' | 'cloneConsent' | 'storage' | 'database' | 'stateRoot' | 'preview' | 'applyConsent' | 'done';
export type Storage = 'recommended' | 'existing' | 'custom';
export interface Wizard {
  screen: Screen;
  answers: Partial<WizardAnswers>;
  storage: Storage;
  selection: number;
  history: Screen[];
  cloned?: string;
  editing?: boolean;
}
export function initialWizard(binding?: { homeRoot: string; database: string; stateRoot: string }): Wizard {
  return { screen: 'start', answers: binding ? { homeMode: 'existing', homeRoot: binding.homeRoot,
    databaseMode: 'existing', database: binding.database, stateRoot: binding.stateRoot } : {},
    storage: 'recommended', selection: 0, history: [] };
}
export function menuLength(screen: Screen, configured: boolean): number {
  switch (screen) {
    case 'start': return configured ? 4 : 2;
    case 'homeMode': return 5;
    case 'homeRoot': return 5;
    case 'remote': return 3;
    case 'cloneConsent': case 'applyConsent': return 3;
    case 'storage': return 5;
    case 'database': case 'stateRoot': return 4;
    case 'preview': return 8;
    case 'done': return 1;
  }
}
export function move(w: Wizard, delta: number, count: number): Wizard {
  return { ...w, selection: Math.max(0, Math.min(count - 1, w.selection + delta)) };
}
export function advance(w: Wizard, screen: Screen, selection = 0): Wizard {
  return { ...w, screen, selection, history: [...w.history, w.screen], editing: false };
}
export function back(w: Wizard): Wizard {
  if (!w.history.length) return w;
  const history = w.history.slice(), screen = history.pop()!;
  return { ...w, screen, history, selection: 0, editing: false };
}
export function setHome(w: Wizard, mode: WizardAnswers['homeMode'], path?: string): Wizard {
  const changed = mode !== w.answers.homeMode;
  const { remote: _remote, ...withoutRemote } = w.answers;
  void _remote;
  return { ...w, answers: { ...(changed ? withoutRemote : w.answers), homeMode: mode,
    ...(path && (changed || !w.answers.homeRoot) ? { homeRoot: path } : {}) }, selection: 0 };
}
export function setStorage(w: Wizard, mode: Storage, defaults: { database?: string; stateRoot?: string }): Wizard {
  const databaseMode = mode === 'existing' ? 'existing' : 'new';
  const database = mode === 'existing' ? (w.answers.databaseMode === 'existing' ? w.answers.database : undefined) :
    w.answers.databaseMode === 'new' ? w.answers.database ?? defaults.database : defaults.database;
  const { database: _database, ...rest } = w.answers;
  void _database;
  return { ...w, storage: mode, answers: { ...rest, databaseMode,
    ...(database ? { database } : {}), ...(w.answers.stateRoot ?? defaults.stateRoot ? { stateRoot: w.answers.stateRoot ?? defaults.stateRoot } : {}) }, selection: 0 };
}
export function editFromPreview(w: Wizard, screen: Screen): Wizard {
  return { ...advance(w, screen), editing: true };
}
export function returnFromEdit(w: Wizard): Wizard {
  return w.editing ? { ...w, screen: 'preview', selection: 0, editing: false, history: w.history.filter(s => s !== 'preview') } : w;
}
