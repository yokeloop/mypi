const { readdirSync } = require('node:fs');
module.exports = {
  forbidden: [
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    { name: 'resolved-imports', severity: 'error', from: {}, to: { couldNotResolve: true } },
    { name: 'production-only', severity: 'error', from: { path: '^src/' }, to: { path: '^(test|scripts)/' } },
    { name: 'shared-is-pure', severity: 'error', from: { path: '^src/shared/' }, to: { pathNot: '^src/shared/' } },
    { name: 'core-no-io', severity: 'error', from: { path: '^src/modules/[^/]+/(?!adapters/)' },
      to: { pathNot: '^src/(modules|shared)/' } },
    { name: 'adapters-no-orchestration', severity: 'error', from: { path: '^src/modules/' },
      to: { path: '^src/(app|cli|mcp)/' } },
    { name: 'infrastructure-direction', severity: 'error', from: { path: '^src/infrastructure/' },
      to: { path: '^src/(modules|app|cli|mcp)/' } },
    { name: 'cli-uses-app', severity: 'error', from: { path: '^src/cli/' },
      to: { path: '^src/(modules|infrastructure)/' } },
    { name: 'app-no-entrypoints', severity: 'error', from: { path: '^src/app/' }, to: { path: '^src/(cli|mcp)/' } },
    { name: 'mcp-uses-app', severity: 'error', from: { path: '^src/mcp/' }, to: { path: '^src/(cli|modules|infrastructure)/' } },
    { name: 'cli-no-mcp', severity: 'error', from: { path: '^src/cli/' }, to: { path: '^src/mcp/' } },
    { name: 'protocol-at-boundary', severity: 'error', from: { path: '^src/(?!mcp/)' },
      to: { path: 'node_modules/(@modelcontextprotocol/|zod/)' } },
    ...readdirSync('src/modules').map(name => ({
      name: name + '-public-api', severity: 'error',
      from: { pathNot: '^(src/modules/' + name + '/|src/app/(create-app|create-workspace|journal-storage)\\.ts$)' },
      to: { path: '^src/modules/' + name + '/(?!public\\.ts$)' },
    })),
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { extensions: ['.ts', '.js', '.json'], exportsFields: ['exports'], conditionNames: ['import', 'node', 'default'] },
  },
};
