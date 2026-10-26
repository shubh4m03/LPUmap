/**
 * The owner's campus illustration as the app uses it
 * (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §3–§5): the published manifest
 * (public/isometric-art/manifest.json) merged with the owner's association
 * decisions from the publication (v3 `artworkAssociations`).
 *
 * One load per app start, shared by every consumer: the building directory and
 * search (one id per building), the place panel, and the illustrated overview
 * renderer (read it from `useAtlas().artwork`; never load the manifest again).
 *
 * The artwork is optional: a missing or invalid manifest never fails the app.
 * `unavailableReason` then says why, the directory lists the map buildings
 * only, and the isometric mode shows the map-accurate drawing
 * (resolveIsometricVariant).
 */
import {
  ARTWORK_UNAVAILABLE_REASON,
  createArtworkDirectory,
  loadIsometricArtManifest,
  mergeArtworkAssociations,
  type ArtworkAssociationIssue,
  type ArtworkDirectory,
  type EffectiveArtworkAssociation,
  type IsometricArtManifest,
  type ManifestHotspot,
  type PublishedArtworkAssociation,
} from '../../isometric-art/index.ts';

export interface ArtworkLoad {
  manifest: IsometricArtManifest | null;
  /** null when the manifest loaded; else the user-facing reason. */
  unavailableReason: string | null;
}

export const NO_ARTWORK: ArtworkLoad = { manifest: null, unavailableReason: ARTWORK_UNAVAILABLE_REASON };

/** Loads the manifest. Never rejects. */
export async function loadArtwork(load = loadIsometricArtManifest): Promise<ArtworkLoad> {
  try {
    const r = await load();
    return r.ok
      ? { manifest: r.manifest, unavailableReason: null }
      : { manifest: null, unavailableReason: r.reason };
  } catch {
    return NO_ARTWORK;
  }
}

export interface AtlasArtwork {
  /** The loaded manifest, or null (then `unavailableReason` is set). */
  manifest: IsometricArtManifest | null;
  unavailableReason: string | null;
  /** Effective association per subject id (curated baseline + owner decisions, checked against the directory). */
  associations: ReadonlyMap<string, EffectiveArtworkAssociation>;
  /** Merge problems (orphan decisions, links to buildings no longer listed), for the admin and diagnostics. */
  issues: readonly ArtworkAssociationIssue[];
  /** createArtworkDirectory output (null without a manifest). */
  directory: ArtworkDirectory | null;
  hotspotsBySubject: ReadonlyMap<string, readonly ManifestHotspot[]>;
  /** Subject id of a hotspot. */
  subjectOfHotspot(hotspotId: string): string | undefined;
}

const EMPTY_ASSOCIATIONS: ReadonlyMap<string, EffectiveArtworkAssociation> = new Map();

/**
 * Merges the manifest baseline with the owner's decisions. `buildingIds` is
 * the building directory's id set (directoryBuildingIds): a verified join or
 * an unconfirmed candidate outside it is reported and shown as unresolved.
 */
export function buildArtwork(
  load: ArtworkLoad,
  decisions: readonly PublishedArtworkAssociation[],
  buildingIds: ReadonlySet<string>,
): AtlasArtwork {
  const m = load.manifest;
  if (!m)
    return {
      manifest: null,
      unavailableReason: load.unavailableReason ?? ARTWORK_UNAVAILABLE_REASON,
      associations: EMPTY_ASSOCIATIONS,
      issues: [],
      directory: null,
      hotspotsBySubject: new Map(),
      subjectOfHotspot: () => undefined,
    };
  const merged = mergeArtworkAssociations({
    subjectIds: m.subjects.map((s) => s.subjectId),
    baseline: m.associations,
    decisions,
    buildingExists: (id) => buildingIds.has(id),
  });
  const hotspotsBySubject = new Map<string, ManifestHotspot[]>();
  const subjectByHotspot = new Map<string, string>();
  for (const h of m.hotspots) {
    hotspotsBySubject.set(h.subjectId, [...(hotspotsBySubject.get(h.subjectId) ?? []), h]);
    subjectByHotspot.set(h.hotspotId, h.subjectId);
  }
  return {
    manifest: m,
    unavailableReason: null,
    associations: merged.bySubject,
    issues: merged.issues,
    directory: createArtworkDirectory(m.subjects, merged.bySubject),
    hotspotsBySubject,
    subjectOfHotspot: (id) => subjectByHotspot.get(id),
  };
}
