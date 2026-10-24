/**
 * Valid Building Studio fixtures (pure data). Each test clones and breaks one
 * thing at a time, so every refinement has a passing and a failing case.
 */
import type { LngLat } from '../../../src/data/schema.ts';
import type {
  ModelConfigV1,
  ModelDefaults,
  PublishedStudioBuilding,
  StudioDraft,
  StudioIdentity,
  TemplateDefinition,
} from '../../../src/building-studio/schema.ts';

/** APP_CONFIG.map.center: inside maxBounds and on campus. */
export const ANCHOR: LngLat = [75.7032, 31.2533];
export const STU_ID = 'stu:abcdefghijklmnopqrstuvwxyz';
export const T = '2026-10-24T09:30:00.000Z';

export const clone = <V>(v: V): V => structuredClone(v);

export function modelDefaults(over: Partial<ModelDefaults> = {}): ModelDefaults {
  return {
    generatorId: 'box',
    generatorVersion: 1,
    widthM: 20,
    lengthM: 40,
    heightM: 12.8,
    floors: 4,
    floorHeightM: 3.2,
    baseOffsetM: 0,
    shape: { kind: 'box' },
    roof: { shape: 'flat', colour: '#b0a99f', material: 'concrete' },
    facade: {
      material: 'plaster',
      wallColour: '#e8dcc8',
      windowPattern: 'punched',
      windowDensity: 0.4,
      balconies: false,
      entranceSide: 'front',
    },
    detailLevel: 'facade',
    ...over,
  };
}

export function model(over: Partial<ModelConfigV1> = {}): ModelConfigV1 {
  return { modelConfigVersion: 1, anchor: ANCHOR, rotationDeg: 30, ...modelDefaults(), ...over };
}

export function identity(over: Partial<StudioIdentity> = {}): StudioIdentity {
  return {
    name: null,
    aliases: [],
    categoryId: 'academic',
    subtype: null,
    description: null,
    notes: null,
    directoryVisible: true,
    ...over,
  };
}

export function draft(over: Partial<StudioDraft> = {}): StudioDraft {
  return {
    identity: identity(),
    model: model(),
    verification: { status: 'unverified' },
    accessNodeId: null,
    templateRef: { templateId: 'academic-block', templateVersion: 1, variantId: 'plain' },
    positionCorrection: null,
    ...over,
  };
}

/** A 20 × 40 m rectangle around ANCHOR (not rotated), closed, counter-clockwise. */
export const FOOTPRINT: PublishedStudioBuilding['footprint'] = {
  type: 'Polygon',
  coordinates: [
    [
      [75.7031, 31.2531],
      [75.7033, 31.2531],
      [75.7033, 31.2535],
      [75.7031, 31.2535],
      [75.7031, 31.2531],
    ],
  ],
};

export function published(over: Partial<PublishedStudioBuilding> = {}): PublishedStudioBuilding {
  const { notes: _n, ...pub } = identity({ name: 'Studio Hall', aliases: ['SH'] });
  return {
    id: STU_ID,
    targetId: null,
    version: 1,
    publishedAt: T,
    identity: pub,
    verification: { status: 'unverified' },
    accuracyClass: 'generic-prefab',
    templateRef: { templateId: 'academic-block', templateVersion: 1, variantId: 'plain' },
    model: model(),
    footprint: clone(FOOTPRINT),
    footprintAreaM2: 800,
    membership: {
      campusStatus: 'inside',
      insideFraction: 1,
      distanceToBoundaryM: 120,
      reasonCode: 'interior',
      decision: 'auto',
      decisionSource: null,
    },
    accessNodeId: null,
    positionCorrected: false,
    ...over,
  };
}

export function template(over: Partial<TemplateDefinition> = {}): TemplateDefinition {
  return {
    id: 'academic-block',
    version: 1,
    name: 'Academic block',
    libraryCategory: 'academic-block',
    intendedUse: 'Generic teaching block (illustrative)',
    suggestedCategoryId: 'academic',
    generatorId: 'box',
    generatorVersion: 1,
    constraints: {
      widthM: { min: 10, max: 80 },
      lengthM: { min: 20, max: 200 },
      heightM: { min: 6, max: 40 },
      floors: { min: 2, max: 12 },
      roofShapes: ['flat', 'hip'],
      windowPatterns: ['punched', 'ribbon'],
      balconiesAllowed: false,
    },
    variants: [
      { id: 'plain', name: 'Plain', description: null, defaults: modelDefaults() },
      {
        id: 'ribbon-hip',
        name: 'Ribbon windows, hipped roof',
        description: 'Second visual variant',
        defaults: modelDefaults({
          roof: { shape: 'hip', pitchDeg: 20, colour: '#8a4b3c', material: 'tile' },
          facade: {
            material: 'brick',
            wallColour: '#b5651d',
            windowPattern: 'ribbon',
            windowDensity: 0.5,
            balconies: false,
            entranceSide: 'front',
          },
        }),
      },
    ],
    accuracyClass: 'generic-prefab',
    renderCost: 'low',
    ...over,
  };
}
