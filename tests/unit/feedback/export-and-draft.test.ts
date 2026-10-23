import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyText, downloadText, safeFilename } from '../../../src/feedback/index.ts';

import type * as FeedbackModule from '../../../src/feedback/index.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('copyText', () => {
  it('uses the async clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when the clipboard rejects', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    await expect(copyText('hello')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports failure honestly when nothing can copy', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    });
    await expect(copyText('hello')).resolves.toBe(false);
  });
});

describe('downloadText', () => {
  it('creates a text blob link, clicks it and revokes the URL', async () => {
    const create = vi.fn().mockReturnValue('blob:mock');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });

    expect(downloadText('my report', 'body text')).toBe(true);
    const blob = create.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('text/plain;charset=utf-8');
    await expect(blob.text()).resolves.toBe('body text');
    expect(clicks[0]?.download).toBe('my-report.txt');
    expect(document.querySelector('a[download]')).toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    expect(revoke).toHaveBeenCalledWith('blob:mock');
  });

  it('returns false when blob URLs are unsupported', () => {
    Object.defineProperty(URL, 'createObjectURL', { value: undefined, configurable: true });
    expect(downloadText('x', 'y')).toBe(false);
  });
});

describe('safeFilename', () => {
  it.each([
    ['report', 'report.txt'],
    ['report.txt', 'report.txt'],
    ['../../etc/passwd', 'etc-passwd.txt'],
    ['', 'correction.txt'],
    ['Block 34 / café', 'Block-34-caf.txt'],
  ])('%s -> %s', (input, expected) => {
    expect(safeFilename(input)).toBe(expected);
  });
});

describe('useCorrectionDraft (session storage)', () => {
  let fb: typeof FeedbackModule;
  const load = async () => {
    vi.resetModules();
    fb = await import('../../../src/feedback/index.ts');
  };

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await load();
  });

  it('keeps a half-written draft across a reload via sessionStorage only', async () => {
    fb.useCorrectionDraft.getState().update({ kind: 'wrong-hours', details: 'Closes at' });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.getItem('lpu-atlas:v1:correction-draft')).not.toBeNull();
    await load();
    expect(fb.useCorrectionDraft.getState().draft).toEqual({
      ...fb.EMPTY_DRAFT,
      kind: 'wrong-hours',
      details: 'Closes at',
    });
  });

  it('reset clears memory and storage', () => {
    fb.useCorrectionDraft.getState().update({ details: 'abc' });
    fb.useCorrectionDraft.getState().reset();
    expect(fb.useCorrectionDraft.getState().draft).toEqual(fb.EMPTY_DRAFT);
    expect(sessionStorage.length).toBe(0);
  });

  it('keeps an oversized draft in memory but not in storage', () => {
    fb.useCorrectionDraft.getState().update({ details: 'short text' });
    fb.useCorrectionDraft.getState().update({ details: 'x'.repeat(5000) });
    expect(fb.useCorrectionDraft.getState().draft.details).toHaveLength(5000);
    expect(sessionStorage.getItem('lpu-atlas:v1:correction-draft')).toBeNull();
  });

  it('ignores a corrupted stored draft', async () => {
    sessionStorage.setItem('lpu-atlas:v1:correction-draft', JSON.stringify({ kind: 'bogus' }));
    await load();
    expect(fb.useCorrectionDraft.getState().draft).toEqual(fb.EMPTY_DRAFT);
  });
});
