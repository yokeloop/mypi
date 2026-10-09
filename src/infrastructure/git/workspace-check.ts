import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspaceGit } from './workspace-git.js';
import { InputError } from '../../shared/errors.js';
import { parseWorkspaceCheckConfig, WORKSPACE_CHECK_CONFIG, workspaceCheckState } from '../../shared/workspace-check.js';
import type { WorkspaceCheckCache } from '../../shared/workspace-check.js';

/** Local, replaceable per-worktree cache. No locks, credentials or persisted command output. */
export function workspaceCheck(root: string, binding: string) {
  const git = workspaceGit(root);
  function read(): WorkspaceCheckCache | null {
    const path = git.checkCachePath();
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('Invalid cache');
      const cache = JSON.parse(readFileSync(path, 'utf8')) as WorkspaceCheckCache;
      if (cache.version !== 1 || typeof cache.binding !== 'string' || typeof cache.startedAt !== 'string'
        || !['running', 'passed', 'failed', 'unavailable'].includes(cache.state)
        || !(cache.content === null || /^[a-f0-9]{64}$/.test(cache.content))
        || !Array.isArray(cache.outcomes) || cache.outcomes.length > 8
        || cache.outcomes.some(result => !result || !Array.isArray(result.argv)
          || result.argv.some(arg => typeof arg !== 'string') || !['passed', 'failed', 'interrupted'].includes(result.outcome)
          || !(result.exitCode === null || Number.isInteger(result.exitCode)))
        || (cache.state === 'passed' && (!cache.content || !cache.outcomes.length
          || cache.outcomes.some(result => result.outcome !== 'passed' || result.exitCode !== 0)))) throw new Error('Invalid cache');
      return cache;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new InputError('Checked material unavailable: unreadable check cache');
    }
  }
  function save(cache: WorkspaceCheckCache): void {
    const path = git.checkCachePath(), temporary = path + '.tmp';
    writeFileSync(temporary, JSON.stringify(cache) + '\n', { mode: 0o600 });
    renameSync(temporary, path);
  }
  function observe() {
    const snapshot = git.checkedContent();
    if (!snapshot.tracked.has(WORKSPACE_CHECK_CONFIG)) throw new InputError('Checked material unavailable: stage the project-owned .mypi-checks.json before initial verification');
    const file = join(root, WORKSPACE_CHECK_CONFIG), stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 64 * 1024) throw new InputError('Checked material unavailable: check configuration');
    const config = parseWorkspaceCheckConfig(JSON.parse(readFileSync(file, 'utf8')));
    return { ...snapshot, config };
  }
  function inspect() {
    try {
      const cache = read();
      if (!cache) return { state: 'absent' as const, cache: null };
      let content: string | null = null;
      try { content = observe().content; } catch { /* Unknown content cannot be fresh. */ }
      return { state: workspaceCheckState(cache, binding, content), cache };
    } catch { return { state: 'unavailable' as const, cache: null }; }
  }
  return {
    inspect,
    requireCurrent(publish = false) {
      const cache = read();
      let snapshot: ReturnType<typeof observe>;
      try { snapshot = observe(); } catch {
        throw new InputError('Checked material unavailable; inspect project configuration/content and run workspace verify');
      }
      const state = workspaceCheckState(cache, binding, snapshot.content);
      if (state !== 'current') throw new InputError('Checked material ' + state + '; run workspace verify for this worktree');
      if (publish && snapshot.content !== snapshot.headContent) {
        throw new InputError('Checked material differs from published HEAD: uncommitted companion content remains; reconcile explicitly without discarding unrelated files');
      }
    },
    verify() {
      const cache: WorkspaceCheckCache = { version: 1, binding, state: 'running', content: null,
        startedAt: new Date().toISOString(), outcomes: [] };
      // A new admitted attempt invalidates old green even if configuration/observation fails.
      save(cache);
      try {
        const before = observe();
        cache.content = before.content;
        save(cache);
        for (const { argv } of before.config.commands) {
          const result = spawnSync(argv[0]!, argv.slice(1), { cwd: root, env: process.env, shell: false,
            timeout: 60000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
          const outcome = result.error || result.signal ? 'interrupted' : result.status === 0 ? 'passed' : 'failed';
          cache.outcomes.push({ argv, exitCode: result.status, outcome });
          if (outcome !== 'passed') {
            cache.state = 'failed'; save(cache);
            throw new InputError('Checked material check ' + outcome + '; inspect prescribed command and rerun workspace verify');
          }
          save(cache);
        }
        if (observe().content !== before.content) throw new InputError('Checked material changed during verification; rerun workspace verify');
        cache.state = 'passed'; save(cache);
        return { state: 'current' as const, cache };
      } catch (error) {
        if (cache.state !== 'failed') { cache.state = 'unavailable'; save(cache); }
        if (error instanceof InputError) throw error;
        throw new InputError('Checked material unavailable: verification could not complete');
      }
    },
  };
}
