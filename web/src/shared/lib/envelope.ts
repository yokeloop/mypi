export type Rec = Record<string, unknown>;
export type Page = { items: Rec[]; next: string | null };

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const isRecord = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);
const badResponse = () => new ApiFailure(200, 'bad_response', 'Unexpected response');

export function unwrap(status: number, body: unknown): unknown {
  if (isRecord(body) && isRecord(body.error)) {
    const { code, message } = body.error;
    throw new ApiFailure(status, typeof code === 'string' ? code : 'http_' + status,
      typeof message === 'string' ? message : 'HTTP ' + status);
  }
  if (status < 200 || status > 299) throw new ApiFailure(status, 'http_error', 'HTTP ' + status);
  if (isRecord(body) && 'data' in body) return body.data;
  throw new ApiFailure(status, 'bad_response', 'Unexpected response');
}

export function asItems(data: unknown): Rec[] {
  if (!isRecord(data) || !Array.isArray(data.items)) throw badResponse();
  return data.items.filter(isRecord);
}

export function asPage(data: unknown): Page {
  const items = asItems(data);
  const next = (data as Rec).next;
  return { items, next: typeof next === 'string' ? next : null };
}

export function asRecord(data: unknown): Rec {
  if (!isRecord(data)) throw badResponse();
  return data;
}
