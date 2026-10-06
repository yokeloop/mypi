#!/usr/bin/env node
// One-command, forward-only release. Never move a published tag or roll back a partial push.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = 'yokeloop/mypi';
const version = process.argv[2];
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function run(program, args, { inherit = false, allowFailure = false } = {}) {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe', maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${program} ${args.join(' ')} failed (${result.status}): ${result.stderr || ''}`);
  }
  return result;
}
const git = (...args) => run('git', args).stdout.trim();
const gh = (...args) => run('gh', args).stdout.trim();
const file = path => readFileSync(resolve(root, path), 'utf8');
const sha = () => git('rev-parse', 'HEAD');
const remoteRef = ref => {
  const lines = git('ls-remote', 'origin', ref).split('\n').filter(Boolean);
  if (lines.length > 1) throw new Error(`Ambiguous remote ref: ${ref}`);
  return lines.length ? lines[0].split('\t')[0] : null;
};
const clean = () => {
  if (git('status', '--porcelain=v1', '--untracked-files=normal')) {
    throw new Error('Working tree or index is not clean; no release changes made');
  }
};
const tagTarget = tag => {
  const local = run('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], { allowFailure: true });
  if (local.status === 1) return null;
  if (local.status !== 0) throw new Error('Cannot read local tag');
  return git('rev-parse', `${tag}^{}`);
};
const packageVersion = () => JSON.parse(file('package.json')).version;
const serverVersion = () => {
  const match = file('src/mcp/server.ts').match(/new McpServer\(\{ name: 'mypi', version: '([^']+)' \}\)/g);
  if (!match || match.length !== 1) throw new Error('Expected exactly one MCP server version');
  return match[0].match(/version: '([^']+)'/)[1];
};
function replaceVersion(path, oldVersion, newVersion, marker) {
  const source = file(path);
  if (source.split(marker(oldVersion)).length !== 2) throw new Error(`Unexpected version in ${path}`);
  writeFileSync(resolve(root, path), source.replace(marker(oldVersion), marker(newVersion)));
}
function compare(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

async function main() {
  if (process.argv.length !== 3 || !semver.test(version)) {
    throw new Error('Usage: pnpm release <major.minor.patch> (for example: pnpm release 0.1.2)');
  }
  const tag = `v${version}`;
  if (git('branch', '--show-current') !== 'main') throw new Error('Release only from main');
  clean();
  const origin = git('config', '--get', 'remote.origin.url');
  if (!/^(?:https:\/\/github\.com\/|git@github\.com:)yokeloop\/mypi(?:\.git)?$/.test(origin)) {
    throw new Error('origin must be yokeloop/mypi on GitHub');
  }
  gh('auth', 'status');
  const current = packageVersion();
  if (current !== serverVersion()) throw new Error('package.json and MCP server versions differ');
  const start = sha();
  const remoteStart = remoteRef('refs/heads/main');
  if (!remoteStart) throw new Error('Remote main not found');
  const localTag = tagTarget(tag);
  const remoteTag = remoteRef(`refs/tags/${tag}^{}`) ?? remoteRef(`refs/tags/${tag}`);

  if (current === version) {
    // Resume only our already committed release. Never tag an arbitrary commit.
    if (git('log', '-1', '--format=%s') !== `release: ${tag}` || (localTag && localTag !== start) ||
        (remoteTag && remoteTag !== start)) throw new Error('Existing version/tag is not this release commit');
    if (remoteStart !== start && remoteStart !== git('rev-parse', 'HEAD^')) {
      throw new Error('Remote main diverged; inspect before retry');
    }
    if (!localTag && remoteTag) throw new Error('Remote tag exists but local tag is missing; fetch and inspect it');
    if (!localTag) run('git', ['tag', '-a', tag, '-m', `mypi ${tag}`]);
  } else {
    if (!semver.test(current) || compare(version, current) <= 0) throw new Error('Version must increase');
    if (remoteStart !== start) throw new Error('Local main differs from origin/main');
    if (localTag || remoteTag) throw new Error('Release tag already exists');
    replaceVersion('package.json', current, version, v => `"version": "${v}"`);
    replaceVersion('src/mcp/server.ts', current, version, v => `new McpServer({ name: 'mypi', version: '${v}' })`);
    console.log(`Checking ${tag} locally...`);
    run('pnpm', ['build'], { inherit: true });
    run('pnpm', ['verify'], { inherit: true });
    run('git', ['add', '--', 'package.json', 'src/mcp/server.ts']);
    run('git', ['commit', '-m', `release: ${tag}`], { inherit: true });
    run('git', ['tag', '-a', tag, '-m', `mypi ${tag}`]);
  }
  clean();
  const target = sha();
  if (packageVersion() !== version || serverVersion() !== version || tagTarget(tag) !== target) {
    throw new Error('Local release version/tag mismatch');
  }
  const remoteHead = remoteRef('refs/heads/main');
  const publishedTag = remoteRef(`refs/tags/${tag}^{}`) ?? remoteRef(`refs/tags/${tag}`);
  if (publishedTag && publishedTag !== target) throw new Error('Remote tag points to a different commit');
  if (remoteHead !== target || !publishedTag) {
    if (publishedTag && remoteHead !== target) throw new Error('Tag published but main differs; inspect remote state');
    if (remoteHead !== target && remoteHead !== git('rev-parse', 'HEAD^')) {
      throw new Error('Remote main changed; inspect before push');
    }
    console.log(`Pushing ${tag} and main atomically...`);
    run('git', ['push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}:refs/tags/${tag}`], { inherit: true });
  }
  if (remoteRef('refs/heads/main') !== target || remoteRef(`refs/tags/${tag}^{}`) !== target) {
    throw new Error('Remote refs do not point to the release commit');
  }

  console.log(`Waiting for hosted CI on ${target}...`);
  const deadline = Date.now() + 12 * 60 * 1000;
  let ci;
  while (Date.now() < deadline) {
    const runs = JSON.parse(gh('run', 'list', '-R', repo, '--workflow', 'm1-verify.yml',
      '--event', 'push', '--commit', target, '--limit', '20', '--json',
      'databaseId,headSha,status,conclusion,url'));
    ci = runs.find(run => run.headSha === target);
    if (ci?.status === 'completed') break;
    await sleep(10_000);
  }
  if (!ci || ci.status !== 'completed' || ci.conclusion !== 'success') {
    throw new Error(`Hosted CI did not pass for ${target}: ${JSON.stringify(ci ?? 'not found')}`);
  }
  // The GitHub Release is a separate API write; a retry never moves the Git tag.
  const existing = run('gh', ['release', 'view', tag, '-R', repo, '--json', 'url,isDraft'], { allowFailure: true });
  if (existing.status === 0) {
    const release = JSON.parse(existing.stdout);
    if (release.isDraft) throw new Error('Existing release is a draft; inspect before retry');
    console.log(`Already published: ${release.url}`);
    return;
  }
  console.log(`Publishing ${tag}...`);
  run('gh', ['release', 'create', tag, '-R', repo, '--verify-tag', '--prerelease',
    '--title', `mypi ${tag}`, '--generate-notes', '--notes',
    `Not production-ready; the independent trusted merge gate and final M1 acceptance remain open.\n\nHosted verification: ${ci.url}. The package is private and is not published to npm.`], { inherit: true });
  const release = JSON.parse(gh('release', 'view', tag, '-R', repo, '--json', 'url,isDraft,tagName'));
  if (release.isDraft || release.tagName !== tag) throw new Error('Release publication not confirmed');
  console.log(`Published: ${release.url}`);
}

main().catch(error => { console.error(`Release stopped: ${error.message}\nInspect local/remote refs before retry; no automatic rollback.`); process.exitCode = 1; });
