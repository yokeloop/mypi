import { readFileSync, mkdirSync, realpathSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { command, herdr, shellQuote, unitState } from '../infrastructure/process/command.js';
import { createTaskWorktree, taskRevision, auditWorktree } from '../infrastructure/git/task-worktree.js';
import { createWorkspace } from './create-workspace.js';
import { exportTaskCommit } from '../infrastructure/git/export-task.js';
import { taskBinding, runDirectory, newRunId, withRuns } from './run-records.js';

export interface LaunchOptions { deriveArtifact?: string; deriveWorkspace?: string; resume?: string; seconds: number; fixture: boolean; model?: string; modelCalls: number }
function entry(): string { return fileURLToPath(new URL('../mcp/run-service.js', import.meta.url)); }
export function startRun(filename: string, key: string, options: LaunchOptions, root?: string) {
  if (process.versions.node.split('.')[0] !== '24') throw new Error('Node 24 is required for task runtime');
  if (!Number.isSafeInteger(options.seconds) || options.seconds < 10 || options.seconds > 86400) throw new Error('Explicit runtime budget must be 10..86400 seconds');
  if (options.fixture && (options.seconds > 55 || !['inactive', 'failed'].includes(unitState('mypi-tests.service').ActiveState ?? ''))) throw new Error('Fixture needs the inactive exclusive test unit and at most 55 seconds');
  if (!Number.isSafeInteger(options.modelCalls) || options.modelCalls < 1 || options.modelCalls > 1000) throw new Error('Explicit model call budget must be 1..1000');
  if (!options.fixture && (!options.model || !/^[a-zA-Z0-9._-]+$/.test(options.model))) throw new Error('Explicit openai-codex model required');
  if (options.deriveArtifact !== undefined || options.deriveWorkspace !== undefined) {
    if (!/^[a-z0-9]{6,16}$/.test(options.deriveArtifact ?? '') || !/^[A-Za-z0-9_-]{1,100}$/.test(options.deriveWorkspace ?? '')) throw new Error('Explicit Derive artifact and workspace grant required');
  }
  // No mutation before verifying the registered request, caller topology and installed tools.
  const binding = taskBinding(filename, key, root);
  const current = herdr(['pane', 'current', '--current']).pane as { workspace_id: string };
  for (const executable of ['bwrap', 'systemd-run', 'git']) command('which', [executable]);
  const piRoot = realpathSync(join(command('mise', ['where', 'pi']), 'pi'));
  if (!existsSync(join(piRoot, 'pi'))) throw new Error('Pinned Pi distribution not found');
  if ((JSON.parse(readFileSync(join(piRoot, 'package.json'), 'utf8')) as { version?: string }).version !== '1.0.0') throw new Error('Validated Pi 1.0.0 runtime required');
  const id = newRunId(), directory = runDirectory(filename, id);
  let sessionId = newRunId(), worktree = join(directory, 'work'), baseRevision = taskRevision(binding.project.checkoutPath!);
  let previous: string | null = null;
  if (options.resume) {
    const before = withRuns(filename, true, runs => runs.get(options.resume!));
    if (!['stopped', 'failed'].includes(before.state) || before.requestId !== binding.card.id) throw new Error('Only a reconciled attempt of this task can resume');
    if (!['inactive', 'failed'].includes(unitState(before.unit).ActiveState ?? '')) throw new Error('Previous service still active');
    sessionId = before.sessionId; worktree = before.worktree; baseRevision = before.baseRevision;
    previous = runDirectory(filename, before.id);
    auditWorktree(worktree);
  }
  const record = withRuns(filename, false, runs => runs.prepare({ id, requestId: binding.card.id, requestKey: key, sessionId, worktree, baseRevision, fixture: options.fixture }));
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
    if (!previous) createTaskWorktree(binding.project.checkoutPath!, worktree, baseRevision, 'mypi/' + key + '-' + id);
    writeFileSync(join(directory, 'launch.json'), JSON.stringify({ attempt: id, piRoot, node: process.execPath, previous, seconds: options.seconds, fixture: options.fixture,
      provider: 'openai-codex', model: options.model, maxCalls: options.modelCalls,
      derive: options.deriveArtifact ? { artifact: options.deriveArtifact, workspace: options.deriveWorkspace } : undefined,
      authPath: join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent'), 'auth.json') }), { flag: 'wx', mode: 0o600 });
    const created = herdr(['tab', 'create', '--workspace', current.workspace_id, '--cwd', directory, '--label', key, '--no-focus']);
    const pane = (created.root_pane as { pane_id: string }).pane_id, tab = (created.tab as { tab_id: string }).tab_id;
    withRuns(filename, false, runs => runs.transition(id, 'prepared', 'starting', { pane, tab }));
    // Fixed executable and derived IDs; no interpolated user program or arbitrary shell endpoint.
    const argv = ['systemd-run', '--setenv=MYPI_HOST_TTY', '--setenv=HERDR_ENV=1',
      '--setenv=HERDR_SOCKET_PATH=' + (process.env.HERDR_SOCKET_PATH ?? ''), '--user', '--wait', '--pty', '--collect', '--service-type=exec', '--unit=' + record.unit,
      '-p', 'CPUQuota=200%', '-p', 'MemoryMax=1G', '-p', 'MemorySwapMax=0', '-p', 'TasksMax=64',
      '-p', 'RuntimeMaxSec=' + options.seconds + 's', '-p', 'TimeoutStopSec=5s', '-p', 'KillMode=control-group',
      '-p', 'OOMPolicy=kill', '-p', 'NoNewPrivileges=yes', process.execPath, entry(), filename, id, binding.contextRoot];
    // Capture the caller terminal identity before systemd creates a different one.
    herdr(['pane', 'run', pane, 'export MYPI_HOST_TTY=$(stat -Lc %r /proc/self/fd/0); ' + argv.map(shellQuote).join(' ')]);
    return { ...record, state: 'starting', pane, tab, directory };
  } catch (error) {
    // Retain worktree/ref/pane evidence; never silently repeat setup after a partial launch.
    const now = withRuns(filename, true, runs => runs.get(id));
    if (now.state === 'prepared') withRuns(filename, false, runs => runs.transition(id, 'prepared', 'failed', { detail: String(error) }));
    throw new Error('Launch incomplete; inspect run ' + id + ': ' + String(error));
  }
}
export function stopRun(filename: string, id: string) {
  let run = withRuns(filename, true, runs => runs.get(id));
  const terminal = run.state === 'stopped' || run.state === 'failed';
  // Revoke first. No worker or MCP command can call this host control surface.
  if (!terminal && run.state !== 'stopping') run = withRuns(filename, false, runs => runs.transition(id, run.state, 'stopping'));
  const state = unitState(run.unit);
  if (state.ActiveState !== 'inactive' && state.ActiveState !== 'failed') {
    if (terminal && state.InvocationID !== run.invocation) return run;
    if (!run.invocation || state.InvocationID !== run.invocation) throw new Error('Service binding mismatch; grant revoked, inspect manually');
    command('systemctl', ['--user', '--no-pager', 'stop', run.unit]);
  }
  return reconcileRun(filename, id);
}
export function reconcileRun(filename: string, id: string) {
  const run = withRuns(filename, true, runs => runs.get(id)), state = unitState(run.unit);
  if (state.ActiveState !== 'inactive' && state.ActiveState !== 'failed') return { ...run, service: state };
  if (state.ControlGroup && existsSync(join('/sys/fs/cgroup', state.ControlGroup, 'cgroup.procs'))) throw new Error('Cgroup cleanup not established');
  if (run.state === 'stopped' || run.state === 'failed') return run;
  return withRuns(filename, false, runs => runs.transition(id, run.state, run.state === 'stopping' ? 'stopped' : 'failed',
    { detail: 'Service absent/inactive; reconciled without completing the request' }));
}
export function showRun(filename: string, id: string) { return withRuns(filename, true, runs => runs.get(id)); }
export function listRuns(filename: string, key: string, root?: string) {
  const app = createWorkspace(filename, true, root);
  try { const card = app.requests.get(key); return withRuns(filename, true, runs => runs.list(card.id)); }
  finally { app.close(); }
}
export function exportRun(filename: string, id: string, root?: string) {
  const run = showRun(filename, id);
  if (!['stopped', 'failed'].includes(run.state)) throw new Error('Stop and reconcile before exporting Git');
  const service = unitState(run.unit);
  if (!['inactive', 'failed'].includes(service.ActiveState ?? '') || service.ControlGroup) throw new Error('Service/cgroup cleanup required');
  const binding = taskBinding(filename, run.requestKey, root);
  if (listRuns(filename, run.requestKey, root).some(other => !['stopped', 'failed'].includes(other.state))) throw new Error('Another task attempt is active');
  const unit = run.unit === 'mypi-tests.service' ? run.unit : 'mypi-export-' + id + '.service';
  const argv = ['--user', '--wait', '--pipe', '--collect', '--quiet', '--service-type=exec', '--unit=' + unit,
    '-p', 'CPUQuota=200%', '-p', 'MemoryMax=1G', '-p', 'MemorySwapMax=0', '-p', 'TasksMax=64', '-p', 'RuntimeMaxSec=55s',
    '-p', 'TimeoutStopSec=5s', '-p', 'KillMode=control-group', '-p', 'OOMPolicy=kill', '-p', 'NoNewPrivileges=yes',
    process.execPath, fileURLToPath(new URL('../cli/run-export.js', import.meta.url)), filename, id, binding.contextRoot];
  return JSON.parse(command('systemd-run', argv, 65000)) as unknown;
}
export function exportInsideService(filename: string, id: string, root: string) {
  const run = showRun(filename, id), unit = run.unit === 'mypi-tests.service' ? run.unit : 'mypi-export-' + id + '.service';
  const service = unitState(unit);
  if (!['stopped', 'failed'].includes(run.state) || !process.env.INVOCATION_ID || service.InvocationID !== process.env.INVOCATION_ID
    || Number(service.MainPID) !== process.pid) throw new Error('Export service binding required');
  const binding = taskBinding(filename, run.requestKey, root);
  const revision = exportTaskCommit(binding.project.checkoutPath!, run.worktree, join(runDirectory(filename, id), 'agent'), run.baseRevision, run.requestKey);
  return { id, revision, pushed: false, accepted: false };
}
export function runtimeRoot(): string { return dirname(dirname(dirname(fileURLToPath(import.meta.url)))); }
