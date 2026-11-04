export const SESSION_COOKIE = 'mypi_session', SESSION_MAX_AGE = 2_592_000;

export function readSessionCookie(header: string | undefined): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const pair = part.trim(), at = pair.indexOf('=');
    if (at !== -1 && pair.slice(0, at) === SESSION_COOKIE) return pair.slice(at + 1) || undefined;
  }
  return undefined;
}

function cookie(value: string, maxAge: number, secure: boolean): string {
  return SESSION_COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (secure ? '; Secure' : '');
}

export function sessionCookie(token: string, secure: boolean): string {
  return cookie(token, SESSION_MAX_AGE, secure);
}

export function clearSessionCookie(secure: boolean): string {
  return cookie('', 0, secure);
}
