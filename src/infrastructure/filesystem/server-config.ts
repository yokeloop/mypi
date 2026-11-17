export type ServerConfig = { url: string; token: string; device?: string };

export function readServerConfig(_file: string): ServerConfig | undefined {
  throw new Error('Not implemented');
}
