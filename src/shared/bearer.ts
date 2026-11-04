export function bearer(authorization: string | undefined): string | undefined {
  return /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization ?? '')?.[1];
}
