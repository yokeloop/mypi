import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('every skill in integrations/skills has a frontmatter Pi can parse: its directory name, a description and no unquoted value with ": "', () => {
  const skills = readdirSync(new URL('integrations/skills/', root)).sort();
  assert.ok(skills.includes('flow'));
  assert.ok(skills.includes('epic'));
  for (const skill of skills) {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(read(`integrations/skills/${skill}/SKILL.md`));
    assert(match !== null, skill);
    const fields = new Map<string, string>();
    for (const line of (match[1] ?? '').split('\n')) {
      const colon = line.indexOf(': ');
      assert(colon > 0, `${skill}: ${line}`);
      const value = line.slice(colon + 2).trim();
      if (!/^'.*'$|^".*"$/.test(value)) assert(!value.includes(': '), `${skill}: unquoted value with ": " in ${line.slice(0, colon)}`);
      fields.set(line.slice(0, colon), value);
    }
    assert.equal(fields.get('name'), skill);
    assert.ok((fields.get('description') ?? '').replace(/^['"]|['"]$/g, '').trim().length > 0, skill);
  }
});
