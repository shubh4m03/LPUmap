/**
 * Refreshes data/curated/organizations.json from a fixed, small set of public
 * www.lpu.in pages (see docs/research/LPU_PUBLIC_SOURCES.md). NOT part of the
 * normal build: run manually with `npm run data:fetch-public [-- --dry-run] [-- --offline]`.
 *
 * Politeness: robots.txt is fetched and obeyed for every URL, one request at a
 * time with a delay, timeouts, bounded retries with exponential backoff, and the
 * neutral User-Agent `LPU-Campus-Atlas-research/0.1` (scripts/lib/http.ts; no
 * contact or personal identifier is sent).
 *
 * Licensing: the site's terms allow personal, non-commercial viewing only, so raw
 * HTML is cached under the git-ignored data/.cache/lpu/ and never committed. Only
 * facts (official names, page URLs, page titles, hashes) are kept, in
 * data/raw/lpu/public-pages.snapshot.json. Descriptions are generated templates,
 * never copied prose.
 *
 * Extraction is regex-based (no DOM dependency). Every emitted name must appear
 * verbatim in the fetched page text; nothing is filled from memory.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CATEGORIES } from '../src/config/categories.ts';
import { fetchResponseWithRetry, ROBOTS_PRODUCT_TOKEN } from './lib/http.ts';

export const ORIGIN = 'https://www.lpu.in';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = join(ROOT, 'data/curated/organizations.json');
const SNAPSHOT_FILE = join(ROOT, 'data/raw/lpu/public-pages.snapshot.json');
const CACHE_DIR = join(ROOT, 'data/.cache/lpu');
/** robots.txt groups are matched on this exact product token (it prefixes RESEARCH_USER_AGENT). */
export const AGENT_TOKEN = ROBOTS_PRODUCT_TOKEN;
const TIMEOUT_MS = 20_000;
const RETRIES = 3;
const BACKOFF_BASE_MS = 1500;
const POLITE_DELAY_MS = 2000;
const CONCURRENCY = 1;
/** Refuse to overwrite when the record count falls by more than this share. */
export const MAX_DROP_RATIO = 0.4;

const SCHOOLS_INDEX_PATH = '/schools/';

/** Facilities named on official pages. Emitted only if the name is found verbatim. */
const FACILITY_TARGETS = [
  {
    slug: 'central-library',
    name: 'Central Library',
    categoryId: 'library',
    path: '/academics/libraries.php',
  },
  {
    slug: 'uni-health-centre',
    name: 'Uni Health Centre',
    categoryId: 'health',
    path: '/student-services/healthcare.php',
  },
  {
    slug: 'department-of-sports',
    name: 'Department of Sports',
    categoryId: 'sports',
    path: '/campus-life/sports.php',
  },
] as const;

/** Umbrella names printed on several school pages. Emitted only if found verbatim on one of `pages`. */
const UMBRELLA_TARGETS = [
  {
    slug: 'school-of-design',
    name: 'School of Design',
    pages: ['fashion', 'interior-and-furniture', 'animation-and-multimedia'],
    description: 'Name used on LPU’s official fashion, interior/product and multimedia design pages.',
  },
  {
    slug: 'school-of-liberal-and-creative-arts',
    name: 'School of Liberal and Creative Arts',
    pages: ['journalism-film-production', 'performing-arts'],
    description: 'Name used on LPU’s official journalism and theatre & music pages.',
  },
] as const;

export interface OrgRecord {
  id: string;
  name: string;
  aliases: string[];
  categoryId: string;
  kind: 'organization';
  description?: string;
  website: string;
  anchor?: { target: string };
  source: { name: string; url: string; retrievedAt: string };
  verificationStatus: 'imported';
}
export interface OrgFile {
  $comment: string;
  records: OrgRecord[];
}
interface Page {
  url: string;
  html: string;
  status: number;
  /** ISO date the HTML was fetched (cache mtime when re-extracting offline). */
  fetchedAt?: string;
}

// ---------- robots.txt ----------

/**
 * RFC 9309 subset: the group whose product token equals ours (case-insensitive) else `*`,
 * longest-match rule, Allow wins ties.
 */
export function robotsAllows(robotsTxt: string, agentToken: string, pathWithQuery: string): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; pattern: string }> }> = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && current) {
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const token = agentToken.toLowerCase();
  // Exact token match: a substring rule would let a group such as `User-agent: bot` override `*`.
  const own = groups.filter((g) => g.agents.some((a) => a !== '*' && a.split('/')[0]?.trim() === token));
  const applicable = own.length > 0 ? own : groups.filter((g) => g.agents.includes('*'));
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of applicable.flatMap((g) => g.rules)) {
    if (!robotsPatternToRegExp(rule.pattern).test(pathWithQuery)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow))
      best = { allow: rule.allow, length };
  }
  return best ? best.allow : true;
}

function robotsPatternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

// ---------- HTML extraction (dependency-free) ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Visible body text: drops comments, scripts, styles and site-wide header/nav/footer chrome. */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|header|nav|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(stripped).replace(/\s+/g, ' ').trim();
}

export function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = m?.[1] ? decodeEntities(m[1]).replace(/\\\//g, '/').replace(/\s+/g, ' ').trim() : '';
  return title || null;
}

/** School cards on /schools/: `news-tag` label followed by a "Read More" link to /schools/<slug>/. */
export function extractSchoolCards(html: string): Array<{ label: string; slug: string; url: string }> {
  const cards: Array<{ label: string; slug: string; url: string }> = [];
  const seen = new Set<string>();
  for (const chunk of html.split(/class="news-cell"/).slice(1)) {
    const label = /class="news-tag"[^>]*>([\s\S]*?)<\/div>/.exec(chunk)?.[1];
    const href = /href="https:\/\/www\.lpu\.in\/schools\/([a-z0-9-]+)\/"/.exec(chunk);
    const slug = href?.[1];
    if (!label || !slug || seen.has(slug)) continue;
    const clean = htmlToText(label);
    if (!clean) continue;
    seen.add(slug);
    cards.push({ label: clean, slug, url: `${ORIGIN}/schools/${slug}/` });
  }
  return cards;
}

const PREFIX_STOPWORDS = new Set([
  'The',
  'the',
  'LPU',
  'Our',
  'At',
  'In',
  'By',
  'Of',
  'And',
  'To',
  'Welcome',
]);
/** The name continues ("… and Architecture") or names another institution (", GNDU"). */
const FOREIGN_OR_LONGER = /^(?:\s+(?:and|&|of|for)\s|\s*,\s*(?!LPU\b|Lovely\b)[A-Z])/;

/**
 * Finds the printed "School of <label>" name on a school's own page, tolerating "&" vs "and".
 * Text is flattened, so a capitalised word before "School" may be an adjacent heading; a proper-noun
 * prefix ("Mittal School of Business") is therefore kept only when that exact form occurs twice.
 */
