import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readlinkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { planInstallation, applyInstallation, planHomeClone, applyHomeClone } from '../../src/app/setup-installation.js';
import { resolveInstallation } from '../../src/app/installation.js';
import { initializeState } from '../../src/app/create-app.js';
import type { SetupChoices } from '../../src/app/setup-installation.js';

function git(...args: string[]) {
  const result = spawnSync('git', args, { encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 0, result.stderr);
}
function fixture(t: import('node:test').TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-install-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'context'); mkdirSync(home);
  git('init', '--quiet', '--initial-branch=main', home);
  mkdirSync(join(home, 'pi'));
  writeFileSync(join(home, 'USER-INSTRUCTIONS.md'), 'Keep this instruction\n');
  writeFileSync(join(home, 'pi/settings.json'), JSON.stringify({ theme: 'personal', packages: [{ source: './other', skills: ['+./skills'] }],
    skills: ['+./skills', '-./excluded', '~/native-skill', '+~/native-skill', '!hidden'] }));
  writeFileSync(join(home, 'pi/mcp.json'), '{"mcpServers":{"mypi":{"enabled":false,"command":"~/bin/mypi","args":["~/config"],"cwd":"./work"}}}\n');
  const engine = (name: string) => {
    const root = join(dir, name); mkdirSync(join(root, 'integrations/pi'), { recursive: true });
    writeFileSync(join(root, 'integrations/pi/package.json'), '{"name":"mypi-pi"}');
    return root;
  };
  return { dir, home, engine };
}
test('two engine setups share unchanged home, preserve resource filters/MCP override and selected DB/state', t => {
  const { dir, home, engine } = fixture(t), a = engine('a'), b = engine('b');
  const homeSettings = readFileSync(join(home, 'pi/settings.json'));
  const mcp = readFileSync(join(home, 'pi/mcp.json'));
  for (const root of [a, b]) {
    const choices: SetupChoices = { homeMode: 'existing', homeRoot: home, databaseMode: 'new',
      database: join(dir, root === a ? 'a.sqlite3' : 'b.sqlite3'), stateRoot: join(dir, root === a ? 'a-state' : 'b-state') };
    const plan = planInstallation(root, choices);
    assert(!existsSync(choices.database)); assert(!existsSync(join(root, '.mypi-local.json')));
    applyInstallation(plan);
    const selected = resolveInstallation(root, {});
    assert.equal(selected.database, choices.database);
    const settings = JSON.parse(readFileSync(join(root, '.pi/settings.json'), 'utf8'));
    assert.equal(settings.theme, 'personal');
    assert(settings.skills.includes('+' + join(home, 'pi/skills')));
    assert(settings.skills.includes('-' + join(home, 'pi/excluded')));
    assert(settings.skills.includes('!' + join(home, 'pi/hidden')));
    assert(settings.skills.includes('~/native-skill'));
    assert(settings.skills.includes('+~/native-skill'));
    const selectedPackage = settings.packages.at(-1);
    assert.equal(typeof selectedPackage === 'string' ? selectedPackage : selectedPackage.source, join(root, 'integrations/pi'));
    assert.deepEqual(settings.packages[0].skills, ['+./skills']);
    assert.equal(readlinkSync(join(root, '.pi/mcp.json')), join(home, 'pi/mcp.json'));
    assert.deepEqual(applyInstallation(planInstallation(root, { ...choices, databaseMode: 'existing' })), []);
  }
  assert.deepEqual(readFileSync(join(home, 'pi/settings.json')), homeSettings);
  assert.deepEqual(readFileSync(join(home, 'pi/mcp.json')), mcp);
});
test('legacy Pi link preview accounts for replacement configuration links without rewriting selected home', t => {
  const { dir, home, engine } = fixture(t), root = engine('legacy');
  writeFileSync(join(home, 'pi/APPEND_SYSTEM.md'), 'Native instructions\n');
  symlinkSync(join(home, 'pi'), join(root, '.pi'));
  const choices: SetupChoices = { homeMode: 'existing', homeRoot: home, databaseMode: 'new',
    database: join(dir, 'state.sqlite3'), stateRoot: join(dir, 'runtime') };
  const plan = planInstallation(root, choices);
  assert(plan.changes.includes('link project instructions to selected home'));
  assert(plan.changes.includes('link selected-home MCP configuration'));
  applyInstallation(plan);
  assert.equal(readFileSync(join(home, 'pi/APPEND_SYSTEM.md'), 'utf8'), 'Native instructions\n');
  assert.equal(readlinkSync(join(root, '.pi/APPEND_SYSTEM.md')), join(home, 'pi/APPEND_SYSTEM.md'));
  const repeat = planInstallation(root, { ...choices, databaseMode: 'existing' });
  assert(!repeat.warnings.some(item => item.includes('instructions are NOT linked')));
  assert.deepEqual(applyInstallation(repeat), []);
});

