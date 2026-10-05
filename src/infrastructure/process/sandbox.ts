export interface SandboxPaths { worktree: string; agent: string; context: string; bridge: string; runtime: string; pi: string; node: string; sessionId: string; model: string; providerSocket: string }
export function sandboxArgs(p: SandboxPaths): string[] {
  // Preserve only the dedicated service PTY. Never use this on an inherited host-shell terminal.
  return ['--unshare-all', '--unshare-user', '--disable-userns', '--die-with-parent', '--cap-drop', 'ALL', '--clearenv',
    '--ro-bind', '/usr', '/usr', '--symlink', 'usr/lib', '/lib', '--ro-bind', '/lib64', '/lib64',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/home', '--dir', '/home/worker',
    '--bind', p.worktree, '/work', '--ro-bind', p.runtime + '/git-pointer', '/work/.git',
    '--bind', p.agent, '/home/worker/agent', '--ro-bind', p.context, '/context',
    '--dir', '/bridge', '--ro-bind', p.bridge, '/bridge/mypi.sock', '--ro-bind', p.providerSocket, '/bridge/provider.sock',
    '--ro-bind', p.runtime, '/runtime', '--ro-bind', p.pi, '/opt/pi', '--dir', '/tools', '--ro-bind', p.node, '/tools/node',
    '--setenv', 'PATH', '/tools:/usr/bin', '--setenv', 'HOME', '/home/worker', '--setenv', 'LANG', 'C.UTF-8',
    '--setenv', 'TERM', 'xterm-256color', '--setenv', 'PI_CODING_AGENT_DIR', '/home/worker/agent',
    '--setenv', 'PI_OFFLINE', '1', '--setenv', 'PI_TELEMETRY', '0', '--setenv', 'PI_SKIP_VERSION_CHECK', '1',
    '--setenv', 'MYPI_SESSION_ID', p.sessionId,
    '--setenv', 'GIT_CONFIG_NOSYSTEM', '1', '--setenv', 'GIT_CONFIG_GLOBAL', '/dev/null', '--chdir', '/work',
    '/opt/pi/pi', '--offline', '--no-approve', '--no-context-files', '--no-skills', '--no-prompt-templates', '--no-themes',
    '--extension', '/runtime/worker.mjs', '--session-id', p.sessionId,
    '--session-dir', '/home/worker/agent/sessions', '--model', p.model, '--name', 'mypi-task'];
}
