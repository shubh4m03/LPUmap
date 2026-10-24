import { describe, expect, it } from 'vitest';
import {
  containsProhibitedSourceUrl,
  hasControlChars,
  isHttpUrl,
  isProhibitedSourceUrl,
} from '../../../src/building-studio/text.ts';

describe('isProhibitedSourceUrl (Google Maps / Earth / Street View are never a source)', () => {
  it.each([
    'https://www.google.com/maps/place/LPU/@31.25,75.70,17z',
    'https://google.co.in/maps/@31.2533,75.7032,3a,75y,90t/data=!3m6!1e1', // Street View
    'http://maps.google.com/?q=31.25,75.70',
    'https://maps.google.co.in/maps?ll=31.25,75.70',
    'https://earth.google.com/web/@31.25,75.70,250a',
    'https://www.google.com/earth/',
    'https://maps.app.goo.gl/AbCdEf123',
    'https://goo.gl/maps/xyz',
    'https://g.page/some-place',
    'https://maps.googleapis.com/maps/api/staticmap?center=31.25,75.70',
    'https://streetviewpixels-pa.googleapis.com/v1/thumbnail?panoid=x',
    'https://khms1.google.com/kh/v=979?x=1&y=2&z=3',
    'https://mt0.google.com/vt/lyrs=s&x=1&y=2&z=3',
    'https://maps.gstatic.com/tactile/x.png',
    'www.google.com/maps/place/x',
    'maps.app.goo.gl/AbC',
    'HTTPS://WWW.GOOGLE.COM/MAPS/place/x',
  ])('rejects %s', (url) => expect(isProhibitedSourceUrl(url)).toBe(true));

  it.each([
    'https://sites.research.google/gr/open-buildings/',
    'https://storage.googleapis.com/open-buildings-data/v3/points_s2_level_6_gzip_no_header/391b_buildings.csv.gz',
    'https://www.google.com/search?q=lpu',
    'https://www.openstreetmap.org/way/422437885',
    'https://www.lpu.in/campus/',
    'https://mapsofindia.example/maps/punjab',
    'https://www.google.com/mapsearch-not-maps',
    'not a url at all',
    '',
  ])('allows %s', (url) => expect(isProhibitedSourceUrl(url)).toBe(false));

  it('finds prohibited URLs inside free text, with or without a scheme', () => {
    expect(containsProhibitedSourceUrl('Position checked on maps.app.goo.gl/abc yesterday')).toBe(true);
    expect(containsProhibitedSourceUrl('See (https://www.google.com/maps/@31.2,75.7,18z).')).toBe(true);
    expect(containsProhibitedSourceUrl('From OSM way/422437885 and https://www.lpu.in/ page')).toBe(false);
    expect(containsProhibitedSourceUrl('Not taken from Google Maps; paced on site.')).toBe(false);
  });
});

describe('text safety', () => {
  it('flags control, bidi-override and lone-surrogate characters but keeps ZWJ/LRM', () => {
    expect(hasControlChars('Block‮34')).toBe(true);
    expect(hasControlChars('a\u0000b')).toBe(true);
    expect(hasControlChars('\ud800x')).toBe(true);
    expect(hasControlChars('क्‍ष ‎')).toBe(false);
    expect(hasControlChars('a\tb', [0x09])).toBe(false);
  });

  it('isHttpUrl: http(s) only, no credentials', () => {
    expect(isHttpUrl('https://x.org/a')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('https://u:p@x.org')).toBe(false);
  });
});
