// Portable replacement for GNU timeout, used by build and tui:build on Linux and macOS.
// Runs the command in its own process group; after --time seconds sends SIGTERM to the
// group, after --kill-after more seconds SIGKILL. Exit codes: 124 time limit reached,
// 125 bad arguments, 126 command cannot be started, 127 command not found,
// 128+N command killed by signal N, otherwise the command's own exit code.
import { spawn } from 'node:child_process';
import { constants } from 'node:os';

const usage = 'Usage: node scripts/bounded.mjs --time <s> --kill-after <s> -- <command> [args…]';
const flags = { '--time': 'time', '--kill-after': 'killAfter' };

function parse(argv) {
  const options = {};
  let i = 0;
  for (; i < argv.length && argv[i] !== '--'; i += 2) {
    const name = flags[argv[i]];
    const value = Number(argv[i + 1]);
    if (!name || i + 1 >= argv.length || !Number.isFinite(value) || value <= 0) return undefined;
    options[name] = value;
  }
  const command = argv.slice(i + 1);
  if (i >= argv.length || command.length === 0 || Object.values(flags).some(name => options[name] === undefined)) return undefined;
  return { ...options, command };
}

const options = parse(process.argv.slice(2));
if (!options) {
  console.error(usage);
  process.exit(125);
}

const [cmd, ...args] = options.command;
const child = spawn(cmd, args, { stdio: 'inherit', detached: true });
let timedOut = false;

function killGroup(signal) {
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function groupAlive() {
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

child.on('error', error => {
  console.error(`bounded: ${cmd}: ${error.message}`);
  process.exit(error.code === 'ENOENT' ? 127 : 126);
});

const timer = setTimeout(() => {
  timedOut = true;
  killGroup('SIGTERM');
  setTimeout(() => {
    killGroup('SIGKILL');
    process.exit(124);
  }, options.killAfter * 1000);
}, options.time * 1000);

child.on('exit', (code, signal) => {
  if (timedOut) {
    if (!groupAlive()) process.exit(124);
    return;
  }
  clearTimeout(timer);
  process.exit(signal ? 128 + constants.signals[signal] : code);
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => killGroup(signal));
