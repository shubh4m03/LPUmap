/** Tag → Place field mapping shared by every place builder. */
import type { Place, Provenance, Wheelchair } from '../../src/data/schema.ts';
import type { Tags } from './osm-parse.ts';

const ALIAS_KEYS = [
  'name:en',
  'alt_name',
  'alt_name:en',
  'short_name',
  'short_name:en',
  'official_name',
  'official_name:en',
  'old_name',
  'old_name:en',
  'loc_name',
];

export function cleanName(raw: string | undefined): string | null {
  const v = raw?.replace(/\s+/g, ' ').trim();
  return v ? v : null;
}

/** The source name: `name`, else `name:en`. Never synthesised. */
export function nameFromTags(tags: Tags): string | null {
  return cleanName(tags.name) ?? cleanName(tags['name:en']);
}

/** Alternative names from name variants (split on ";"), excluding the primary name; sorted, case-deduped. */
export function aliasesFromTags(tags: Tags, name: string | null): string[] {
  const seen = new Set<string>(name ? [name.toLowerCase()] : []);
  const out: string[] = [];
  for (const key of ALIAS_KEYS) {
    for (const part of (tags[key] ?? '').split(';')) {
      const v = cleanName(part);
      if (v && !seen.has(v.toLowerCase())) {
        seen.add(v.toLowerCase());
        out.push(v);
      }
    }
  }
  return out.sort();
}

export function mergeAliases(
  existing: readonly string[],
  extra: readonly string[],
  name: string | null,
): string[] {
  const seen = new Set<string>([...(name ? [name] : []), ...existing].map((s) => s.toLowerCase()));
  const out = [...existing];
  for (const a of extra) {
    const v = cleanName(a);
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out.sort();
}

/** Accepts only syntactically valid absolute http(s) URLs. */
export function safeHttpUrl(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v || /\s/.test(v)) return undefined;
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.') ? v : undefined;
  } catch {
    return undefined;
  }
}

export function contactFromTags(tags: Tags): Place['contact'] {
  const phone =
    cleanName(tags.phone ?? tags['contact:phone'] ?? tags['contact:mobile'] ?? tags.mobile) ?? undefined;
  const email = cleanName(tags.email ?? tags['contact:email']) ?? undefined;
  const website = safeHttpUrl(tags.website ?? tags['contact:website']);
  if (!phone && !email && !website) return undefined;
  return {
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(website ? { website } : {}),
  };
}

export function wheelchairFromTag(raw: string | undefined): Wheelchair {
  return raw === 'yes' || raw === 'limited' || raw === 'no' ? raw : 'unknown';
}

export function osmProvenance(ref: string, retrievedAt: string, tags: Tags): Provenance {
  const checkDate = cleanName(tags.check_date ?? tags.survey_date);
  return {
    sourceId: 'osm',
    sourceRef: ref,
    retrievedAt,
    verificationStatus: 'imported',
    ...(checkDate
      ? { notes: `OSM contributors recorded check_date ${checkDate}; not re-verified by this project.` }
      : {}),
  };
}

/** Optional fields common to all OSM-derived places. */
export function commonPlaceFields(tags: Tags): Pick<Place, 'openingHours' | 'contact' | 'wheelchair'> {
  const hours = cleanName(tags.opening_hours);
  const contact = contactFromTags(tags);
  return {
    ...(hours ? { openingHours: hours } : {}),
    ...(contact ? { contact } : {}),
    wheelchair: wheelchairFromTag(tags.wheelchair),
  };
}
