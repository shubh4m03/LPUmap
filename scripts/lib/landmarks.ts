/**
 * data/curated/landmarks.json — ids of named or verified campus features that
 * must never silently disappear from the dataset. A build whose output lacks
 * any of them fails validation (and so never replaces public/data).
 *
 * How to add one: append { id, in, why } where `id` is the stable feature id
 * (`osm:way/…`, `osm:relation/…`, `cur:…`), `in` lists the files that must
 * contain it, and `why` says what makes it a landmark (its source name, a
 * survey, …). Only add features that exist in the current build; never add a
 * guessed id. Removing a landmark on purpose means editing this file in the
 * same change, with the reason in the commit message.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const LANDMARKS_FILE = 'landmarks.json';

export const landmarkFileSchema = z.enum(['buildings', 'places', 'boundary']);

export const landmarksFileSchema = z.strictObject({
  $comment: z.string().optional(),
  landmarks: z.array(
    z.strictObject({
      id: z.string().regex(/^(osm:(node|way|relation)\/\d+|cur:[a-z0-9][a-z0-9-]*)$/),
      in: z.array(landmarkFileSchema).min(1),
      why: z.string().min(1),
    }),
  ),
});
export type LandmarksFile = z.infer<typeof landmarksFileSchema>;

export function readLandmarks(curatedDir: string): LandmarksFile | null {
  const path = join(curatedDir, LANDMARKS_FILE);
  if (!existsSync(path)) return null;
  const parsed = landmarksFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`${path} is invalid:\n${z.prettifyError(parsed.error)}`);
  const ids = parsed.data.landmarks.map((l) => l.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${path} lists a landmark id twice`);
  return parsed.data;
}

export interface LandmarkPresence {
  buildings: ReadonlySet<string>;
  places: ReadonlySet<string>;
  boundary: ReadonlySet<string>;
}

/** Landmarks missing from the files they must appear in. */
export function missingLandmarks(file: LandmarksFile, present: LandmarkPresence): string[] {
  const out: string[] = [];
  for (const l of file.landmarks)
    for (const where of l.in)
      if (!present[where].has(l.id)) out.push(`${l.id} missing from ${where} (${l.why})`);
  return out;
}
