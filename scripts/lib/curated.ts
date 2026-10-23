/**
 * Loads and merges data/curated/: sourced aliases, overrides and
 * organization records. Problems are collected and thrown together so a
 * curator sees every broken record at once.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import { CATEGORIES } from '../../src/config/categories.ts';
import type { Place, Relation, SourceRecord } from '../../src/data/schema.ts';
import type { PlaceRecord } from './build-places.ts';
import { relationId } from './build-relations.ts';
import { aliasesFileSchema, organizationsFileSchema, overridesFileSchema } from './curated-schema.ts';
import type { AliasesFile, OrganizationsFile, OverridesFile } from './curated-schema.ts';
import { mergeAliases, safeHttpUrl } from './place-fields.ts';

export class CuratedDataError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Curated data is invalid:\n  - ${problems.join('\n  - ')}`);
    this.name = 'CuratedDataError';
    this.problems = problems;
  }
}

export interface CuratedInputs {
  aliases: AliasesFile;
  overrides: OverridesFile;
  organizations: OrganizationsFile;
  /** File names that were present. */
  present: string[];
}

function readJson<S extends z.ZodType>(
  dir: string,
  file: string,
  schema: S,
  empty: z.infer<S>,
  problems: string[],
) {
  const path = join(dir, file);
  if (!existsSync(path)) return { value: empty, present: false };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    problems.push(`${file}: not valid JSON (${(e as Error).message})`);
    return { value: empty, present: true };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      problems.push(`${file}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    return { value: empty, present: true };
  }
  return { value: parsed.data as z.infer<S>, present: true };
}

/** Reads and schema-validates the curated directory (missing files = empty lists). */
export function loadCurated(dir: string): CuratedInputs {
  const problems: string[] = [];
  const a = readJson(dir, 'aliases.json', aliasesFileSchema, { aliases: [] }, problems);
  const o = readJson(dir, 'overrides.json', overridesFileSchema, { overrides: [] }, problems);
  const g = readJson(dir, 'organizations.json', organizationsFileSchema, { records: [] }, problems);
  if (problems.length > 0) throw new CuratedDataError(problems);
  return {
    aliases: a.value,
    overrides: o.value,
    organizations: g.value,
    present: [
      a.present && 'aliases.json',
      o.present && 'overrides.json',
      g.present && 'organizations.json',
    ].filter((x): x is string => typeof x === 'string'),
  };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '') || 'source';

/** "https://www.lpu.in/academics/libraries.php" → "lpu.in/academics/libraries". */
function urlStem(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\.[a-z0-9]+$/i, '')}`;
  } catch {
    return url;
  }
}

