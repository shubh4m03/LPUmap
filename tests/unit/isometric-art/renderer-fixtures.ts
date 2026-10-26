/** Shared fixtures of the illustrated-overview renderer tests: the COMMITTED manifest, parsed by its schema. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeArtworkAssociations } from '../../../src/isometric-art/associations.ts';
import {
  isometricArtManifestSchema,
  type IsometricArtManifest,
  type PublishedArtworkAssociation,
} from '../../../src/isometric-art/schema.ts';
import { buildArtModel, type ArtModel } from '../../../src/isometric-art/hotspot-model.ts';

/** Repository root (vitest runs from it; import.meta.url is not a file URL under jsdom). */
export const ROOT = process.cwd();

export function loadManifest(): IsometricArtManifest {
  const raw = JSON.parse(readFileSync(join(ROOT, 'public/isometric-art/manifest.json'), 'utf8')) as unknown;
  return isometricArtManifestSchema.parse(raw);
}

/** The model as the app builds it (src/app/data/artwork.ts merges, the renderer models). */
export function modelOf(
  manifest: IsometricArtManifest,
  decisions: readonly PublishedArtworkAssociation[] = [],
  buildingExists: (id: string) => boolean = () => true,
): ArtModel {
  const merged = mergeArtworkAssociations({
    subjectIds: manifest.subjects.map((s) => s.subjectId),
    baseline: manifest.associations,
    decisions,
    buildingExists,
  });
  return buildArtModel(manifest, merged.bySubject);
}

/** The five viewports of the alignment gate (desktop, laptop, tablet, phone, small phone). */
export const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, dpr: 1 },
  { name: 'laptop', width: 1280, height: 800, dpr: 1 },
  { name: 'tablet', width: 768, height: 1024, dpr: 1 },
  { name: 'mobile', width: 390, height: 844, dpr: 2 },
  { name: 'mobile-small', width: 360, height: 800, dpr: 2 },
] as const;
