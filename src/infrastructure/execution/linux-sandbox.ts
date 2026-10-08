import { spawn } from 'node:child_process';
import { accessSync, constants, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import type { Readable } from 'node:stream';

export interface LinuxSandboxConfiguration {
  readonly workspace: string;
  readonly bubblewrap: string;
  readonly node: string;
  /** Trusted, credential-free OS toolchain trees, mounted read-only at these fixed paths. */
  readonly runtimePaths: readonly ('/usr' | '/lib' | '/lib64')[];
  readonly deadlineMs: number;
  readonly outputBytes: number;
}

export interface SandboxRequest {
  readonly argv: readonly string[];
  readonly stdin?: string;
}

export interface SandboxOutcome {
  readonly kind: 'exited' | 'launch-failed' | 'indeterminate' | 'deadline' | 'output-limit';
  readonly stdout: string;
  readonly stderr: string;
  /** Actual host-observed bubblewrap status; never replaced by child diagnostics. */
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly diagnostic?: string;
}

// PID 1 exits with the command, letting the kernel kill every remaining namespace
// descendant, including children which changed session/process group. fd 3 is only
// untrusted diagnostic data; the requested command receives stdio 0/1/2, not fd 3.
const init = `
const {spawn}=require('node:child_process');
const {writeSync}=require('node:fs');
const {constants}=require('node:os');
const report=(value)=>writeSync(3,JSON.stringify(value));
const args=JSON.parse(process.argv[1]);
const child=spawn(args[0],args.slice(1),{stdio:[0,1,2]});
child.once('error',error=>{report({launchError:error.code});process.exit(125)});
child.once('exit',(code,signal)=>{
  const status=code===null?128+constants.signals[signal]:code;
  report({exitCode:status});process.exit(status);
});
`;

function canonical(path: string): string {
  if (!isAbsolute(path) || normalize(path) !== path || path.includes('\0')) {
    throw new Error('Sandbox paths must be normalized absolute paths');
  }
  return realpathSync(path);
}

function executable(path: string): string {
  const resolved = canonical(path);
  if (!lstatSync(resolved).isFile()) throw new Error('Sandbox executable must be a regular file');
  accessSync(resolved, constants.X_OK);
  return resolved;
}

/**
 * Trusted preparation is required: an exclusively owned, credential-free workspace
 * with no external hardlinks/mounts or concurrent host writers; immutable toolchain
 * sources. This is not a model-callable configuration API. See the feasibility doc.
 */
export function createLinuxSandbox(configuration: LinuxSandboxConfiguration) {
  if (process.platform !== 'linux') throw new Error('Linux sandbox unavailable');
  const workspace = canonical(configuration.workspace);
  if (workspace !== configuration.workspace || workspace === '/') throw new Error('Workspace must be canonical');
  const bubblewrap = executable(configuration.bubblewrap);
  const node = executable(configuration.node);
  const runtimePaths = [...configuration.runtimePaths].map(path => {
    if (!['/usr', '/lib', '/lib64'].includes(path)) throw new Error('Invalid runtime destination');
    return { source: canonical(path), destination: path };
  });
  for (const path of [bubblewrap, node, ...runtimePaths.map(mount => mount.source)]) {
    if (path === workspace || path.startsWith(workspace + '/') || workspace.startsWith(path + '/')) {
      throw new Error('Workspace and trusted executables/toolchain must not overlap');
    }
  }
  const { deadlineMs, outputBytes } = configuration;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60_000
    || !Number.isSafeInteger(outputBytes) || outputBytes < 1 || outputBytes > 1024 * 1024) {
    throw new Error('Invalid sandbox bounds');
  }

  function argumentsForWorkspace(): string[] {
    if (canonical(workspace) !== workspace || !lstatSync(workspace).isDirectory()
      || lstatSync(workspace).uid !== process.getuid!()) throw new Error('Workspace ownership changed');
    const masks: string[] = [];
    // Revalidate before each run. Never follow workspace links on the host. A .git
    // mount cannot be renamed/unlinked from inside the writable workspace mount.
    function inspect(directory: string, relative: string): void {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        const target = '/workspace/' + (relative ? relative + '/' : '') + name;
        const stat = lstatSync(path);
        if (name === '.git') {
          if (stat.isDirectory()) masks.push('--tmpfs', target, '--remount-ro', target);
          else if (stat.isFile() && stat.nlink === 1) masks.push('--ro-bind', '/dev/null', target);
          else throw new Error('Unsupported Git metadata');
        } else if (stat.isSymbolicLink()) {
          // Links resolve only against the isolated mount tree at execution time.
        } else if (stat.isDirectory()) inspect(path, relative ? relative + '/' + name : name);
        else if (!stat.isFile() || stat.nlink !== 1) throw new Error('Workspace contains authority objects or hardlinks');
      }
    }
    // Trusted preparation must supply a placeholder even for non-Git workspaces.
    lstatSync(join(workspace, '.git'));
    inspect(workspace, '');
    return [
      '--unshare-user', '--unshare-pid', '--unshare-net', '--unshare-ipc', '--unshare-uts',
      '--disable-userns', '--die-with-parent', '--new-session', '--as-pid-1', '--cap-drop', 'ALL', '--clearenv',
      ...runtimePaths.flatMap(({ source, destination }) => ['--ro-bind', source, destination]),
      '--ro-bind', node, '/toolchain/node',
      '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/home',
      '--dir', '/home/sandbox', '--dir', '/home/sandbox/cache',
      '--bind', workspace, '/workspace', ...masks,
      '--setenv', 'PATH', '/toolchain:/usr/bin', '--setenv', 'HOME', '/home/sandbox',
      '--setenv', 'XDG_CACHE_HOME', '/home/sandbox/cache', '--setenv', 'TMPDIR', '/tmp',
      '--setenv', 'LANG', 'C.UTF-8', '--chdir', '/workspace',
      '--remount-ro', '/', '--', '/toolchain/node', '-e', init,
    ];
  }
  // Invalid preparation fails before any command can be requested.
  argumentsForWorkspace();

  return Object.freeze({
    async run(request: SandboxRequest): Promise<SandboxOutcome> {
      let args: string[];
      try {
        const argv = [...request.argv];
        if (!argv.length || !argv[0] || argv.some(arg => typeof arg !== 'string' || arg.includes('\0'))
          || Buffer.byteLength(JSON.stringify(argv)) > 64 * 1024
          || (request.stdin !== undefined && (typeof request.stdin !== 'string' || Buffer.byteLength(request.stdin) > 1024 * 1024))) {
          throw new Error('Invalid sandbox command or input bound');
        }
        args = [...argumentsForWorkspace(), JSON.stringify(argv)];
      } catch (error) {
        return { kind: 'launch-failed', stdout: '', stderr: '', exitCode: null, signal: null, diagnostic: String(error) };
      }
      return new Promise(resolve => {
        const child = spawn(bubblewrap, args, {
          cwd: '/', env: {}, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        });
        let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), status = Buffer.alloc(0);
        let bytes = 0;
        let stopped: 'deadline' | 'output-limit' | undefined;
        let launchError: Error | undefined;
        const stop = (reason: 'deadline' | 'output-limit') => {
          stopped ??= reason;
          child.kill('SIGKILL');
        };
        const timer = setTimeout(() => stop('deadline'), deadlineMs);
        const collect = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
          const retained = chunk.subarray(0, Math.max(0, outputBytes - bytes));
          if (stream === 'stdout') stdout = Buffer.concat([stdout, retained]);
          else stderr = Buffer.concat([stderr, retained]);
          bytes += chunk.length;
          if (bytes > outputBytes) stop('output-limit');
        };
        child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'stdout'));
        child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'stderr'));
        (child.stdio[3] as Readable).on('data', (chunk: Buffer) => {
          if (status.length + chunk.length > 1024) stop('output-limit');
          else status = Buffer.concat([status, chunk]);
        });
        child.once('error', error => { launchError = error; });
        child.stdin.on('error', () => { /* EPIPE is expected when the command does not consume input. */ });
        child.stdin.end(request.stdin);
        child.once('close', (exitCode, signal) => {
          clearTimeout(timer);
          // Malformed bytes can expand to U+FFFD on decoding. Budget returned
          // UTF-8 too, retaining whole code points with stdout allocated first;
          // separate streams do not imply a cross-stream time ordering.
          let remaining = outputBytes;
          const boundedText = (buffer: Buffer): string => {
            const text = buffer.toString('utf8');
            const encoded = Buffer.alloc(Math.min(remaining, Buffer.byteLength(text)));
            const { read, written } = new TextEncoder().encodeInto(text, encoded);
            remaining -= written;
            if (read < text.length) stopped ??= 'output-limit';
            return encoded.toString('utf8', 0, written);
          };
          const base = { stdout: boundedText(stdout), stderr: boundedText(stderr), exitCode, signal };
          if (stopped) return resolve({ ...base, kind: stopped });
          if (launchError) return resolve({ ...base, kind: 'launch-failed', diagnostic: launchError.message });
          // Treat fd3 as possibly accessible to same-uid sandbox code via /proc. Reports
          // never override actual termination, authorize effects or prove safety.
          try {
            const report: unknown = JSON.parse(status.toString('utf8'));
            if (report && typeof report === 'object' && !Array.isArray(report)
              && Object.keys(report).length === 1 && !signal) {
              if (Object.hasOwn(report, 'exitCode') && 'exitCode' in report && report.exitCode === exitCode
                && Number.isInteger(exitCode) && exitCode !== null && exitCode >= 0 && exitCode <= 255) {
                return resolve({ ...base, kind: 'exited' });
              }
              if (Object.hasOwn(report, 'launchError') && 'launchError' in report
                && typeof report.launchError === 'string' && report.launchError.length > 0 && exitCode === 125) {
                return resolve({ ...base, kind: 'indeterminate', diagnostic: 'Sandbox reports command startup failure: ' + report.launchError });
              }
            }
          } catch { /* Missing/malformed status is not evidence of successful startup. */ }
          resolve({ ...base, kind: 'indeterminate', diagnostic: 'Sandbox startup or termination could not be confirmed' });
        });
      });
    },
  });
}
