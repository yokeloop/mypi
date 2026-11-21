// Portable replacement for GNU timeout, used by build and tui:build on Linux and macOS.
// Runs the command in its own process group; after --time seconds sends SIGTERM to the
// group, after --kill-after more seconds SIGKILL. Exit codes: 124 time limit reached,
// 125 bad arguments, 126 command cannot be started, 127 command not found,
// 128+N command killed by signal N, otherwise the command's own exit code.
// --name takes the lock <tmpdir>/<name>.lock (a second live run exits 1 with
// "already running", an abandoned lock is removed) and gives the command a private
// run directory in MYPI_BOUNDED_DIR and this supervisor's pid in MYPI_BOUNDED_PID.
// --memory and --tasks poll /bin/ps every 200 ms: the command's group and every
// descendant seen so far; above the summed RSS or the process count the tree is
// killed and the run exits 1. After the command exits, a seen descendant still alive
// is reported as "Surviving child", killed, and fails the run. A clean run prints a
// Cost line (and CPU from the run directory's cost file). On macOS the polling and
// the audit stand in for the cgroup and the PID namespace (docs/TESTING.md §6).
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';

const usage = 'Usage: node scripts/bounded.mjs --time <s> --kill-after <s> [--name <name>] [--memory <n>[K|M|G] --tasks <n>] -- <command> [args…]';
const flags = { '--time': 'time', '--kill-after': 'killAfter' };
const units = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
const optional = {
  '--name': ['name', value => /^[a-z0-9-]+$/.test(value) ? value : undefined],
  '--memory': ['memory', value => {
    const match = /^(\d+)([KMG]?)$/.exec(value);
    return match && Number(match[1]) > 0 ? Number(match[1]) * units[match[2]] : undefined;
  }],
  '--tasks': ['tasks', value => /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : undefined],
};

function parse(argv) {
  const options = {};
  let i = 0;
  for (; i < argv.length && argv[i] !== '--'; i += 2) {
    if (i + 1 >= argv.length) return undefined;
    if (optional[argv[i]]) {
      const [name, read] = optional[argv[i]];
      const value = read(argv[i + 1]);
      if (value === undefined) return undefined;
      options[name] = value;
      continue;
    }
    const name = flags[argv[i]];
    const value = Number(argv[i + 1]);
    if (!name || !Number.isFinite(value) || value <= 0) return undefined;
    options[name] = value;
  }
  const command = argv.slice(i + 1);
  if (i >= argv.length || command.length === 0 || Object.values(flags).some(name => options[name] === undefined)) return undefined;
  if ((options.memory === undefined) !== (options.tasks === undefined)) return undefined;
  return { ...options, command };
}

let lock;
let runDir;

function finish(code) {
  if (runDir) rmSync(runDir, { recursive: true, force: true });
  if (lock && holder(lock) === process.pid) rmSync(lock, { recursive: true, force: true });
  process.exit(code);
}

function say(fd, line) {
  writeSync(fd, line + '\n');
}

function holder(path) {
  try {
    return Number(readFileSync(join(path, 'pid'), 'utf8'));
  } catch {
    return 0;
  }
}

