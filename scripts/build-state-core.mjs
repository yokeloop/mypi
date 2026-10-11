import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);

function digest(root, files) {
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    hash.update(relative(root, file) + '\0').update(readFileSync(file)).update('\0');
  }
  return hash.digest('hex');
}

const manifestPath = root => join(root, 'dist/build-state.json');

function buildState(root) {
  return {
    input: digest(root, [...walk(join(root, 'src')), ...walk(join(root, 'test')),
      ...walk(join(root, 'integrations')), join(root, 'package.json'), join(root, 'pnpm-lock.yaml'), join(root, 'tsconfig.json')]),
    output: digest(root, walk(join(root, 'dist')).filter(file => file !== manifestPath(root))),
  };
}

export function writeBuildState(root) {
  writeFileSync(manifestPath(root), JSON.stringify(buildState(root)) + '\n');
}

export function checkBuildState(root) {
  try {
    const expected = JSON.parse(readFileSync(manifestPath(root), 'utf8'));
    const current = buildState(root);
    if (expected?.input === current.input && expected?.output === current.output) return;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    // A missing, unreadable or invalid manifest/output must never admit old code.
  }
  throw new Error(`mypi build missing, stale or modified in ${root}. Run pnpm build in that checkout.`);
}
