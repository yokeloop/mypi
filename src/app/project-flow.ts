import { createApp } from './create-app.js';
import { contextFiles } from '../infrastructure/filesystem/context-files.js';
import { projectGit } from '../infrastructure/git/project-git.js';
import { DEFAULT_TASK_BRANCH, parseFlow, parseIdentity } from '../modules/projects/public.js';
import type { ProjectFlow } from '../modules/projects/public.js';
import { InputError } from '../shared/errors.js';

interface FlowFiles { read(path: string): string | undefined; path(path: string): string }

export function flowFile(project: { org: string; slug: string }): string {
  return 'projects/' + project.org + '/' + project.slug + '/flow.json';
}

export function readProjectFlow(files: FlowFiles, project: { org: string; slug: string }): { source: 'file' | 'default'; flow: ProjectFlow } {
  const text = files.read(flowFile(project));
  if (text === undefined) return { source: 'default', flow: {} };
  return { source: 'file', flow: parseFlow(text, files.path(flowFile(project))) };
}

export function projectFlow(filename: string, root: string, reference: string) {
  const app = createApp(filename, true);
  try {
    const project = app.readSnapshot(() => {
      const projects = app.projects.list();
      if (/^[A-Z]+$/.test(reference)) return projects.find(p => p.code === reference);
      const { org, slug } = parseIdentity(reference);
      return projects.find(p => p.org === org && p.slug === slug);
    });
    if (!project) throw new InputError('Unknown project: ' + reference);
    const files = contextFiles(root);
    const { source, flow } = readProjectFlow(files, project);
    const integration = flow.integration
      ?? (project.checkoutPath === null ? 'main' : projectGit(project.checkoutPath).defaultBranch() ?? 'main');
    return {
      project: project.org + '/' + project.slug, code: project.code, source, file: files.path(flowFile(project)),
      integration, taskBranch: flow.taskBranch ?? DEFAULT_TASK_BRANCH, prTarget: flow.prTarget ?? integration,
      mergeMethod: flow.mergeMethod ?? 'merge', release: flow.release ?? null,
    };
  } finally { app.close(); }
}
