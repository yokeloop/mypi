import { fileURLToPath } from 'node:url';
import { checkBuildState, writeBuildState } from './build-state-core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv[2] === 'write') writeBuildState(root);
else if (process.argv[2] === 'check') checkBuildState(root);
else throw new Error('Use write or check');
