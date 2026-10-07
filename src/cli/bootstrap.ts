#!/usr/bin/env node
import { createElement as h, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import { homedir } from 'node:os';
import { resolveStatePath } from '../app/create-app.js';
import { applyUserLayer, planUserLayer } from '../app/setup-user-layer.js';
import type { UserLayerPlan } from '../app/setup-user-layer.js';

function Bootstrap({ plan, onComplete }: { plan: UserLayerPlan; onComplete: (message: string) => void }) {
  const { exit } = useApp();
  const finish = (message: string) => { onComplete(message); exit(); };
  const [busy, setBusy] = useState(false);
  useInput((input, key) => {
    if (busy) return;
    if (input.toLowerCase() === 'n' || key.escape || key.return || (key.ctrl && input === 'c')) {
      finish('Cancelled; no user files changed.');
    } else if (input.toLowerCase() === 'y') {
      setBusy(true);
      try {
        const saved = applyUserLayer(plan);
        finish(saved.length ? 'User layer ready. Review and commit the changes in home/ yourself; no commit or push was made.\nStart Pi from this checkout and approve project trust. In a running session use /reload.\nDatabase created if absent; an existing file was left unchanged.'
          : 'User layer already configured; nothing changed.');
      } catch (error) { exit(error instanceof Error ? error : new Error(String(error))); }
    }
  });
  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true }, 'mypi — user layer bootstrap'),
    h(Text, null, `Workspace: ${plan.root}`),
    h(Text, null, 'Set up Pi resources and create an absent database. No global settings, network or Git commits.'),
    ...plan.changes.map(change => h(Text, { key: change.path }, `  ${change.kind}: ${relative(plan.root, change.path)}`)),
    h(Text, null, plan.initializeGit ? '  Initialize home/ as a separate Git repository on main (no remote).' : '  Preserve existing home Git.'),
    h(Text, null, `  ${plan.database.create ? 'Create database' : 'Keep existing database'}: ${plan.database.path}`),
    h(Text, { color: 'yellow' }, 'Stop other setup/storage writers before proceeding. Apply? [y/N]'));
}

try {
  if (process.argv.length !== 2) throw new Error('Usage: pnpm bootstrap (interactive terminal required)');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Bootstrap needs an interactive terminal; no files changed. Run pnpm bootstrap in your terminal.');
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const plan = planUserLayer(root, resolveStatePath(process.env, homedir()));
  let result = '';
  const app = render(h(Bootstrap, { plan, onComplete: message => { result = message; } }), { exitOnCtrlC: false });
  await app.waitUntilExit();
  if (result) process.stdout.write(result + '\n');
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}
