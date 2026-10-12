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
import { initialWizard, advance, back, move, setHome, setStorage, editFromPreview, returnFromEdit } from './bootstrap-model.js';
import type { Wizard } from './bootstrap-model.js';
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
const agentSettingsPath = join(process.env['PI_CODING_AGENT_DIR'] || join(userHome, '.pi', 'agent'), 'settings.json');
function selected(w: Wizard): SetupChoices {
  const a = w.answers;
  if (!a.homeMode || !a.homeRoot || !a.databaseMode || !a.database || !a.stateRoot) throw new Error('Заполните все пути до просмотра');
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
    try {
      const choices = selected(next);
      if (next.cloned) { choices.homeMode = 'existing'; choices.homeRoot = next.cloned; delete choices.remote; }
      choices.refreshProjection = refreshChoice;
      const p = planInstallation(root, choices); setPlan(p); setProblem(undefined);
      setW({ ...next, screen: 'preview', selection: 0, editing: false });
    } catch (error) { setPlan(undefined); setProblem(setupProblem(error)); setW({ ...next, screen: 'preview', selection: 0 }); }
  };
  const acceptPath = (field: PathField, input: string) => {
    let value: string;
    try { value = field === 'remote' && !input.startsWith('/') && !input.startsWith('~') && !input.startsWith('.') ? input : normalizeSetupPath(input, root, userHome); }
    catch (error) { setProblem(setupProblem(error)); return; }
    if (field === 'remote' && !value) { setProblem({ code: 'invalid-path', field, message: 'Укажите Git URL или локальный репозиторий', actions: ['change'] }); return; }
    const next = { ...w, answers: { ...w.answers, [field]: value } };
    if (field !== 'remote') {
      const issue = validateSetupChoice(root, next.answers);
      if (issue) { setProblem(issue); return; }
    }
    setProblem(undefined); setPicker(undefined); setEditor(undefined); setEditingField(undefined);
    const advanced = nextAfterPath(next, field);
    if (advanced.screen === 'preview') preview(advanced); else setW(advanced);
  };
  const quit = () => finish(applyAttempt.current ? `Применение было начато; проверьте реальные пути home ${w.answers.homeRoot}, БД ${w.answers.database}, runtime ${w.answers.stateRoot}, .pi и привязку. Частичный результат не откатан.` : w.cloned ? `Отменено. Клонированный home остаётся: ${w.cloned}. БД и привязка не созданы.` :
    cloneAttempt.current ? `Операция клонирования была начата; проверьте ${w.answers.homeRoot}. Повтор без проверки небезопасен.` : 'Отменено до записи настройки.');
  const menu = (() => {
    switch (w.screen) {
      case 'start': return observation.status === 'configured' ? ['Уже настроено — показать текущие пути', 'Подготовить обновлённый обзор', 'Проверить настройку заново', 'Отмена'] : ['Продолжить настройку', 'Отмена'];
      case 'homeMode': return ['Создать новый home в ./home [рекомендуется]', 'Выбрать существующий Git home', 'Клонировать home из Git', 'Назад', 'Отмена'];
      case 'homeRoot': return [`Использовать предложенный путь: ${w.answers.homeRoot || defaults.homeRoot}`, 'Выбрать папку…', 'Ввести путь…', 'Назад', 'Отмена'];
      case 'remote': return ['Ввести Git URL / путь', 'Выбрать локальный репозиторий…', 'Назад'];
      case 'cloneConsent': return ['Назад — ничего не клонировать', `Клонировать только home: ${w.answers.homeRoot}`, 'Отмена'];
      case 'storage': return [`Новая БД и рекомендуемый runtime: ${defaults.database || 'требуется выбрать путь'}`, 'Выбрать существующую БД', 'Настроить пути отдельно', 'Назад', 'Отмена'];
      case 'database': return [`Использовать путь: ${w.answers.database || defaults.database || 'не задан'}`, 'Выбрать файл или новую папку…', 'Ввести путь…', 'Назад'];
      case 'stateRoot': return [`Использовать путь: ${w.answers.stateRoot || defaults.stateRoot || 'не задан'}`, 'Выбрать папку…', 'Ввести путь…', 'Назад'];
      case 'preview': return ['Назад', 'Изменить home', 'Изменить БД', 'Изменить runtime', 'Подробности ресурсов и всех путей', 'Подготовить обновлённый обзор', 'Продолжить к подтверждению', 'Отмена'];
      case 'applyConsent': return ['Назад — не применять', 'Применить настройку', 'Отмена'];
      case 'done': return ['Готово'];
    }
  })();
  const [details, setDetails] = useState(false);
  const [detailIndex, setDetailIndex] = useState(0);
  const [horizontal, setHorizontal] = useState(0);
  useInput((input, key) => {
    if (pending) { if (pending === 'clone' && (key.escape || key.ctrl && input === 'c')) { controller.current?.abort(); setProblem({ code: 'clone-uncertain', field: 'homeRoot', message: 'Запрошена остановка. Ожидаем Git; проверьте папку после результата.', actions: ['inspect'] }); } return; }
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
          if (entry?.kind === 'file' || entry?.targetKind === 'file') { if (picker.kind === 'file' || editingField === 'remote') acceptPath(editingField!, entry.path); else setProblem({ code: 'invalid-path', message: 'Требуется папка, не файл', actions: ['change'] }); }
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
          if (entries.nextOffset !== undefined) setProblem({ code: 'invalid-path', message: 'Больше 200 совпадений; уточните начало имени для Tab или используйте фильтр выбора папки.', actions: ['change'] });
          if (entries.error) setProblem({ code: 'invalid-path', message: entries.error, actions: ['change'] });
        } catch (error) { setProblem(setupProblem(error)); }
        return;
      }
      const action = key.leftArrow ? 'left' : key.rightArrow ? 'right' : key.backspace ? 'backspace' : key.delete ? 'delete' : undefined;
      if (action) { setEditor(editKey(editor, action)); setCompletions([]); return; }
      if (!key.ctrl && !key.meta && input) { setEditor(insert(editor, input)); setCompletions([]); }
      return;
    }
    if (key.escape) { if (w.screen === 'start') quit(); else { setW(back(w)); setProblem(undefined); } return; }
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
    if (index === menu.indexOf('Отмена')) { quit(); return; }
    if (index === menu.indexOf('Назад') || menu[index]?.startsWith('Назад')) { setW(back(w)); return; }
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
      if (cloneAttempt.current && problem?.code !== 'clone-aborted') { setProblem({ code: 'clone-uncertain', field: 'homeRoot', message: `Проверьте результат clone в ${w.answers.homeRoot}; повтор не разрешён в этом сеансе.`, actions: ['inspect'] }); return; }
      try {
        const clone = planHomeClone(root, w.answers.homeRoot!, w.answers.remote!);
        controller.current = new AbortController(); cloneAttempt.current = true; setPending('clone'); setProblem(undefined);
        void applyHomeClone(clone, controller.current.signal).then(destination => {
          setW(current => { const { remote: _remote, ...answers } = current.answers; void _remote;
            return advance({ ...current, cloned: destination, answers: { ...answers, homeMode: 'existing', homeRoot: destination } }, 'storage'); });
        }).catch(error => setProblem(setupProblem(error))).finally(() => setPending(undefined));
      } catch (error) { setProblem(setupProblem(error)); }
      return;
    }
    if (w.screen === 'storage') {
      if (index > 2) return;
      const storage = (['recommended', 'existing', 'custom'] as const)[index];
      if (!storage) return;
      const next = setStorage(w, storage, defaults);
      if (storage === 'recommended' && !defaults.database) { setProblem({ code: 'invalid-path', field: 'stateRoot', message: defaults.problem?.message || 'Выберите путь БД и runtime вручную', actions: ['change'] }); setW(advance(next, 'database')); }
      else if (storage === 'recommended') preview(advance(next, 'preview'));
      else setW(advance(next, 'database'));
      return;
    }
    if (w.screen === 'preview') {
      if (index >= 1 && index <= 3) {
        if (index === 1 && w.cloned) { setProblem({ code: 'local-conflict', field: 'homeRoot', message: `Clone уже сохранён: ${w.cloned}. Завершите сценарий; для другого home начните новый.`, actions: ['inspect'] }); return; }
        setW(editFromPreview(w, (['homeRoot', 'database', 'stateRoot'] as const)[index - 1]!)); return; }
      if (index === 4) { setDetails(!details); setDetailIndex(0); setHorizontal(0); return; }
      if (index === 5) { setRefresh(true); preview(w, true); return; }
      if (index === 6 && plan && !applyAttempt.current) { setW(advance(w, 'applyConsent')); return; }
    }
    if (w.screen === 'applyConsent' && index === 1 && plan) {
      if (applyAttempt.current) { setProblem({ code: 'stale', message: 'После попытки записи проверьте реальные пути перед новым запуском.', actions: ['inspect'] }); return; }
      applyAttempt.current = true; setPending('apply');
      try { const saved = applyInstallation(plan); finish(saved.length ? `Настройка готова. Создано/изменено: ${saved.join(', ')}. Запустите mise exec -- pi. Проекты не зарегистрированы; Git commit/push и глобальные настройки Pi не менялись.` : 'Уже настроено; файлов не изменяли. Запустите mise exec -- pi.'); }
      catch (error) { setProblem(setupProblem(error)); setW({ ...w, screen: 'preview', selection: 0 }); }
      finally { setPending(undefined); }
    }
  });
  const width = stdout.columns || 80, height = stdout.rows || 24;
  const detailList = plan ? [
    `Home (${plan.choices.homeMode}): ${plan.binding.homeRoot}`,
    `БД (${plan.choices.databaseMode}): ${plan.binding.database}`,
    `Runtime: ${plan.binding.stateRoot}`,
    `Git origin: ${plan.remote || 'не указан'}`,
    `Пакет: ${join(root, 'integrations/pi')}`,
    `Глобальные источники: ${plan.knownGlobalSources.join(', ') || 'нет'}`,
    `Настройки Pi: ${plan.agentSettingsPath || 'нет'}`,
    `Общие настройки home (не меняются): ${join(plan.binding.homeRoot, 'pi/settings.json')}`,
    ...plan.changes.map(change => 'Будет изменено: ' + change),
    ...plan.warnings.map(warning => 'Предупреждение: ' + warning)] : [];
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
    h(Text, { bold: true }, `mypi — Настройка / ${picker ? 'Выбор пути' : w.screen}`),
    h(Text, null, safe(`Checkout: ${root}`)),
    h(Text, null, safe(picker ? `Текущая папка: ${picker.path}` : w.screen === 'start' ? `Состояние: ${observation.status}` :
      w.screen === 'storage' ? 'БД хранит данные; runtime — служебные файлы. Авторизация Pi не меняется.' :
      w.screen === 'cloneConsent' ? 'Только clone home; БД и привязка пока не создаются.' : 'Выберите действие; пока ничего не создаём.')),
    w.screen === 'cloneConsent' ? h(Text, null, `Git источник [←→ ${horizontal}]: ${segment(w.answers.remote || '')}`) : null,
    picker ? h(Text, null, `Фильтр: ${picker.query || '(все)'} · ${picker.page.total} элементов · страница ${picker.offset + 1}–${Math.min(picker.offset + 40, picker.page.total)}`) : null,
    editor ? h(Text, null, `Путь/адрес [курсор ${editor.cursor}/${Array.from(editor.text).length}]: ${displayEditor({ text: Array.from(editor.text).slice(Math.max(0, editor.cursor - Math.max(8, width - 48)), editor.cursor + 8).join(''), cursor: Math.min(editor.cursor, Math.max(8, width - 48)) })}`) : null,
    ...(!editor ? lines.map((item, i) => h(Text, { key: begin + i, bold: begin + i === focus }, `${begin + i === focus ? '›' : ' '} ${safe(item.label)}`)) : []),
    !editor ? h(Text, null, `Выбрано ${focus + 1}/${items.length} [←→ ${horizontal}]: ${segment(focusedPath)}`) : null,
    completions.length ? h(Text, null, `Совпадение ${completionIndex + 1}/${completions.length} [↑↓, Enter]: ${safe(completions[completionIndex] || '')}`) : null,
    (w.screen === 'preview' || w.screen === 'applyConsent') && plan ? h(Box, { flexDirection: 'column' },
      h(Text, null, safe(`Пути и изменения: ${detailList.length}; предупреждений: ${plan.warnings.length}. PgUp/PgDn листать.`)),
      h(Text, null, details ? `Подробность ${detailIndex + 1}/${detailList.length}: ${segment(detailList[detailIndex] || '')}` :
        safe(`Home ${plan.binding.homeRoot}; БД ${plan.binding.database}; runtime ${plan.binding.stateRoot}`))) : null,
    problem ? h(Text, { color: 'red' }, `Ошибка [←→ ${horizontal}]: ${segment(`${problem.field || 'Настройка'}: ${problem.message} · ${problem.actions.join(', ')}`)}`) : null,
    pending ? h(Text, null, safe(pending === 'clone' ? `Git clone выполняется: ${w.answers.homeRoot}. Esc/Ctrl+C — запросить остановку; дождитесь результата.` : 'Применяем настройку; отмена не откатывает уже выполненные действия.')) : null,
    h(Text, { dimColor: true }, editor ? '←→ курсор · Home/End · Tab · Enter принять · Esc назад' :
      picker ? '↑↓ выбор · Enter открыть · Esc назад · ←→ путь' : '↑↓ выбор · Enter · Esc назад · Ctrl+C отмена · ←→ путь'));
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
