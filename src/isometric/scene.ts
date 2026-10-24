/**
 * Scene build (docs/ISOMETRIC_AND_3D_DESIGN.md §6.6 step 1): the loaded
 * dataset → everything the overview draws, in view units at k = 1. Rerun only
 * when the data or the rotation changes. Pure and synchronous.
 *
 *  - Ground (basemap, boundary, map-key grid) stays in local metres: it is
 *    drawn through an affine canvas transform, so it does not depend on the
 *    rotation and road widths stay true metres.
 *  - Buildings are the campus-inventory footprints of buildings.geojson (the
 *    same loaded dataset as every other mode; nothing is copied or invented).
 *    A building with an owner-authored studio model draws the model's faces
 *    instead of its prism; its footprint still takes part in the depth graph
 *    and in hit-testing (S1: picking always uses the footprint).
 */
import type { StudioMesh } from '../building-studio/mesh/types.ts';
import { APP_CONFIG } from '../config/index.ts';
import type {
  BasemapFile,
  BasemapLayer,
  BoundaryFile,
  BuildingsFile,
  HeightSource,
  LngLat,
} from '../data/schema.ts';
import { depthOrder, type DepthNode } from './depth-order.ts';
import {
  normalizePolygon,
  polygonsOfGeometry,
  prismFaces3,
  projectFace,
  sortVisibleFaces,
  studioFaces3,
  isFrontFacing,
  type AppearanceColours,
  type Face3,
  type IsoFace,
  type SortStats,
} from './faces.ts';
import { boxOf, emptyBox, extendBox, type Box, type Pt } from './geometry.ts';
import {
  createIsoProjection,
  createLocalFrame,
  type IsoProjection,
  type IsoRotation,
  type LocalFrame,
} from './projection.ts';

/** An owner-authored model to draw in place of a building's prism (S1). */
export interface IsoStudioModel {
  /** Public id: equals the building feature id (`stu:…`, or the base building id it models). */
  id: string;
  mesh: StudioMesh;
  /** Owner-chosen appearance colours (appearance only, never a material claim). */
  colours?: AppearanceColours;
  /** S3 public label, e.g. "Illustrative model placed by the site owner — not verified". */
  verificationLabel: string;
  /** S3 appearance label ("Colours and materials are appearance only"). */
  appearanceLabel: string;
  /** True when the model could not be generated and the S2 fallback prism is drawn. */
  fallback?: boolean;
}

