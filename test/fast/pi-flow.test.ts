import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Script } from 'node:vm';

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
  assert.deepEqual(reviewer.properties.outsidePlan, { type: 'array', items: { type: 'string' } });
  assert.ok(reviewer.required.includes('outsidePlan'));
  const tester = JSON.parse(frontmatter(read('integrations/pi-flow/tester.md')).get('outputSchema') ?? '');
  assert.deepEqual(tester.properties.handover.required, ['attach', 'teardown']);
  assert.ok(tester.required.includes('handover'));
});

test('integrations/pi-flow holds the three workflow templates, each opening with its header comment, free of nested async functions and compiling as a workflow body', () => {
  const files = readdirSync(new URL('integrations/pi-flow/', root)).filter(file => file.endsWith('.js')).sort();
  assert.deepEqual(files, ['investigate.js', 'parallel.js', 'standard.js']);
  for (const file of files) {
    const source = read(`integrations/pi-flow/${file}`);
    assert(source.startsWith('/*'), file);
    assert.doesNotMatch(source, /\basync\b/, file);
    assert.doesNotThrow(() => new Script('(async (runs, args) => {\n' + source + '\n})'), file);
  }
});

test('standard.js and parallel.js return each review round with its range and outside-plan files, fix blocking findings through resume, and stop before a fix when files lie outside the plan', async () => {
  const template = (file: string) => new Script('(async (runs, args) => {\n' + read(`integrations/pi-flow/${file}`) + '\n})').runInThisContext();
  const blocking = { severity: 'blocking', lens: 1, file: 'a.txt', line: 1, problem: 'p', evidence: 'e', fix: 'f' };
  const fixing = {
    implement: { runId: 'e1', structuredOutput: { base: 'b0', head: 'h1' } },
    'review-1': { structuredOutput: { status: 'changes_required', findings: [blocking], outsidePlan: [] } },
    'fix-1': { runId: 'e2', ok: true, structuredOutput: { base: 'b0', head: 'h2' } },
    'review-2': { structuredOutput: { status: 'approved', findings: [], outsidePlan: [] } },
  };
  const outside = {
    implement: fixing.implement,
    'review-1': { structuredOutput: { status: 'changes_required', findings: [blocking], outsidePlan: ['extra.txt'] } },
  };
  const stub = (results: Record<string, unknown>, calls: string[]) => ({ run: (key: string) => { calls.push(key); return Promise.resolve(results[key]); } });
  const prefixed = (results: Record<string, unknown>) => Object.fromEntries(Object.entries(results).map(([key, value]) => ['a-' + key, value]));
  const parts = { parts: [{ key: 'a', plan: '/p', worktree: '/w', taskDir: '/t', base: 'flow/x' }] };

  let calls: string[] = [];
  let result = await template('standard.js')(stub(fixing, calls), {});
  assert.deepEqual(calls, ['implement', 'review-1', 'fix-1', 'review-2']);
  assert.deepEqual(result.reviews, [
    { round: 1, range: 'b0..h1', status: 'changes_required', findings: [blocking], outsidePlan: [] },
    { round: 2, range: 'b0..h2', status: 'approved', findings: [], outsidePlan: [] },
  ]);
  assert.equal(result.fixes.length, 1);
  assert.equal(result.executor.runId, 'e2');

  calls = [];
  result = await template('standard.js')(stub(outside, calls), {});
  assert.deepEqual(calls, ['implement', 'review-1']);
  assert.deepEqual(result.fixes, []);
  assert.deepEqual(result.reviews[0].outsidePlan, ['extra.txt']);
  assert.equal(result.executor.runId, 'e1');

  calls = [];
  result = await template('parallel.js')(stub(prefixed(fixing), calls), parts);
  assert.deepEqual(calls, ['a-implement', 'a-review-1', 'a-fix-1', 'a-review-2']);
  assert.equal(result[0].key, 'a');
  assert.deepEqual(result[0].reviews, [
    { round: 1, range: 'b0..h1', status: 'changes_required', findings: [blocking], outsidePlan: [] },
    { round: 2, range: 'b0..h2', status: 'approved', findings: [], outsidePlan: [] },
  ]);
  assert.equal(result[0].fixes.length, 1);
  assert.equal(result[0].executor.runId, 'e2');

  calls = [];
  result = await template('parallel.js')(stub(prefixed(outside), calls), parts);
  assert.deepEqual(calls, ['a-implement', 'a-review-1']);
  assert.equal(result[0].key, 'a');
  assert.deepEqual(result[0].fixes, []);
  assert.deepEqual(result[0].reviews[0].outsidePlan, ['extra.txt']);
  assert.equal(result[0].executor.runId, 'e1');
});
