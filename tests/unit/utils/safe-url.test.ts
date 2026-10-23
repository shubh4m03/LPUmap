import { describe, expect, it } from 'vitest';
import { mailHref, safeExternalUrl, telHref } from '../../../src/utils/safe-url.ts';

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

describe('safeExternalUrl', () => {
  it('accepts absolute http(s) URLs and normalises them', () => {
    expect(safeExternalUrl('https://www.lpu.in')).toBe('https://www.lpu.in/');
    expect(safeExternalUrl('HTTP://Example.COM/a%20b')).toBe('http://example.com/a%20b');
    expect(safeExternalUrl('  https://example.com/path?q=1#x  ')).toBe('https://example.com/path?q=1#x');
    expect(safeExternalUrl('https://example.com:8443/')).toBe('https://example.com:8443/');
  });

  it.each([
    undefined,
    '',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com/',
    'mailto:a@example.com',
    '/relative/path',
    'relative/path',
    '//evil.example/',
    'https:evil.example',
    'https:/evil.example',
    'https:///evil.example',
    'https://user:pass@evil.example/',
    'https://user@evil.example/',
    'https://good.example\\@evil.example/',
    'https://exa mple.com/',
    'https://example.com/\u0000',
    'https://exa\u0000mple.com/',
    '\thttps://example.com/',
    'https://example.com/a\rb',
    `${ZERO_WIDTH_SPACE}https://example.com/`,
    'https://example.com/\n',
    `https://example.com/${ZERO_WIDTH_SPACE}`,
    'https://',
    `https://example.com/${'a'.repeat(3000)}`,
  ])('rejects %j', (raw) => {
    expect(safeExternalUrl(raw)).toBeNull();
  });
});

describe('telHref', () => {
  it('keeps a leading + and the digits', () => {
    expect(telHref('+91 1824 517000')).toBe('tel:+911824517000');
    expect(telHref('+91-1824-517000')).toBe('tel:+911824517000');
    expect(telHref('(01824) 517.000')).toBe('tel:01824517000');
    expect(telHref('123456')).toBe('tel:123456');
  });

  it.each([
    '',
    '12345',
    '+',
    '1234567890123456',
    '91+1824517000',
    '+91 1824 517000; +91 1824 404404',
    '+91 1824 517000 ext 2',
    'javascript:alert(1)',
    '1824517000?body=x',
    '1824\n517000',
    'tel:+911824517000',
  ])('rejects %j', (raw) => {
    expect(telHref(raw)).toBeNull();
  });
});

describe('mailHref', () => {
  it('builds a mailto link for a plain address', () => {
    expect(mailHref('info@example.edu')).toBe('mailto:info@example.edu');
    expect(mailHref(' First.Last+tag@Sub.Example.ac.in ')).toBe('mailto:First.Last%2Btag@sub.example.ac.in');
    expect(mailHref("o'brien@example.com")).toBe("mailto:o'brien@example.com");
  });

  it.each([
    '',
    'not-an-email',
    '@example.com',
    'a@',
    'a@b',
    'a@@example.com',
    'a@b@example.com',
    'a@example.com?subject=hi',
    'a@example.com&cc=evil@example.com',
    'a@example.com\nBcc: evil@example.com',
    'a@example.com\r\nBcc: evil@example.com',
    'a@example.com%0ABcc:evil@example.com',
    'a@example.com,evil@example.com',
    'a b@example.com',
    'a..b@example.com',
    '.a@example.com',
    'a@-example.com',
    'a@example..com',
    'javascript:alert(1)@example.com',
    `${'a'.repeat(65)}@example.com`,
  ])('rejects %j', (raw) => {
    expect(mailHref(raw)).toBeNull();
  });
});