function alive(pid) {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function acquire(base, name) {
  const target = join(base, name + '.lock');
  for (let attempt = 0; ; attempt++) {
    const staging = mkdtempSync(join(base, name + '.lock.'));
    writeFileSync(join(staging, 'pid'), String(process.pid));
    try {
      renameSync(staging, target);
      return target;
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') throw error;
    }
    const pid = holder(target);
    if (attempt > 0 || alive(pid)) {
      say(2, `bounded: ${name} already running (pid ${pid})`);
      finish(1);
    }
    rmSync(target, { recursive: true, force: true });
  }
}

const options = parse(process.argv.slice(2));
if (!options) {
  console.error(usage);
  finish(125);
}

const watched = options.memory !== undefined;
let env = process.env;
if (options.name) {
  const base = realpathSync(tmpdir());
  lock = acquire(base, options.name);
  runDir = mkdtempSync(join(base, options.name + '.'));
  env = { ...process.env, MYPI_BOUNDED_DIR: runDir, MYPI_BOUNDED_PID: String(process.pid) };
}

const [cmd, ...args] = options.command;
const started = Date.now();
const child = spawn(cmd, args, { stdio: 'inherit', detached: true, env });
let timedOut = false;
let exited = false;
const seen = new Set();
let memoryPeak = 0;
let tasksPeak = 0;
let polling = false;

function killGroup(signal) {
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function killSeen() {
  for (const pid of seen) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
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

function measure(stdout) {
  const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const children = new Map();
  for (const [pid, ppid] of rows) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  const tree = new Set(rows.filter(([pid, , pgid]) => pgid === child.pid || pid === child.pid || seen.has(pid)).map(([pid]) => pid));
  const queue = [...tree, ...seen];
  while (queue.length) {
    for (const pid of children.get(queue.pop()) ?? []) {
      if (!tree.has(pid)) {
        tree.add(pid);
        queue.push(pid);
      }
    }
  }
  let memory = 0;
  for (const [pid, , , rss] of rows) if (tree.has(pid)) memory += rss * 1024;
  for (const pid of tree) seen.add(pid);
  memoryPeak = Math.max(memoryPeak, memory);
  tasksPeak = Math.max(tasksPeak, tree.size);
  let exceeded;
  if (memory > options.memory) exceeded = `memory limit exceeded (${memory} > ${options.memory})`;
  else if (tree.size > options.tasks) exceeded = `tasks limit exceeded (${tree.size} > ${options.tasks})`;
  if (!exceeded) return;
  say(2, `bounded: ${exceeded}`);
  killGroup('SIGKILL');
  killSeen();
  finish(1);
}

function poll() {
  if (polling || exited) return;
  polling = true;
  execFile('/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid=,rss='], (error, stdout) => {
    polling = false;
    if (!error && !exited) measure(stdout);
  });
}

child.on('error', error => {
  console.error(`bounded: ${cmd}: ${error.message}`);
  finish(error.code === 'ENOENT' ? 127 : 126);
});

let poller;
if (watched && child.pid) {
  poll();
  poller = setInterval(poll, 200);
}

const timer = setTimeout(() => {
  timedOut = true;
  killGroup('SIGTERM');
  setTimeout(() => {
    killGroup('SIGKILL');
    killSeen();
    finish(124);
  }, options.killAfter * 1000);
}, options.time * 1000);

function cost() {
  const peaks = `memory_peak=${memoryPeak} tasks_peak=${tasksPeak}`;
  let text;
  try {
    text = readFileSync(join(runDir, 'cost'), 'utf8');
  } catch {
    say(1, `Cost: wall=${Date.now() - started}ms ${peaks}`);
    return;
  }
  const values = Object.fromEntries(text.trim().split('\n').map(line => line.split('=')));
  say(1, `Cost: wall=${values.wall}ms fast=${values.fast}ms ${peaks}`);
  say(1, `CPU: ${values.cpu_us} us`);
}

child.on('exit', (code, signal) => {
  exited = true;
  clearInterval(poller);
  if (timedOut) {
    if (!groupAlive()) {
      killSeen();
      finish(124);
    }
    return;
  }
  clearTimeout(timer);
  const status = signal ? 128 + constants.signals[signal] : code;
  if (!watched) finish(status);
  const survivors = [...seen].filter(alive);
  for (const pid of survivors) say(2, `Surviving child: ${pid}`);
  const group = groupAlive();
  if (group && !survivors.length) say(2, `Surviving child: group ${child.pid}`);
  killSeen();
  killGroup('SIGKILL');
  if (survivors.length || group) finish(status === 0 ? 1 : status);
  if (status === 0) cost();
  finish(status);
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => killGroup(signal));