/** Registry of curated sources keyed by name+url, with deterministic ids. */
class SourceRegistry {
  private byKey = new Map<string, SourceRecord>();
  add(src: { name: string; url?: string; retrievedAt?: string }): string {
    const key = `${src.name}\u0000${src.url ?? ''}`;
    const existing = this.byKey.get(key);
    if (existing) {
      if (src.retrievedAt && (!existing.retrievedAt || src.retrievedAt > existing.retrievedAt)) {
        existing.retrievedAt = src.retrievedAt;
      }
      return existing.id;
    }
    const base = `curated:${slug(src.url ? urlStem(src.url) : src.name)}`;
    let id = base;
    for (let n = 2; [...this.byKey.values()].some((s) => s.id === id); n++) id = `${base}-${n}`;
    this.byKey.set(key, {
      id,
      name: src.name,
      ...(src.url ? { url: src.url } : {}),
      ...(src.retrievedAt ? { retrievedAt: src.retrievedAt } : {}),
    });
    return id;
  }
  list(): SourceRecord[] {
    return [...this.byKey.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}

export interface CuratedMergeResult {
  records: PlaceRecord[];
  relations: Relation[];
  sources: SourceRecord[];
  applied: { aliases: number; overrides: number; organizations: number; anchoredOrganizations: number };
}

/** Applies organizations, then aliases, then overrides. Throws CuratedDataError on any unresolved reference. */
export function mergeCurated(records: readonly PlaceRecord[], curated: CuratedInputs): CuratedMergeResult {
  const problems: string[] = [];
  const out = [...records];
  const byId = new Map(out.map((r) => [r.place.id, r]));
  const categoryIds = new Set(CATEGORIES.map((c) => c.id));
  const sources = new SourceRegistry();
  const relations: Relation[] = [];
  let anchored = 0;

  for (const [i, rec] of curated.organizations.records.entries()) {
    const where = `organizations.json records[${i}] (${rec.id})`;
    if (byId.has(rec.id)) problems.push(`${where}: duplicate place id`);
    if (!categoryIds.has(rec.categoryId)) problems.push(`${where}: unknown categoryId "${rec.categoryId}"`);
    const anchor = rec.anchor ? byId.get(rec.anchor.target) : undefined;
    if (rec.anchor && (!anchor || !anchor.place.location)) {
      problems.push(
        `${where}: anchor ${rec.anchor.target} does not resolve to a located place in the snapshot`,
      );
      continue;
    }
    const website = safeHttpUrl(rec.website);
    const sourceId = sources.add(rec.source);
    const a = anchor?.place;
    const buildingId = a ? (a.kind === 'building' ? a.id : a.buildingId) : undefined;
    const place: Place = {
      id: rec.id,
      name: rec.name,
      displayName: rec.name,
      aliases: mergeAliases([], rec.aliases, rec.name),
      categoryId: rec.categoryId,
      kind: 'organization',
      location: a?.location ?? null,
      ...(buildingId ? { buildingId } : {}),
      campusZone: a?.campusZone ?? 'on-campus',
      ...(rec.description ? { description: rec.description } : {}),
      ...(website ? { contact: { website } } : {}),
      wheelchair: 'unknown',
      ...(a?.graphNodeId !== undefined
        ? { graphNodeId: a.graphNodeId, connectorLengthM: a.connectorLengthM ?? 0 }
        : {}),
      provenance: {
        sourceId,
        sourceRef: rec.source.url,
        retrievedAt: rec.source.retrievedAt,
        verificationStatus: rec.verificationStatus,
      },
    };
    const record: PlaceRecord = { place, geometry: 'point' };
    out.push(record);
    byId.set(place.id, record);
    if (a) {
      anchored++;
      relations.push({
        id: relationId('located_in', place.id, a.id),
        type: 'located_in',
        from: place.id,
        to: a.id,
        inferred: false,
        method: 'curated',
        provenance: {
          sourceId,
          sourceRef: rec.source.url,
          retrievedAt: rec.source.retrievedAt,
          verificationStatus: rec.verificationStatus,
        },
      });
    }
  }

  for (const [i, entry] of curated.aliases.aliases.entries()) {
    const target = byId.get(entry.target);
    if (!target) {
      problems.push(`aliases.json aliases[${i}]: target ${entry.target} does not exist`);
      continue;
    }
    sources.add(entry.source);
    target.place.aliases = mergeAliases(target.place.aliases, entry.aliases, target.place.name);
  }

  for (const [i, o] of curated.overrides.overrides.entries()) {
    const target = byId.get(o.target);
    const where = `overrides.json overrides[${i}]`;
    if (!target) {
      problems.push(`${where}: target ${o.target} does not exist`);
      continue;
    }
    if (o.set.categoryId && !categoryIds.has(o.set.categoryId)) {
      problems.push(`${where}: unknown categoryId "${o.set.categoryId}"`);
      continue;
    }
    const p = target.place;
    if (o.set.name) {
      p.name = o.set.name;
      p.displayName = o.set.name;
      p.aliases = p.aliases.filter((x) => x.toLowerCase() !== o.set.name!.toLowerCase());
    }
    if (o.set.categoryId) p.categoryId = o.set.categoryId;
    if (o.set.description) p.description = o.set.description;
    if (o.set.openingHours) p.openingHours = o.set.openingHours;
    if (o.set.wheelchair) p.wheelchair = o.set.wheelchair;
    sources.add(o.source);
    // An unverified report is dated in the notes only: lastVerifiedAt would claim a check that never happened.
    const verified = o.check === 'physical-survey' || o.check === 'official-publication';
    const { lastVerifiedAt: _previous, ...rest } = p.provenance;
    p.provenance = {
      ...rest,
      ...(verified ? { lastVerifiedAt: o.lastVerifiedAt } : {}),
      verificationStatus: verified ? 'verified' : 'unverified',
      notes: `Fields ${Object.keys(o.set).sort().join(', ')} overridden from "${o.source.name}" (${o.check}, ${
        o.lastVerifiedAt
      })${o.verifiedBy ? ` by ${o.verifiedBy}` : ''}.`,
    };
  }

  if (problems.length > 0) throw new CuratedDataError(problems);
  return {
    records: out,
    relations,
    sources: sources.list(),
    applied: {
      aliases: curated.aliases.aliases.length,
      overrides: curated.overrides.overrides.length,
      organizations: curated.organizations.records.length,
      anchoredOrganizations: anchored,
    },
  };
}
