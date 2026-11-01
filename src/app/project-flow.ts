import { parseFlow } from '../modules/projects/public.js';
import type { ProjectFlow } from '../modules/projects/public.js';

export interface FlowFiles { read(path: string): string | undefined; path(path: string): string }

export function flowFile(project: { org: string; slug: string }): string {
  return 'projects/' + project.org + '/' + project.slug + '/flow.json';
}

export function readProjectFlow(files: FlowFiles, project: { org: string; slug: string }): { source: 'file' | 'default'; flow: ProjectFlow } {
  const text = files.read(flowFile(project));
  if (text === undefined) return { source: 'default', flow: {} };
  return { source: 'file', flow: parseFlow(text, files.path(flowFile(project))) };
}
