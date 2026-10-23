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
