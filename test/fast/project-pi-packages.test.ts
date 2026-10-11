import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectProjectPiPackages } from '../../src/app/project-pi-packages.js';

test('project Pi package preflight refuses active known competing engine but retains inert/shadowed package resources', () => {
  const root = mkdtempSync(join(tmpdir(), 'mypi-project-package-'));
  try {
    const old = join(root, 'old'), agent = join(root, 'agent'), project = join(root, 'project');
    for (const path of [old, agent, project, join(project, '.pi')]) mkdirSync(path);
    writeFileSync(join(old, 'package.json'), JSON.stringify({ name: 'mypi-pi', pi: { extensions: ['./entry.ts'] } }));
    writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [old, 'npm:unrelated'] }));
    const env = { PI_CODING_AGENT_DIR: agent };
    assert.throws(() => inspectProjectPiPackages(project, root, env, root), /Competing mypi Pi package/);
    writeFileSync(join(project, '.pi', 'settings.json'), JSON.stringify({ packages: [{ source: old, extensions: [] }],
      extensions: ['./other-extension.ts'] }));
    assert.doesNotThrow(() => inspectProjectPiPackages(project, root, env, root));
    writeFileSync(join(project, '.pi', 'settings.json'), JSON.stringify({ packages: [{ source: old, extensions: [], autoload: false }],
      extensions: ['./other-extension.ts'] }));
    assert.throws(() => inspectProjectPiPackages(project, root, env, root), /Competing mypi Pi package/);
    writeFileSync(join(project, '.pi', 'settings.json'), JSON.stringify({ packages: [{ source: old, extensions: ['-entry.ts'], autoload: false }] }));
    assert.throws(() => inspectProjectPiPackages(project, root, env, root), /Ambiguous/);
    writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [{ source: old, extensions: [] }] }));
    assert.doesNotThrow(() => inspectProjectPiPackages(project, root, env, root));
    writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [] }));
    writeFileSync(join(project, '.pi', 'settings.json'), JSON.stringify({ packages: [{ source: old, extensions: [], autoload: false }] }));
    assert.doesNotThrow(() => inspectProjectPiPackages(project, root, env, root));
    writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [{ source: old, extensions: [] }] }));
    writeFileSync(join(project, '.pi', 'settings.json'), JSON.stringify({ packages: [{ source: old, extensions: ['+entry.ts'], autoload: false }] }));
    assert.throws(() => inspectProjectPiPackages(project, root, env, root), /Ambiguous/);
    writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [{ source: old, autoload: false }] }));
    writeFileSync(join(project, '.pi', 'settings.json'), JSON.stringify({ packages: [] }));
    assert.doesNotThrow(() => inspectProjectPiPackages(project, root, env, root));
    writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [] }));
    writeFileSync(join(project, '.pi', 'settings.json'), JSON.stringify({ packages: [{ source: old, extensions: ['-entry.ts'], autoload: false }] }));
    assert.doesNotThrow(() => inspectProjectPiPackages(project, root, env, root));
    writeFileSync(join(project, '.pi', 'settings.json'), JSON.stringify({ packages: ['../../old'], skills: ['./unrelated'] }));
    assert.throws(() => inspectProjectPiPackages(project, root, env, root), /Competing mypi Pi package/);
    mkdirSync(join(project, '.pi', 'old'));
    writeFileSync(join(project, '.pi', 'old', 'package.json'), JSON.stringify({ name: 'mypi-pi', pi: { extensions: ['./entry.ts'] } }));
    writeFileSync(join(project, '.pi', 'settings.json'), JSON.stringify({ packages: ['old'] }));
    assert.throws(() => inspectProjectPiPackages(project, root, env, project), /Competing mypi Pi package/);
    writeFileSync(join(project, '.pi', 'settings.json'), JSON.stringify({ packages: ['~/old'] }));
    assert.throws(() => inspectProjectPiPackages(project, root, env, root), /Competing mypi Pi package/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
