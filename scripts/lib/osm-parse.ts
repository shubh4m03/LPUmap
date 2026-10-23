/**
 * Dependency-free OpenStreetMap readers: API 0.6 / Overpass XML and Overpass
 * JSON. Only what the pipeline needs is kept (ids, coordinates, node refs,
 * members, tags); metadata such as user/changeset is discarded.
 */

export type Tags = Record<string, string>;

export interface OsmNode {
  type: 'node';
  id: number;
  lon: number;
  lat: number;
  tags: Tags;
}

export interface OsmWay {
  type: 'way';
  id: number;
  nodes: number[];
  tags: Tags;
}

export interface OsmMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role: string;
}

export interface OsmRelation {
  type: 'relation';
  id: number;
  members: OsmMember[];
  tags: Tags;
}

export interface OsmData {
  nodes: Map<number, OsmNode>;
  ways: Map<number, OsmWay>;
  relations: Map<number, OsmRelation>;
}

export class OsmParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OsmParseError';
  }
}

export function emptyOsmData(): OsmData {
  return { nodes: new Map(), ways: new Map(), relations: new Map() };
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITY[body] ?? whole;
  });
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    const key = m[1];
    if (key !== undefined) attrs[key] = decodeXmlEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

function toId(raw: string | undefined, what: string): number {
  const n = Number(raw);
  if (raw === undefined || !Number.isSafeInteger(n)) throw new OsmParseError(`Invalid ${what} id: ${raw}`);
  return n;
}

function toCoord(raw: string | undefined, what: string): number {
  const n = Number(raw);
  if (raw === undefined || raw === '' || !Number.isFinite(n))
    throw new OsmParseError(`Invalid ${what}: ${raw}`);
  return n;
}

function asMemberType(raw: string | undefined): OsmMember['type'] {
  if (raw === 'node' || raw === 'way' || raw === 'relation') return raw;
  throw new OsmParseError(`Invalid relation member type: ${raw}`);
}

/** Parses OSM XML (API 0.6 map/full responses, Overpass `out meta|body`). */
export function parseOsmXml(xml: string): OsmData {
  if (!/<osm[\s>]/.test(xml)) throw new OsmParseError('Not an OSM XML document (no <osm> root element)');
  const data = emptyOsmData();
  type Open = OsmNode | OsmWay | OsmRelation;
  let current: Open | null = null;
  let skip = false;
  // Quoted attribute values may legally contain an unescaped ">", so they are matched as units.
  const tagRe = /<(\/?)(node|way|relation|nd|tag|member)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  for (let m = tagRe.exec(xml); m; m = tagRe.exec(xml)) {
    const [, closing, name, rawAttrs = '', selfClosing] = m;
    if (closing) {
      if (current && name === current.type) {
        if (!skip) store(data, current);
        current = null;
        skip = false;
      }
      continue;
    }
    const attrs = parseAttributes(rawAttrs);
    if (name === 'node' || name === 'way' || name === 'relation') {
      const id = toId(attrs.id, name);
      skip = attrs.visible === 'false';
      let el: Open;
      if (name === 'node') {
        el = { type: 'node', id, lon: toCoord(attrs.lon, 'lon'), lat: toCoord(attrs.lat, 'lat'), tags: {} };
      } else if (name === 'way') {
        el = { type: 'way', id, nodes: [], tags: {} };
      } else {
        el = { type: 'relation', id, members: [], tags: {} };
      }
      if (selfClosing) {
        if (!skip) store(data, el);
        skip = false;
      } else {
        current = el;
      }
      continue;
    }
    if (!current) continue;
    if (name === 'tag' && attrs.k !== undefined) {
      current.tags[attrs.k] = attrs.v ?? '';
    } else if (name === 'nd' && current.type === 'way') {
      current.nodes.push(toId(attrs.ref, 'nd ref'));
    } else if (name === 'member' && current.type === 'relation') {
      current.members.push({
        type: asMemberType(attrs.type),
        ref: toId(attrs.ref, 'member ref'),
        role: attrs.role ?? '',
      });
    }
  }
  if (current) throw new OsmParseError(`Unterminated <${current.type} id="${current.id}">`);
  return data;
}

function store(data: OsmData, el: OsmNode | OsmWay | OsmRelation): void {
  if (el.type === 'node') data.nodes.set(el.id, el);
  else if (el.type === 'way') data.ways.set(el.id, el);
  else data.relations.set(el.id, el);
}

function stringTags(raw: unknown): Tags {
  const tags: Tags = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') tags[k] = v;
  }
  return tags;
}

/** Parses an Overpass API JSON response (`[out:json]`). */
export function parseOverpassJson(json: string | unknown): OsmData {
  const doc: unknown = typeof json === 'string' ? JSON.parse(json) : json;
  if (!doc || typeof doc !== 'object' || !Array.isArray((doc as { elements?: unknown }).elements)) {
    throw new OsmParseError('Not an Overpass JSON document (missing "elements" array)');
  }
  const data = emptyOsmData();
  for (const raw of (doc as { elements: unknown[] }).elements) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const id = toId(String(e.id), String(e.type));
    const tags = stringTags(e.tags);
    if (e.type === 'node') {
      store(data, {
        type: 'node',
        id,
        lon: toCoord(String(e.lon), 'lon'),
        lat: toCoord(String(e.lat), 'lat'),
        tags,
      });
    } else if (e.type === 'way') {
      const nodes = Array.isArray(e.nodes) ? e.nodes.map((n) => toId(String(n), 'way node')) : [];
      store(data, { type: 'way', id, nodes, tags });
    } else if (e.type === 'relation') {
      const members = Array.isArray(e.members)
        ? e.members.map((mm: unknown) => {
            const mem = (mm ?? {}) as Record<string, unknown>;
            return {
              type: asMemberType(String(mem.type)),
              ref: toId(String(mem.ref), 'member ref'),
              role: typeof mem.role === 'string' ? mem.role : '',
            };
          })
        : [];
      store(data, { type: 'relation', id, members, tags });
    }
  }
  return data;
}

/** Detects the format from the first non-blank character. */
export function parseOsm(text: string): OsmData {
  const first = text.trimStart()[0];
  if (first === '{') return parseOverpassJson(text);
  if (first === '<') return parseOsmXml(text);
  throw new OsmParseError('Unrecognised OSM data format (expected XML or Overpass JSON)');
}

/** Union of several extracts; the first occurrence of an element wins. */
export function mergeOsmData(...parts: OsmData[]): OsmData {
  const out = emptyOsmData();
  for (const p of parts) {
    for (const [id, n] of p.nodes) if (!out.nodes.has(id)) out.nodes.set(id, n);
    for (const [id, w] of p.ways) if (!out.ways.has(id)) out.ways.set(id, w);
    for (const [id, r] of p.relations) if (!out.relations.has(id)) out.relations.set(id, r);
  }
  return out;
}

/** Elements sorted by id — the pipeline iterates these for deterministic output. */
export function sortedValues<T extends { id: number }>(m: Map<number, T>): T[] {
  return [...m.values()].sort((a, b) => a.id - b.id);
}
