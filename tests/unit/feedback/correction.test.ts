import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CORRECTION_KINDS,
  CORRECTION_KIND_LABELS,
  ISSUE_URL_MAX_LENGTH,
  correctionIssueUrl,
  correctionTitle,
  correctionToText,
  validateCorrection,
} from '../../../src/feedback/index.ts';
import type { CorrectionDraft } from '../../../src/feedback/index.ts';

const draft: CorrectionDraft = {
  kind: 'wrong-name',
  placeId: 'osm:way/123',
  placeName: 'Lovely Institute of Technology',
  details: 'The sign at the entrance shows a different name.',
  sourceUrl: 'https://example.org/photo',
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('validateCorrection', () => {
  it('accepts a complete draft and trims text', () => {
    const r = validateCorrection({ ...draft, details: `  ${draft.details}  ` });
    expect(r).toEqual({ ok: true, value: draft });
  });

  it('treats blank optional fields as absent', () => {
    const r = validateCorrection({
      kind: 'other',
      details: 'Something is wrong here.',
      placeId: '',
      sourceUrl: '  ',
    });
    expect(r).toEqual({ ok: true, value: { kind: 'other', details: 'Something is wrong here.' } });
  });

  it('enforces the details length bounds after trimming', () => {
    expect(validateCorrection({ kind: 'other', details: '   short   ' }).ok).toBe(false);
    expect(validateCorrection({ kind: 'other', details: 'x'.repeat(10) }).ok).toBe(true);
    expect(validateCorrection({ kind: 'other', details: 'x'.repeat(2000) }).ok).toBe(true);
    const tooLong = validateCorrection({ kind: 'other', details: 'x'.repeat(2001) });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.errors.join(' ')).toMatch(/2000/);
  });

  it('limits place names to 200 characters', () => {
    expect(validateCorrection({ ...draft, placeName: 'n'.repeat(200) }).ok).toBe(true);
    expect(validateCorrection({ ...draft, placeName: 'n'.repeat(201) }).ok).toBe(false);
  });

  it.each(['javascript:alert(1)', 'ftp://example.org/x', 'example.org', 'not a url', 'data:text/plain,hi'])(
    'rejects source url %s',
    (sourceUrl) => {
      const r = validateCorrection({ ...draft, sourceUrl });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.some((e) => /http/.test(e))).toBe(true);
    },
  );

  it('accepts http and https source urls', () => {
    expect(validateCorrection({ ...draft, sourceUrl: 'http://example.org' }).ok).toBe(true);
    expect(validateCorrection({ ...draft, sourceUrl: 'https://example.org/a?b=c' }).ok).toBe(true);
  });

  it('rejects unknown kinds and non-objects with readable errors', () => {
    const r = validateCorrection({ ...draft, kind: 'spam' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('Choose what kind of correction this is.');
    expect(validateCorrection(null).ok).toBe(false);
    expect(validateCorrection('text').ok).toBe(false);
  });

  it('has a label for every kind', () => {
    for (const k of CORRECTION_KINDS) expect(CORRECTION_KIND_LABELS[k]).toBeTruthy();
  });
});

describe('correctionToText', () => {
  it('includes kind label, place, details, source and dataset version', () => {
    const text = correctionToText(draft, 'abc123def');
    expect(text).toContain('Type: Wrong name');
    expect(text).toContain('Place: Lovely Institute of Technology');
    expect(text).toContain('Place id: osm:way/123');
    expect(text).toContain(draft.details);
    expect(text).toContain('Source: https://example.org/photo');
    expect(text).toContain('Dataset version: abc123def');
  });

  it('marks missing fields as not specified rather than inventing them', () => {
    const text = correctionToText({ kind: 'missing-facility', details: 'There is a water cooler here.' }, '');
    expect(text).toContain('Place: (not specified)');
    expect(text).toContain('Place id: (not specified)');
    expect(text).toContain('Source: (none given)');
    expect(text).toContain('Dataset version: unknown');
  });

  it('contains no coordinates, user agent or other device data', () => {
    const text = correctionToText(draft, 'v1abcdef');
    expect(text).not.toMatch(/\d{1,3}\.\d{3,}/);
    expect(text.toLowerCase()).not.toMatch(/lat|lon|location|user.?agent|mozilla|screen/);
    expect(text).not.toContain(navigator.userAgent);
  });
});

describe('correctionIssueUrl', () => {
  it('returns null when VITE_CORRECTIONS_URL is unset or empty', () => {
    vi.stubEnv('VITE_CORRECTIONS_URL', '');
    expect(correctionIssueUrl(draft, 'v1')).toBeNull();
    expect(correctionIssueUrl(draft, 'v1', undefined)).toBeNull();
  });

  it('reads the configured https URL from the environment', () => {
    vi.stubEnv('VITE_CORRECTIONS_URL', 'https://github.com/example/atlas/issues/new');
    const url = correctionIssueUrl(draft, 'v1abcdef');
    expect(url).not.toBeNull();
    const parsed = new URL(url ?? '');
    expect(parsed.origin + parsed.pathname).toBe('https://github.com/example/atlas/issues/new');
    expect(parsed.searchParams.get('title')).toBe(correctionTitle(draft));
    expect(parsed.searchParams.get('body')).toBe(correctionToText(draft, 'v1abcdef'));
  });

  it.each(['http://example.org/issues/new', 'javascript:alert(1)', 'not a url', 'ftp://example.org'])(
    'rejects non-https configured URL %s',
    (configured) => {
      expect(correctionIssueUrl(draft, 'v1', configured)).toBeNull();
    },
  );

  it('encodes special characters and keeps existing query params', () => {
    const tricky: CorrectionDraft = {
      kind: 'other',
      placeName: 'Café & Co #1',
      details: 'Line one\nLine two & more ?=%',
    };
    const url = correctionIssueUrl(tricky, 'v1', 'https://tracker.example/new?labels=data')!;
    expect(url).not.toMatch(/[\n #]/);
    expect(url).not.toContain('Café');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('labels')).toBe('data');
    expect(parsed.searchParams.get('title')).toBe('[Correction] Other: Café & Co #1');
    expect(parsed.searchParams.get('body')).toContain('Line one\nLine two & more ?=%');
  });

  it(`caps the URL at ${ISSUE_URL_MAX_LENGTH} characters by truncating the body`, () => {
    const long: CorrectionDraft = { kind: 'other', details: 'é✓ '.repeat(660) };
    const url = correctionIssueUrl(long, 'v1', 'https://tracker.example/new')!;
    expect(url.length).toBeLessThanOrEqual(ISSUE_URL_MAX_LENGTH);
    const body = new URL(url).searchParams.get('body')!;
    expect(body).toContain('Details truncated');
    expect(body.startsWith('LPU Campus Atlas')).toBe(true);
    expect(body).not.toContain('�');
    // Uses the available space rather than truncating far more than needed.
    expect(url.length).toBeGreaterThan(ISSUE_URL_MAX_LENGTH - 40);
  });

  it('keeps the place, source and dataset version when the details are truncated', () => {
    const long: CorrectionDraft = { ...draft, details: '中文'.repeat(1000) };
    const url = correctionIssueUrl(long, 'ds-2026-10', 'https://tracker.example/new')!;
    expect(url.length).toBeLessThanOrEqual(ISSUE_URL_MAX_LENGTH);
    const body = new URL(url).searchParams.get('body')!;
    expect(body).toContain('Details truncated');
    expect(body).toContain(`Place: ${draft.placeName}`);
    expect(body).toContain(`Source: ${draft.sourceUrl}`);
    expect(body.endsWith('Dataset version: ds-2026-10')).toBe(true);
  });

  it('falls back to truncating the whole body when the metadata alone is too long', () => {
    const huge: CorrectionDraft = {
      kind: 'other',
      placeName: '名'.repeat(200),
      details: 'details that are long enough',
      sourceUrl: `https://example.org/${'路'.repeat(1900)}`,
    };
    const url = correctionIssueUrl(huge, 'v1', 'https://tracker.example/new')!;
    expect(url.length).toBeLessThanOrEqual(ISSUE_URL_MAX_LENGTH);
    const body = new URL(url).searchParams.get('body')!;
    expect(body.startsWith('LPU Campus Atlas')).toBe(true);
    expect(body).toContain('Report truncated');
  });

  it('returns null when even an empty body cannot fit the configured URL', () => {
    expect(correctionIssueUrl(draft, 'v1', `https://tracker.example/${'a'.repeat(6000)}`)).toBeNull();
  });

  it('does not truncate a normal report', () => {
    const url = correctionIssueUrl(draft, 'v1', 'https://tracker.example/new')!;
    expect(new URL(url).searchParams.get('body')).not.toContain('truncated');
  });

  it('truncates very long titles', () => {
    const title = correctionTitle({ kind: 'other', placeName: 'p'.repeat(200), details: 'x'.repeat(20) });
    expect(Array.from(title).length).toBe(120);
    expect(title.endsWith('…')).toBe(true);
  });
});
