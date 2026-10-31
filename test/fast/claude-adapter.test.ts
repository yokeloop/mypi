import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tools } from '../../src/mcp/tools.js';

const read = (path: string) => readFileSync(new URL('../../../' + path, import.meta.url), 'utf8');

test('.mcp.json starts the built mypi MCP server with node from PATH', () => {
  assert.deepEqual(JSON.parse(read('.mcp.json')), { mcpServers: { mypi: { command: 'node', args: ['dist/src/mcp/main.js'] } } });
});

test('Claude settings allow exactly the mypi MCP tools, run session registration and the budgeted warmup on every SessionStart source, and emit events on Stop and Notification', () => {
  const settings = JSON.parse(read('.claude/settings.json'));
  assert.deepEqual(Object.keys(settings).sort(), ['$schema', 'hooks', 'permissions']);
  assert.equal(settings.$schema, 'https://json.schemastore.org/claude-code-settings.json');
  assert.deepEqual(Object.keys(settings.permissions), ['allow']);
  const allow: unknown = settings.permissions.allow;
  assert(Array.isArray(allow) && allow.every(rule => typeof rule === 'string' && rule.startsWith('mcp__mypi__')));
  assert.equal(new Set(allow).size, allow.length);
  assert.deepEqual(allow.map((rule: string) => rule.slice('mcp__mypi__'.length)).sort(), Object.keys(tools).sort());
  assert.deepEqual(settings.hooks, { SessionStart: [{ matcher: 'startup|resume|clear|compact|fork',
    hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/dist/src/cli/main.js" session register --agent claude --hook --pid "$PPID" >/dev/null 2>&1; '
      + 'node "$CLAUDE_PROJECT_DIR/dist/src/cli/main.js" warmup --max-chars 9500', timeout: 30 }] }],
    Stop: [{ hooks: [{ type: 'command',
      command: 'node "$CLAUDE_PROJECT_DIR/dist/src/cli/main.js" turn end --pid "$PPID" >/dev/null 2>&1', timeout: 10 }] }],
    Notification: [{ matcher: 'permission_prompt|elicitation_dialog', hooks: [{ type: 'command',
      command: 'node "$CLAUDE_PROJECT_DIR/dist/src/cli/main.js" event emit --waiting --hook --pid "$PPID" >/dev/null 2>&1', timeout: 10 }] }] });
});
