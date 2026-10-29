/**
 * Starter template library (S2, S3, S14): 17 generic building types from the
 * owner's list, built on the seven code generators. Code, versioned, pure.
 *
 * Honesty rules:
 *  - Every starter template is accuracyClass 'generic-prefab': an
 *    illustrative massing model, never a statement about any real LPU
 *    building. Names and intended uses describe a TYPE of building only; no
 *    block names, numbers, heights or materials of real buildings appear.
 *  - Dimensions, colours and materials are plausible generic defaults chosen
 *    for legibility (appearance only), not measurements.
 *  - renderCost and the triangle estimates are COMPUTED from the generated
 *    meshes (generateStudioMeshDetailed), never typed in.
 *
 * Versioning: a template version is immutable. Changing a template means
 * appending a new version to STARTER_TEMPLATE_VERSIONS; older versions stay
 * resolvable so "apply template vN" and provenance keep working. Instances
 * never change when a template does (they store the full resolved model).
 */
import { APP_CONFIG } from '../config/index.ts';
import { CATEGORIES } from '../config/index.ts';
import type { LngLat } from '../data/index.ts';
import { generateStudioMeshDetailed } from './mesh/generate.ts';
import {
  LIBRARY_CATEGORIES,
  templateDefinitionSchema,
  type Facade,
  type LibraryCategory,
  type ModelConfigV1,
  type ModelDefaults,
  type RenderCost,
  type Roof,
  type RoofShape,
  type ShapeParams,
  type TemplateDefinition,
  type TemplateRef,
  type WindowPattern,
} from './schema.ts';

export const LIBRARY_CATEGORY_LABELS: Readonly<Record<LibraryCategory, string>> = {
  'academic-block': 'Academic block',
  'lecture-hall': 'Lecture hall',
  'lab-research': 'Lab / research',
  'hostel-multistorey': 'Multi-storey hostel',
  residential: 'Residential',
  'canteen-kiosk': 'Canteen / kiosk',
  'retail-service': 'Small retail / service',
  administrative: 'Administrative',
  library: 'Library',
  auditorium: 'Auditorium',
  'sports-facility': 'Sports facility',
  'parking-structure': 'Parking structure',
  utility: 'Utility',
  'small-single-storey': 'Small single-storey',
  'generic-low-rise': 'Generic low-rise',
  'generic-mid-rise': 'Generic mid-rise',
  'generic-high-rise': 'Generic high-rise',
};

/** Face-count thresholds of renderCost (schema.ts templateDefinitionSchema): < 60 low, < 250 medium. */
export const RENDER_COST_FACES = { low: 60, medium: 250 } as const;

export const renderCostForFaces = (faces: number): RenderCost =>
  faces < RENDER_COST_FACES.low ? 'low' : faces < RENDER_COST_FACES.medium ? 'medium' : 'high';

// ---------------------------------------------------------------------------
// Definition helpers (generic appearance presets; appearance only)
// ---------------------------------------------------------------------------

const roof = (shape: RoofShape, colour: string, material: Roof['material'], pitchDeg?: number): Roof =>
  pitchDeg === undefined ? { shape, colour, material } : { shape, pitchDeg, colour, material };

const facade = (
  material: Facade['material'],
  wallColour: string,
  windowPattern: WindowPattern,
  windowDensity: number,
  extra: Partial<Pick<Facade, 'balconies' | 'entranceSide'>> = {},
): Facade => ({
  material,
  wallColour,
  windowPattern,
  windowDensity: windowPattern === 'none' ? 0 : windowDensity,
  balconies: extra.balconies ?? false,
  entranceSide: extra.entranceSide ?? 'front',
});

function defaults(
  shape: ShapeParams,
  dims: { w: number; l: number; floors: number; floorH: number },
  r: Roof,
  f: Facade,
): ModelDefaults {
  return {
    generatorId: shape.kind,
    generatorVersion: 1,
    widthM: dims.w,
    lengthM: dims.l,
    // Body height = floors × floor height, so no default raises 'height-floors-conflict'.
    heightM: Math.round(dims.floors * dims.floorH * 1000) / 1000,
    floors: dims.floors,
    floorHeightM: dims.floorH,
    baseOffsetM: 0,
    shape,
    roof: r,
    facade: f,
    detailLevel: 'details',
  };
}

const range = (min: number, max: number) => ({ min, max });

type DraftTemplate = Omit<TemplateDefinition, 'renderCost' | 'accuracyClass' | 'version'> & {
  /** Registry categories this type usually maps to (first = suggestedCategoryId). */
  categoryHints: readonly string[];
};