export interface IsoSceneInput {
  buildings: BuildingsFile;
  basemap: BasemapFile;
  boundary: BoundaryFile;
  studioModels?: readonly IsoStudioModel[];
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

export interface GroundPolygon {
  layer: BasemapLayer;
  rings: Pt[][];
}
export interface GroundLine {
  layer: BasemapLayer;
  coords: Pt[];
}
export interface GridLine {
  from: Pt;
  to: Pt;
}
export interface GridLabel {
  text: string;
  at: Pt;
}

export interface IsoGround {
  frame: LocalFrame;
  /** Campus boundary polygons (local metres). */
  boundary: Pt[][][];
  polygons: GroundPolygon[];
  lines: GroundLine[];
  /** Map-key reference grid (APP_CONFIG.directory: fixed origin, 200 m cells) over the campus extent. */
  grid: { lines: GridLine[]; labels: GridLabel[] };
  /** Outer boundary vertices (fit and default rotation). */
  campusPoints: Pt[];
  vertexCount: number;
}

const POLYGON_ORDER: readonly BasemapLayer[] = ['landuse', 'green', 'pitch', 'parking', 'water'];
const LINE_ORDER: readonly BasemapLayer[] = ['road-major', 'road', 'service', 'path', 'steps'];

function linesOfGeometry(g: { type: string; coordinates: unknown }): LngLat[][] {
  const isPos = (p: unknown): p is LngLat =>
    Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const lineOf = (l: unknown): LngLat[] | null =>
    Array.isArray(l) && l.length >= 2 && l.every(isPos) ? l.map((p: LngLat) => [p[0], p[1]] as LngLat) : null;
  if (g.type === 'LineString') {
    const l = lineOf(g.coordinates);
    return l ? [l] : [];
  }
  if (g.type === 'MultiLineString' && Array.isArray(g.coordinates))
    return g.coordinates.map(lineOf).filter((l): l is LngLat[] => l !== null);
  return [];
}

const columnLetter = (i: number): string => String.fromCharCode(65 + i);

export function buildGround(
  input: Pick<IsoSceneInput, 'basemap' | 'boundary'>,
  frame: LocalFrame = createLocalFrame(),
): IsoGround {
  const local = (ring: readonly LngLat[]): Pt[] => ring.map((p) => frame.toLocal(p));
  let vertexCount = 0;
  const boundary: Pt[][][] = [];
  const campusPoints: Pt[] = [];
  for (const f of input.boundary.features) {
    for (const poly of polygonsOfGeometry(f.geometry)) {
      const rings = poly.map(local);
      boundary.push(rings);
      campusPoints.push(...(rings[0] ?? []));
      vertexCount += rings.reduce((s, r) => s + r.length, 0);
    }
  }
  const polygons: GroundPolygon[] = [];
  const lines: GroundLine[] = [];
  for (const f of input.basemap.features) {
    const layer = f.properties.layer;
    if (POLYGON_ORDER.includes(layer)) {
      for (const poly of polygonsOfGeometry(f.geometry)) {
        const rings = poly.map(local);
        vertexCount += rings.reduce((s, r) => s + r.length, 0);
        polygons.push({ layer, rings });
      }
    } else if (LINE_ORDER.includes(layer)) {
      for (const l of linesOfGeometry(f.geometry)) {
        vertexCount += l.length;
        lines.push({ layer, coords: local(l) });
      }
    }
  }
  polygons.sort((a, b) => POLYGON_ORDER.indexOf(a.layer) - POLYGON_ORDER.indexOf(b.layer));
  lines.sort((a, b) => LINE_ORDER.indexOf(b.layer) - LINE_ORDER.indexOf(a.layer)); // minor first, major on top

  // Map-key grid: fixed origin (north-west corner), columns A… west→east, rows 1… north→south.
  const grid: IsoGround['grid'] = { lines: [], labels: [] };
  if (campusPoints.length > 0) {
    const { gridOrigin, cellM } = APP_CONFIG.directory;
    const [oe, on] = frame.toLocal(gridOrigin);
    const ext = boxOf(campusPoints);
    const c0 = Math.max(0, Math.floor((ext.minX - oe) / cellM));
    const c1 = Math.ceil((ext.maxX - oe) / cellM);
    const r0 = Math.max(0, Math.floor((on - ext.maxY) / cellM));
    const r1 = Math.ceil((on - ext.minY) / cellM);
    const west = oe + c0 * cellM;
    const east = oe + c1 * cellM;
    const north = on - r0 * cellM;
    const south = on - r1 * cellM;
    for (let c = c0; c <= c1; c++)
      grid.lines.push({ from: [oe + c * cellM, north], to: [oe + c * cellM, south] });
    for (let r = r0; r <= r1; r++)
      grid.lines.push({ from: [west, on - r * cellM], to: [east, on - r * cellM] });
    for (let c = c0; c < c1 && c < 26; c++)
      for (let r = r0; r < r1; r++)
        grid.labels.push({
          text: `${columnLetter(c)}${r + 1}`,
          at: [oe + c * cellM + 8, on - r * cellM - 8],
        });
  }
  return { frame, boundary, polygons, lines, grid, campusPoints, vertexCount };
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export interface IsoBuilding {
  id: string;
  name: string | null;
  displayName: string;
  key: string | null;
  areaM2: number;
  heightM: number;
  minHeightM: number;
  heightSource: HeightSource;
  /** The height is a placeholder (`fallback`): lighter tones and a dashed roof outline. */
  placeholder: boolean;
  /** Visible faces, back to front (view units). */
  faces: IsoFace[];
  /** Roof outline(s) at the top of the footprint prism (view units). */
  roofOutline: Pt[][];
  /** Hit shapes of the footprint prism: roof polygon(s) and visible wall quads (view units). */
  hit: Pt[][][];
  hitBox: Box;
  /** Union of drawn faces (view units), for culling. */
  box: Box;
  /** Label/marker anchor: the point-on-surface at the top of the building. */
  labelAnchor: Pt;
  /** Point-on-surface at ground level. */
  groundAnchor: Pt;
  anchorLngLat: LngLat;
  studio: IsoStudioModel | null;
}

export interface IsoDrawItem {
  building: IsoBuilding;
  faces: IsoFace[];
}

export interface IsoSceneStats {
  buildMs: number;
  buildings: number;
  faces: number;
  windows: number;
  /** Unit-order cycles Kahn had to break (0 by construction; guarded by a test). */
  cycles: number;
  /** Building-level cycles resolved by sorting the members' faces together. */
  cycleMerges: number;
  /** Painter cycles broken inside buildings (and interleaved clusters). */
  faceCycles: number;
  interleavedPairs: number;
  overlapPairs: number;
  /** Studio models whose id matches no building feature (not drawn). */
  studioUnmatched: number;
}

export interface IsoScene {
  rotation: IsoRotation;
  projection: IsoProjection;
  frame: LocalFrame;
  /** Back to front (by each building's last drawn face): the order hit-testing reverses. */
  buildings: IsoBuilding[];
  /**
   * What to paint, back to front. One item per building, except inside an
   * interleaved cluster, where the members' faces alternate and a building may
   * appear in several items.
   */
  draw: IsoDrawItem[];
  byId: ReadonlyMap<string, IsoBuilding>;
  /** View-unit bounds of buildings and boundary. */
  bounds: Box;
  stats: IsoSceneStats;
}

/** Window quads drawn per scene at most (appearance detail; beyond it windows are omitted). */
export const WINDOW_BUDGET = 6000;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function buildIsoScene(
  input: IsoSceneInput,
  rotation: IsoRotation,
  frame: LocalFrame = createLocalFrame(),
  campusPoints: readonly Pt[] = [],
): IsoScene {
  const t0 = now();
  const proj = createIsoProjection(rotation);
  const studioById = new Map<string, IsoStudioModel>();
  for (const m of input.studioModels ?? []) if (!studioById.has(m.id)) studioById.set(m.id, m);
  let studioMatched = 0;

  interface Prep {
    id: string;
    polygons: Pt[][][];
    props: BuildingsFile['features'][number]['properties'];
    studio: IsoStudioModel | null;
  }
  const preps: Prep[] = [];
  const seen = new Set<string>();
  for (const f of input.buildings.features) {
    const p = f.properties;
    if (!p.inCampusInventory || seen.has(p.id)) continue;
    const polygons = polygonsOfGeometry(f.geometry)
      .map((poly) => normalizePolygon(poly.map((r) => r.map((ll) => frame.toLocal(ll)))))
      .filter((poly) => poly.length > 0);
    if (polygons.length === 0) continue;
    seen.add(p.id);
    const studio = studioById.get(p.id) ?? null;
    if (studio) studioMatched++;
    preps.push({ id: p.id, polygons, props: p, studio });
  }

  // Global depth graph over footprints (one node per building; parts of a multipolygon share it).
  const nodes: DepthNode[] = preps.map((b) => ({
    id: b.id,
    rings: b.polygons.flat().map((r) => r.map(([e, n]) => proj.viewFrame(e, n) as Pt)),
    heightM: b.props.renderHeightM,
    minHeightM: b.props.renderMinHeightM,
  }));
  const depth = depthOrder(nodes, { sinA: proj.sinA, cosA: proj.cosA });
  // Height rule for truly overlapping footprints, applied face by face inside their unit.
  const n = nodes.length;
  const forced = new Map<number, -1 | 1>();
  for (const [back, front] of depth.overlaps) {
    forced.set(back * n + front, -1);
    forced.set(front * n + back, 1);
  }

  const sortStats: SortStats = { cycles: 0 };
  const windowBudget = { left: WINDOW_BUDGET };
  const bounds = emptyBox();
  for (const p of campusPoints) {
    const [x, y] = proj.project(p[0], p[1], 0);
    extendBox(bounds, x, y);
  }
  let faceCount = 0;
  type OwnedFace = Face3 & { owner: number };
  const buildings: IsoBuilding[] = [];
  const draw: IsoDrawItem[] = [];
  for (const unit of depth.units) {
    // Per member: hit shape = footprint prism (base prisms and studio models alike, S1).
    const members = unit.map((i) => {
      const b = preps[i]!;
      const p = b.props;
      const z0 = p.renderMinHeightM;
      const z1 = p.renderHeightM;
      const prism = b.polygons.flatMap((poly) => prismFaces3(poly, z0, z1));
      const hit = prism
        .filter((f) => isFrontFacing(f, proj))
        .map((f) => [
          f.ring.map((v) => proj.project(v[0], v[1], v[2]) as Pt),
          ...f.holes.map((h) => h.map((v) => proj.project(v[0], v[1], v[2]) as Pt)),
        ]);
      const roofOutline = prism
        .filter((f) => f.material === 'roof')
        .flatMap((f) => [f.ring, ...f.holes].map((r) => r.map((v) => proj.project(v[0], v[1], v[2]) as Pt)));
      const faces3: OwnedFace[] = (b.studio ? studioFaces3(b.studio.mesh, frame) : prism).map((f) => ({
        ...f,
        owner: i,
      }));
      const hitBox = emptyBox();
      for (const poly of hit) for (const [x, y] of poly[0] ?? []) extendBox(hitBox, x, y);
      const anchorLngLat: LngLat = [p.anchorLon, p.anchorLat];
      const [ae, an] = frame.toLocal(anchorLngLat);
      const topZ = b.studio ? Math.max(z1, b.studio.mesh.bbox.max[2]) : z1;
      const building: IsoBuilding = {
        id: b.id,
        name: p.name,
        displayName: p.displayName,
        key: p.directoryKey,
        areaM2: p.areaM2 ?? 0,
        heightM: z1,
        minHeightM: z0,
        heightSource: p.renderHeightSource,
        placeholder: p.renderHeightSource === 'fallback',
        faces: [],
        roofOutline,
        hit,
        hitBox,
        box: hit.length > 0 ? { ...hitBox } : emptyBox(),
        labelAnchor: proj.project(ae, an, topZ),
        groundAnchor: proj.project(ae, an, 0),
        anchorLngLat,
        studio: b.studio,
      };
      return { i, building, faces3 };
    });
    const byIndex = new Map(members.map((m) => [m.i, m.building]));
    // One building: its own faces. An interleaved cluster: all members' faces sorted together.
    const sorted = sortVisibleFaces(
      members.flatMap((m) => m.faces3),
      proj,
      sortStats,
      unit.length > 1
        ? (a, b) => (a.owner === b.owner ? 0 : (forced.get(a.owner * n + b.owner) ?? 0))
        : undefined,
    );
    let item: IsoDrawItem | null = null;
    for (const f of sorted) {
      const owner = byIndex.get(f.owner)!;
      const face = projectFace(f, proj, owner.studio?.colours ?? null, windowBudget);
      owner.faces.push(face);
      for (const [x, y] of face.ring) extendBox(owner.box, x, y);
      if (!item || item.building !== owner) {
        item = { building: owner, faces: [] };
        draw.push(item);
      }
      item.faces.push(face);
      faceCount++;
    }
    // Within a cluster, a building's place in the (hit-test) order is that of its last drawn face.
    const lastAt = new Map<IsoBuilding, number>();
    draw.forEach((d, k) => lastAt.set(d.building, k));
    const ordered = members
      .map((m) => m.building)
      .sort((a, b) => (lastAt.get(a) ?? -1) - (lastAt.get(b) ?? -1));
    for (const b of ordered) {
      extendBox(bounds, b.box.minX, b.box.minY);
      extendBox(bounds, b.box.maxX, b.box.maxY);
      buildings.push(b);
    }
  }

  const byId = new Map(buildings.map((b) => [b.id, b]));
  return {
    rotation,
    projection: proj,
    frame,
    buildings,
    draw,
    byId,
    bounds,
    stats: {
      buildMs: now() - t0,
      buildings: buildings.length,
      faces: faceCount,
      windows: WINDOW_BUDGET - windowBudget.left,
      cycles: depth.cycles,
      cycleMerges: depth.cycleMerges,
      faceCycles: sortStats.cycles,
      interleavedPairs: depth.interleavedPairs,
      overlapPairs: depth.overlapPairs,
      studioUnmatched: studioById.size - studioMatched,
    },
  };
}
