import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('local entry admits only the current checkout build independently of caller cwd', t => {
  const root = mkdtempSync(join(tmpdir(), 'mypi-build-entry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scripts = join(root, 'scripts');
  const dist = join(root, 'dist');
  mkdirSync(scripts);
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'test'));
  mkdirSync(join(root, 'integrations'));
  mkdirSync(join(dist, 'src/cli'), { recursive: true });
  const source = fileURLToPath(new URL('../../../scripts/', import.meta.url));
  for (const name of ['build-state-core.mjs', 'build-state.mjs', 'mypi.mjs']) cpSync(join(source, name), join(scripts, name));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  for (const name of ['pnpm-lock.yaml', 'tsconfig.json']) writeFileSync(join(root, name), name);
  const cli = join(dist, 'src/cli/main.js');
  writeFileSync(cli, `if (process.argv[2] === 'fail') process.exit(7);
if (process.argv[2] === 'signal') process.kill(process.pid, 'SIGTERM');
console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));
`);
  const run = (script: string, args: string[] = []) => {
    const result = spawnSync(process.execPath, [join(scripts, script), ...args], {
      cwd: tmpdir(), encoding: 'utf8', timeout: 3000,
    });
    assert.ifError(result.error);
    return result;
  };
  const missing = run('mypi.mjs', ['pi', '--', '--help']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /build missing, stale or modified.*pnpm build/s);
  assert.match(missing.stderr, new RegExp(root));
  assert.equal(missing.stdout, '');
  assert.equal(run('build-state.mjs', ['write']).status, 0);
  const current = run('mypi.mjs', ['pi', '--', '--help']);
  assert.equal(current.status, 0, current.stderr);
  assert.deepEqual(JSON.parse(current.stdout), { args: ['pi', '--', '--help'], cwd: tmpdir() });
  assert.equal(run('mypi.mjs', ['fail']).status, 7);
  const terminated = run('mypi.mjs', ['signal']);
  assert.equal(terminated.status, null);
  assert.equal(terminated.signal, 'SIGTERM');
  assert.equal(run('build-state.mjs', ['check']).status, 0);
  writeFileSync(join(root, 'src/new.ts'), 'source changed');
  assert.equal(run('mypi.mjs').status, 1);
  rmSync(join(root, 'src/new.ts'));
  writeFileSync(cli, readFileSync(cli, 'utf8') + '// modified compiled code\n');
  assert.equal(run('mypi.mjs').status, 1);
  assert.equal(run('build-state.mjs', ['check']).status, 1);
});