const BOX = { kind: 'box' } as const;
const HALL = { kind: 'hall' } as const;

const DRAFTS: readonly DraftTemplate[] = [
  {
    id: 'academic-block',
    name: 'Academic block',
    libraryCategory: 'academic-block',
    intendedUse: 'Generic multi-storey teaching block with classrooms and offices (illustrative).',
    suggestedCategoryId: 'academic',
    categoryHints: ['academic', 'university'],
    generatorId: 'box',
    generatorVersion: 1,
    constraints: {
      widthM: range(12, 80),
      lengthM: range(20, 200),
      heightM: range(6, 60),
      floors: range(2, 15),
      roofShapes: ['flat', 'hip', 'gable'],
      windowPatterns: ['punched', 'ribbon', 'grid'],
      balconiesAllowed: false,
    },
    variants: [
      {
        id: 'plain',
        name: 'Plain, flat roof',
        description: 'Rendered walls with punched windows.',
        defaults: defaults(
          BOX,
          { w: 20, l: 60, floors: 4, floorH: 3.6 },
          roof('flat', '#b8b2a7', 'concrete'),
          facade('plaster', '#e9dfcc', 'punched', 0.4),
        ),
      },
      {
        id: 'ribbon-hip',
        name: 'Ribbon windows, hipped roof',
        description: 'Brick walls with continuous window bands under a hipped roof.',
        defaults: defaults(
          BOX,
          { w: 18, l: 50, floors: 3, floorH: 3.6 },
          roof('hip', '#8c4a3c', 'tile', 22),
          facade('brick', '#b4664a', 'ribbon', 0.5),
        ),
      },
      {
        id: 'grid-tall',
        name: 'Tall, gridded facade',
        description: 'Concrete frame with an even window grid.',
        defaults: defaults(
          BOX,
          { w: 24, l: 70, floors: 6, floorH: 3.6 },
          roof('flat', '#a7a49d', 'membrane'),
          facade('concrete', '#d4d0c8', 'grid', 0.55),
        ),
      },
    ],
  },
  {
    id: 'lecture-hall',
    name: 'Lecture hall',
    libraryCategory: 'lecture-hall',
    intendedUse: 'Large single-volume teaching hall with high windows (illustrative).',
    suggestedCategoryId: 'academic',
    categoryHints: ['academic'],
    generatorId: 'hall',
    generatorVersion: 1,
    constraints: {
      widthM: range(15, 60),
      lengthM: range(20, 80),
      heightM: range(6, 20),
      floors: range(1, 3),
      roofShapes: ['flat', 'shed', 'gable'],
      windowPatterns: ['ribbon', 'punched', 'none'],
      balconiesAllowed: false,
    },
    variants: [
      {
        id: 'gable',
        name: 'Gabled hall',
        description: null,
        defaults: defaults(
          HALL,
          { w: 24, l: 36, floors: 2, floorH: 4.5 },
          roof('gable', '#6f7378', 'metal', 18),
          facade('plaster', '#e6dccb', 'ribbon', 0.5),
        ),
      },
      {
        id: 'shed',
        name: 'Mono-pitch hall',
        description: null,
        defaults: defaults(
          HALL,
          { w: 20, l: 30, floors: 2, floorH: 4 },
          roof('shed', '#6f7378', 'metal', 8),
          facade('concrete', '#d6d2ca', 'ribbon', 0.45),
        ),
      },
    ],
  },
  {
    id: 'lab-research',
    name: 'Lab / research block',
    libraryCategory: 'lab-research',
    intendedUse: 'Generic laboratory or research building with tall floors (illustrative).',
    suggestedCategoryId: 'academic',
    categoryHints: ['academic'],
    generatorId: 'box',
    generatorVersion: 1,
    constraints: {
      widthM: range(12, 60),
      lengthM: range(20, 120),
      heightM: range(6, 40),
      floors: range(2, 8),
      roofShapes: ['flat', 'shed'],
      windowPatterns: ['grid', 'ribbon', 'punched'],
      balconiesAllowed: false,
    },
    variants: [
      {
        id: 'grid',
        name: 'Gridded block',
        description: null,
        defaults: defaults(
          BOX,
          { w: 18, l: 45, floors: 3, floorH: 4 },
          roof('flat', '#9fa3a6', 'membrane'),
          facade('concrete', '#cfd2d4', 'grid', 0.45),
        ),
      },
      {
        id: 'ribbon',
        name: 'Ribbon-window block',
        description: null,
        defaults: defaults(
          BOX,
          { w: 16, l: 40, floors: 4, floorH: 4 },
          roof('flat', '#9fa3a6', 'gravel'),
          facade('metal', '#bcc4ca', 'ribbon', 0.5),
        ),
      },
    ],
  },
  {
    id: 'hostel-multistorey',
    name: 'Multi-storey hostel',
    libraryCategory: 'hostel-multistorey',
    intendedUse: 'Generic student residence block with repeated rooms (illustrative).',
    suggestedCategoryId: 'hostel',
    categoryHints: ['hostel', 'residential'],
    generatorId: 'box',
    generatorVersion: 1,
    constraints: {
      widthM: range(12, 40),
      lengthM: range(30, 150),
      heightM: range(9, 60),
      floors: range(3, 16),
      roofShapes: ['flat', 'hip'],
      windowPatterns: ['punched', 'ribbon'],
      balconiesAllowed: true,
    },
    variants: [
      {
        id: 'balcony-slab',
        name: 'Slab block with balconies',
        description: 'Flat roof, punched windows and balcony slabs on the long walls.',
        defaults: defaults(
          BOX,
          { w: 16, l: 60, floors: 6, floorH: 3.2 },
          roof('flat', '#b3ada3', 'concrete'),
          facade('plaster', '#efe4d2', 'punched', 0.35, { balconies: true }),
        ),
      },
      {
        id: 'hipped-brick',
        name: 'Brick block, hipped roof',
        description: 'Brick walls without balconies under a hipped roof.',
        defaults: defaults(
          BOX,
          { w: 14, l: 50, floors: 5, floorH: 3.2 },
          roof('hip', '#7d4537', 'tile', 25),
          facade('brick', '#a85b44', 'punched', 0.3),
        ),
      },
      {
        id: 'ribbon-tall',
        name: 'Tall block, ribbon windows',
        description: null,
        defaults: defaults(
          BOX,
          { w: 18, l: 80, floors: 9, floorH: 3.2 },
          roof('flat', '#a9a59e', 'membrane'),
          facade('concrete', '#dcd6cc', 'ribbon', 0.45),
        ),
      },
    ],
  },
  {
    id: 'residential',
    name: 'Residential building',
    libraryCategory: 'residential',
    intendedUse: 'Generic staff housing or small apartment building (illustrative).',
    suggestedCategoryId: 'residential',
    categoryHints: ['residential', 'hostel'],
    generatorId: 'box',
    generatorVersion: 1,
    constraints: {
      widthM: range(6, 40),
      lengthM: range(6, 80),
      heightM: range(3, 40),
      floors: range(1, 12),
      roofShapes: ['flat', 'gable', 'hip'],
      windowPatterns: ['punched', 'ribbon'],
      balconiesAllowed: true,
    },
    variants: [
      {
        id: 'flat-balconies',
        name: 'Apartment block with balconies',
        description: null,
        defaults: defaults(
          BOX,
          { w: 14, l: 30, floors: 4, floorH: 3 },
          roof('flat', '#b0a99f', 'concrete'),
          facade('plaster', '#f0e6d6', 'punched', 0.35, { balconies: true }),
        ),
      },
      {
        id: 'gabled-house',
        name: 'Two-storey house, gabled roof',
        description: null,
        defaults: defaults(
          BOX,
          { w: 10, l: 14, floors: 2, floorH: 3 },
          roof('gable', '#8a4b3c', 'tile', 30),
          facade('plaster', '#f3ead9', 'punched', 0.3),
        ),
      },
      {
        id: 'hipped-house',
        name: 'Two-storey house, hipped roof',
        description: null,
        defaults: defaults(
          BOX,
          { w: 12, l: 12, floors: 2, floorH: 3 },
          roof('hip', '#6e5a4c', 'tile', 25),
          facade('brick', '#b87355', 'punched', 0.3),
        ),
      },
    ],
  },
  {
    id: 'canteen-kiosk',
    name: 'Canteen / kiosk',
    libraryCategory: 'canteen-kiosk',
    intendedUse: 'Small food outlet or kiosk with an open canopy for seating or queues (illustrative).',
    suggestedCategoryId: 'food',
    categoryHints: ['food', 'shop'],
    generatorId: 'kiosk-canopy',
    generatorVersion: 1,
    constraints: {
      widthM: range(3, 30),
      lengthM: range(3, 30),
      heightM: range(2.6, 8),
      floors: range(1, 2),
      roofShapes: ['flat', 'shed'],
      windowPatterns: ['none', 'ribbon', 'punched'],
      balconiesAllowed: false,
    },
    variants: [
      {
        id: 'front-canopy',
        name: 'Kiosk with front canopy',
        description: null,
        defaults: defaults(
          { kind: 'kiosk-canopy', canopyDepthFrac: 0.3, canopySide: 'front' },
          { w: 8, l: 10, floors: 1, floorH: 3.5 },
          roof('flat', '#5f7d8c', 'metal'),
          facade('plaster', '#f2e3c4', 'ribbon', 0.5),
        ),
      },
      {
        id: 'side-canopy-shed',
        name: 'Canteen with side canopy, mono-pitch roof',
        description: null,
        defaults: defaults(
          { kind: 'kiosk-canopy', canopyDepthFrac: 0.35, canopySide: 'right' },
          { w: 14, l: 10, floors: 1, floorH: 4 },
          roof('shed', '#6c7a5a', 'metal', 10),
          facade('brick', '#c07a52', 'punched', 0.35),
        ),
      },
    ],
  },
  {
    id: 'retail-service',
    name: 'Small retail / service',
    libraryCategory: 'retail-service',
    intendedUse: 'Shop, print shop, bank branch or similar small service unit (illustrative).',
    suggestedCategoryId: 'shop',
    categoryHints: ['shop', 'printing', 'finance'],
    generatorId: 'box',
    generatorVersion: 1,
    constraints: {
      widthM: range(4, 30),
      lengthM: range(4, 40),
      heightM: range(2.6, 10),
      floors: range(1, 3),
      roofShapes: ['flat', 'shed'],
      windowPatterns: ['curtain', 'ribbon', 'punched'],
      balconiesAllowed: false,
    },
    variants: [
      {
        id: 'shopfront',
        name: 'Glazed shopfront',
        description: null,
        defaults: defaults(
          BOX,
          { w: 8, l: 12, floors: 1, floorH: 3.6 },
          roof('flat', '#9d9890', 'membrane'),
          facade('plaster', '#ebe3d3', 'curtain', 0.7),
        ),
      },
      {
        id: 'shed-unit',
        name: 'Unit with mono-pitch roof',
        description: null,
        defaults: defaults(
          BOX,
          { w: 6, l: 10, floors: 1, floorH: 3.2 },
          roof('shed', '#6d6a64', 'metal', 8),
          facade('brick', '#b26e4f', 'punched', 0.35),
        ),
      },
    ],
  },
  {
    id: 'administrative',
    name: 'Administrative building',
    libraryCategory: 'administrative',
    intendedUse: 'Generic office or administration building on an L-shaped plan (illustrative).',
    suggestedCategoryId: 'building',
    categoryHints: ['building', 'university'],
    generatorId: 'l-shape',
    generatorVersion: 1,
    constraints: {
      widthM: range(20, 100),
      lengthM: range(20, 100),
      heightM: range(6, 40),
      floors: range(2, 10),
      roofShapes: ['flat'],
      windowPatterns: ['punched', 'ribbon', 'grid'],
      balconiesAllowed: false,
    },
    variants: [
      {
        id: 'l-punched',
        name: 'L-plan, punched windows',
        description: null,
        defaults: defaults(
          { kind: 'l-shape', notchWidthFrac: 0.5, notchLengthFrac: 0.5, notchCorner: 'front-right' },
          { w: 40, l: 40, floors: 3, floorH: 3.6 },
          roof('flat', '#b2aca2', 'concrete'),
          facade('plaster', '#ece2cf', 'punched', 0.4),
        ),
      },
      {
        id: 'l-ribbon',
        name: 'L-plan, ribbon windows',
        description: null,
        defaults: defaults(
          { kind: 'l-shape', notchWidthFrac: 0.45, notchLengthFrac: 0.55, notchCorner: 'back-left' },
          { w: 50, l: 36, floors: 4, floorH: 3.6 },
          roof('flat', '#a3a19b', 'membrane'),
          facade('concrete', '#d8d4cc', 'ribbon', 0.5),
        ),
      },
    ],
  },
  {
    id: 'library',
    name: 'Library',
    libraryCategory: 'library',
    intendedUse: 'Generic library or reading-room building around a courtyard (illustrative).',
    suggestedCategoryId: 'library',
    categoryHints: ['library'],
    generatorId: 'u-shape',
    generatorVersion: 1,
    constraints: {
      widthM: range(30, 120),
      lengthM: range(30, 120),
      heightM: range(6, 30),
      floors: range(2, 6),
      roofShapes: ['flat'],
      windowPatterns: ['ribbon', 'grid', 'curtain', 'punched'],
      balconiesAllowed: false,
    },
    variants: [
      {
        id: 'courtyard',
        name: 'Closed courtyard',
        description: null,
        defaults: defaults(
          { kind: 'u-shape', courtyardWidthFrac: 0.4, courtyardDepthFrac: 0.4, openSide: 'none' },
          { w: 50, l: 50, floors: 3, floorH: 4 },
          roof('flat', '#a9a49b', 'concrete'),
          facade('stone', '#d9cdb5', 'ribbon', 0.45),
        ),
      },
      {
        id: 'open-u',
        name: 'U-plan open to the front',
        description: null,
        defaults: defaults(
          { kind: 'u-shape', courtyardWidthFrac: 0.45, courtyardDepthFrac: 0.5, openSide: 'front' },
          { w: 60, l: 40, floors: 3, floorH: 4 },
          roof('flat', '#9fa09c', 'membrane'),
          facade('glass', '#c9d6dc', 'curtain', 0.65),
        ),
      },
    ],
  },
  {
    id: 'auditorium',
    name: 'Auditorium',
    libraryCategory: 'auditorium',
    intendedUse: 'Large assembly hall or auditorium with few windows (illustrative).',
    suggestedCategoryId: 'academic',
    categoryHints: ['academic', 'building'],
    generatorId: 'hall',
    generatorVersion: 1,
    constraints: {
      widthM: range(20, 80),
      lengthM: range(25, 100),
      heightM: range(8, 25),
      floors: range(1, 3),
      roofShapes: ['flat', 'shed', 'gable'],
      windowPatterns: ['none', 'ribbon'],
      balconiesAllowed: false,
    },
    variants: [
      {
        id: 'gable',
        name: 'Gabled auditorium',
        description: null,
        defaults: defaults(
          HALL,
          { w: 30, l: 45, floors: 2, floorH: 7 },
          roof('gable', '#70757a', 'metal', 15),
          facade('concrete', '#d3cec5', 'ribbon', 0.3),
        ),
      },
      {
        id: 'flat-blind',
        name: 'Flat-roofed, blind walls',
        description: null,
        defaults: defaults(
          HALL,
          { w: 35, l: 50, floors: 2, floorH: 6 },
          roof('flat', '#a5a29b', 'membrane'),
          facade('stone', '#d7ccb8', 'none', 0),
        ),
      },
    ],
  },
  {
    id: 'sports-facility',
    name: 'Sports facility',
    libraryCategory: 'sports-facility',
    intendedUse: 'Indoor sports hall, gymnasium or pavilion (illustrative).',
    suggestedCategoryId: 'sports',
    categoryHints: ['sports'],
    generatorId: 'hall',
    generatorVersion: 1,
    constraints: {
      widthM: range(15, 80),
      lengthM: range(20, 120),
      heightM: range(5, 25),
      floors: range(1, 3),
      roofShapes: ['flat', 'shed', 'gable'],
      windowPatterns: ['ribbon', 'punched', 'none'],
      balconiesAllowed: false,
    },
    variants: [
      {
        id: 'gable-hall',
        name: 'Gabled sports hall',
        description: null,
        defaults: defaults(
          HALL,
          { w: 30, l: 50, floors: 2, floorH: 5 },
          roof('gable', '#5d6a74', 'metal', 15),
          facade('metal', '#c2c8cc', 'ribbon', 0.4),
        ),
      },
      {
        id: 'shed-hall',
        name: 'Mono-pitch sports hall',
        description: null,
        defaults: defaults(
          HALL,
          { w: 25, l: 40, floors: 2, floorH: 4.5 },
          roof('shed', '#4f6d5a', 'metal', 8),
          facade('concrete', '#d0cdc4', 'ribbon', 0.35),
        ),
      },
      {
        id: 'flat-pavilion',
        name: 'Low flat-roofed pavilion',
        description: null,
        defaults: defaults(
          HALL,
          { w: 20, l: 30, floors: 1, floorH: 6 },
          roof('flat', '#a49f96', 'concrete'),
          facade('plaster', '#ebe1cf', 'punched', 0.35),
        ),
      },
    ],
  },
  {
    id: 'parking-structure',
    name: 'Parking structure',
    libraryCategory: 'parking-structure',
    intendedUse: 'Multi-level car or two-wheeler parking deck with open sides (illustrative).',
    suggestedCategoryId: 'parking',
    categoryHints: ['parking', 'transport'],
    generatorId: 'box',
    generatorVersion: 1,
    constraints: {
      widthM: range(20, 80),
      lengthM: range(30, 150),
      heightM: range(5, 25),
      floors: range(2, 8),
      roofShapes: ['flat'],
      windowPatterns: ['ribbon'],
      balconiesAllowed: false,
    },
    variants: [
      {
        id: 'open-deck',
        name: 'Open-deck garage',
        description: null,
        defaults: defaults(
          BOX,
          { w: 32, l: 60, floors: 4, floorH: 3 },
          roof('flat', '#8f8d88', 'concrete'),
          facade('concrete', '#c9c6bf', 'ribbon', 0.6),
        ),
      },
    ],
  },
  {
    id: 'utility',
    name: 'Utility building',
    libraryCategory: 'utility',
    intendedUse: 'Plant room, substation, pump house or store (illustrative).',
    suggestedCategoryId: 'building',
    categoryHints: ['building'],
    generatorId: 'box',
    generatorVersion: 1,
    constraints: {
      widthM: range(2, 30),
      lengthM: range(2, 40),
      heightM: range(2.4, 12),
      floors: range(1, 3),
      roofShapes: ['flat', 'shed'],
      windowPatterns: ['none', 'punched'],
      balconiesAllowed: false,
    },
    variants: [
      {
        id: 'plant-room',
        name: 'Plant room',
        description: null,
        defaults: defaults(
          BOX,
          { w: 6, l: 8, floors: 1, floorH: 3.5 },
          roof('flat', '#8c8a85', 'concrete'),
          facade('concrete', '#bfbcb5', 'none', 0),
        ),
      },
    ],
  },
  {
    id: 'small-single-storey',
    name: 'Small single-storey building',
    libraryCategory: 'small-single-storey',
    intendedUse: 'Any small one-storey structure: guard room, office cabin, shelter (illustrative).',
    suggestedCategoryId: 'building',
    categoryHints: ['building'],
    generatorId: 'box',
    generatorVersion: 1,
    constraints: {
      widthM: range(3, 20),
      lengthM: range(3, 30),
      heightM: range(2.4, 6),
      floors: range(1, 1),
      roofShapes: ['flat', 'shed', 'gable', 'hip'],
      windowPatterns: ['none', 'punched'],
      balconiesAllowed: false,
    },
    variants: [
      {
        id: 'flat',
        name: 'Flat roof',
        description: null,
        defaults: defaults(
          BOX,
          { w: 6, l: 9, floors: 1, floorH: 3.2 },
          roof('flat', '#a8a39a', 'concrete'),
          facade('plaster', '#efe5d3', 'punched', 0.3),
        ),
      },
      {
        id: 'gable',
        name: 'Gabled roof',
        description: null,
        defaults: defaults(
          BOX,
          { w: 6, l: 9, floors: 1, floorH: 3 },
          roof('gable', '#8a4b3c', 'tile', 30),
          facade('brick', '#b5694c', 'punched', 0.3),
        ),
      },
    ],
  },
  {
    id: 'generic-low-rise',
    name: 'Generic low-rise',
    libraryCategory: 'generic-low-rise',
    intendedUse: 'Any one- to three-storey building whose use is not recorded (illustrative).',
    suggestedCategoryId: 'building',
    categoryHints: ['building'],
    generatorId: 'box',
    generatorVersion: 1,
    constraints: {
      widthM: range(6, 60),
      lengthM: range(6, 120),
      heightM: range(3, 12),
      floors: range(1, 3),
      roofShapes: ['flat', 'shed', 'gable', 'hip'],
      windowPatterns: ['punched', 'ribbon', 'grid'],
      balconiesAllowed: false,
    },
    variants: [
      {
        id: 'flat',
        name: 'Flat-roofed low-rise',
        description: null,
        defaults: defaults(
          BOX,
          { w: 15, l: 30, floors: 2, floorH: 3.2 },
          roof('flat', '#aca69c', 'concrete'),
          facade('plaster', '#e7ddca', 'punched', 0.35),
        ),
      },
    ],
  },
  {
    id: 'generic-mid-rise',
    name: 'Generic mid-rise (stepped)',
    libraryCategory: 'generic-mid-rise',
    intendedUse: 'Any four- to twelve-storey building with set-back upper floors (illustrative).',
    suggestedCategoryId: 'building',
    categoryHints: ['building'],
    generatorId: 'stepped',
    generatorVersion: 1,
    constraints: {
      widthM: range(15, 80),
      lengthM: range(15, 120),
      heightM: range(12, 40),
      floors: range(4, 12),
      roofShapes: ['stepped'],
      windowPatterns: ['punched', 'ribbon', 'grid'],
      balconiesAllowed: false,
    },
    variants: [
      {
        id: 'two-tier',
        name: 'Two tiers',
        description: null,
        defaults: defaults(
          { kind: 'stepped', tiers: 2, setbackM: 3 },
          { w: 30, l: 40, floors: 6, floorH: 3.3 },
          roof('stepped', '#a6a199', 'concrete'),
          facade('plaster', '#e4dac7', 'ribbon', 0.45),
        ),
      },
      {
        id: 'three-tier',
        name: 'Three tiers',
        description: null,
        defaults: defaults(
          { kind: 'stepped', tiers: 3, setbackM: 3 },
          { w: 36, l: 48, floors: 9, floorH: 3.3 },
          roof('stepped', '#9c9a94', 'membrane'),
          facade('concrete', '#d5d1c8', 'grid', 0.5),
        ),
      },
    ],
  },
  {
    id: 'generic-high-rise',
    name: 'Generic high-rise (tower on podium)',
    libraryCategory: 'generic-high-rise',
    intendedUse: 'Any tall building: a tower on a low podium (illustrative).',
    suggestedCategoryId: 'building',
    categoryHints: ['building'],
    generatorId: 'tower-podium',
    generatorVersion: 1,
    constraints: {
      widthM: range(25, 100),
      lengthM: range(25, 100),
      heightM: range(30, 150),
      floors: range(10, 40),
      roofShapes: ['flat'],
      windowPatterns: ['grid', 'curtain', 'ribbon'],
      balconiesAllowed: false,
    },
    variants: [
      {
        id: 'curtain-tower',
        name: 'Glazed tower',
        description: null,
        defaults: defaults(
          { kind: 'tower-podium', podiumFloors: 2, towerWidthFrac: 0.5, towerLengthFrac: 0.5 },
          { w: 40, l: 40, floors: 12, floorH: 3.3 },
          roof('flat', '#9a9892', 'membrane'),
          facade('glass', '#b9c8d0', 'curtain', 0.7),
        ),
      },
      {
        id: 'grid-tower',
        name: 'Gridded tower',
        description: null,
        defaults: defaults(
          { kind: 'tower-podium', podiumFloors: 3, towerWidthFrac: 0.45, towerLengthFrac: 0.6 },
          { w: 44, l: 36, floors: 15, floorH: 3.3 },
          roof('flat', '#a09d96', 'concrete'),
          facade('concrete', '#d2cec6', 'grid', 0.5),
        ),
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Resolved library (render cost computed from the meshes; memoised)
// ---------------------------------------------------------------------------

export interface VariantStats {
  variantId: string;
  faces: number;
  triangles: number;
}

export interface LibraryEntry {
  definition: TemplateDefinition;
  /** Registry category ids this type usually maps to (first = suggestedCategoryId). */
  categoryHints: readonly string[];
  categoryLabel: string;
  /** Computed per variant from the generated mesh at its own detail level. */
  variantStats: readonly VariantStats[];
  /** Triangles of the heaviest variant. */
  estimatedTriangles: number;
}

/** Placement used to measure template meshes (any anchor gives the same face count). */
const MEASURE_ANCHOR: LngLat = [APP_CONFIG.map.center[0], APP_CONFIG.map.center[1]];

/** Resolved model of a variant at a placement (the full config an instance stores, S2). */
export function modelFromVariant(
  variant: Pick<TemplateDefinition['variants'][number], 'defaults'>,
  placement: { anchor: LngLat; rotationDeg: number },
): ModelConfigV1 {
  const model: ModelConfigV1 = {
    modelConfigVersion: 1,
    anchor: [placement.anchor[0], placement.anchor[1]],
    rotationDeg: placement.rotationDeg,
    ...variant.defaults,
  };
  return structuredClone(model);
}

function measure(def: Omit<TemplateDefinition, 'renderCost'>): VariantStats[] {
  return def.variants.map((v) => {
    const r = generateStudioMeshDetailed(modelFromVariant(v, { anchor: MEASURE_ANCHOR, rotationDeg: 0 }));
    if (!r.ok) throw new Error(`Starter template ${def.id}/${v.id} does not generate: ${r.message}`);
    return { variantId: v.id, faces: r.mesh.faces.length, triangles: r.triangles };
  });
}

/** Every version of every starter template (append-only). Version 1 is the first release. */
export const STARTER_TEMPLATE_VERSIONS: readonly { draft: DraftTemplate; version: number }[] = DRAFTS.map(
  (draft) => ({
    draft,
    version: 1,
  }),
);

let resolved: LibraryEntry[] | null = null;
let resolvedAll: Map<string, LibraryEntry> | null = null;

function resolveAll(): Map<string, LibraryEntry> {
  if (resolvedAll) return resolvedAll;
  const all = new Map<string, LibraryEntry>();
  for (const { draft, version } of STARTER_TEMPLATE_VERSIONS) {
    const { categoryHints, ...body } = draft;
    const base = { ...body, version, accuracyClass: 'generic-prefab' as const };
    const variantStats = measure(base);
    const heaviest = variantStats.reduce((a, b) => (b.faces > a.faces ? b : a));
    const definition = templateDefinitionSchema.parse({
      ...base,
      renderCost: renderCostForFaces(heaviest.faces),
    });
    all.set(`${draft.id}@${version}`, {
      definition,
      categoryHints,
      categoryLabel: LIBRARY_CATEGORY_LABELS[draft.libraryCategory],
      variantStats,
      estimatedTriangles: Math.max(...variantStats.map((s) => s.triangles)),
    });
  }
  resolvedAll = all;
  return all;
}

/** The latest version of every starter template, in LIBRARY_CATEGORIES order. */
export function starterLibrary(): readonly LibraryEntry[] {
  if (resolved) return resolved;
  const latest = new Map<string, LibraryEntry>();
  for (const e of resolveAll().values()) {
    const prev = latest.get(e.definition.id);
    if (!prev || e.definition.version > prev.definition.version) latest.set(e.definition.id, e);
  }
  resolved = [...latest.values()].sort(
    (a, b) =>
      LIBRARY_CATEGORIES.indexOf(a.definition.libraryCategory) -
        LIBRARY_CATEGORIES.indexOf(b.definition.libraryCategory) ||
      (a.definition.id < b.definition.id ? -1 : 1),
  );
  return resolved;
}

/** A specific starter template version, or null when it does not exist. */
export function starterTemplate(id: string, version?: number): LibraryEntry | null {
  if (version === undefined) return starterLibrary().find((e) => e.definition.id === id) ?? null;
  return resolveAll().get(`${id}@${version}`) ?? null;
}

/** Provenance reference for a placed variant (never re-applied silently). */
export const templateRefFor = (def: TemplateDefinition, variantId: string): TemplateRef => ({
  templateId: def.id,
  templateVersion: def.version,
  variantId,
});

// ---------------------------------------------------------------------------
// Browsing and search
// ---------------------------------------------------------------------------

export interface LibraryGroup {
  category: LibraryCategory;
  label: string;
  entries: LibraryEntry[];
}

/** Entries grouped by library category, in LIBRARY_CATEGORIES order (empty groups kept: honest empty state). */
export function libraryByCategory(entries: readonly LibraryEntry[] = starterLibrary()): LibraryGroup[] {
  return LIBRARY_CATEGORIES.map((category) => ({
    category,
    label: LIBRARY_CATEGORY_LABELS[category],
    entries: entries.filter((e) => e.definition.libraryCategory === category),
  }));
}

const fold = (s: string) =>
  s
    .toLocaleLowerCase('en')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const categoryWords = (id: string): string[] => {
  const c = CATEGORIES.find((x) => x.id === id);
  return c ? [c.label, c.noun, ...c.synonyms] : [id];
};

/**
 * Searches name, intended use, library category, registry category hints
 * (labels and synonyms) and variant names. Every query word must match
 * somewhere; results rank name matches first, then by library order.
 */
export function searchLibrary(
  query: string,
  entries: readonly LibraryEntry[] = starterLibrary(),
): LibraryEntry[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (words.length === 0) return [...entries];
  const scored: { e: LibraryEntry; score: number; order: number }[] = [];
  entries.forEach((e, order) => {
    const d = e.definition;
    const name = fold(d.name);
    const hay = fold(
      [
        d.name,
        d.intendedUse,
        e.categoryLabel,
        d.libraryCategory,
        ...e.categoryHints.flatMap(categoryWords),
        ...d.variants.map((v) => v.name),
      ].join(' '),
    );
    if (!words.every((w) => hay.includes(w))) return;
    const score = words.reduce(
      (s, w) =>
        s +
        (name.startsWith(w)
          ? 4
          : name.split(' ').some((t) => t.startsWith(w))
            ? 3
            : name.includes(w)
              ? 2
              : 1),
      0,
    );
    scored.push({ e, score, order });
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((s) => s.e);
}
