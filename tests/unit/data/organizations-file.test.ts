// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CATEGORIES } from '../../../src/config/categories.ts';
import {
  buildRecords,
  checkDrop,
  decodeEntities,
  diffSummary,
  extractSchoolCards,
  extractTitle,
  findSchoolName,
  htmlToText,
  mergeAnchors,
  oldestFetchDate,
  robotsAllows,
  serialize,
  type OrgRecord,
} from '../../../scripts/fetch-public-data.ts';

const readRepoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

const httpsUrl = z.url().refine((u) => u.startsWith('https://'), 'must be https');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/);
const categoryIds = new Set(CATEGORIES.map((c) => c.id));

const recordSchema = z.strictObject({
  id: z.string().regex(/^cur:[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)),
  categoryId: z.string().refine((id) => categoryIds.has(id), 'categoryId must exist in CATEGORIES'),
  kind: z.literal('organization'),
  description: z.string().trim().min(1).max(200).optional(),
  website: httpsUrl,
  anchor: z.strictObject({ target: z.string().regex(/^osm:(node|way|relation)\/\d+$/) }).optional(),
  source: z.strictObject({
    name: z.string().startsWith('Lovely Professional University — '),
    url: httpsUrl,
    retrievedAt: isoDate,
  }),
  verificationStatus: z.literal('imported'),
});
const fileSchema = z.strictObject({ $comment: z.string().min(1), records: z.array(recordSchema) });

describe('data/curated/organizations.json', () => {
  const raw = readRepoFile('data/curated/organizations.json');
  const parsed = fileSchema.safeParse(JSON.parse(raw));

  it('matches the documented shape', () => {
    expect(parsed.success, parsed.success ? '' : z.prettifyError(parsed.error)).toBe(true);
  });

  const records = parsed.success ? parsed.data.records : [];

  it('has unique ids and unique names', () => {
    expect(new Set(records.map((r) => r.id)).size).toBe(records.length);
    expect(new Set(records.map((r) => r.name.toLowerCase())).size).toBe(records.length);
  });

  it('only cites official lpu.in pages, and the website is the cited page', () => {
    for (const r of records) {
      expect(new URL(r.source.url).hostname).toBe('www.lpu.in');
      expect(r.website).toBe(r.source.url);
    }
  });

  it('keeps aliases distinct from the name and from each other', () => {
    for (const r of records) {
      expect(r.aliases).not.toContain(r.name);
      expect(new Set(r.aliases).size).toBe(r.aliases.length);
    }
  });

  it('anchors only to OSM features that carry exactly the same name in the snapshot', () => {
    const anchored = records.filter((r) => r.anchor);
    if (anchored.length === 0) return;
    const osm = readRepoFile('data/raw/osm/campus-bbox.osm');
    for (const r of anchored) {
      const [, type, id] = /^osm:(node|way|relation)\/(\d+)$/.exec(r.anchor?.target ?? '') ?? [];
      const start = osm.indexOf(`<${type} id="${id}"`);
      expect(start, `${r.anchor?.target} missing from snapshot`).toBeGreaterThanOrEqual(0);
      const element = osm.slice(start, osm.indexOf(`</${type}>`, start));
      expect(/<tag k="name" v="([^"]*)"/.exec(element)?.[1]).toBe(r.name);
    }
  });

  it('is byte-identical to what the refresher would serialise (no hand-format drift)', () => {
    expect(serialize(JSON.parse(raw))).toBe(raw.replace(/\r\n/g, '\n'));
  });
});

