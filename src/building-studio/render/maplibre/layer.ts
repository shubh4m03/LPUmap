/**
 * The studio custom layer (S1): a MapLibre CustomLayerInterface in raw
 * WebGL2 that draws StudioMesh instances in metres with the map's own
 * projection. No Three.js and no new dependency.
 *
 * - Placement: every instance gets instanceMatrix(mainMatrix, origin), so a
 *   model sits at its anchor with true metre scale at any pitch, bearing and
 *   zoom (placement.ts).
 * - Depth: renderingMode '3d' shares MapLibre's depth buffer, so models and
 *   fill-extrusions occlude each other correctly.
 * - Preview: translucent instances (premultiplied alpha, no depth writes,
 *   back faces culled) for Studio placement.
 * - Selection: the instance whose id is selected is tinted.
 * - Picking is NOT done here: the footprint layer is always used (S1).
 * - Failure: compile/link/upload/draw errors and context loss mark the layer
 *   failed and call onFailure once; the host then removes it and shows the
 *   extrusion fallback. render() never throws into MapLibre's frame.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';
import type { LngLat } from '../../../data/index.ts';
import type { StudioMesh } from '../../index.ts';
import { buildMeshBuffers, hexToRgb, meshContentKey, type StudioAppearance } from './buffers.ts';
import {
  createGpuMeshCache,
  createStudioProgram,
  type GpuMesh,
  type GpuMeshCache,
  type StudioGL,
  type StudioProgram,
} from './gl-resources.ts';
import { frontFaceWinding, instanceMatrix, lightDirectionEnu } from './placement.ts';

export const STUDIO_LAYER_ID = 'studio-models';

export interface StudioLayerInstance {
  /** Public building id (targetId ?? studio id): the id used for selection everywhere. */
  id: string;
  mesh: StudioMesh;
  appearance: StudioAppearance;
  /** Translucent placement preview (Studio). */
  preview?: boolean;
}

/** MapLibre light parameters the extrusions use, so both are lit alike (map-anchored). */
export interface StudioLight {
  /** [radial, azimuth°, polar°] as in MapLibre's LightSpecification.position. */
  position: [number, number, number];
  intensity: number;
  /** `#rrggbb`. */
  colour: string;
}

export interface StudioLayerStyle {
  light: StudioLight;
  /** Tint of the selected instance, `#rrggbb` (the map's selection colour). */
  highlight: string;
  /** Glass tone of procedural windows, `#rrggbb`. */
  glass: string;
}

export type StudioLayerFailure = 'program' | 'buffers' | 'render' | 'context-lost';

export interface StudioLayerStats {
  instances: number;
  meshes: number;
  gpuBytes: number;
  uploads: number;
  drawCalls: number;
  triangles: number;
  /** CPU time of the last render() call in ms (command submission, not GPU time). */
  lastRenderMs: number;
}

export interface StudioLayerOptions {
  id?: string;
  style: StudioLayerStyle;
  /** Called once when the layer stops drawing for good. */
  onFailure?(reason: StudioLayerFailure, detail: string): void;
  now?(): number;
}

export interface StudioCustomLayer extends CustomLayerInterface {
  setInstances(list: readonly StudioLayerInstance[]): void;
  setSelected(id: string | null): void;
  setStyle(style: StudioLayerStyle): void;
  /** Hides the layer without releasing resources (2D mode, below the extrusion zoom). */
  setVisible(visible: boolean): void;
  /** The map's context was lost: drop GL references without touching the dead context. */
  contextLost(): void;
  stats(): StudioLayerStats;
  readonly failure: StudioLayerFailure | null;
}

/** Map surface the layer needs: repaint requests only. */
type LayerHostMap = Pick<MapLibreMap, 'triggerRepaint'>;

interface Active {
  instance: StudioLayerInstance;
  key: string;
  gpu: GpuMesh | null;
}

const PREVIEW_ALPHA = 0.55;

