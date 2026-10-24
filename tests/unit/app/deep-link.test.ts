import { describe, expect, it } from 'vitest';
import { buildPlaceUrl, isPlaceIdLike, parsePlaceParam } from '../../../src/app/deep-link.ts';

describe('deep links', () => {
  it('parses valid OSM and curated ids', () => {
    expect(parsePlaceParam('?place=osm:way/422547454')).toBe('osm:way/422547454');
    expect(parsePlaceParam('?place=osm%3Anode%2F12')).toBe('osm:node/12');
    expect(parsePlaceParam('?x=1&place=cur:central-library')).toBe('cur:central-library');
  });

  it('rejects missing, malformed or hostile values', () => {
    expect(parsePlaceParam('')).toBeNull();
    expect(parsePlaceParam('?place=')).toBeNull();
    expect(parsePlaceParam('?place=javascript:alert(1)')).toBeNull();
    expect(parsePlaceParam('?place=osm:way/abc')).toBeNull();
    expect(parsePlaceParam('?place=<script>')).toBeNull();
    expect(isPlaceIdLike(`cur:${'a'.repeat(300)}`)).toBe(false);
  });

  it('builds share URLs that keep other params and the hash', () => {
    expect(buildPlaceUrl('https://x.test/app/?e2e=1#top', 'osm:node/1')).toBe(
      'https://x.test/app/?e2e=1&place=osm%3Anode%2F1#top',
    );
    expect(buildPlaceUrl('https://x.test/?place=osm:node/1&a=2', null)).toBe('https://x.test/?a=2');
  });
});

describe('deep links to published records', () => {
  it('accepts studio building ids and owner/community location ids', () => {
    const stu = 'stu:abcdefghijklmnopqrstuvwxyz';
    expect(parsePlaceParam(`?place=${stu}`)).toBe(stu);
    expect(parsePlaceParam('?place=own:a1B2-c_3')).toBe('own:a1B2-c_3');
    expect(parsePlaceParam('?place=com:x9')).toBe('com:x9');
    expect(parsePlaceParam('?place=cur:central.library_1')).toBe('cur:central.library_1');
  });

  it('rejects ids outside those grammars', () => {
    expect(isPlaceIdLike('stu:short')).toBe(false);
    expect(isPlaceIdLike('stu:ABCDEFGHIJKLMNOPQRSTUVWX')).toBe(false); // base32 is lower case
    expect(isPlaceIdLike('stu:abcdefghijklmnopqrstuvwxyz0189')).toBe(false); // 0, 1, 8, 9 are not base32
    expect(isPlaceIdLike('own:')).toBe(false);
    expect(isPlaceIdLike('own:a b')).toBe(false);
  });
});
