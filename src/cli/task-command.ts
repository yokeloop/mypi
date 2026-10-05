// Thin host Pi command adapter. The process/UI ports are provided by Pi, not global state.
export interface TaskContext { cwd: string; ui: { notify(message: string, type: 'info' | 'error'): void } }
export interface TaskHost {
  exec(program: string, args: string[], options: { cwd: string; timeout: number }): Promise<{ code: number; stdout: string; stderr: string }>;
  registerCommand(name: string, command: { description: string; handler(args: string, ctx: TaskContext): Promise<void> }): void;
}
export function registerTask(pi: TaskHost, root: string, cli: string): void {
  async function run(args: string[]): Promise<Record<string, unknown>> {
    const result = await pi.exec('mise', ['exec', '--', 'node', cli, ...args], { cwd: root, timeout: 10000 });
    if (result.code !== 0) throw new Error(result.stderr || 'Task command failed');
    return JSON.parse(result.stdout) as Record<string, unknown>;
  }
  pi.registerCommand('task', {
    description: 'Create a card only: JSON {title,status,slug,source,project?}; never starts a worker',
    handler: async (args, ctx) => {
      try {
        const raw: unknown = JSON.parse(args);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected a task object');
        const value = raw as Record<string, unknown>;
        if (Object.keys(value).some(k => !['title', 'status', 'slug', 'source', 'project'].includes(k)) ||
          ['title', 'status', 'slug', 'source'].some(k => typeof value[k] !== 'string' || !value[k].trim())) throw new Error('Expected title/status/slug/source strings');
        let project = value.project;
        if (project === undefined) {
          const resolved = await run(['project', 'resolve', ctx.cwd]);
          if (resolved.match !== 'project') throw new Error('Specify project explicitly (or null); checkout is not uniquely registered');
          project = resolved.identity;
        }
        if (project !== null && typeof project !== 'string') throw new Error('Invalid project');
        const created = await run(['request', 'create', '--title', value.title as string, '--status', value.status as string, '--slug', value.slug as string,
          ...(project === null ? [] : ['--project', project]), '--', value.source as string]);
        ctx.ui.notify(JSON.stringify(created) + ' — card only; no run launched', 'info');
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); }
    },
  });
}
