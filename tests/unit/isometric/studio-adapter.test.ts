/** isoStudioModel: a published studio record → what the overview draws (S1, S2, S3). */
import { describe, expect, it } from 'vitest';
import { APPEARANCE_LABEL, VERIFICATION_LABELS } from '../../../src/building-studio/schema.ts';
import { GENERIC_SHAPE_NOTE } from '../../../src/building-studio/labels.ts';
import { isoStudioModel } from '../../../src/isometric/studio.ts';
import { FOOTPRINT, model } from '../building-studio/fixtures.ts';

describe('isoStudioModel', () => {
  it('generates the same mesh as the 3D renderer, with appearance colours and the S3 labels', () => {
    const m = model();
    const iso = isoStudioModel({
      publicId: 'stu:abcdefghijklmnopqrstuvwxyz',
      footprint: FOOTPRINT,
      model: m,
      verification: { status: 'unverified' },
    });
    expect(iso.fallback).toBeUndefined();
    expect(iso.id).toBe('stu:abcdefghijklmnopqrstuvwxyz');
    expect(iso.mesh.origin).toEqual(m.anchor);
    expect(iso.colours).toEqual({ wall: m.facade.wallColour, roof: m.roof.colour });
    expect(iso.verificationLabel).toBe(VERIFICATION_LABELS.unverified);
    expect(iso.verificationLabel).toMatch(/not verified/);
    expect(iso.appearanceLabel).toBe(APPEARANCE_LABEL);
  });

  it('never drops an unsupported model: it draws the stored footprint × body height (S2)', () => {
    const unknown = { ...model(), modelConfigVersion: 99 };
    const iso = isoStudioModel({
      publicId: 'osm:way/1',
      footprint: FOOTPRINT,
      model: unknown,
      verification: { status: 'surveyed' },
    });
    expect(iso.fallback).toBe(true);
    expect(iso.colours).toBeUndefined();
    expect(iso.mesh.bbox.max[2]).toBeCloseTo(unknown.baseOffsetM + unknown.heightM, 9);
    // A verified record of a generic model says the shape is generic (no accuracyClass given → generic).
    expect(iso.verificationLabel).toBe(`${VERIFICATION_LABELS.surveyed} (${GENERIC_SHAPE_NOTE})`);
  });
});
