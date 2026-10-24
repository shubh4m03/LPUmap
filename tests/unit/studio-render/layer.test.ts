import type { CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateStudioMesh } from '../../../src/building-studio/mesh/generate.ts';
import type { StudioMesh } from '../../../src/building-studio/mesh/types.ts';
import {
  createGpuMeshCache,
  createStudioProgram,
  StudioGlError,
} from '../../../src/building-studio/render/maplibre/gl-resources.ts';
import {
  createStudioCustomLayer,
  type StudioLayerInstance,
  type StudioLayerStyle,
} from '../../../src/building-studio/render/maplibre/layer.ts';
import { buildMeshBuffers } from '../../../src/building-studio/render/maplibre/buffers.ts';
import { model } from '../building-studio/fixtures.ts';
import { createFakeGL, type FakeGL } from './fake-gl.ts';

const STYLE: StudioLayerStyle = {
  light: { position: [1.15, 210, 35], intensity: 0.5, colour: '#ffffff' },
  highlight: '#c2410c',
  glass: '#4b5d70',
};
const APPEARANCE = { wall: '#e8dcc8', roof: '#b0a99f' };

function meshAt(anchor: [number, number], over: Parameters<typeof model>[0] = {}): StudioMesh {
  const r = generateStudioMesh(model({ anchor, ...over }));
  if (!r.ok) throw new Error(r.message);
  return r.mesh;
}

const inst = (id: string, mesh: StudioMesh, preview = false): StudioLayerInstance => ({
  id,
  mesh,
  appearance: APPEARANCE,
  ...(preview ? { preview: true } : {}),
});

/** A render argument with an identity projection (only the matrix plumbing matters here). */
const ARGS = {
  defaultProjectionData: { mainMatrix: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) },
} as unknown as CustomRenderMethodInput;

function setup() {
  const gl = createFakeGL();
  const map = { triggerRepaint: vi.fn() };
  const onFailure = vi.fn();
  const layer = createStudioCustomLayer({ style: STYLE, onFailure });
  layer.onAdd!(map as unknown as MapLibreMap, gl as unknown as WebGL2RenderingContext);
  const render = () => layer.render(gl as unknown as WebGL2RenderingContext, ARGS);
  return { gl, map, layer, onFailure, render };
}

describe('GPU mesh cache', () => {
  let gl: FakeGL;
  beforeEach(() => {
    gl = createFakeGL();
  });
  const data = () => buildMeshBuffers(meshAt([75.7032, 31.2533]), APPEARANCE);

  it('uploads once per key, counts references and deletes on the last release', () => {
    const cache = createGpuMeshCache(gl);
    const a = cache.acquire('k', data);
    const b = cache.acquire('k', data);
    expect(a).toBe(b);
    expect(cache.uploads).toBe(1);
    expect(gl.live.buffers.size).toBe(2);
    expect(gl.live.vaos.size).toBe(1);
    cache.release('k');
    expect(gl.live.buffers.size).toBe(2);
    cache.release('k');
    expect(gl.live.buffers.size).toBe(0);
    expect(gl.live.vaos.size).toBe(0);
    expect(cache.size).toBe(0);
    cache.release('unknown'); // ignored
  });

  it('disposeAll deletes everything; forget (context lost) deletes nothing', () => {
    const cache = createGpuMeshCache(gl);
    cache.acquire('a', data);
    cache.acquire('b', data);
    expect(cache.bytes).toBeGreaterThan(0);
    cache.forget();
    expect(gl.calls).toEqual([]);
    expect(cache.size).toBe(0);
    const c2 = createGpuMeshCache(gl);
    c2.acquire('a', data);
    c2.disposeAll();
    expect(gl.calls.filter((c) => c === 'deleteBuffer')).toHaveLength(2);
  });

  it('a failing shader throws StudioGlError and leaks no shader', () => {
    gl.failCompile = true;
    expect(() => createStudioProgram(gl)).toThrow(StudioGlError);
    expect(gl.live.shaders.size).toBe(0);
  });
});

