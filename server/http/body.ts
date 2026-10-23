/**
 * Bounded JSON body reader. Enforces the limit twice: up front from
 * Content-Length (cheap rejection) and while streaming (a lying or absent
 * Content-Length cannot smuggle a larger body).
 */
import type { z } from 'zod';
import { HttpError } from './errors.ts';
import type { ApiIssue } from './errors.ts';

export function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const [type, ...params] = value.split(';');
  if (type?.trim().toLowerCase() !== 'application/json') return false;
  for (const p of params) {
    const [k, v] = p.split('=');
    if (k?.trim().toLowerCase() === 'charset') {
      const cs = v?.trim().replace(/^"|"$/g, '').toLowerCase();
      if (cs !== 'utf-8' && cs !== 'utf8') return false;
    }
  }
  return true;
}

export async function readJsonBody(request: Request, limitBytes: number): Promise<unknown> {
  if (!isJsonContentType(request.headers.get('Content-Type'))) {
    throw new HttpError('invalid', 'Content-Type must be application/json', { status: 415 });
  }
  const declared = request.headers.get('Content-Length');
  if (declared !== null) {
    if (!/^\d{1,15}$/.test(declared.trim())) throw new HttpError('invalid', 'Invalid Content-Length');
    if (Number(declared) > limitBytes) throw new HttpError('too-large', 'Request body is too large');
  }
  if (request.body === null) throw new HttpError('invalid', 'Request body is required');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limitBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError('too-large', 'Request body is too large');
    }
    chunks.push(value);
  }
  if (total === 0) throw new HttpError('invalid', 'Request body is required');

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError('invalid', 'Request body is not valid UTF-8');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError('invalid', 'Request body is not valid JSON');
  }
}

export function zodIssues(error: z.ZodError): ApiIssue[] {
  return error.issues.slice(0, 20).map((i) => ({
    path: i.path.map(String).join('.'),
    message: i.message,
  }));
}

/** Validates with a Zod schema; failures become 400 'invalid' with field issues (never echoing values). */
export function parseWith<T extends z.ZodType>(schema: T, value: unknown, what = 'Request body'): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError('invalid', `${what} is invalid`, { issues: zodIssues(result.error) });
  }
  return result.data;
}