describe('fetch-public-data: robots.txt', () => {
  const robots = [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /files',
    'Disallow: /*?utm_source=',
    'Disallow: /result.php$',
    'Allow: /files/public',
    '',
    'User-agent: GPTBot',
    'Allow: /',
  ].join('\n');

  it('falls back to the * group for an unlisted agent', () => {
    expect(robotsAllows(robots, 'LPUCampusAtlasDataBot', '/schools/')).toBe(true);
    expect(robotsAllows(robots, 'LPUCampusAtlasDataBot', '/admin/x')).toBe(false);
    expect(robotsAllows(robots, 'LPUCampusAtlasDataBot', '/files/report.pdf')).toBe(false);
  });

  it('applies the longest matching rule, wildcards and $ anchors', () => {
    expect(robotsAllows(robots, 'LPUCampusAtlasDataBot', '/files/public/a')).toBe(true);
    expect(robotsAllows(robots, 'LPUCampusAtlasDataBot', '/x.php?utm_source=y')).toBe(false);
    expect(robotsAllows(robots, 'LPUCampusAtlasDataBot', '/result.php')).toBe(false);
    expect(robotsAllows(robots, 'LPUCampusAtlasDataBot', '/result.php?id=1')).toBe(true);
  });

  it('uses an agent-specific group when one matches', () => {
    expect(robotsAllows(robots, 'GPTBot', '/admin')).toBe(true);
  });

  it('does not treat a group whose token is a substring of ours as our own', () => {
    const loose = ['User-agent: *', 'Disallow: /schools/', '', 'User-agent: Bot', 'Allow: /'].join('\n');
    expect(robotsAllows(loose, 'LPUCampusAtlasDataBot', '/schools/')).toBe(false);
    const own = ['User-agent: *', 'Allow: /', '', 'User-agent: lpucampusatlasdatabot', 'Disallow: /'].join(
      '\n',
    );
    expect(robotsAllows(own, 'LPUCampusAtlasDataBot', '/schools/')).toBe(false);
  });

  it('allows everything when robots.txt is empty', () => {
    expect(robotsAllows('', 'LPUCampusAtlasDataBot', '/anything')).toBe(true);
  });
});

describe('fetch-public-data: extraction', () => {
  it('extracts visible text without comments, scripts or entities', () => {
    const html =
      '<p>A&amp;B</p><!-- <p>Hidden School</p> --><script>var x="School of X"</script><p>C&#39;s</p>';
    expect(htmlToText(html)).toBe("A&B C's");
  });

  it('decodes entities and leaves invalid code points untouched instead of throwing', () => {
    expect(decodeEntities('&#x2019;&#8212;&AMP;&bogus;')).toBe('’—&&bogus;');
    expect(decodeEntities('a&#x110000;b&#0;c')).toBe('a&#x110000;b&#0;c');
  });

  it('extracts and cleans the page title', () => {
    expect(extractTitle('<head><title>\n LPU &amp; Law \n</title></head>')).toBe('LPU & Law');
    expect(extractTitle('<title>  </title>')).toBeNull();
    expect(extractTitle('<p>no title</p>')).toBeNull();
  });

  it('drops header, nav and footer chrome', () => {
    expect(htmlToText('<header>School of Agriculture</header><main>Body</main><footer>F</footer>')).toBe(
      'Body',
    );
  });

  it('extracts school cards, de-duplicated, ignoring non-school links', () => {
    const card = (label: string, href: string) =>
      `<div class="news-cell"><div class="news-tag">${label}</div><a href="${href}" class="link-btn">Read More</a></div>`;
    const html = [
      card('Law', 'https://www.lpu.in/schools/law/'),
      card('Law again', 'https://www.lpu.in/schools/law/'),
      card('Elsewhere', 'https://example.com/schools/x/'),
      card('Hotel Management &amp; Tourism', 'https://www.lpu.in/schools/hotel-management-and-tourism/'),
    ].join('');
    expect(extractSchoolCards(html)).toEqual([
      { label: 'Law', slug: 'law', url: 'https://www.lpu.in/schools/law/' },
      {
        label: 'Hotel Management & Tourism',
        slug: 'hotel-management-and-tourism',
        url: 'https://www.lpu.in/schools/hotel-management-and-tourism/',
      },
    ]);
  });

  it('finds the printed school name, tolerating & vs and', () => {
    expect(
      findSchoolName('Welcome to the School of Hotel Management & Tourism.', 'Hotel Management and Tourism'),
    ).toBe('School of Hotel Management & Tourism');
  });

  it('keeps a proper-noun prefix only when that form recurs', () => {
    const twice = 'Mittal School of Business is great. Join Mittal School of Business today.';
    expect(findSchoolName(twice, 'Business')).toBe('Mittal School of Business');
    expect(findSchoolName('Time School of Law shows. The School of Law is approved.', 'Law')).toBe(
      'School of Law',
    );
  });

  it('rejects other institutions and longer names that merely contain the label', () => {
    expect(findSchoolName('alumni of School of Planning, GNDU and others', 'Planning')).toBeNull();
    expect(findSchoolName('School of Planning and Architecture, New Delhi', 'Planning')).toBeNull();
    expect(findSchoolName('The School of Planning, LPU welcomes you', 'Planning')).toBe('School of Planning');
  });

  it('does not glue a prefix that itself starts with "School" onto the name', () => {
    const text = 'Schools School of Law here. Schools School of Law again.';
    expect(findSchoolName(text, 'Law')).toBe('Schools School of Law');
    expect(findSchoolName('Schools School of Law once.', 'Law')).toBe('School of Law');
  });

  it('returns null when the page never prints the name', () => {
    expect(findSchoolName('Theatre and Music discipline', 'Theatre & Music')).toBeNull();
  });
});