export function findSchoolName(text: string, label: string): string | null {
  const words = label
    .replace(/&/g, ' and ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.toLowerCase() === 'and' ? '(?:and|&)' : w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  if (words.length === 0) return null;
  const re = new RegExp(`(?:\\b([A-Z][a-z]+)\\s+)?\\bSchool\\s+of\\s+${words.join('\\s+')}\\b`, 'g');
  let plain: string | null = null;
  const prefixed = new Map<string, number>();
  for (const m of text.matchAll(re)) {
    if (FOREIGN_OR_LONGER.test(text.slice((m.index ?? 0) + m[0].length))) continue;
    const prefix = m[1];
    const core = m[0].slice(prefix ? m[0].search(/\bSchool\s+of\b/) : 0).replace(/\s+/g, ' ');
    if (prefix && !PREFIX_STOPWORDS.has(prefix)) {
      const full = `${prefix} ${core}`;
      prefixed.set(full, (prefixed.get(full) ?? 0) + 1);
    }
    plain ??= core;
  }
  const recurring = [...prefixed].find(([, count]) => count >= 2);
  return recurring ? recurring[0] : plain;
}

const normalizeForCompare = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim();

export function containsVerbatim(text: string, name: string): boolean {
  return normalizeForCompare(text).includes(normalizeForCompare(name));
}

const sourceName = (title: string | null) => `Lovely Professional University — ${title ?? 'untitled page'}`;

/** Pure: builds records from fetched pages. `pages` is keyed by absolute URL. */
export function buildRecords(pages: Map<string, Page>, retrievedAt: string): OrgRecord[] {
  const index = pages.get(`${ORIGIN}${SCHOOLS_INDEX_PATH}`);
  if (!index) throw new Error('Schools index page missing');
  const records: OrgRecord[] = [];
  const cards = extractSchoolCards(index.html);
  for (const card of cards) {
    const page = pages.get(card.url);
    if (!page) continue;
    const name = findSchoolName(htmlToText(page.html), card.label) ?? card.label;
    const aliases = containsVerbatim(name, card.label) ? [] : [card.label];
    records.push({
      id: `cur:school-${card.slug}`,
      name,
      aliases,
      categoryId: 'academic',
      kind: 'organization',
      description: `Listed as “${card.label}” on LPU’s official schools and departments index; no map position is published.`,
      website: card.url,
      source: { name: sourceName(extractTitle(page.html)), url: card.url, retrievedAt },
      verificationStatus: 'imported',
    });
  }
  for (const u of UMBRELLA_TARGETS) {
    const hit = u.pages
      .map((slug) => pages.get(`${ORIGIN}/schools/${slug}/`))
      .find(
        (p) => p && new RegExp(`\\b${u.name.replace(/ and /g, ' (?:and|&) ')}\\b`).test(htmlToText(p.html)),
      );
    if (!hit) continue;
    records.push({
      id: `cur:${u.slug}`,
      name: u.name,
      aliases: [],
      categoryId: 'academic',
      kind: 'organization',
      description: u.description,
      website: hit.url,
      source: { name: sourceName(extractTitle(hit.html)), url: hit.url, retrievedAt },
      verificationStatus: 'imported',
    });
  }
  for (const f of FACILITY_TARGETS) {
    const url = `${ORIGIN}${f.path}`;
    const page = pages.get(url);
    if (!page) continue;
    const text = htmlToText(page.html);
    if (!containsVerbatim(text, f.name)) continue;
    const block = new RegExp(`${f.name} located in (Block-\\d+)`).exec(text)?.[1];
    records.push({
      id: `cur:${f.slug}`,
      name: f.name,
      aliases: [],
      categoryId: f.categoryId,
      kind: 'organization',
      description: block
        ? `The official page places it in ${block}; that block has no verified map position yet.`
        : 'Named on LPU’s official website; no map position is published.',
      website: url,
      source: { name: sourceName(extractTitle(page.html)), url, retrievedAt },
      verificationStatus: 'imported',
    });
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}

/** Keeps manually curated anchors (never extracted) for ids that still exist. */
export function mergeAnchors(next: OrgRecord[], previous: OrgRecord[]): OrgRecord[] {
  const anchors = new Map(previous.filter((r) => r.anchor).map((r) => [r.id, r.anchor]));
  return next.map((r) => {
    const anchor = anchors.get(r.id);
    if (!anchor) return r;
    const { source, verificationStatus, ...head } = r; // keep the documented key order
    return { ...head, anchor, source, verificationStatus };
  });
}

export function checkDrop(previousCount: number, nextCount: number): string | null {
  if (nextCount === 0) return 'Extraction produced zero records.';
  if (previousCount > 0 && nextCount < previousCount * (1 - MAX_DROP_RATIO)) {
    return `Record count fell from ${previousCount} to ${nextCount} (> ${MAX_DROP_RATIO * 100}% drop).`;
  }
  return null;
}

export function diffSummary(previous: OrgRecord[], next: OrgRecord[]): string {
  const prev = new Map(previous.map((r) => [r.id, r]));
  const nextIds = new Set(next.map((r) => r.id));
  const strip = (r: OrgRecord) => JSON.stringify({ ...r, source: { ...r.source, retrievedAt: '' } });
  const added = next.filter((r) => !prev.has(r.id)).map((r) => r.id);
  const removed = previous.filter((r) => !nextIds.has(r.id)).map((r) => r.id);
  const changed = next
    .filter((r) => prev.has(r.id) && strip(prev.get(r.id) as OrgRecord) !== strip(r))
    .map((r) => r.id);
  const list = (label: string, ids: string[]) =>
    `${label} (${ids.length})${ids.length ? `: ${ids.join(', ')}` : ''}`;
  return [
    `${previous.length} → ${next.length} records`,
    list('added', added),
    list('removed', removed),
    list('changed', changed),
  ].join('\n');
}

/** Prettier's printWidth for this repo (.prettierrc); string arrays that fit on one line are collapsed. */
const PRINT_WIDTH = 110;

/** JSON.stringify with string arrays kept on one line when the whole line fits (matches Prettier output). */
export function serialize(file: OrgFile): string {
  const json = JSON.stringify(file, null, 2).replace(
    /^([^\n]*)\[\n((?:[ ]+"(?:[^"\\\n]|\\.)*",?\n)+)[ ]*\](,?)$/gm,
    (whole, head: string, body: string, comma: string) => {
      const items = body
        .split('\n')
        .filter(Boolean)
        .map((l) => l.trim().replace(/,$/, ''));
      const line = `${head}[${items.join(', ')}]${comma}`;
      return line.length <= PRINT_WIDTH ? line : whole;
    },
  );
  return `${json}\n`;
}

// ---------- network ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string): Promise<Page> {
  const res = await fetchResponseWithRetry(
    fetch,
    url,
    { headers: { Accept: 'text/html,text/plain' }, redirect: 'follow' },
    { retries: RETRIES, baseDelayMs: BACKOFF_BASE_MS, timeoutMs: TIMEOUT_MS },
  );
  if (res.status < 200 || res.status >= 300) return { url, html: '', status: res.status }; // 4xx: not retried
  // Deterministic, so retrying would only repeat the off-site request.
  if (new URL(res.url).origin !== ORIGIN) return { url, html: '', status: -1 };
  return { url, html: res.text, status: res.status };
}

async function mapBounded<T, R>(
  items: T[],
  limit: number,
  delayMs: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
      if (delayMs > 0) await sleep(delayMs);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function oldestFetchDate(pages: Array<{ fetchedAt?: string }>): string {
  const dates = pages.map((p) => p.fetchedAt).filter((d): d is string => Boolean(d));
  return dates.length ? dates.reduce((a, b) => (b < a ? b : a)) : new Date().toISOString().slice(0, 10);
}

const cacheFile = (url: string) =>
  join(
    CACHE_DIR,
    `${new URL(url).pathname.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '_') || 'index'}.html`,
  );

async function loadPages(urls: string[], offline: boolean, robots: string): Promise<Page[]> {
  if (offline) {
    return urls.map((url) => {
      const file = cacheFile(url);
      if (!existsSync(file)) throw new Error(`--offline: no cached copy of ${url}`);
      const fetchedAt = statSync(file).mtime.toISOString().slice(0, 10);
      return { url, html: readFileSync(file, 'utf8'), status: 200, fetchedAt };
    });
  }
  return mapBounded(urls, CONCURRENCY, POLITE_DELAY_MS, async (url) => {
    const { pathname, search } = new URL(url);
    if (!robotsAllows(robots, AGENT_TOKEN, pathname + search)) throw new Error(`robots.txt disallows ${url}`);
    const page = await fetchText(url);
    if (page.status === -1) throw new Error(`Refusing ${url}: redirected off ${ORIGIN}`);
    if (page.status !== 200) throw new Error(`HTTP ${page.status} for ${url}`);
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cacheFile(url), page.html);
    return { ...page, fetchedAt: new Date().toISOString().slice(0, 10) };
  });
}

// ---------- main ----------

const COMMENT =
  'Official LPU schools/disciplines and named facilities, extracted by scripts/fetch-public-data.ts from www.lpu.in ' +
  '(see docs/research/LPU_PUBLIC_SOURCES.md). Names are as printed on the cited page; descriptions are our own. ' +
  'None has a published map position, so records are unlocated unless a manual anchor links an OSM feature with ' +
  'the same name. Anchors are curated by hand and preserved on refresh.';

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const offline = args.has('--offline');
  let robots = '';
  if (!offline) {
    // RFC 9309: 4xx means no restrictions; 5xx/network errors throw in fetchText (fail closed).
    const res = await fetchText(`${ORIGIN}/robots.txt`);
    if (res.status === -1) throw new Error('robots.txt redirected off-site; refusing to crawl.');
    robots = res.html;
  }

  const [index] = await loadPages([`${ORIGIN}${SCHOOLS_INDEX_PATH}`], offline, robots);
  const cards = extractSchoolCards(index?.html ?? '');
  const urls = [...cards.map((c) => c.url), ...FACILITY_TARGETS.map((f) => `${ORIGIN}${f.path}`)];
  const pages = new Map([index as Page, ...(await loadPages(urls, offline, robots))].map((p) => [p.url, p]));
  // Offline re-extraction must not stamp old cached HTML with today's date.
  const retrievedAt = oldestFetchDate([...pages.values()]);

  const previous: OrgFile = existsSync(OUT_FILE)
    ? (JSON.parse(readFileSync(OUT_FILE, 'utf8')) as OrgFile)
    : { $comment: '', records: [] };
  const records = mergeAnchors(buildRecords(pages, retrievedAt), previous.records);
  const known = new Set(CATEGORIES.map((c) => c.id));
  const badCategory = records.find((r) => !known.has(r.categoryId));
  if (badCategory) throw new Error(`Unknown categoryId ${badCategory.categoryId} on ${badCategory.id}`);

  console.log(`Schools listed on index: ${cards.length}`);
  console.log(diffSummary(previous.records, records));
  const dropError = checkDrop(previous.records.length, records.length);
  if (dropError) {
    console.error(`Refusing to write: ${dropError} Existing file left untouched.`);
    process.exitCode = 2;
    return;
  }
  if (dryRun) {
    console.log('--dry-run: nothing written.');
    return;
  }
  writeFileSync(OUT_FILE, serialize({ $comment: COMMENT, records }));
  const snapshot = {
    retrievedAt,
    robots: offline ? 'not re-checked (--offline)' : `${ORIGIN}/robots.txt checked for ${AGENT_TOKEN} / *`,
    pages: [...pages.values()].map((p) => ({
      url: p.url,
      title: extractTitle(p.html),
      bytes: Buffer.byteLength(p.html),
      sha256: createHash('sha256').update(p.html).digest('hex'),
    })),
    schoolCards: cards.map(({ label, url }) => ({ label, url })),
  };
  mkdirSync(dirname(SNAPSHOT_FILE), { recursive: true });
  writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Wrote ${records.length} records to ${OUT_FILE}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
