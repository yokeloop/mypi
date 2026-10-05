import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, renameSync, watch, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerBroker } from '../infrastructure/process/worker-broker.js';
import { sandboxArgs } from '../infrastructure/process/sandbox.js';
import { createPrivateGit, copyPrivateTree } from '../infrastructure/git/private-git.js';
import { auditWorktree } from '../infrastructure/git/task-worktree.js';
import type { DeriveConnector } from './derive-session.js';
import { deriveSession } from './derive-session.js';
import type { DeriveGrant } from './derive-command.js';
import { workerAccess } from './worker-access.js';
import { withRuns, runDirectory, taskBinding } from './run-records.js';
import { createWorkspace } from './create-workspace.js';
import { herdr, unitState } from '../infrastructure/process/command.js';

interface Launch {
  piRoot: string; node: string; previous: string | null; seconds: number;
  derive?: DeriveGrant; fixture: boolean; provider: string; model?: string; maxCalls: number; authPath: string;
}
export async function serveRun(filename: string, id: string, root: string, connectDerive?: DeriveConnector): Promise<void> {
  const run = withRuns(filename, true, runs => runs.get(id));
  if (run.state !== 'starting') throw new Error('Run is not starting');
  const service = unitState(run.unit);
  const invocation = process.env.INVOCATION_ID;
  const ttyDevice = statSync('/proc/self/fd/0').rdev;
  if (!process.stdin.isTTY || !process.stdout.isTTY || !invocation || service.InvocationID !== invocation
    || Number(service.MainPID) !== process.pid || !process.env.MYPI_HOST_TTY
    || ttyDevice === Number(process.env.MYPI_HOST_TTY)) throw new Error('Dedicated service/PTY identity not established');
  withRuns(filename, false, runs => runs.transition(id, 'starting', 'starting', { invocation }));
  let derive: Awaited<ReturnType<typeof deriveSession>> | undefined;
  let broker: Awaited<ReturnType<typeof workerBroker>> | undefined;
  let provider: ReturnType<typeof spawn> | undefined, worker: ReturnType<typeof spawn> | undefined;
  let readyTimer: NodeJS.Timeout | undefined, readyReceived = false, stopRequested = false;
  const stop = () => { stopRequested = true; worker?.kill('SIGTERM'); provider?.kill('SIGTERM'); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    const dir = runDirectory(filename, id), launch = JSON.parse(readFileSync(join(dir, 'launch.json'), 'utf8')) as Launch;
    const binding = taskBinding(filename, run.requestKey, root);
    if (binding.card.id !== run.requestId) throw new Error('Request binding mismatch');
    auditWorktree(run.worktree);
    const agent = join(dir, 'agent'), context = join(dir, 'context'), runtime = join(dir, 'runtime');
    for (const path of [agent, context, runtime]) mkdirSync(path, { mode: 0o700 });
    if (launch.previous) {
      const before = join(launch.previous, 'agent', 'sessions');
      // Never follow worker-controlled session symlinks into a host resource.
      if (existsSync(before) && lstatSync(before).isSymbolicLink()) throw new Error('Unsafe session directory');
      mkdirSync(join(agent, 'sessions'));
      for (const name of existsSync(before) ? readdirSync(before) : []) {
        if (!name.endsWith('_' + run.sessionId + '.jsonl')) continue;
        const path = join(before, name), info = lstatSync(path);
        if (!info.isFile() || info.nlink !== 1 || info.size > 32 * 1024 * 1024) throw new Error('Unsafe session file');
        copyFileSync(path, join(agent, 'sessions', name));
      }
    }
    if (launch.previous && existsSync(join(launch.previous, 'agent', 'git'))) {
      copyPrivateTree(join(launch.previous, 'agent', 'git'), join(agent, 'git'));
    } else {
      createPrivateGit(binding.project.checkoutPath!, join(agent, 'git'), run.baseRevision,
        'mypi/' + run.requestKey + '-' + basename(join(run.worktree, '..')));
    }
    writeFileSync(join(runtime, 'git-pointer'), 'gitdir: /home/worker/agent/git\n');
    const workspace = createWorkspace(filename, true, root);
    try {
      const seed = { card: binding.card, history: workspace.history({ type: 'request', key: run.requestKey }, { limit: 20 }),
        source: workspace.read(binding.card.contextDir + '/source.md'),
        inherited: binding.grant.contextReads.map(path => ({ path, text: workspace.read(path) })) };
      writeFileSync(join(context, 'task.json'), JSON.stringify(seed, null, 2));
    } finally { workspace.close(); }
    const files = fileURLToPath(new URL('../../../integrations/pi/scoped/', import.meta.url));
    for (const file of ['worker.mjs', 'bridge.mjs']) copyFileSync(join(files, file), join(runtime, file));
    writeFileSync(join(agent, 'settings.json'), JSON.stringify({ quietStartup: true, cacheWarming: 'off', enableAnalytics: false,
      enableInstallTelemetry: false, retry: { enabled: false }, defaultTools: ['read', 'bash', 'edit', 'write', 'codemode'] }));
    writeFileSync(join(agent, 'mcp.json'), JSON.stringify({ mcpServers: { mypi: { command: '/tools/node', args: ['/runtime/bridge.mjs'], exposure: 'codemode' } } }));
    derive = launch.derive ? await deriveSession(dir, launch.derive, launch.fixture, connectDerive) : undefined;
    const socket = join(dir, 'mypi.sock'), providerSocket = join(dir, 'provider.sock');
    const check = () => { withRuns(filename, true, runs => runs.active(id)); taskBinding(filename, run.requestKey, root); };
    broker = await workerBroker(socket, workerAccess(filename, id, root, derive), value => {
      const ready = value as { sessionId?: unknown; ttyDevice?: unknown };
      if (ready?.sessionId !== run.sessionId || ready.ttyDevice !== ttyDevice) throw new Error('Ready binding mismatch');
      const current = withRuns(filename, true, runs => runs.get(id));
      if (current.state !== 'starting') throw new Error('Stale readiness');
      withRuns(filename, false, runs => runs.transition(id, 'starting', 'running', { invocation }));
      readyReceived = true; clearTimeout(readyTimer);
      writeFileSync(join(dir, 'ready.tmp'), JSON.stringify({ id, sessionId: run.sessionId, invocation }));
      renameSync(join(dir, 'ready.tmp'), join(dir, 'ready.json'));
      try { herdr(['pane', 'report-agent', run.pane!, '--source', 'mypi-' + id, '--agent', 'pi', '--state', 'idle', '--agent-session-id', run.sessionId]); } catch { /* Binding remains in DB, never inferred from UI. */ }
    }, check, Boolean(derive));
    const providerConfig = join(dir, 'provider.json'), providerReady = join(dir, 'provider-ready.json');
    writeFileSync(providerConfig, JSON.stringify({ ...launch, socket: providerSocket, metadata: join(runtime, 'model.json'),
      emptyAuth: join(dir, 'empty-auth.json'), emptyModels: join(dir, 'empty-models.json'), grantSocket: socket, ready: providerReady }), { mode: 0o600 });
    writeFileSync(join(dir, 'empty-models.json'), '{}'); writeFileSync(join(dir, 'empty-auth.json'), '{}', { mode: 0o600 });
    mkdirSync(join(dir, 'provider-agent'), { mode: 0o700 });
    // Host relay has no work tools, context discovery or real agent turns. Worker tools remain fully usable.
    provider = spawn(join(launch.piRoot, 'pi'), ['--offline', '--mode', 'rpc', '--no-session', '--no-tools', '--no-extensions',
      '--no-context-files', '--no-skills', '--no-prompt-templates', '--no-themes', '--extension', join(files, 'gateway.mjs')], {
      cwd: dir, stdio: ['pipe', 'ignore', 'ignore'], env: { PATH: process.env.PATH, HOME: join(dir, 'provider-agent'),
        PI_CODING_AGENT_DIR: join(dir, 'provider-agent'), PI_OFFLINE: '1', PI_TELEMETRY: '0', MYPI_GATEWAY_CONFIG: providerConfig },
    });
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => { clearTimeout(timeout); watcher.close(); error ? reject(error) : resolve(); };
      const inspect = () => {
        if (!existsSync(providerReady)) return;
        try {
          const value = JSON.parse(readFileSync(providerReady, 'utf8')) as { pid: number };
          if (value.pid !== provider?.pid) throw new Error('Provider PID binding mismatch');
          finish();
        } catch { finish(new Error('Invalid provider handshake')); }
      };
      const watcher = watch(dir, inspect);
      const timeout = setTimeout(() => finish(new Error('Provider startup deadline')), 5000);
      provider!.once('error', finish);
      provider!.once('exit', () => finish(new Error('Provider startup failed')));
      inspect();
    });
    if (stopRequested) throw new Error('Stopped during startup');
    const metadata = JSON.parse(readFileSync(join(runtime, 'model.json'), 'utf8')) as { provider: string; id: string };
    worker = spawn('bwrap', sandboxArgs({ worktree: run.worktree, agent, context, bridge: socket, runtime,
      pi: launch.piRoot, node: realpathSync(launch.node), sessionId: run.sessionId,
      model: metadata.provider + '/' + metadata.id, providerSocket }), { stdio: 'inherit' });
    readyTimer = setTimeout(() => { if (!readyReceived) worker?.kill('SIGTERM'); }, 5000);
    const exitCode = await new Promise<number | null>((resolve, reject) => { worker!.once('error', reject); worker!.once('exit', resolve); });
    const current = withRuns(filename, true, runs => runs.get(id));
    let sessionFile: string | null = null;
    try {
      if (!lstatSync(join(agent, 'sessions')).isDirectory()) throw new Error('Unsafe session directory');
      for (const name of readdirSync(join(agent, 'sessions'))) {
        if (name.endsWith('_' + run.sessionId + '.jsonl') && lstatSync(join(agent, 'sessions', name)).isFile()) sessionFile = basename(name);
      }
    } catch { /* Allocated session IDs do not imply materialized transcripts. */ }
    if (!['stopped', 'failed'].includes(current.state)) withRuns(filename, false, runs => runs.transition(id, current.state,
      current.state === 'stopping' || (current.state === 'running' && exitCode === 0) ? 'stopped' : 'failed',
      { sessionFile, detail: 'Worker exit observed; request acceptance unchanged' }));
  } catch (error) {
    const current = withRuns(filename, true, runs => runs.get(id));
    if (!['stopped', 'failed'].includes(current.state)) withRuns(filename, false, runs => runs.transition(id, current.state, 'failed', { detail: String(error) }));
    throw error;
  } finally {
    clearTimeout(readyTimer);
    worker?.kill('SIGTERM'); provider?.kill('SIGTERM'); provider?.stdin?.destroy(); broker?.close(); await derive?.close();
    process.off('SIGTERM', stop); process.off('SIGINT', stop);
    try { herdr(['pane', 'release-agent', run.pane!, '--agent', 'pi', '--source', 'mypi-' + id]); } catch { /* Host UI may already be closed. */ }
  }
}
