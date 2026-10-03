import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';

const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(report.summary.error, 0, JSON.stringify(report.summary.violations));
const graph = new Map(report.modules.map(m => [m.source, m]));
const walkFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walkFiles(dir + '/' + e.name) : [dir + '/' + e.name]);
const files = walkFiles('test');
for (const file of files) {
  assert(/^test\/(fast|boundary)\/[^/]+\.test\.ts$/.test(file) || /^test\/support\/.+\.ts$/.test(file),
    'Unknown test file: ' + file);
}
for (const profile of ['fast', 'boundary']) {
  assert(files.some(f => f.startsWith('test/' + profile + '/')), 'Missing profile: ' + profile);
}
const reached = roots => {
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const d of graph.get(file)?.dependencies ?? []) visit(d.resolved);
  };
  roots.forEach(visit);
  return seen;
};
const fast = reached(files.filter(f => f.startsWith('test/fast/')));
const all = reached(files.filter(f => /\.test\.ts$/.test(f)));
const network = /^(node:)?(net|http|https|http2|tls|dgram|dns)(\/|$)/;
for (const file of all) assert(!network.test(file), 'Test network dependency: ' + file);
for (const file of fast) {
  assert(!/^(node:)?(child_process|cluster|worker_threads)$/.test(file), 'Fast process dependency: ' + file);
}
for (const file of new Set([...files, ...all].filter(f => /^(test|src)\/.*\.ts$/.test(f)))) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = node => {
    if (file.startsWith('test/')) {
      if (ts.isIdentifier(node) || ts.isStringLiteral(node)) {
        assert(!['only', 'skip', 'todo'].includes(node.text), 'Focused/skipped test: ' + file);
      }
      if (ts.isStringLiteral(node)) assert(!node.text.includes('--test'), 'Nested runner: ' + file);
    }
    if (fast.has(file) && ts.isIdentifier(node)) {
      assert(!['setTimeout', 'setInterval', 'setImmediate', 'Atomics'].includes(node.text), 'Fast wait: ' + file);
    }
    if (ts.isCallExpression(node)) {
      assert(node.expression.kind !== ts.SyntaxKind.ImportKeyword, 'Dynamic import needs review: ' + file);
      if (ts.isIdentifier(node.expression)) {
        assert(!['require', 'eval', 'Function'].includes(node.expression.text), 'Dynamic execution: ' + file);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
console.log('Admission: module boundaries, discovery and reachable fast effects checked (not a sandbox proof)');
