import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, readSync, fstatSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { contextFiles, relativeContextPath } from '../filesystem/context-files.js';
import { PartialError } from '../../shared/context.js';
import { InputError } from '../../shared/errors.js';

export function contextGit(root: string, published: () => ReadonlySet<string> = () => new Set()) {
  root = resolve(root);
  const files = contextFiles(root);
  const attributes = '* -text -filter -ident -working-tree-encoding\n';
  function ensureAttributes(): void {
    const info = join(root, '.git/info');
    if (existsSync(info) && lstatSync(info).isSymbolicLink()) throw new InputError('Symlink in Git metadata');
    const path = join(info, 'attributes');
    if (existsSync(path)) {
      if (lstatSync(path).isSymbolicLink() || lstatSync(path).nlink !== 1 || readFileSync(path, 'utf8') !== attributes) throw new InputError('Conflicting context Git attributes');
    } else {
      mkdirSync(join(root, '.git/info'), { recursive: true });
      writeFileSync(path, attributes, { flag: 'wx', mode: 0o600 });
    }
  }
  function git(args: string[], missingHead = false): string {
    const result = spawnSync('git', ['--literal-pathspecs', '-c', 'core.hooksPath=/dev/null',
      '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false',
      '-c', 'user.name=mypi', '-c', 'user.email=mypi@localhost', '-C', root, ...args],
    { encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))) });
    if (missingHead && result.status === 1 && !result.error) return '';
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim() || 'Git failed');
    return result.stdout;
  }
  function matchesBlob(path: string, oid: string, size: number, immutable: boolean): boolean {
    const target = files.path(path);
    if (!existsSync(target)) return false;
    const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size < size || (immutable && stat.size !== size)) return false;
      const hash = createHash(oid.length === 40 ? 'sha1' : 'sha256').update('blob ' + size + '\0');
      const buffer = Buffer.alloc(64 * 1024);
      for (let offset = 0; offset < size;) {
        const count = readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
        if (!count) return false;
        hash.update(buffer.subarray(0, count)); offset += count;
      }
      return hash.digest('hex') === oid;
    } finally { closeSync(fd); }
  }
  function ownMetadata(): void {
    try {
      const stat = lstatSync(join(root, '.git'));
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new InputError('Context Git metadata must be a private directory');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  function check(paths: string[]): void {
    ownMetadata();
    if (!paths.length) throw new InputError('Explicit context paths required');
    for (const path of paths) { relativeContextPath(path); files.path(path); }
    if (!existsSync(join(root, '.git')) || git(['rev-parse', '--show-toplevel']).trim() !== root) {
      throw new InputError('Context must be its own Git repository');
    }
    if (resolve(root, git(['rev-parse', '--git-common-dir']).trim()) !== join(root, '.git')) throw new InputError('Shared Git metadata is not a private context repository');
    ensureAttributes();
  }
  return {
    initialize() {
      files.path('MEMORY.md');
      ownMetadata();
      mkdirSync(root, { recursive: true, mode: 0o700 });
      if (!existsSync(join(root, '.git'))) git(['init', '--quiet']);
      check(['MEMORY.md']);
      ensureAttributes();
    },
    head(): string | undefined { return git(['rev-parse', '--verify', '--quiet', 'HEAD'], true).trim() || undefined; },
    cleanAll() {
      check(['MEMORY.md']);
      for (const path of git(['ls-files', '-z']).split('\0').filter(Boolean)) files.path(path);
      if (git(['status', '--porcelain=v1', '--untracked-files=all', '--ignored'])) throw new InputError('Dirty context; reconcile before backup');
    },
    bundle(destination: string) { git(['bundle', 'create', destination, 'HEAD']); },
    restoreFile(path: string, revision: string) {
      check([path]);
      if (published().has(path) || path.startsWith('journal/') || path.startsWith('inbox/') || path === 'source.md' || path.endsWith('/source.md') || path.endsWith('/errors.md')) {
        throw new InputError('Immutable/append-only history cannot be restored by rewriting');
      }
      if (!/^[a-f0-9]{40,64}$/.test(revision)) throw new InputError('Full commit hash required');
      if (git(['cat-file', '-t', revision + ':' + path]).trim() !== 'blob') throw new InputError('Explicit file path required');
      if (existsSync(files.path(path))) this.clean([path]);
      else if (git(['diff', '--cached', '--name-only', '--', path])) throw new InputError('Staged preimage must be saved first');
      ensureAttributes();
      git(['restore', '--source=' + revision, '--worktree', '--', path]);
      try { return this.commit([path], 'Restore ' + path + ' from ' + revision); }
      catch (e) { throw new PartialError(String(e), ['context'], ['git'], [path]); }
    },
    clean(paths: string[]) {
      check(paths);
      if (git(['status', '--porcelain=v1', '--untracked-files=all', '--', ...paths])) {
        throw new InputError('Target has uncommitted changes; reconcile/commit explicitly first');
      }
    },
    validateJournal() {
      check(['MEMORY.md']);
      const head = this.head();
      if (!head) return;
      const paths = git(['ls-tree', '-r', '-z', '--name-only', head, '--', 'journal']).split('\0').filter(Boolean);
      this.validate(paths);
    },
    validate(paths: string[]) {
      if (!paths.length) return;
      check(paths);
      const immutablePaths = published();
      const head = git(['rev-parse', '--verify', '--quiet', 'HEAD'], true).trim();
      if (head) for (const path of paths) {
        if (!git(['ls-tree', '--name-only', head, '--', path]).trim()) continue;
        if (!(immutablePaths.has(path) || path.endsWith('/source.md') || path === 'source.md' || path.startsWith('inbox/')
          || path.startsWith('journal/') || path.endsWith('/errors.md'))) continue;
        const oid = git(['rev-parse', '--verify', head + ':' + path]).trim();
        const size = Number(git(['cat-file', '-s', oid]).trim());
        const immutable = immutablePaths.has(path) || path.endsWith('/source.md') || path === 'source.md' || path.startsWith('inbox/');
        if (!Number.isSafeInteger(size) || size < 0 || !matchesBlob(path, oid, size, immutable)) {
          throw new InputError(immutable ? 'Immutable source cannot be changed' : 'Append-only history cannot be rewritten');
        }
      }
    },
    commit(paths: string[], message: string) {
      check(paths);
      ensureAttributes();
      const head = git(['rev-parse', '--verify', '--quiet', 'HEAD'], true).trim();
      for (const path of paths) if (!files.isFile(path)) {
        if (existsSync(files.path(path)) || !head || git(['cat-file', '-t', head + ':' + path]).trim() !== 'blob') {
          throw new InputError('Explicit file paths required');
        }
      }
      this.validate(paths);
      // --only includes only the named files, leaving unrelated staged content intact.
      git(['add', '--', ...paths]);
      const dirty = git(['status', '--porcelain=v1', '--', ...paths]);
      if (dirty) git(['commit', '--quiet', '--only', '-m', message, '--', ...paths]);
      return git(['rev-parse', 'HEAD']).trim();
    },
  };
}

export function cloneContextBundle(bundle: string, root: string): void {
  contextFiles(root).path('MEMORY.md');
  mkdirSync(resolve(root, '..'), { recursive: true, mode: 0o700 });
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'clone', '--quiet', '--no-checkout', '--', resolve(bundle), resolve(root)],
    { encoding: 'utf8', timeout: 3000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))) });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr);
  contextGit(root).initialize();
  const checkout = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', '-C', root, 'checkout', '--quiet', '--force', 'HEAD'],
    { encoding: 'utf8', timeout: 3000, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))) });
  if (checkout.error || checkout.status !== 0) throw new Error(checkout.error?.message || checkout.stderr);
}
