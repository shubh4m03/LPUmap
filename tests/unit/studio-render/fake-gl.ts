/**
 * Recording fake of the WebGL2 calls the studio layer makes. It allocates
 * numbered handles, tracks which buffers / vertex arrays / programs are alive
 * and logs draw calls with the uniforms set at that moment, so resource
 * lifecycle and draw behaviour can be asserted without a GPU.
 */
import type { StudioGL } from '../../../src/building-studio/render/maplibre/gl-resources.ts';

export interface DrawRecord {
  count: number;
  type: number;
  vao: number | null;
  uniforms: Record<string, unknown>;
  depthMask: boolean;
  cull: boolean;
  frontFace: number | null;
}

export interface FakeGL extends StudioGL {
  live: { buffers: Set<number>; vaos: Set<number>; programs: Set<number>; shaders: Set<number> };
  calls: string[];
  draws: DrawRecord[];
  bufferUploads: number;
  failCompile: boolean;
  failDraw: boolean;
  lost: boolean;
}

export function createFakeGL(): FakeGL {
  let next = 1;
  const live = {
    buffers: new Set<number>(),
    vaos: new Set<number>(),
    programs: new Set<number>(),
    shaders: new Set<number>(),
  };
  const uniforms: Record<string, unknown> = {};
  let boundVao: number | null = null;
  let depthMask = true;
  let cull = false;
  let frontFace: number | null = null;
  const handle = <T>(set: Set<number>) => {
    const h = next++;
    set.add(h);
    return h as unknown as T;
  };
  const id = (h: unknown) => h as number;
  const gl = {
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    UNSIGNED_SHORT: 0x1403,
    UNSIGNED_INT: 0x1405,
    TRIANGLES: 0x0004,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    CULL_FACE: 0x0b44,
    BACK: 0x0405,
    CW: 0x0900,
    CCW: 0x0901,
    live,
    calls: [] as string[],
    draws: [] as DrawRecord[],
    bufferUploads: 0,
    failCompile: false,
    failDraw: false,
    lost: false,
    createBuffer: () => handle<WebGLBuffer>(live.buffers),
    deleteBuffer: (b: WebGLBuffer | null) => {
      live.buffers.delete(id(b));
      gl.calls.push('deleteBuffer');
    },
    bindBuffer: () => {},
    bufferData: () => {
      gl.bufferUploads += 1;
    },
    createVertexArray: () => handle<WebGLVertexArrayObject>(live.vaos),
    deleteVertexArray: (v: WebGLVertexArrayObject | null) => {
      live.vaos.delete(id(v));
      gl.calls.push('deleteVertexArray');
    },
    bindVertexArray: (v: WebGLVertexArrayObject | null) => {
      boundVao = v === null ? null : id(v);
    },
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    createShader: () => handle<WebGLShader>(live.shaders),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => !gl.failCompile,
    getShaderInfoLog: () => 'fake compile error',
    deleteShader: (s: WebGLShader | null) => {
      live.shaders.delete(id(s));
    },
    createProgram: () => handle<WebGLProgram>(live.programs),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    deleteProgram: (p: WebGLProgram | null) => {
      live.programs.delete(id(p));
      gl.calls.push('deleteProgram');
    },
    useProgram: () => {},
    getUniformLocation: (_p: WebGLProgram, name: string) => name as unknown as WebGLUniformLocation,
    uniformMatrix4fv: (loc: WebGLUniformLocation | null, _t: boolean, v: Float32Array) => {
      uniforms[loc as unknown as string] = Array.from(v);
    },
    uniform1f: (loc: WebGLUniformLocation | null, v: number) => {
      uniforms[loc as unknown as string] = v;
    },
    uniform2f: (loc: WebGLUniformLocation | null, a: number, b: number) => {
      uniforms[loc as unknown as string] = [a, b];
    },
    uniform3f: (loc: WebGLUniformLocation | null, a: number, b: number, c: number) => {
      uniforms[loc as unknown as string] = [a, b, c];
    },
    drawElements: (_mode: number, count: number, type: number) => {
      if (gl.failDraw) throw new Error('fake draw failure');
      gl.draws.push({ count, type, vao: boundVao, uniforms: { ...uniforms }, depthMask, cull, frontFace });
    },
    enable: (cap: number) => {
      if (cap === gl.CULL_FACE) cull = true;
    },
    disable: (cap: number) => {
      if (cap === gl.CULL_FACE) cull = false;
    },
    cullFace: () => {},
    frontFace: (mode: number) => {
      frontFace = mode;
    },
    depthMask: (flag: boolean) => {
      depthMask = flag;
    },
    isContextLost: () => gl.lost,
  };
  return gl as unknown as FakeGL;
}
