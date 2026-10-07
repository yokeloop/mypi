import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(dir + '/' + e.name) : [dir + '/' + e.name]);
const digest = files => {
  const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(file + '\0').update(readFileSync(file)).update('\0');
  return hash.digest('hex');
};
const manifest = 'dist/build-state.json';
const state = {
  input: digest([...walk('src'), ...walk('test'), ...walk('integrations'), 'package.json', 'pnpm-lock.yaml', 'tsconfig.json']),
  output: digest(walk('dist').filter(file => file !== manifest)),
};
if (process.argv[2] === 'write') writeFileSync(manifest, JSON.stringify(state) + '\n');
else {
  assert.equal(process.argv[2], 'check');
  assert.deepEqual(state, JSON.parse(readFileSync(manifest, 'utf8')), 'Stale/modified build; run pnpm build');
}
