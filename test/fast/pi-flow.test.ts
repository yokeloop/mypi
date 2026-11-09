import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('.pi/settings.json starts pi-subagents children without ambient extensions and scans the engine and home role folders', () => {
  assert.deepEqual(JSON.parse(read('.pi/settings.json')), {
    subagents: { defaultExtensions: [], agentScanDirs: ['integrations/pi-flow', 'home/pi-flow'] },
  });
});

const ROLES: Record<string, { tools: string; acceptanceRole: string }> = {
  challenger: { tools: 'read, grep, find, ls, bash', acceptanceRole: 'read-only' },
  executor: { tools: 'read, grep, find, ls, bash, edit, write', acceptanceRole: 'writer' },
  investigator: { tools: 'read, grep, find, ls, bash', acceptanceRole: 'read-only' },
  planner: { tools: 'read, grep, find, ls, write', acceptanceRole: 'writer' },
  reviewer: { tools: 'read, grep, find, ls, bash', acceptanceRole: 'read-only' },
  scout: { tools: 'read, grep, find, ls, bash', acceptanceRole: 'read-only' },
  tester: { tools: 'read, grep, find, ls, bash, edit, write', acceptanceRole: 'writer' },
};

function frontmatter(text: string): Map<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert(match !== null, 'frontmatter');
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? '').split('\n')) {
    const colon = line.indexOf(':');
    assert(colon > 0, line);
    fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return fields;
}

function objects(schema: unknown): Record<string, unknown>[] {
  if (Array.isArray(schema)) return schema.flatMap(objects);
  if (schema === null || typeof schema !== 'object') return [];
  const node = schema as Record<string, unknown>;
  return [...('properties' in node ? [node] : []), ...Object.values(node).flatMap(objects)];
}

test('integrations/pi-flow holds exactly the seven engine roles, each with its tools, acceptance role, project context and a closed one-line answer schema, and no model or extensions', () => {
  const files = readdirSync(new URL('integrations/pi-flow/', root)).filter(file => file.endsWith('.md')).sort();
  assert.deepEqual(files, Object.keys(ROLES).sort().map(role => role + '.md'));
  for (const [role, expected] of Object.entries(ROLES)) {
    const fields = frontmatter(read(`integrations/pi-flow/${role}.md`));
    assert.equal(fields.get('name'), role);
    assert.ok((fields.get('description') ?? '').length > 0, role);
    assert.equal(fields.get('tools'), expected.tools, role);
    assert.equal(fields.get('acceptanceRole'), expected.acceptanceRole, role);
    assert.equal(fields.get('inheritProjectContext'), 'true', role);
    assert.equal(fields.has('model'), false, role);
    assert.equal(fields.has('extensions'), false, role);
    const schema = JSON.parse(fields.get('outputSchema') ?? '');
    assert.equal(schema.type, 'object', role);
    for (const node of objects(schema)) {
      assert.equal(node.additionalProperties, false, role);
      const keys = Object.keys(node.properties as object);
      for (const key of (node.required as string[] | undefined) ?? []) assert(keys.includes(key), `${role}: ${key}`);
    }
  }
  const reviewer = JSON.parse(frontmatter(read('integrations/pi-flow/reviewer.md')).get('outputSchema') ?? '');
  assert.deepEqual(reviewer.properties.status.enum, ['approved', 'changes_required']);
});
