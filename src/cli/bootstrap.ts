#!/usr/bin/env node
import { createElement as h, useEffect, useRef, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdin, useStdout } from 'ink';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { planInstallation, applyInstallation, planHomeClone, applyHomeClone } from '../app/setup-installation.js';
import type { SetupChoices, InstallationPlan } from '../app/setup-installation.js';
import { observeSetup, browseSetupDirectory, validateSetupChoice, setupProblem } from '../app/setup-observation.js';
import type { SetupProblem } from '../app/setup-observation.js';
import { normalizeSetupPath, suggestSetupPaths } from '../app/setup-paths.js';
import { initialWizard, advance, back, move, setHome, setStorage, editFromPreview, returnFromEdit, afterHomeClone, clonedHomeMatchesSelection } from './bootstrap-model.js';
import type { Screen, Wizard } from './bootstrap-model.js';
import { insert, editKey, complete as completePath, displayEditor } from './bootstrap-editor.js';
import type { Editor } from './bootstrap-editor.js';
import { pickerItems, entryIsDirectory } from './bootstrap-picker.js';
import type { Picker, PickerKind } from './bootstrap-picker.js';
import { shiftViewport, visibleSegment } from './bootstrap-viewport.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const userHome = homedir();
const observation = observeSetup(root);
const defaults = suggestSetupPaths(observation.engineRoot, userHome, process.env['XDG_STATE_HOME']);
type PathField = 'homeRoot' | 'database' | 'stateRoot' | 'remote';
const screenLabels: Record<Screen, string> = {
  start: 'Start', homeMode: 'Home source', homeRoot: 'Home path', remote: 'Git source',
  cloneConsent: 'Confirm clone', storage: 'Storage', database: 'Database path',
  stateRoot: 'Runtime path', preview: 'Preview', applyConsent: 'Confirm setup', done: 'Done',
};
const agentSettingsPath = join(process.env['PI_CODING_AGENT_DIR'] || join(userHome, '.pi', 'agent'), 'settings.json');
function selected(w: Wizard): SetupChoices {
  const a = w.answers;
  if (!a.homeMode || !a.homeRoot || !a.databaseMode || !a.database || !a.stateRoot) throw new Error('Select all paths before preview');
  return { homeMode: a.homeMode, homeRoot: a.homeRoot, databaseMode: a.databaseMode,
    database: a.database, stateRoot: a.stateRoot, ...(a.homeMode === 'clone' && !w.cloned ? { remote: a.remote } : {}),
    agentSettingsPath };
}
function Bootstrap({ complete }: { complete: (message: string) => void }) {
  const { exit } = useApp(), { stdout } = useStdout(), { internal_eventEmitter } = useStdin();
  const [w, setW] = useState(() => initialWizard(observation.binding));
  const [problem, setProblem] = useState<SetupProblem | undefined>(observation.problem);
  const [plan, setPlan] = useState<InstallationPlan>();
  const [refresh, setRefresh] = useState(false);
  const [picker, setPicker] = useState<Picker>();
  const [editor, setEditor] = useState<Editor>();
  const [editingField, setEditingField] = useState<PathField>();
  useEffect(() => {
    if (!editingField) return;
    // Ink strips Home/End sequences from useInput's input and exposes no key flags for them.
    const onRaw = (data: string | Buffer) => {
      const sequence = String(data);
      if (['\u001b[H', '\u001bOH', '\u001b[1~', '\u001b[7~'].includes(sequence)) setEditor(value => value ? editKey(value, 'home') : value);
      if (['\u001b[F', '\u001bOF', '\u001b[4~', '\u001b[8~'].includes(sequence)) setEditor(value => value ? editKey(value, 'end') : value);
    };
    internal_eventEmitter.on('input', onRaw);
    return () => { internal_eventEmitter.off('input', onRaw); };
  }, [editingField, internal_eventEmitter]);
  const [completions, setCompletions] = useState<string[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [pending, setPending] = useState<'clone' | 'apply'>();
  const controller = useRef<AbortController | undefined>(undefined);
  const cloneAttempt = useRef(false);
  const applyAttempt = useRef(false);
  const finish = (message: string) => { complete(message); exit(); };
  const beginEdit = (field: PathField, value = '') => { setEditingField(field); setEditor({ text: value, cursor: Array.from(value).length }); setCompletions([]); setCompletionIndex(0); setProblem(undefined); };
  const browse = (field: PathField, kind: PickerKind) => {
    const path = field === 'remote' ? root : dirname(w.answers[field] || (field === 'homeRoot' ? defaults.homeRoot : defaults.database || root));
    const page = browseSetupDirectory(path, '', 0, 40);
    setEditingField(field); setPicker({ path, kind, page, query: '', offset: 0, selection: 0 }); setProblem(page.error ? { code: 'invalid-path', field: field === 'remote' ? 'remote' : field, message: page.error, actions: ['change'] } : undefined);
  };
  const updatePicker = (path: string, query = '', offset = 0) => {
    const page = browseSetupDirectory(path, query, offset, 40);
    setPicker(p => p ? { ...p, path: page.error ? p.path : page.path, query, offset, selection: 0, page } : p);
    setProblem(page.error ? { code: 'invalid-path', message: page.error, actions: ['change'] } : undefined);
  };
  const nextAfterPath = (v: Wizard, field: PathField): Wizard => {
    if (v.editing) return returnFromEdit(v);
    if (field === 'homeRoot') return advance(v, v.answers.homeMode === 'clone' ? 'remote' : 'storage');
    if (field === 'remote') return advance(v, 'cloneConsent');
    if (field === 'database') return advance(v, v.storage === 'custom' ? 'stateRoot' : 'preview');
    return advance(v, 'preview');
  };
  const preview = (next: Wizard, refreshChoice = refresh) => {
    if (!clonedHomeMatchesSelection(next)) {
      setPlan(undefined);
      setProblem({ code: 'local-conflict', field: 'homeRoot', message: `Selected home differs from the cloned home at ${next.cloned}. Inspect the clone; restart to choose another home.`, actions: ['inspect'] });
      setW({ ...next, screen: 'preview', selection: 0 });
      return;
    }
    try {
      const choices = selected(next);
      choices.refreshProjection = refreshChoice;
      const p = planInstallation(root, choices); setPlan(p); setProblem(undefined);
      setW({ ...next, screen: 'preview', selection: 0, editing: false });
    } catch (error) { setPlan(undefined); setProblem(setupProblem(error)); setW({ ...next, screen: 'preview', selection: 0 }); }
  };
  const acceptPath = (field: PathField, input: string) => {
    let value: string;
    try { value = field === 'remote' && !input.startsWith('/') && !input.startsWith('~') && !input.startsWith('.') ? input : normalizeSetupPath(input, root, userHome); }
    catch (error) { setProblem(setupProblem(error)); return; }
    if (field === 'remote' && !value) { setProblem({ code: 'invalid-path', field, message: 'Enter a Git URL or local repository path', actions: ['change'] }); return; }
    const next = { ...w, answers: { ...w.answers, [field]: value } };
    if (field !== 'remote') {
      const issue = validateSetupChoice(root, next.answers);
      if (issue) { setProblem(issue); return; }
    }
    setProblem(undefined); setPicker(undefined); setEditor(undefined); setEditingField(undefined);
    const advanced = nextAfterPath(next, field);
    if (advanced.screen === 'preview') preview(advanced); else setW(advanced);
  };
  const goBack = () => {
    if (w.cloned && w.screen === 'storage') {
      setProblem({ code: 'local-conflict', field: 'homeRoot', message: `Home was cloned to ${w.cloned}. Change the database/runtime paths or cancel; restart to choose another home. The clone will remain.`, actions: ['inspect'] });
      return;
    }
    setW(back(w)); setProblem(undefined);
  };
  const quit = () => finish(applyAttempt.current ? `Setup started; inspect home ${w.answers.homeRoot}, database ${w.answers.database}, runtime ${w.answers.stateRoot}, .pi and the binding. Partial changes were not rolled back.` : w.cloned ? `Cancelled. Cloned home remains at ${w.cloned}. Database and binding were not created.` :
    cloneAttempt.current ? `Clone started; inspect ${w.answers.homeRoot}. Do not retry without checking.` : 'Cancelled before writing setup.');
  const menu = (() => {
    switch (w.screen) {
      case 'start': return observation.status === 'configured' ? ['Already configured — show current paths', 'Prepare refreshed preview', 'Review setup again', 'Cancel'] : ['Continue setup', 'Cancel'];
      case 'homeMode': return ['Create new home in ./home [recommended]', 'Select existing Git home', 'Clone home from Git', 'Back', 'Cancel'];
      case 'homeRoot': return [`Use suggested path: ${w.answers.homeRoot || defaults.homeRoot}`, 'Browse directories…', 'Enter path…', 'Back', 'Cancel'];
      case 'remote': return ['Enter Git URL / path', 'Browse local repositories…', 'Back'];
      case 'cloneConsent': return ['Back — do not clone', `Clone home only: ${w.answers.homeRoot}`, 'Cancel'];
      case 'storage': return [`New database and recommended runtime: ${defaults.database || 'choose a path'}`, 'Select existing database', 'Set paths separately', w.cloned ? 'Back (home cloned; restart to change it)' : 'Back', 'Cancel'];
      case 'database': return [`Use path: ${w.answers.database || defaults.database || 'not set'}`, 'Browse files or new directories…', 'Enter path…', 'Back'];
      case 'stateRoot': return [`Use path: ${w.answers.stateRoot || defaults.stateRoot || 'not set'}`, 'Browse directories…', 'Enter path…', 'Back'];
      case 'preview': return ['Back', 'Change home', 'Change database', 'Change runtime', 'Show resource and path details', 'Prepare refreshed preview', 'Continue to confirmation', 'Cancel'];
      case 'applyConsent': return ['Back — do not apply', 'Apply setup', 'Cancel'];
      case 'done': return ['Done'];
    }
  })();
  const [details, setDetails] = useState(false);
  const [detailIndex, setDetailIndex] = useState(0);
  const [horizontal, setHorizontal] = useState(0);
  useInput((input, key) => {
    if (pending) { if (pending === 'clone' && (key.escape || key.ctrl && input === 'c')) { controller.current?.abort(); setProblem({ code: 'clone-uncertain', field: 'homeRoot', message: 'Stop requested. Waiting for Git; inspect the directory afterward.', actions: ['inspect'] }); } return; }
    if (key.ctrl && input === 'c') { quit(); return; }
    if (picker) {
      if (key.escape) { setPicker(undefined); return; }
      if (key.leftArrow || key.rightArrow) { setHorizontal(n => shiftViewport(n, key.rightArrow ? 1 : -1, stdout.columns || 80)); return; }
      if (key.upArrow || key.downArrow) { setHorizontal(0); setPicker(p => p ? { ...p, selection: Math.max(0, Math.min(pickerItems(p, userHome, root).length - 1, p.selection + (key.upArrow ? -1 : 1))) } : p); return; }
      if (key.backspace || key.delete) { updatePicker(picker.path, picker.query.slice(0, -1)); return; }
      if (key.return) {
        const item = pickerItems(picker, userHome, root)[picker.selection];
        if (!item) return;
        if (item.action === 'back') { setPicker(undefined); return; }
        if (item.action === 'previous' || item.action === 'next') { updatePicker(picker.path, picker.query, item.action === 'previous' ? Math.max(0, picker.offset - 40) : picker.page.nextOffset ?? 0); return; }
        if (item.action === 'manual' || item.action === 'child') { const value = item.action === 'child' ? picker.path + '/' : ''; setPicker(undefined); beginEdit(editingField!, value); return; }
        if (item.action === 'use') { if (picker.kind !== 'file') acceptPath(editingField!, picker.path); return; }
        if (item.action === 'entry') {
          const entry = picker.page.entries.find(e => e.path === item.path);
          if (entry?.error) { setProblem({ code: 'invalid-path', message: entry.error, actions: ['change'] }); return; }
          if (entry && entryIsDirectory(entry)) { updatePicker(entry.path); return; }
          if (entry?.kind === 'file' || entry?.targetKind === 'file') { if (picker.kind === 'file' || editingField === 'remote') acceptPath(editingField!, entry.path); else setProblem({ code: 'invalid-path', message: 'Select a directory, not a file', actions: ['change'] }); }
          return;
        }
        if (item.path) updatePicker(item.path);
        return;
      }
      if (input && !key.ctrl && !key.meta) updatePicker(picker.path, picker.query + input);
      return;
    }
    if (editor && editingField) {
      if (key.escape) { if (completions.length) { setCompletions([]); return; } setEditor(undefined); setEditingField(undefined); return; }
      if (completions.length && (key.upArrow || key.downArrow)) { setCompletionIndex(i => (i + (key.upArrow ? -1 : 1) + completions.length) % completions.length); return; }
      if (key.return && completions.length) {
        const name = completions[completionIndex];
        if (name) { setEditor(completePath(editor, [name]).editor); setCompletions([]); setCompletionIndex(0); }
        return;
      }
      if (key.return) { acceptPath(editingField, editor.text.trim() || (editingField === 'homeRoot' ? w.answers.homeRoot || defaults.homeRoot : editingField === 'database' ? w.answers.database || defaults.database || '' : editingField === 'stateRoot' ? w.answers.stateRoot || defaults.stateRoot || '' : '')); return; }
      if (key.tab && editingField !== 'remote') {
        try { const path = normalizeSetupPath(editor.text.slice(0, Array.from(editor.text).slice(0, editor.cursor).join('').lastIndexOf('/') + 1) || '.', root, userHome);
          const before = Array.from(editor.text).slice(0, editor.cursor).join('');
          const prefix = before.slice(before.lastIndexOf('/') + 1);
          const entries = browseSetupDirectory(path, prefix, 0, 200);
          const result = completePath(editor, entries.entries.map(e => e.name));
          if (entries.nextOffset === undefined) setEditor(result.editor);
          setCompletions(entries.nextOffset !== undefined ? [] : result.matches.length > 1 ? result.matches : []);
          setCompletionIndex(0);
          if (entries.nextOffset !== undefined) setProblem({ code: 'invalid-path', message: 'More than 200 matches; refine the prefix for Tab or use the directory picker filter.', actions: ['change'] });
          if (entries.error) setProblem({ code: 'invalid-path', message: entries.error, actions: ['change'] });
        } catch (error) { setProblem(setupProblem(error)); }
        return;
      }
      const action = key.leftArrow ? 'left' : key.rightArrow ? 'right' : key.backspace ? 'backspace' : key.delete ? 'delete' : undefined;
      if (action) { setEditor(editKey(editor, action)); setCompletions([]); return; }
      if (!key.ctrl && !key.meta && input) { setEditor(insert(editor, input)); setCompletions([]); }
      return;
    }
    if (key.escape) { if (w.screen === 'start') quit(); else goBack(); return; }
    if (key.upArrow || key.downArrow) { setHorizontal(0); setW(move(w, key.upArrow ? -1 : 1, menu.length)); return; }
    if (key.leftArrow || key.rightArrow) { setHorizontal(n => shiftViewport(n, key.rightArrow ? 1 : -1, stdout.columns || 80)); return; }
    if (details && (key.pageUp || key.pageDown)) { setDetailIndex(n => Math.max(0, Math.min(detailList.length - 1, n + (key.pageDown ? 1 : -1)))); setHorizontal(0); return; }
    if (!key.return) return;
    const index = w.selection;
    if (w.screen === 'start') {
      if (index === menu.length - 1) { quit(); return; }
      if (observation.status === 'configured' && index < 2) { setRefresh(index === 1); preview(w, index === 1); return; }
      setW(advance(w, 'homeMode')); return;
    }
    if (index === menu.indexOf('Cancel')) { quit(); return; }
    if (index === menu.indexOf('Back') || menu[index]?.startsWith('Back')) { goBack(); return; }
    if (w.screen === 'homeMode') {
      const mode = (['new', 'existing', 'clone'] as const)[index];
      if (mode) { const candidate = mode === 'existing' ? observation.homeCandidates.find(c => c.kind === 'eligible')?.path : undefined;
        setW(advance(setHome(w, mode, candidate || (mode === 'existing' ? undefined : defaults.homeRoot)), 'homeRoot')); } return;
    }
    if (w.screen === 'homeRoot' || w.screen === 'database' || w.screen === 'stateRoot') {
      const field = w.screen;
      if (index === 0) acceptPath(field, w.answers[field] || (field === 'homeRoot' ? defaults.homeRoot : field === 'database' ? defaults.database || '' : defaults.stateRoot || ''));
      if (index === 1) browse(field, field === 'database' ? (w.answers.databaseMode === 'existing' ? 'file' : 'future-file') : field === 'homeRoot' && w.answers.homeMode === 'existing' ? 'directory' : 'future-directory');
      if (index === 2) beginEdit(field, w.answers[field] || '');
      return;
    }
    if (w.screen === 'remote') { if (index === 0) beginEdit('remote', w.answers.remote || ''); else if (index === 1) browse('remote', 'directory'); return; }
    if (w.screen === 'cloneConsent') {
      if (index !== 1) return;
      if (cloneAttempt.current && problem?.code !== 'clone-aborted') { setProblem({ code: 'clone-uncertain', field: 'homeRoot', message: `Inspect clone at ${w.answers.homeRoot}; retry is not allowed in this session.`, actions: ['inspect'] }); return; }
      try {
        const clone = planHomeClone(root, w.answers.homeRoot!, w.answers.remote!);
        controller.current = new AbortController(); cloneAttempt.current = true; setPending('clone'); setProblem(undefined);
        void applyHomeClone(clone, controller.current.signal).then(destination => {
          setW(current => afterHomeClone(current, destination));
        }).catch(error => setProblem(setupProblem(error))).finally(() => setPending(undefined));
      } catch (error) { setProblem(setupProblem(error)); }
      return;
    }
    if (w.screen === 'storage') {
      if (index > 2) return;
      const storage = (['recommended', 'existing', 'custom'] as const)[index];
      if (!storage) return;
      const next = setStorage(w, storage, defaults);
      if (storage === 'recommended' && !defaults.database) { setProblem({ code: 'invalid-path', field: 'stateRoot', message: defaults.problem?.message || 'Choose database and runtime paths manually', actions: ['change'] }); setW(advance(next, 'database')); }
      else if (storage === 'recommended') preview(advance(next, 'preview'));
      else setW(advance(next, 'database'));
      return;
    }
    if (w.screen === 'preview') {
      if (index >= 1 && index <= 3) {
        if (index === 1 && w.cloned) { setProblem({ code: 'local-conflict', field: 'homeRoot', message: `Clone remains at ${w.cloned}. Finish setup; restart to choose another home.`, actions: ['inspect'] }); return; }
        setW(editFromPreview(w, (['homeRoot', 'database', 'stateRoot'] as const)[index - 1]!)); return; }
      if (index === 4) { setDetails(!details); setDetailIndex(0); setHorizontal(0); return; }
      if (index === 5) { setRefresh(true); preview(w, true); return; }
      if (index === 6 && plan && !applyAttempt.current) { setW(advance(w, 'applyConsent')); return; }
    }
    if (w.screen === 'applyConsent' && index === 1 && plan) {
      if (applyAttempt.current) { setProblem({ code: 'stale', message: 'After a write attempt, inspect the actual paths before restarting.', actions: ['inspect'] }); return; }
      applyAttempt.current = true; setPending('apply');
      try { const saved = applyInstallation(plan); finish(saved.length ? `Setup complete. Created/changed: ${saved.join(', ')}. Run mise exec -- pi. No projects were registered; Git commit/push and global Pi settings were unchanged.` : 'Already configured; no files changed. Run mise exec -- pi.'); }
      catch (error) { setProblem(setupProblem(error)); setW({ ...w, screen: 'preview', selection: 0 }); }
      finally { setPending(undefined); }
    }
  });
  const width = stdout.columns || 80, height = stdout.rows || 24;
  const detailList = plan ? [
    `Home (${plan.choices.homeMode}): ${plan.binding.homeRoot}`,
    `Database (${plan.choices.databaseMode}): ${plan.binding.database}`,
    `Runtime: ${plan.binding.stateRoot}`,
    `Git origin: ${plan.remote || 'not specified'}`,
    `Package: ${join(root, 'integrations/pi')}`,
    `Global sources: ${plan.knownGlobalSources.join(', ') || 'none'}`,
    `Pi settings: ${plan.agentSettingsPath || 'none'}`,
    `Shared home settings (unchanged): ${join(plan.binding.homeRoot, 'pi/settings.json')}`,
    ...plan.changes.map(change => 'Will change: ' + change),
    ...plan.warnings.map(warning => 'Warning: ' + warning)] : [];
  const items = picker ? pickerItems(picker, userHome, root) : menu.map(label => ({ label }));
  const focus = picker ? picker.selection : w.selection;
  const windowSize = Math.max(3, Math.min(7, height - 13));
  const begin = Math.max(0, Math.min(focus - Math.floor(windowSize / 2), items.length - windowSize));
  const lines = items.slice(begin, begin + windowSize);
  const safe = (text: string) => text.length > width - 3 ? text.slice(0, Math.max(4, width - 5)) + '…' : text;
  const focused = items[focus]?.label || '';
  const focusedPath = picker ? pickerItems(picker, userHome, root)[focus]?.path || focused : focused;
  const segment = (text: string) => visibleSegment(text, horizontal, width);
  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true }, `mypi — Setup / ${picker ? 'Path picker' : screenLabels[w.screen]}`),
    h(Text, null, safe(`Checkout: ${root}`)),
    h(Text, null, safe(picker ? `Current directory: ${picker.path}` : w.screen === 'start' ? `Status: ${observation.status}` :
      w.screen === 'storage' ? w.cloned ? 'Home cloned; choose database/runtime next. Cancel leaves the clone.' : 'The database stores data; runtime holds support files. Pi authorization is unchanged.' :
      w.screen === 'cloneConsent' ? 'Clone home only; database and binding are not created yet.' : 'Choose an action; review changes before confirming.')),
    w.screen === 'cloneConsent' ? h(Text, null, `Git source [←→ ${horizontal}]: ${segment(w.answers.remote || '')}`) : null,
    picker ? h(Text, null, `Filter: ${picker.query || '(all)'} · ${picker.page.total} items · ${picker.offset + 1}–${Math.min(picker.offset + 40, picker.page.total)}`) : null,
    editor ? h(Text, null, `Path/URL [cursor ${editor.cursor}/${Array.from(editor.text).length}]: ${displayEditor({ text: Array.from(editor.text).slice(Math.max(0, editor.cursor - Math.max(8, width - 48)), editor.cursor + 8).join(''), cursor: Math.min(editor.cursor, Math.max(8, width - 48)) })}`) : null,
    ...(!editor ? lines.map((item, i) => h(Text, { key: begin + i, bold: begin + i === focus }, `${begin + i === focus ? '›' : ' '} ${safe(item.label)}`)) : []),
    !editor ? h(Text, null, `Selected ${focus + 1}/${items.length} [←→ ${horizontal}]: ${segment(focusedPath)}`) : null,
    completions.length ? h(Text, null, `Match ${completionIndex + 1}/${completions.length} [↑↓, Enter]: ${safe(completions[completionIndex] || '')}`) : null,
    (w.screen === 'preview' || w.screen === 'applyConsent') && plan ? h(Box, { flexDirection: 'column' },
      h(Text, null, safe(`Paths and changes: ${detailList.length}; warnings: ${plan.warnings.length}. PgUp/PgDn to browse.`)),
      h(Text, null, details ? `Detail ${detailIndex + 1}/${detailList.length}: ${segment(detailList[detailIndex] || '')}` :
        safe(`Home ${plan.binding.homeRoot}; database ${plan.binding.database}; runtime ${plan.binding.stateRoot}`))) : null,
    problem ? h(Text, { color: 'red' }, `Error [←→ ${horizontal}]: ${segment(`${problem.field || 'Setup'}: ${problem.message} · ${problem.actions.join(', ')}`)}`) : null,
    pending ? h(Text, null, safe(pending === 'clone' ? `Git clone in progress: ${w.answers.homeRoot}. Esc/Ctrl+C requests a stop; wait for the result.` : 'Applying setup; cancelling does not undo completed changes.')) : null,
    h(Text, { dimColor: true }, editor ? '←→ cursor · Home/End · Tab · Enter accept · Esc back' :
      picker ? '↑↓ select · Enter open · Esc back · ←→ path' : '↑↓ select · Enter · Esc back · Ctrl+C cancel · ←→ path'));
}
try {
  if (process.argv.length !== 2) throw new Error('Usage: pnpm bootstrap (interactive terminal required)');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Bootstrap needs an interactive terminal; no files changed. Run pnpm bootstrap in your terminal.');
  let result = '';
  const app = render(h(Bootstrap, { complete: message => { result = message; } }), { exitOnCtrlC: false });
  await app.waitUntilExit();
  if (result) process.stdout.write(result + '\n');
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}
