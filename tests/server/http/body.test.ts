import { describe, expect, it } from 'vitest';
import { isJsonContentType, readJsonBody } from '../../../server/http/body.ts';

const LIMIT = 1024;

function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}): Request {
  let read = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      const next = chunks[read++];
      if (next) c.enqueue(next);
      else c.close();
    },
  });
  return new Request('https://atlas.test/x', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', ...headers },
    duplex: 'half',
  } as RequestInit);
}

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const err = e as { code: string; status: number };
    return { code: err.code, status: err.status };
  }
  throw new Error('expected failure');
}

describe('readJsonBody', () => {
  it('parses a small JSON body', async () => {
    expect(await readJsonBody(streamed([new TextEncoder().encode('{"a":1}')]), LIMIT)).toEqual({ a: 1 });
  });

  it('counts streamed bytes when Content-Length is absent and stops reading past the limit', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(400).fill(0x20);
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(chunk); // endless stream
      },
    });
    const r = new Request('https://atlas.test/x', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      duplex: 'half',
    } as RequestInit);
    expect(await failure(readJsonBody(r, LIMIT))).toEqual({ code: 'too-large', status: 413 });
    expect(pulled).toBeLessThan(10);
  });

  it('rejects a declared Content-Length above the limit without reading', async () => {
    const r = streamed([new TextEncoder().encode('{}')], { 'Content-Length': String(LIMIT + 1) });
    expect(await failure(readJsonBody(r, LIMIT))).toEqual({ code: 'too-large', status: 413 });
  });

  it('accepts exactly the limit', async () => {
    const s = `"${'a'.repeat(LIMIT - 2)}"`;
    expect(await readJsonBody(streamed([new TextEncoder().encode(s)]), LIMIT)).toHaveLength(LIMIT - 2);
  });

  it.each([
    ['empty body', [] as Uint8Array[]],
    ['invalid JSON', [new TextEncoder().encode('{"a":')]],
    ['invalid UTF-8', [new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])]],
  ])('%s → 400 invalid', async (_l, chunks) => {
    expect(await failure(readJsonBody(streamed(chunks), LIMIT))).toEqual({ code: 'invalid', status: 400 });
  });

  it.each(['-1', '1e3', 'abc', '1, 2'])('malformed Content-Length %j → 400', async (cl) => {
    const r = streamed([new TextEncoder().encode('{}')], { 'Content-Length': cl });
    expect(await failure(readJsonBody(r, LIMIT))).toEqual({ code: 'invalid', status: 400 });
  });

  it.each([
    ['application/json', true],
    ['application/json; charset=utf-8', true],
    ['Application/JSON; charset="UTF-8"', true],
    ['application/json; charset=iso-8859-1', false],
    ['text/json', false],
    ['application/jsonp', false],
    ['text/plain', false],
    ['', false],
  ])('content type %j → %s', (ct, ok) => {
    expect(isJsonContentType(ct || null)).toBe(ok);
  });

  it('wrong content type → 415 before reading', async () => {
    const r = new Request('https://atlas.test/x', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(await failure(readJsonBody(r, LIMIT))).toEqual({ code: 'invalid', status: 415 });
  });
});
