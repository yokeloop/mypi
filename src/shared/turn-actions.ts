export type TurnAction =
  | { kind: 'write'; path: string; cwd?: string; content?: string }
  | { kind: 'bash'; command: string; cwd?: string }
  | { kind: 'publish'; content?: string; title?: string }
  | { kind: 'context_write'; paths: string[] };
export type TurnActionReader = (transcriptPath: string) => TurnAction[] | undefined;
