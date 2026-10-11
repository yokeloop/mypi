#!/usr/bin/env node
import { createElement as h, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';

import { planInstallation, applyInstallation, planHomeClone, applyHomeClone } from '../app/setup-installation.js';
import type { HomeClonePlan } from '../app/setup-installation.js';
import type { SetupChoices, InstallationPlan } from '../app/setup-installation.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
type Field = 'homeMode' | 'homeRoot' | 'remote' | 'databaseMode' | 'database' | 'stateRoot';
const fields: Field[] = ['homeMode', 'homeRoot', 'remote', 'databaseMode', 'database', 'stateRoot'];
function fieldAt(index: number, answers: Partial<SetupChoices>): Field | undefined {
  let pos = index;
  for (const field of fields) {
    if (field === 'remote' && answers.homeMode !== 'clone') continue;
    if (pos-- === 0) return field;
  }
}
function prompt(field: Field): string {
  switch (field) {
    case 'homeMode': return 'Home repository: new / existing / clone';
    case 'homeRoot': return 'Home destination (absolute path; clone/new require absent destination)';
    case 'remote': return 'Git remote to clone (local path or URL)';
    case 'databaseMode': return 'Database: new / existing';
    case 'database': return 'External SQLite database file (absolute path)';
    case 'stateRoot': return 'External runtime state root (absolute path)';
  }
}
function accepted(field: Field, input: string): boolean {
  return field === 'homeMode' ? ['new', 'existing', 'clone'].includes(input) : field === 'databaseMode'
    ? ['new', 'existing'].includes(input) : field === 'remote' ? !!input : isAbsolute(input) && !input.includes('\0');
}
function choices(answers: Partial<SetupChoices>): SetupChoices {
  if (!answers.homeMode || !answers.homeRoot || !answers.databaseMode || !answers.database || !answers.stateRoot) throw new Error('Complete all setup choices');
  return { homeMode: answers.homeMode, homeRoot: answers.homeRoot, databaseMode: answers.databaseMode,
    database: answers.database, stateRoot: answers.stateRoot,
    ...(answers.homeMode === 'clone' ? { remote: answers.remote } : {}),
    agentSettingsPath: join(process.env['PI_CODING_AGENT_DIR'] || join(homedir(), '.pi', 'agent'), 'settings.json') };
}
function Bootstrap({ complete }: { complete: (message: string) => void }) {
  const { exit } = useApp();
  const [answers, setAnswers] = useState<Partial<SetupChoices>>({});
  const [step, setStep] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<InstallationPlan>();
  const [phase, setPhase] = useState<'questions' | 'clone' | 'preview'>('questions');
  const [cloned, setCloned] = useState<string>();
  const [clonePlan, setClonePlan] = useState<HomeClonePlan>();
  const [attempted, setAttempted] = useState(false);
  const field = fieldAt(step, answers);
  const finish = (message: string) => { complete(message); exit(); };
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      finish(attempted ? 'Setup effects may already have occurred. Inspect paths in the reported result before retrying.'
        : cloned ? `Cancelled; cloned home remains at ${cloned}. No database or binding was created.` : 'Cancelled; no setup files changed.'); return;
    }
    if (phase === 'questions') {
      if (input.toLowerCase() === 'r' && error.includes('explicit refresh choice') && answers.stateRoot) {
        try { const selected = { ...choices(answers), refreshProjection: true };
          setPlan(planInstallation(root, selected)); setPhase('preview'); setError('Explicit refreshed projection: inspect all selected resources before approving.');
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        return;
      }
      if (!field) return;
      if (key.backspace || key.delete) { setText(value => value.slice(0, -1)); return; }
      if (key.return) {
        if (!text && step > 0) { setStep(step - 1); setError('Go back: enter a replacement value.'); return; }
        const value = text.trim();
        if (!accepted(field, value)) { setError('Invalid choice; enter an exact mode or absolute path.'); return; }
        const next = { ...answers, [field]: value };
        setAnswers(next); setText(''); setError('');
        if (field === 'stateRoot') {
          try {
            const selected = choices(next);
            if (selected.homeMode === 'clone') {
              setClonePlan(planHomeClone(root, selected.homeRoot, selected.remote!)); setPhase('clone');
            } else { setPlan(planInstallation(root, selected)); setPhase('preview'); }
          } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStep(step - 1); }
        } else setStep(step + 1);
        return;
      }
      if (!key.ctrl && !key.meta && input) setText(value => value + input);
      return;
    }
    if (attempted) { setError('Effects may already have occurred; exit and inspect actual paths before a fresh preview. No automatic retry.'); return; }
    if (input.toLowerCase() === 'b' || key.leftArrow) {
      if (phase === 'clone' || !cloned) { setPhase('questions'); setStep(0); setText(''); setError('Re-enter choices from home mode.'); }
      else setError('Clone already exists. Cancel and rerun with existing-home mode to change selection.');
      return;
    }
    if (input.toLowerCase() !== 'y') {
      if (input.toLowerCase() === 'n' || key.return) finish(attempted ? 'Setup effects may already have occurred. Inspect the reported partial paths before retrying.'
        : cloned ? `Cancelled; cloned home remains at ${cloned}. No database or binding was created.` : 'Cancelled; no setup files changed.');
      return;
    }
    try {
      if (phase === 'clone' && clonePlan) {
        setAttempted(true);
        const destination = applyHomeClone(clonePlan);
        setCloned(destination); setClonePlan(undefined); setPhase('preview');
        const selected = choices(answers);
        const existing: SetupChoices = { homeMode: 'existing', homeRoot: destination,
          databaseMode: selected.databaseMode, database: selected.database, stateRoot: selected.stateRoot,
          ...(selected.agentSettingsPath ? { agentSettingsPath: selected.agentSettingsPath } : {}) };
        setPlan(planInstallation(root, existing)); setError('Clone retained. Review actual selected-home resources before approving second stage.'); setAttempted(false);
      } else if (plan) {
        setAttempted(true);
        const saved = applyInstallation(plan);
        finish(saved.length ? `Installation ready. Saved: ${saved.join(', ')}. No Git commit/push or global Pi settings change was made.` : 'Installation already configured; nothing changed.');
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  });
  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true }, 'mypi — installation setup'),
    phase === 'questions' ? h(Text, null, `${prompt(field!)}: ${text}█ (Enter; empty Enter goes back; Esc cancels)`) :
      phase === 'clone' ? h(Text, null, `Clone ONLY ${answers.remote} into absent ${answers.homeRoot}. No DB/binding/project settings yet. Confirm clone? [y/N] (b back, Esc cancel)`) :
        h(Box, { flexDirection: 'column' },
          h(Text, null, `Engine: ${plan?.binding.engineRoot}`), h(Text, null, `Home: ${plan?.binding.homeRoot} (${plan?.remote ?? 'no origin'})`),
          h(Text, null, `Database: ${plan?.binding.database} (${plan?.choices.databaseMode})`),
          h(Text, null, `Runtime state: ${plan?.binding.stateRoot}`),
          h(Text, null, `Engine package: ${join(root, 'integrations/pi')}`),
          h(Text, null, `Pi agent settings inspected: ${plan?.agentSettingsPath ?? 'none'}`),
          h(Text, null, `Known global engine sources to shadow: ${plan?.knownGlobalSources.join(', ') || 'none'}`),
          h(Text, null, `Shared home settings: ${join(plan?.binding.homeRoot ?? '', 'pi/settings.json')} (never modified)`),
          h(Text, null, 'Project APPEND_SYSTEM overrides agent append; home mcp.json overrides package MCP.'),
          ...(plan?.warnings ?? []).map((warning, index) => h(Text, { key: index, color: 'yellow' }, warning)),
          ...(plan?.changes ?? []).map((change, index) => h(Text, { key: index }, `  ${change}`)),
          h(Text, { color: 'yellow' }, 'Apply after rechecking preview? [y/N] (b back, Esc cancel)')),
    error ? h(Text, { color: 'red' }, error.includes('explicit refresh choice') ? error + ' Press r to request an explicit refreshed preview.' : error) : null);
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
