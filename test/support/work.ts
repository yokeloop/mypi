import { join } from 'node:path';
export const work = process.cwd();
export const fromWork = (...parts: string[]) => join(work, ...parts);
export const toolsPath = fromWork('tools');
export const systemPath = `${toolsPath}:/usr/bin:/bin`;
