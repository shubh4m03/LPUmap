/** data/raw/osm/SOURCE.json — provenance of the committed raw snapshot. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const sourceMetaSchema = z.strictObject({
  sourceId: z.literal('osm'),
  name: z.string().min(1),
  url: z.url(),
  license: z.literal('ODbL 1.0'),
  attribution: z.literal('© OpenStreetMap contributors'),
  retrievedAt: z.iso.datetime(),
  method: z.enum(['overpass', 'osm-api-map']),
  /** [west, south, east, north] that was requested. */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  files: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export type SourceMeta = z.infer<typeof sourceMetaSchema>;

export function readSourceMeta(rawDir: string): SourceMeta {
  const path = join(rawDir, 'SOURCE.json');
  if (!existsSync(path)) {
    throw new Error(
      `${path} is missing: every raw snapshot must record its source, licence and retrieval time.`,
    );
  }
  const parsed = sourceMetaSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`${path} is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
