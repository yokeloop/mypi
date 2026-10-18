import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

test('real Node launcher persists projects across independent processes without Python or context writes', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
  const env = { PATH: '/work/tools', HOME: dir, XDG_STATE_HOME: join(dir, 'state') };
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env, cwd: dir, encoding: 'utf8', timeout: 3000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  assert.equal(run('project', 'list').status, 1);
  assert.equal(existsSync(join(dir, 'state')), false);
  const init = run('db', 'init');
  assert.equal(init.status, 0, init.stderr);
  const filename = JSON.parse(init.stdout).database as string;
  const add = run('project', 'add', 'one/project', '--code', 'MP');
  assert.equal(add.status, 0, add.stderr);
  const project = JSON.parse(add.stdout).project;
  assert.equal(project.code, 'MP');
  const before = readFileSync(filename);
  const list = run('project', 'list');
  assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(JSON.parse(list.stdout).projects, [project]);
  assert.deepEqual(readFileSync(filename), before);
  const duplicate = run('project', 'add', 'two/project', '--code', 'MP');
  assert.equal(duplicate.status, 1);
  assert.equal(JSON.parse(duplicate.stderr).status, 'error');
  assert.equal(duplicate.stdout, '');
  assert.equal(existsSync(join(dir, 'home')), false);
  const help = run('--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Pi agent resources default to ~\/\.pi\/agent; optionally set PI_CODING_AGENT_DIR/);
  const missingTarget = run('work-chat', 'list');
  assert.equal(missingTarget.status, 1);
  assert.match(JSON.parse(missingTarget.stderr).message, /MYPI_WORK_CHAT_PI/);
  assert.equal(missingTarget.stdout, '');
  const agentDir = join(dir, 'agent'); mkdirSync(agentDir);
  const observed = spawnSync(process.execPath, [entry, 'work-chat', 'list'], {
    env: { ...env, MYPI_WORK_CHAT_PI: process.execPath, PI_CODING_AGENT_DIR: agentDir },
    cwd: dir, encoding: 'utf8', timeout: 3000,
  });
  assert.equal(observed.status, 0, observed.stderr);
  assert.deepEqual(JSON.parse(observed.stdout), { chats: [] });
  const malformedModel = run('work-chat', 'resume', 'chat-id', '--model', 'unqualified');
  assert.equal(malformedModel.status, 1);
  assert.match(JSON.parse(malformedModel.stderr).message, /provider\/model-id/);
});
