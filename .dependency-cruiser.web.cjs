const { join } = require('node:path');
const layers = ['shared', 'entities', 'features', 'widgets', 'pages', 'app'];
module.exports = {
  forbidden: [
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    { name: 'resolved-imports', severity: 'error', from: {}, to: { couldNotResolve: true } },
    ...layers.slice(0, -1).map((layer, i) => ({ name: 'fsd-layer-' + layer, severity: 'error',
      from: { path: '^web/src/' + layer + '/' }, to: { path: '^web/src/(' + layers.slice(i + 1).join('|') + ')/' } })),
    { name: 'fsd-slice-isolation', severity: 'error', from: { path: '^web/src/(entities|features|widgets|pages)/([^/]+)/' },
      to: { path: '^web/src/$1/', pathNot: '^web/src/$1/$2/' } },
    { name: 'fsd-public-api', severity: 'error', from: { path: '^web/src/([^/]+/[^/]+)/' },
      to: { path: '^web/src/(entities|features|widgets|pages)/[^/]+/(?!index\\.ts$)', pathNot: '^web/src/$1/' } },
    { name: 'fsd-public-api-app', severity: 'error', from: { path: '^web/src/app/' },
      to: { path: '^web/src/(entities|features|widgets|pages)/[^/]+/(?!index\\.ts$)' } },
    { name: 'web-not-engine', severity: 'error', from: { path: '^web/' }, to: { path: '^(src|test|scripts)/' } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: join(__dirname, 'web/tsconfig.json') },
    enhancedResolveOptions: { extensions: ['.ts', '.tsx', '.js'], exportsFields: ['exports'], conditionNames: ['import', 'browser', 'default'] },
  },
};