describe('studio custom layer', () => {
  it('is a 3D custom layer that shares the depth buffer', () => {
    const layer = createStudioCustomLayer({ style: STYLE });
    expect(layer).toMatchObject({ id: 'studio-models', type: 'custom', renderingMode: '3d' });
  });

  it('draws one call per instance with the per-instance matrix and highlight', () => {
    const { gl, layer, render } = setup();
    const a = meshAt([75.7032, 31.2533]);
    const b = meshAt([75.7051, 31.2549], { heightM: 20 });
    layer.setInstances([inst('stu:a', a), inst('stu:b', b)]);
    layer.setSelected('stu:b');
    render();
    expect(gl.draws).toHaveLength(2);
    const byHighlight = gl.draws.map((d) => d.uniforms.u_highlight);
    expect(byHighlight.sort()).toEqual([0, 1]);
    expect(gl.draws.every((d) => d.depthMask && d.cull && d.uniforms.u_alpha === 1)).toBe(true);
    // Different origins → different matrices.
    expect(gl.draws[0]!.uniforms.u_matrix).not.toEqual(gl.draws[1]!.uniforms.u_matrix);
    expect(layer.stats()).toMatchObject({ instances: 2, meshes: 2, drawCalls: 2 });
  });

  it('reuses one buffer for repeated placement of the same model and releases it on removal', () => {
    const { gl, layer } = setup();
    const m1 = meshAt([75.7032, 31.2533]);
    const m2 = meshAt([75.7041, 31.254]); // same model, another anchor
    layer.setInstances([inst('stu:a', m1), inst('stu:b', m2)]);
    expect(layer.stats()).toMatchObject({ instances: 2, meshes: 1, uploads: 1 });
    // Dragging a placement (new origin, same geometry) uploads nothing.
    layer.setInstances([inst('stu:a', m1), inst('stu:b', meshAt([75.705, 31.255]))]);
    expect(layer.stats().uploads).toBe(1);
    layer.setInstances([inst('stu:a', m1)]);
    expect(gl.live.buffers.size).toBe(2);
    layer.setInstances([]);
    expect(gl.live.buffers.size).toBe(0);
    expect(gl.live.vaos.size).toBe(0);
  });

  it('replaces a changed model without leaking the old buffer', () => {
    const { gl, layer } = setup();
    layer.setInstances([inst('stu:a', meshAt([75.7032, 31.2533]))]);
    layer.setInstances([inst('stu:a', meshAt([75.7032, 31.2533], { heightM: 30 }))]);
    expect(layer.stats()).toMatchObject({ meshes: 1, uploads: 2 });
    expect(gl.live.vaos.size).toBe(1);
  });

  it('draws previews translucent after the opaque models, without depth writes', () => {
    const { gl, layer, render } = setup();
    layer.setInstances([
      inst('stu:p', meshAt([75.7032, 31.2533]), true),
      inst('stu:a', meshAt([75.704, 31.254], { heightM: 9 })),
    ]);
    render();
    expect(gl.draws.map((d) => [d.depthMask, d.uniforms.u_alpha])).toEqual([
      [true, 1],
      [false, 0.55],
    ]);
  });

  it('draws nothing while hidden and resumes when shown', () => {
    const { gl, layer, render, map } = setup();
    layer.setInstances([inst('stu:a', meshAt([75.7032, 31.2533]))]);
    layer.setVisible(false);
    render();
    expect(gl.draws).toHaveLength(0);
    layer.setVisible(true);
    render();
    expect(gl.draws).toHaveLength(1);
    expect(map.triggerRepaint).toHaveBeenCalled();
  });

  it('reports a shader failure once and never draws', () => {
    const gl = createFakeGL();
    gl.failCompile = true;
    const onFailure = vi.fn();
    const layer = createStudioCustomLayer({ style: STYLE, onFailure });
    layer.onAdd!(
      { triggerRepaint: vi.fn() } as unknown as MapLibreMap,
      gl as unknown as WebGL2RenderingContext,
    );
    layer.setInstances([inst('stu:a', meshAt([75.7032, 31.2533]))]);
    layer.render(gl as unknown as WebGL2RenderingContext, ARGS);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]![0]).toBe('program');
    expect(layer.failure).toBe('program');
    expect(gl.draws).toHaveLength(0);
  });

  it('turns a draw error into a reported failure instead of throwing into MapLibre', () => {
    const { gl, layer, render, onFailure } = setup();
    layer.setInstances([inst('stu:a', meshAt([75.7032, 31.2533]))]);
    gl.failDraw = true;
    expect(render).not.toThrow();
    expect(onFailure).toHaveBeenCalledWith('render', 'fake draw failure');
    gl.failDraw = false;
    render();
    expect(gl.draws).toHaveLength(0); // stays failed: the host switches to the extrusion fallback
  });

  it('on context loss drops references without calling the dead context', () => {
    const { gl, layer, onFailure } = setup();
    layer.setInstances([inst('stu:a', meshAt([75.7032, 31.2533]))]);
    gl.calls.length = 0;
    gl.lost = true;
    layer.contextLost();
    layer.onRemove!({} as MapLibreMap, gl as unknown as WebGL2RenderingContext);
    expect(gl.calls).toEqual([]);
    expect(onFailure).toHaveBeenCalledWith('context-lost', 'The WebGL context was lost.');
  });

  it('releases every GL object on removal', () => {
    const { gl, layer } = setup();
    layer.setInstances([
      inst('stu:a', meshAt([75.7032, 31.2533])),
      inst('stu:b', meshAt([75.704, 31.254], { heightM: 9 })),
    ]);
    layer.onRemove!({} as MapLibreMap, gl as unknown as WebGL2RenderingContext);
    expect(gl.live.buffers.size).toBe(0);
    expect(gl.live.vaos.size).toBe(0);
    expect(gl.live.programs.size).toBe(0);
  });

  it('uploads instances given before onAdd once the context arrives', () => {
    const gl = createFakeGL();
    const layer = createStudioCustomLayer({ style: STYLE });
    layer.setInstances([inst('stu:a', meshAt([75.7032, 31.2533]))]);
    expect(gl.bufferUploads).toBe(0);
    layer.onAdd!(
      { triggerRepaint: vi.fn() } as unknown as MapLibreMap,
      gl as unknown as WebGL2RenderingContext,
    );
    expect(layer.stats().meshes).toBe(1);
  });
});
