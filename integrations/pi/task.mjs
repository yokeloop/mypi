// Explicit host loading only. No global installation or automatic worker launch.
import { fileURLToPath } from 'node:url';
import { registerTask } from '../../dist/src/cli/task-command.js';

export default function(pi) {
  registerTask(pi, fileURLToPath(new URL('../../', import.meta.url)),
    fileURLToPath(new URL('../../dist/src/cli/main.js', import.meta.url)));
}
