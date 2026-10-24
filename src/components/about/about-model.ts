/** Pure derivations for the About panel. Every number comes from the loaded data. */
import { APP_CONFIG } from '../../config/index.ts';
import type { Manifest, Place, SourceRecord } from '../../data/index.ts';
import { safeExternalUrl } from '../../utils/safe-url.ts';

export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const OSM_CONTRIBUTE_URL = 'https://www.openstreetmap.org/fixthemap';

/** A manifest count, or null when the manifest does not record it (shown as "not recorded"). */
export function count(manifest: Manifest, key: string): number | null {
  const v = manifest.counts[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export const fmt = (n: number | null): string => (n === null ? 'not recorded' : n.toLocaleString('en-IN'));

export interface CoverageFact {
  label: string;
  value: string;
}

export function coverageFacts(m: Manifest): CoverageFact[] {
  const buildings = count(m, 'buildings');
  const unnamed = count(m, 'buildings:unnamed');
  return [
    {
      label: 'Building outlines',
      value:
        buildings !== null && unnamed !== null
          ? `${fmt(buildings)} (${fmt(unnamed)} without a name)`
          : fmt(buildings),
    },
    { label: 'Places and records', value: fmt(count(m, 'places')) },
    { label: 'On campus', value: fmt(count(m, 'zone:on-campus')) },
    {
      label: APP_CONFIG.optionalLayers.nearbyOutsideCampus.badge,
      value: fmt(count(m, 'zone:off-campus-nearby')),
    },
    { label: 'Without a map position', value: fmt(count(m, 'places:withoutLocation')) },
    { label: 'Not connected to paths', value: fmt(count(m, 'places:notConnected')) },
    {
      label: 'Walking network',
      value: `${fmt(count(m, 'graph:nodes'))} points, ${fmt(count(m, 'graph:edges'))} segments, ${fmt(
        count(m, 'graph:components'),
      )} separate parts`,
    },
  ];
}

export interface PlaceStats {
  total: number;
  withHours: number;
  withWheelchair: number;
  verified: number;
}

export function placeStats(places: readonly Place[]): PlaceStats {
  let withHours = 0;
  let withWheelchair = 0;
  let verified = 0;
  for (const p of places) {
    if (p.openingHours) withHours += 1;
    if (p.wheelchair !== 'unknown') withWheelchair += 1;
    if (p.provenance.verificationStatus === 'verified') verified += 1;
  }
  return { total: places.length, withHours, withWheelchair, verified };
}

export interface CitedPage {
  id: string;
  title: string;
  url: string;
  retrievedAt?: string;
}

const LPU_TITLE_PREFIX = /^Lovely Professional University\s+[—-]\s+/;

/** Splits sources into OpenStreetMap, curated official pages (with safe links) and anything else. */
export function groupSources(sources: readonly SourceRecord[]): {
  osm: SourceRecord | null;
  pages: CitedPage[];
  other: SourceRecord[];
} {
  let osm: SourceRecord | null = null;
  const pages: CitedPage[] = [];
  const other: SourceRecord[] = [];
  for (const s of sources) {
    if (s.id === 'osm') {
      osm = s;
      continue;
    }
    const url = s.id.startsWith('curated:') ? safeExternalUrl(s.url) : null;
    if (url) {
      const page: CitedPage = { id: s.id, title: s.name.replace(LPU_TITLE_PREFIX, ''), url };
      if (s.retrievedAt) page.retrievedAt = s.retrievedAt;
      pages.push(page);
    } else other.push(s);
  }
  return { osm, pages, other };
}

/** "www.lpu.in/schools/law/" — a readable form of a URL for link context. */
export function shortUrl(url: string): string {
  const u = new URL(url);
  return `${u.host}${u.pathname}`;
}