test('setup preimage changes, conflicting targets and existing DB remain untouched', t => {
  const { dir, home, engine } = fixture(t), root = engine('engine'), db = join(dir, 'state.sqlite3');
  initializeState(db, true);
  const original = readFileSync(db);
  const choices: SetupChoices = { homeMode: 'existing', homeRoot: home, databaseMode: 'existing', database: db, stateRoot: join(dir, 'cache') };
  const plan = planInstallation(root, choices);
  writeFileSync(join(home, 'pi/settings.json'), '{"theme":"new"}');
  assert.throws(() => applyInstallation(plan), /changed since preview/);
  assert.deepEqual(readFileSync(db), original);
  assert(!existsSync(join(root, '.pi')));
  writeFileSync(join(root, '.pi'), 'keep');
  assert.throws(() => planInstallation(root, choices), /Nonstandard/);
  assert.equal(readFileSync(join(root, '.pi'), 'utf8'), 'keep');
});
test('new home and known agent engine filters are previewed; explicit refresh preserves local custom settings', t => {
  const { dir, engine } = fixture(t), root = engine('current'), older = engine('older'), home = join(dir, 'fresh');
  const old = join(older, 'integrations/pi');
  const global = join(dir, 'agent-settings.json');
  writeFileSync(global, JSON.stringify({ packages: [{ source: old, extensions: [], skills: ['+./skills'] }] }));
  const choices: SetupChoices = { homeMode: 'new', homeRoot: home, databaseMode: 'new', database: join(dir, 'new.sqlite3'),
    stateRoot: join(dir, 'runtime'), agentSettingsPath: global };
  writeFileSync(global, JSON.stringify({ packages: [{ source: root + '/integrations/pi', extensions: [], skills: ['+./skills'] }] }));
  const currentPlan = planInstallation(root, choices);
  assert.deepEqual(JSON.parse(currentPlan.settings).packages, [{ source: root + '/integrations/pi', extensions: [], skills: ['+./skills'] }]);
  writeFileSync(global, JSON.stringify({ packages: [{ source: old, extensions: [], skills: ['+./skills'] }] }));
  const plan = planInstallation(root, choices);
  assert(plan.changes.some(change => change.includes('USER-INSTRUCTIONS')));
  assert(plan.changes.some(change => change.includes('setup provenance')));
  const projected = JSON.parse(plan.settings);
  assert.deepEqual(projected.packages[0], { source: old, extensions: [], skills: [], prompts: [], themes: [] });
  assert.deepEqual(projected.packages[1], { source: root + '/integrations/pi', extensions: [], skills: ['+./skills'] });
  applyInstallation(plan);
  assert.equal(readlinkSync(join(home, 'pi/APPEND_SYSTEM.md')), '../USER-INSTRUCTIONS.md');
  assert.equal(readlinkSync(join(root, '.pi/APPEND_SYSTEM.md')), join(home, 'pi/APPEND_SYSTEM.md'));
  assert.equal(readFileSync(join(home, 'USER-INSTRUCTIONS.md'), 'utf8'), '# Personal instructions\n\n');
  const reuse = { ...choices, homeMode: 'existing' as const, databaseMode: 'existing' as const };
  assert.deepEqual(applyInstallation(planInstallation(root, reuse)), []);
  writeFileSync(global, JSON.stringify({ packages: [{ source: old, extensions: [], skills: [] }] }));
  assert.throws(() => planInstallation(root, reuse), /explicit refresh choice/);
  const globalRefresh = planInstallation(root, { ...reuse, refreshProjection: true });
  assert.deepEqual(JSON.parse(globalRefresh.settings).packages.at(-1).skills, []);
  applyInstallation(globalRefresh);
  writeFileSync(join(home, 'pi/settings.json'), '{"skills":["!private","notes"]}\n');
  assert.throws(() => planInstallation(root, reuse), /explicit refresh choice/);
  const refreshed = planInstallation(root, { ...reuse, refreshProjection: true });
  assert((JSON.parse(refreshed.settings).skills as string[]).includes('!' + join(home, 'pi/private')));
  assert(refreshed.changes.includes('write project settings snapshot'));
  applyInstallation(refreshed);
  assert.deepEqual(applyInstallation(planInstallation(root, reuse)), []);
  mkdirSync(join(home, 'pi/skills'));
  assert.throws(() => planInstallation(root, reuse), /explicit refresh choice/);
  const resourceRefresh = planInstallation(root, { ...reuse, refreshProjection: true });
  assert((JSON.parse(resourceRefresh.settings).skills as string[]).includes(join(home, 'pi/skills')));
  applyInstallation(resourceRefresh);
});

test('local bare remote is cloned only after first approval and reviewed before binding', t => {
  const { dir, home, engine } = fixture(t), root = engine('engine'), bare = join(dir, 'bare.git'), destination = join(dir, 'cloned');
  git('init', '--bare', '--quiet', bare);
  git('-C', home, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'add', '.');
  git('-C', home, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  git('-C', home, 'push', bare, 'main:main');
  git('-C', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  assert(!existsSync(destination)); assert(!existsSync(join(root, '.mypi-local.json')));
  const clone = planHomeClone(root, destination, bare);
  assert(!existsSync(destination));
  assert.throws(() => planInstallation(root, { homeMode: 'clone', homeRoot: destination, remote: bare,
    databaseMode: 'new', database: join(dir, 'new.sqlite3'), stateRoot: join(dir, 'runtime') }), /separate first-stage/);
  applyHomeClone(clone);
  assert(existsSync(join(destination, '.git')));
  // Reusing an occupied clone is rejected by setup planning; Git itself may accept empty destinations.
  assert.throws(() => applyHomeClone(clone), /absent/);
  const choices: SetupChoices = { homeMode: 'existing', homeRoot: destination, databaseMode: 'new', database: join(dir, 'new.sqlite3'), stateRoot: join(dir, 'runtime') };
  const plan = planInstallation(root, choices);
  assert(!existsSync(choices.database)); assert(!existsSync(join(root, '.mypi-local.json')));
  // Withhold second-stage approval: cloned repo is retained, no DB/binding exists.
  assert(existsSync(join(destination, 'pi/settings.json')));
  applyInstallation(plan);
  assert.equal(resolveInstallation(root, {}).homeRoot, destination);
});
