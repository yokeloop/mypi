export interface WorkspaceCommand {
  type: 'workspace';
  name: string;
  args: string[];
  options: Record<string, string | boolean | undefined>;
}
