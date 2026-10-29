/** Truthful wording for place facts. Unknown values are labelled as unknown, never guessed. */
import { APP_CONFIG } from '../../config/index.ts';
import type { CampusZone, Place, PlaceKind, Provenance, Wheelchair } from '../../data/index.ts';
import { PLACE_KIND_LABELS } from '../../data/index.ts';
import { safeExternalUrl } from '../../utils/safe-url.ts';

export const KIND_LABELS: Record<PlaceKind, string> = PLACE_KIND_LABELS;

export const ZONE_LABELS: Record<CampusZone, string> = {
  'on-campus': 'On campus',
  // One label for off-campus things everywhere: the opt-in layer badge.
  'off-campus-nearby': APP_CONFIG.optionalLayers.nearbyOutsideCampus.badge,
};

export const WHEELCHAIR_LABELS: Record<Wheelchair, string> = {
  yes: 'Wheelchair accessible (as mapped, not verified on site)',
  limited: 'Limited wheelchair access (as mapped, not verified on site)',
  no: 'Not wheelchair accessible (as mapped)',
  unknown: 'Not recorded',
};

const roundM = (m: number) => (m >= 10 ? Math.round(m) : Math.round(m * 10) / 10);

/**
 * The public S3 label of a place drawn from an owner-placed studio model (its provenance note, e.g.
 * "Illustrative model placed by the site owner — not verified"): a new `stu:` building, or a base
 * building the owner modelled (heightSource 'studio-model'). Null for any other place.
 */
export function studioModelLabel(place: Place): string | null {
  const modelled = place.id.startsWith('stu:') || place.heightSource === 'studio-model';
  return modelled && place.provenance.notes ? place.provenance.notes : null;
}

/** Height wording by source; null when the place has no height information at all. */
export function heightText(place: Place): string | null {
  // An owner-placed model is drawn at an illustrative height; it is never a measurement.
  if (studioModelLabel(place))
    return 'Height not recorded — drawn at the illustrative height of an owner-placed model';
  const src = place.heightSource ?? (place.kind === 'building' ? 'fallback' : undefined);
  if (src === undefined) return null;
  if (src === 'osm-height' && place.heightM !== undefined)
    return `Measured height · ${roundM(place.heightM)} m`;
  if (src === 'osm-levels-estimate' && place.levels !== undefined) {
    const est = place.heightM ?? place.levels * APP_CONFIG.map.metresPerLevel;
    return `Estimated from ${place.levels} floors (×${APP_CONFIG.map.metresPerLevel} m) · about ${roundM(est)} m`;
  }
  return 'Height not recorded — shown at a placeholder height';
}

const OSM_REF_RE = /^(node|way|relation)\/\d+$/;

/** Link to the record at its source: openstreetmap.org for OSM refs, else a safe http(s) URL. */
export function sourceRefUrl(prov: Provenance): string | null {
  const ref = prov.sourceRef?.trim();
  if (!ref) return null;
  if (OSM_REF_RE.test(ref)) return `https://www.openstreetmap.org/${ref}`;
  return safeExternalUrl(ref);
}

/** Readable date for ISO dates/timestamps; the raw text when it cannot be parsed. */
export function formatDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

export function isUnnamed(place: Place): boolean {
  return place.name === null;
}

/**
 * Why an unnamed place shows no name, worded for where the record comes from. A new
 * owner-placed studio building (`stu:`) is not an OpenStreetMap record, so it must not
 * say that OpenStreetMap has no name for it.
 */
export function unnamedNote(place: Place): string {
  const thing = place.kind === 'building' ? 'building' : 'place';
  if (place.id.startsWith('stu:'))
    return `The site owner added this ${thing} to the map without a name, because no name has been confirmed for it yet. None is shown — we never guess names. If you know it, report a correction below.`;
  if (place.id.startsWith('osm:'))
    return `OpenStreetMap has no name for this ${thing} yet, so none is shown — we never guess names. If you know it, report a correction below or add the name on OpenStreetMap.`;
  return `No name is recorded for this ${thing} yet, so none is shown — we never guess names. If you know it, report a correction below.`;
}