export function createStudioCustomLayer(opts: StudioLayerOptions): StudioCustomLayer {
  const now = opts.now ?? (() => performance.now());
  let style = opts.style;
  let map: LayerHostMap | null = null;
  let gl: StudioGL | null = null;
  let program: StudioProgram | null = null;
  let cache: GpuMeshCache | null = null;
  let failure: StudioLayerFailure | null = null;
  let visible = true;
  let selected: string | null = null;
  const active = new Map<string, Active>();
  const stats = { drawCalls: 0, triangles: 0, lastRenderMs: 0 };

  const fail = (reason: StudioLayerFailure, err: unknown) => {
    if (failure) return;
    failure = reason;
    const detail = err instanceof Error ? err.message : String(err);
    opts.onFailure?.(reason, detail);
  };

  const upload = (a: Active) => {
    if (!cache || a.gpu || failure) return;
    try {
      a.gpu = cache.acquire(a.key, () => buildMeshBuffers(a.instance.mesh, a.instance.appearance));
    } catch (err) {
      fail('buffers', err);
    }
  };

  const release = (a: Active) => {
    if (a.gpu && cache) cache.release(a.key);
    a.gpu = null;
  };

  const repaint = () => map?.triggerRepaint();

  const layer: StudioCustomLayer = {
    id: opts.id ?? STUDIO_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',

    onAdd(m: MapLibreMap, context: WebGL2RenderingContext) {
      map = m;
      gl = context;
      try {
        program = createStudioProgram(context);
      } catch (err) {
        fail('program', err);
        return;
      }
      cache = createGpuMeshCache(context);
      for (const a of active.values()) upload(a);
    },

    onRemove() {
      if (gl && cache && !gl.isContextLost()) {
        cache.disposeAll();
        if (program) (gl as WebGL2RenderingContext).deleteProgram(program.program);
      }
      for (const a of active.values()) a.gpu = null;
      cache = null;
      program = null;
      gl = null;
      map = null;
    },

    render(context: WebGL2RenderingContext, args: CustomRenderMethodInput) {
      stats.drawCalls = 0;
      stats.triangles = 0;
      if (failure || !visible || !program || active.size === 0) return;
      const t0 = now();
      try {
        draw(context, args);
      } catch (err) {
        fail('render', err);
      } finally {
        context.bindVertexArray(null);
        context.depthMask(true);
        context.disable(context.CULL_FACE);
      }
      stats.lastRenderMs = now() - t0;
    },

    setInstances(list) {
      const next = new Map<string, StudioLayerInstance>();
      for (const inst of list) next.set(inst.id, inst);
      for (const [id, a] of active) {
        if (!next.has(id)) {
          release(a);
          active.delete(id);
        }
      }
      for (const [id, inst] of next) {
        const key = meshContentKey(inst.mesh, inst.appearance);
        const prev = active.get(id);
        if (prev && prev.key === key) {
          prev.instance = inst;
          continue;
        }
        // Acquire the new key before releasing the old one so a shared mesh is never re-uploaded.
        const a: Active = { instance: inst, key, gpu: null };
        upload(a);
        if (prev) release(prev);
        active.set(id, a);
      }
      repaint();
    },

    setSelected(id) {
      if (selected === id) return;
      selected = id;
      repaint();
    },

    setStyle(s) {
      style = s;
      repaint();
    },

    setVisible(v) {
      if (visible === v) return;
      visible = v;
      repaint();
    },

    contextLost() {
      cache?.forget();
      for (const a of active.values()) a.gpu = null;
      cache = null;
      program = null;
      fail('context-lost', new Error('The WebGL context was lost.'));
    },

    stats() {
      return {
        instances: active.size,
        meshes: cache?.size ?? 0,
        gpuBytes: cache?.bytes ?? 0,
        uploads: cache?.uploads ?? 0,
        drawCalls: stats.drawCalls,
        triangles: stats.triangles,
        lastRenderMs: stats.lastRenderMs,
      };
    },

    get failure() {
      return failure;
    },
  };

  function draw(context: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const p = program!;
    const u = p.uniforms;
    const main = args.defaultProjectionData.mainMatrix as ArrayLike<number>;
    context.useProgram(p.program);
    const [lx, ly, lz] = lightDirectionEnu(style.light.position);
    context.uniform3f(u.u_lightpos, lx, ly, lz);
    context.uniform1f(u.u_lightintensity, style.light.intensity);
    const lc = hexToRgb(style.light.colour);
    context.uniform3f(u.u_lightcolor, lc[0], lc[1], lc[2]);
    const glass = hexToRgb(style.glass);
    context.uniform3f(u.u_glass, glass[0], glass[1], glass[2]);
    const hl = hexToRgb(style.highlight);
    context.uniform3f(u.u_highlightcolour, hl[0], hl[1], hl[2]);

    // Opaque models first (depth writes on), then translucent previews (depth test only).
    for (const pass of [false, true]) {
      context.depthMask(!pass);
      context.uniform1f(u.u_alpha, pass ? PREVIEW_ALPHA : 1);
      for (const a of active.values()) {
        if (Boolean(a.instance.preview) !== pass) continue;
        if (!a.gpu) upload(a);
        const g = a.gpu;
        if (!g || failure) continue;
        const origin: LngLat = a.instance.mesh.origin;
        const matrix = instanceMatrix(main, origin);
        if (a.instance.mesh.closed) {
          context.enable(context.CULL_FACE);
          context.cullFace(context.BACK);
          context.frontFace(frontFaceWinding(matrix) === 'cw' ? context.CW : context.CCW);
        } else context.disable(context.CULL_FACE);
        context.uniformMatrix4fv(u.u_matrix, false, matrix);
        const bb = a.instance.mesh.bbox;
        context.uniform2f(u.u_zrange, bb.min[2], bb.max[2]);
        context.uniform1f(u.u_highlight, a.instance.id === selected ? 1 : 0);
        context.bindVertexArray(g.vao);
        context.drawElements(context.TRIANGLES, g.indexCount, g.indexType, 0);
        stats.drawCalls += 1;
        stats.triangles += g.triangleCount;
      }
    }
  }

  return layer;
}