describe('fetch-public-data: refresh safety', () => {
  const rec = (id: string, extra: Partial<OrgRecord> = {}): OrgRecord => ({
    id,
    name: id,
    aliases: [],
    categoryId: 'academic',
    kind: 'organization',
    website: 'https://www.lpu.in/x/',
    source: {
      name: 'Lovely Professional University — X',
      url: 'https://www.lpu.in/x/',
      retrievedAt: '2026-01-01',
    },
    verificationStatus: 'imported',
    ...extra,
  });

  it('refuses empty results and drops larger than 40%', () => {
    expect(checkDrop(0, 0)).toMatch(/zero/);
    expect(checkDrop(10, 5)).toMatch(/fell from 10 to 5/);
    expect(checkDrop(10, 6)).toBeNull();
    expect(checkDrop(0, 3)).toBeNull();
  });

  it('preserves manual anchors in documented key order and drops anchors of vanished ids', () => {
    const previous = [
      rec('cur:a', { anchor: { target: 'osm:way/1' } }),
      rec('cur:gone', { anchor: { target: 'osm:way/2' } }),
    ];
    const merged = mergeAnchors([rec('cur:a'), rec('cur:b')], previous);
    expect(merged[0]?.anchor).toEqual({ target: 'osm:way/1' });
    expect(Object.keys(merged[0] ?? {}).slice(-3)).toEqual(['anchor', 'source', 'verificationStatus']);
    expect(merged[1]?.anchor).toBeUndefined();
  });

  it('summarises additions, removals and changes, ignoring retrieval dates', () => {
    const before = [rec('cur:a'), rec('cur:b'), rec('cur:c')];
    const after = [
      rec('cur:a', { source: { ...rec('cur:a').source, retrievedAt: '2026-10-23' } }),
      rec('cur:b', { name: 'Renamed' }),
      rec('cur:d'),
    ];
    const summary = diffSummary(before, after);
    expect(summary).toContain('3 → 3 records');
    expect(summary).toContain('added (1): cur:d');
    expect(summary).toContain('removed (1): cur:c');
    expect(summary).toContain('changed (1): cur:b');
  });

  it('takes the oldest fetch date so offline re-extraction never looks fresher than the HTML', () => {
    expect(oldestFetchDate([{ fetchedAt: '2026-10-23' }, { fetchedAt: '2026-09-01' }, {}])).toBe(
      '2026-09-01',
    );
    expect(oldestFetchDate([{}])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('collapses string arrays only when the whole line fits the 110-column print width', () => {
    const fits = 'x'.repeat(110 - '      "aliases": [""],'.length);
    const tooLong = `${fits}y`;
    for (const [alias, inline] of [
      [fits, true],
      [tooLong, false],
    ] as const) {
      const text = serialize({ $comment: 'c', records: [rec('cur:a', { aliases: [alias] })] });
      const line = text.split('\n').find((l) => l.includes('"aliases"')) ?? '';
      expect(line.length).toBe(inline ? 110 : '      "aliases": ['.length);
      expect(line.endsWith('],')).toBe(inline);
      expect(JSON.parse(text).records[0].aliases).toEqual([alias]);
    }
  });

  it('serialises losslessly', () => {
    const file = { $comment: 'c', records: [rec('cur:a', { aliases: ['A', 'B'] })] };
    const text = serialize(file);
    expect(JSON.parse(text)).toEqual(file);
    expect(text).toContain('"aliases": ["A", "B"]');
  });
});

describe('fetch-public-data: buildRecords', () => {
  const O = 'https://www.lpu.in';
  const page = (url: string, body: string, title = 'T') => ({
    url,
    html: `<html><head><title>${title}</title></head><body>${body}</body></html>`,
    status: 200,
  });
  const card = (label: string, slug: string) =>
    `<div class="news-cell"><div class="news-tag">${label}</div><a href="${O}/schools/${slug}/">Read More</a></div>`;
  const pages = new Map(
    [
      page(`${O}/schools/`, card('Law', 'law') + card('Planning', 'planning') + card('Fashion', 'fashion')),
      page(`${O}/schools/law/`, '<p>The School of Law welcomes you.</p>', 'Law College'),
      page(`${O}/schools/planning/`, '<p>Alumni of Das School of Planning, GNDU</p>'),
      page(`${O}/schools/fashion/`, '<p>The School of Design - Fashion</p>', 'Fashion &amp; Design'),
      page(`${O}/academics/libraries.php`, '<p>The biggest Central Library located in Block-37.</p>'),
      page(`${O}/student-services/healthcare.php`, '<p>Our clinic</p>'),
    ].map((p) => [p.url, p]),
  );
  const records = buildRecords(pages, '2026-10-23');
  const byId = new Map(records.map((r) => [r.id, r]));

  it('emits only names printed on the fetched pages, sorted by id', () => {
    expect(records.map((r) => r.id)).toEqual([
      'cur:central-library',
      'cur:school-fashion',
      'cur:school-law',
      'cur:school-of-design',
      'cur:school-planning',
    ]);
    expect(byId.get('cur:school-law')?.name).toBe('School of Law');
    expect(byId.get('cur:school-planning')?.name).toBe('Planning');
    expect(byId.get('cur:school-fashion')?.name).toBe('Fashion');
  });

  it('omits a facility whose name is not on its page, and one whose page was not fetched', () => {
    expect(byId.has('cur:uni-health-centre')).toBe(false);
    expect(byId.has('cur:department-of-sports')).toBe(false);
  });

  it('cites the exact page and its title, with no coordinates or anchors', () => {
    const law = byId.get('cur:school-law');
    expect(law?.source).toEqual({
      name: 'Lovely Professional University — Law College',
      url: `${O}/schools/law/`,
      retrievedAt: '2026-10-23',
    });
    expect(byId.get('cur:school-of-design')?.source.name).toBe(
      'Lovely Professional University — Fashion & Design',
    );
    for (const r of records) {
      expect(r.anchor).toBeUndefined();
      expect(r).not.toHaveProperty('location');
      expect(r.website).toBe(r.source.url);
    }
  });

  it('records a stated block number only as text', () => {
    expect(byId.get('cur:central-library')?.description).toContain('Block-37');
  });

  it('fails loudly when the schools index is missing', () => {
    expect(() => buildRecords(new Map(), '2026-10-23')).toThrow(/index/);
  });
});
