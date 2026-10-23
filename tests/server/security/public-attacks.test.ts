/**
 * Red-team: attacks through the PUBLIC endpoints (contributions + publication).
 * Every case asserts the security invariant, not just a status code.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSaltMemo } from '../../../server/auth/salt.ts';
import { clientIdentifier } from '../../../server/auth/rate-limit.ts';
import { contributionInputSchema } from '../../../src/community/schema.ts';
import { errorCode, ORIGIN, validSuggestion } from '../http/fixtures.ts';
import { createTestDb, resetTables } from '../http/harness.ts';
import { asOwner, makeKit, publication, publicationVersion, submit } from './helpers.ts';
import type { Kit } from './helpers.ts';

let k: Kit;

beforeAll(async () => {
  k = await makeKit(await createTestDb());
});
afterAll(async () => k.t.dispose());
beforeEach(async () => {
  await resetTables(k.t.db);
  resetSaltMemo();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('self-publication through the public route', () => {
  it('no combination of injected fields (incl. __proto__/constructor) publishes or pre-approves anything', async () => {
    const v0 = await publicationVersion(k);
    const raw = `{
      "name": "Injected Place", "categoryId": "library", "location": [75.7049, 31.2536],
      "status": "approved", "approved": true, "published": true, "isAdmin": true, "role": "owner",
      "reviewer": "owner", "reviewedBy": "owner", "reviewedAt": "2026-01-01T00:00:00.000Z",
      "revision": 99, "id": "sug_aaaaaaaaaaaaaaaaaaaaaaaaaa", "reference": "sug_bbbbbbbbbbbbbbbbbbbbbbbbbb",
      "origin": "owner", "publishedLocationId": "com:aaaaaaaaaaaaaaaaaaaaaaaaaa", "actor": "owner",
      "__proto__": { "status": "approved", "isAdmin": true, "website": "trap" },
      "constructor": { "prototype": { "status": "approved" } }
    }`;
    const res = await submit(k, { raw });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { reference: string; status: string };
    expect(body.status).toBe('pending');
    expect(body.reference).not.toBe('sug_aaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(body.reference).not.toBe('sug_bbbbbbbbbbbbbbbbbbbbbbbbbb');

    const rows = await k.t.db.prepare('SELECT * FROM suggestions').all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({
      id: body.reference,
      status: 'pending',
      revision: 1,
      reviewed_by: null,
      reviewed_at: null,
      published_location_id: null,
    });
    expect(await k.t.count('locations')).toBe(0);
    expect(await publicationVersion(k)).toBe(v0);
    // Global prototypes untouched.
    expect(({} as Record<string, unknown>).status).toBeUndefined();
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    const audit = await k.t.db
      .prepare('SELECT actor, action FROM audit_events WHERE entity_id = ?')
      .bind(body.reference)
      .all();
    expect(audit.results).toEqual([{ actor: 'public', action: 'suggestion.create' }]);
  });

  it('a nested __proto__ cannot smuggle the honeypot or any field', async () => {
    const res = await submit(k, {
      raw: JSON.stringify(validSuggestion()).replace(/}$/, ',"__proto__":{"name":"Evil","website":"x"}}'),
    });
    expect(res.status).toBe(201);
    const row = await k.t.db.prepare('SELECT name FROM suggestions').first<{ name: string }>();
    expect(row?.name).toBe('Quiet Study Corner');
  });
});

describe('cross-site request forgery against the public route', () => {
  it.each([
    ['Origin: null (sandboxed iframe / data: URL)', { origin: 'null' }],
    ['foreign Origin', { origin: 'https://evil.example' }],
    ['look-alike Origin', { origin: `${ORIGIN}.evil.example` }],
    ['scheme downgrade', { origin: ORIGIN.replace('https:', 'http:') }],
    [
      'Sec-Fetch-Site cross-site without Origin',
      { origin: null, headers: { 'Sec-Fetch-Site': 'cross-site' } },
    ],
    ['Sec-Fetch-Site same-site (sibling subdomain)', { headers: { 'Sec-Fetch-Site': 'same-site' } }],
  ] as const)('%s → 403, nothing stored', async (_l, o) => {
    const res = await submit(k, { body: validSuggestion(), ...o });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('csrf');
    expect(await k.t.count('suggestions')).toBe(0);
  });

  it('a simple cross-site form POST (text/plain, no preflight) → 415, nothing stored', async () => {
    const res = await submit(k, {
      raw: JSON.stringify(validSuggestion()),
      headers: { 'Content-Type': 'text/plain' },
      origin: null,
    });
    expect(res.status).toBe(415);
    expect(await k.t.count('suggestions')).toBe(0);
  });
});

describe('hostile text', () => {
  it.each([
    ['RTL override (display spoofing)', 'Library‮yrarbil'],
    ['LTR embedding', 'Gate ‪one'],
    ['bidi isolate', 'Gate ⁦one⁩'],
    ['C1 control (NEL)', 'Block\u008534'],
    ['C1 control (CSI)', 'Block\u009B34'],
    ['lone high surrogate', 'Block \uD800 34'],
    ['lone low surrogate', 'Block \uDC00 34'],
  ])('rejects %s in the name with 400 (never 500), nothing stored', async (_l, name) => {
    const res = await submit(k, { body: validSuggestion({ name }) });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('invalid');
    expect(await k.t.count('suggestions')).toBe(0);
  });

  it('rejects bidi controls in multi-line fields too', () => {
    expect(contributionInputSchema.safeParse(validSuggestion({ details: 'ok‮gnp.exe' })).success).toBe(false);
  });

  it.each([
    ['Gurmukhi', 'ਲਾਇਬ੍ਰੇਰੀ ਬਲਾਕ'],
    ['Devanagari with ZWJ/ZWNJ', 'पुस्त‍कालय‌ ब्लॉक'],
    ['emoji with surrogate pairs', 'Café ☕ 🍕 corner'],
    ['Arabic with RLM', 'مكتبة‏ 34'],
  ])('accepts legitimate %s text', async (_l, name) => {
    const res = await submit(k, { body: validSuggestion({ name }) });
    expect(res.status).toBe(201);
    const row = await k.t.db.prepare('SELECT name FROM suggestions').first<{ name: string }>();
    expect(row?.name).toBe(name);
  });

  it('stores XSS payloads verbatim and returns them only as nosniff JSON', async () => {
    const name = '<img src=x onerror=alert(1)>';
    const details = '</script><script>alert(document.cookie)</script>';
    const created = await submit(k, { body: validSuggestion({ name, details }) });
    expect(created.status).toBe(201);
    const { reference } = (await created.json()) as { reference: string };
    const res = await asOwner(k, 'GET', `/suggestions/${reference}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    const body = (await res.json()) as { suggestion: { name: string; details: string } };
    expect(body.suggestion.name).toBe(name);
    expect(body.suggestion.details).toBe(details);
  });
});

describe('resource exhaustion', () => {
  it('a chunked body without Content-Length larger than 8 KB → 413, nothing stored', async () => {
    const chunk = new TextEncoder().encode(' '.repeat(1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ < 64) c.enqueue(chunk);
        else c.close();
      },
    });
    const request = new Request(`${ORIGIN}/api/contributions/locations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body,
      duplex: 'half',
    } as RequestInit);
    expect(request.headers.get('Content-Length')).toBeNull();
    const { handleContribution } = await import('../../../server/handlers/contributions.ts');
    const { pwDeps } = await import('./helpers.ts');
    const res = await handleContribution(request, pwDeps(k));
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(64); // stopped reading early
    expect(await k.t.count('suggestions')).toBe(0);
  });

  it.each([
    ['deep array nesting', `${'['.repeat(4000)}${']'.repeat(4000)}`],
    ['deep object nesting in an unknown key', `{"x":${'{"a":'.repeat(1300)}1${'}'.repeat(1300)}}`],
    ['deep nesting inside a typed field', `{"name":${'['.repeat(3000)}${']'.repeat(3000)}}`],
  ])('JSON bomb (%s) within the size limit → 400, not 500', async (_l, raw) => {
    expect(raw.length).toBeLessThan(8 * 1024);
    const res = await submit(k, { raw });
    expect(res.status).toBe(400);
    expect(await k.t.count('suggestions')).toBe(0);
  });
});

describe('rate-limit identity', () => {
  it('ignores spoofable forwarding headers', () => {
    const headers = {
      'CF-Connecting-IP': '198.51.100.20',
      'X-Forwarded-For': '1.1.1.1',
      'True-Client-IP': '2.2.2.2',
      'X-Real-IP': '3.3.3.3',
      Forwarded: 'for=4.4.4.4',
    };
    expect(clientIdentifier(new Request(ORIGIN, { headers }))).toBe(
      clientIdentifier(new Request(ORIGIN, { headers: { 'CF-Connecting-IP': '198.51.100.20' } })),
    );
  });

  it.each([
    ['case change', '2001:DB8:AB:CD::1', '2001:db8:ab:cd::1'],
    ['zero-compression variants', '2001:0db8:00ab:00cd:0000:0000:0000:0001', '2001:db8:ab:cd::1'],
    ['another host in the same /64', '2001:db8:ab:cd:ffff:1234:5678:9abc', '2001:db8:ab:cd::1'],
    ['zone id', 'fe80::1%eth0', 'fe80::2'],
    ['IPv4-mapped IPv6', '::ffff:198.51.100.20', '198.51.100.20'],
    ['IPv4-mapped IPv6 (hex form)', '::ffff:c633:6414', '198.51.100.20'],
    ['IPv4 with leading zeros', '198.051.100.020', '198.51.100.20'],
  ])('%s maps to the same client', (_l, a, b) => {
    const id = (ip: string) => clientIdentifier(new Request(ORIGIN, { headers: { 'CF-Connecting-IP': ip } }));
    expect(id(a)).toBe(id(b));
  });

  it('different /64 networks and different IPv4 hosts stay distinct', () => {
    const id = (ip: string) => clientIdentifier(new Request(ORIGIN, { headers: { 'CF-Connecting-IP': ip } }));
    expect(id('2001:db8:ab:cd::1')).not.toBe(id('2001:db8:ab:ce::1'));
    expect(id('198.51.100.20')).not.toBe(id('198.51.100.21'));
  });

  it('rotating IPv6 addresses inside one /64 does not bypass the contribution limit', async () => {
    const statuses: number[] = [];
    for (let i = 1; i <= 7; i++) {
      const res = await submit(k, {
        body: validSuggestion({ name: `Rotating Place ${i}` }),
        ip: `2001:db8:1:2:${i.toString(16)}::${(i * 7).toString(16)}`,
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    expect(await k.t.count('suggestions')).toBe(5);
    const buckets = await k.t.db.prepare('SELECT bucket FROM rate_limits').all<{ bucket: string }>();
    expect(JSON.stringify(buckets.results)).not.toMatch(/2001|db8/);
  });
});

describe('GET /api/locations leaks nothing private', () => {
  it('omits pending/rejected suggestions, hidden locations, notes, actors and review data', async () => {
    const mk = async (name: string, details: string) => {
      const r = await submit(k, { body: validSuggestion({ name, details, landmark: `LM ${name}` }) });
      return ((await r.json()) as { reference: string }).reference;
    };
    const pending = await mk('Pending Secret Spot', 'PRIVATE-DETAILS-1');
    const rejected = await mk('Rejected Secret Spot', 'PRIVATE-DETAILS-2');
    const approved = await mk('Approved Public Spot', 'PRIVATE-DETAILS-3');
    expect(
      (
        await asOwner(k, 'POST', `/suggestions/${rejected}/reject`, {
          body: { revision: 1, reason: 'PRIVATE-REASON' },
        })
      ).status,
    ).toBe(200);
    expect(
      (await asOwner(k, 'POST', `/suggestions/${approved}/approve`, { body: { revision: 1 } })).status,
    ).toBe(200);

    const created = await asOwner(k, 'POST', '/locations', {
      body: { fields: { name: 'Hidden Owner Spot', categoryId: 'food', location: [75.7049, 31.2536] } },
    });
    const hiddenId = ((await created.json()) as { id: string }).id;
    expect((await asOwner(k, 'POST', `/locations/${hiddenId}/hide`, { body: { revision: 1 } })).status).toBe(
      200,
    );
    const ov = await asOwner(k, 'PUT', `/overrides/${encodeURIComponent('cur:central-library')}`, {
      body: {
        revision: null,
        fields: { openingHours: '08:00-20:00' },
        hidden: false,
        note: 'PRIVATE-OVERRIDE-NOTE',
      },
    });
    expect(ov.status).toBe(200);

    const res = await publication(k);
    const text = await res.text();
    expect(text).toContain('Approved Public Spot');
    expect(text).toContain('08:00-20:00');
    for (const secret of [
      'Pending Secret Spot',
      'Rejected Secret Spot',
      'Hidden Owner Spot',
      hiddenId,
      pending,
      rejected,
      approved,
      'PRIVATE-',
      'LM ',
      'owner@example.org',
      'sug_',
      'reviewed',
      'suggestionId',
      'createdBy',
      'updatedBy',
      'accessNote',
      'note',
    ])
      expect(text).not.toContain(secret);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('the public contribution response never reveals other pending submissions', async () => {
    await submit(k, { body: validSuggestion({ name: 'Secret Pending Duplicate' }), ip: '198.51.100.1' });
    const res = await submit(k, {
      body: validSuggestion({ name: 'Secret Pending Duplicate' }),
      ip: '198.51.100.2',
    });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toMatch(/"kind":"suggestion"|sug_[a-z2-7]{26}"[^}]*Secret/);
    const body = JSON.parse(text) as { possibleDuplicates: Array<{ kind: string }> };
    expect(body.possibleDuplicates.every((d) => d.kind !== 'suggestion')).toBe(true);
  });
});
