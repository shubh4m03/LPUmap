/** Constants shared by the illustrated overview's components (kept out of .tsx for fast refresh). */
import type { BadgeTone } from '../components/ui/index.ts';
import { ASSOCIATION_STATUS_TEXT, type AssociationStatusName as AssociationStatus } from './text.ts';
import type { ArtRect } from './viewport.ts';

/**
 * The legend box of the master overview, in SOURCE PIXELS, with a 14 px
 * margin of the surrounding artwork. Measured on the original at 1.2× with a
 * 50 px grid (white card ≈ x 86–736, y 1900–2304; the inventory's
 * regionsApprox.legendBox [88, 1900, 650, 405] ±15 agrees). The crop is a VIEW
 * of the original pixels (a clipped, uniformly scaled <img>), never a new file.
 */
export const LEGEND_CROP: ArtRect = { x: 72, y: 1886, width: 678, height: 432 };

export const ILLUSTRATION_NOTICE = 'Illustration — not to scale; positions are schematic';

/** Detail-card badge of an illustration item: the shared wording of text.ts. */
export const ASSOCIATION_BADGE: Record<
  AssociationStatus,
  { label: string; tone: BadgeTone; detail: string }
> = {
  verified: badge('verified'),
  approximate: badge('approximate'),
  unresolved: badge('unresolved'),
};

function badge(status: AssociationStatus): { label: string; tone: BadgeTone; detail: string } {
  const t = ASSOCIATION_STATUS_TEXT[status];
  return { label: t.label, tone: t.tone, detail: t.description };
}
