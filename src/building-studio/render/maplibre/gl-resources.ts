/**
 * WebGL2 resources of the studio custom layer: the shader program and a
 * reference-counted cache of mesh buffers.
 *
 * Reuse: buffers are keyed by `meshContentKey` (local geometry +
 * appearance, origin excluded), so placing the same model again — or
 * dragging a preview to a new anchor — uploads nothing; a key's buffers are
 * deleted when its last instance is released. After a context loss the GL
 * objects are already gone, so `forget()` drops the references without
 * calling into the dead context.
 */
import { ATTRIBUTES, STRIDE_BYTES, type MeshBuffers } from './buffers.ts';
import {
  ATTRIBUTE_LOCATIONS,
  FRAGMENT_SHADER,
  UNIFORMS,
  VERTEX_SHADER,
  type UniformName,
} from './shaders.ts';

/** The subset of WebGL2RenderingContext the layer uses (lets tests pass a recording fake). */
export type StudioGL = Pick<
  WebGL2RenderingContext,
  | 'ARRAY_BUFFER'
  | 'ELEMENT_ARRAY_BUFFER'
  | 'STATIC_DRAW'
  | 'FLOAT'
  | 'UNSIGNED_SHORT'
  | 'UNSIGNED_INT'
  | 'TRIANGLES'
  | 'VERTEX_SHADER'
  | 'FRAGMENT_SHADER'
  | 'COMPILE_STATUS'
  | 'LINK_STATUS'
  | 'CULL_FACE'
  | 'BACK'
  | 'CW'
  | 'CCW'
  | 'createBuffer'
  | 'deleteBuffer'
  | 'bindBuffer'
  | 'bufferData'
  | 'createVertexArray'
  | 'deleteVertexArray'
  | 'bindVertexArray'
  | 'enableVertexAttribArray'
  | 'vertexAttribPointer'
  | 'createShader'
  | 'shaderSource'
  | 'compileShader'
  | 'getShaderParameter'
  | 'getShaderInfoLog'
  | 'deleteShader'
  | 'createProgram'
  | 'attachShader'
  | 'linkProgram'
  | 'getProgramParameter'
  | 'getProgramInfoLog'
  | 'deleteProgram'
  | 'useProgram'
  | 'getUniformLocation'
  | 'uniformMatrix4fv'
  | 'uniform1f'
  | 'uniform2f'
  | 'uniform3f'
  | 'drawElements'
  | 'enable'
  | 'disable'
  | 'cullFace'
  | 'frontFace'
  | 'depthMask'
  | 'isContextLost'
>;

export class StudioGlError extends Error {
  override readonly name = 'StudioGlError';
}

export interface StudioProgram {
  program: WebGLProgram;
  uniforms: Record<UniformName, WebGLUniformLocation | null>;
}

function compile(gl: StudioGL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new StudioGlError('Could not create a shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new StudioGlError(`Shader compilation failed: ${log}`);
  }
  return shader;
}

/** Compiles and links the studio program. Throws StudioGlError on failure (the caller falls back). */
export function createStudioProgram(gl: StudioGL): StudioProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  let fs: WebGLShader;
  try {
    fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  } catch (err) {
    gl.deleteShader(vs);
    throw err;
  }
  const program = gl.createProgram();
  if (!program) throw new StudioGlError('Could not create a program.');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new StudioGlError(`Program link failed: ${log}`);
  }
  const uniforms = {} as Record<UniformName, WebGLUniformLocation | null>;
  for (const name of UNIFORMS) uniforms[name] = gl.getUniformLocation(program, name);
  return { program, uniforms };
}

export interface GpuMesh {
  key: string;
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  indexCount: number;
  indexType: number;
  triangleCount: number;
  bytes: number;
  refs: number;
}

export interface GpuMeshCache {
  /** Returns the cached buffers for `key` (+1 reference), building and uploading them on a miss. */
  acquire(key: string, build: () => MeshBuffers): GpuMesh;
  /** −1 reference; deletes the GL objects when none remain. Unknown keys are ignored. */
  release(key: string): void;
  get(key: string): GpuMesh | undefined;
  readonly size: number;
  /** GPU bytes held (vertex + index data). */
  readonly bytes: number;
  /** Uploads since creation (cache misses), for tests and the bake-off. */
  readonly uploads: number;
  /** Deletes every GL object (layer removal). */
  disposeAll(): void;
  /** Drops every reference without GL calls (the context is lost; its objects are gone). */
  forget(): void;
}

export function createGpuMeshCache(gl: StudioGL): GpuMeshCache {
  const entries = new Map<string, GpuMesh>();
  let uploads = 0;

  const destroy = (m: GpuMesh) => {
    gl.deleteVertexArray(m.vao);
    gl.deleteBuffer(m.vbo);
    gl.deleteBuffer(m.ibo);
  };

  return {
    acquire(key, build) {
      const hit = entries.get(key);
      if (hit) {
        hit.refs += 1;
        return hit;
      }
      const data = build();
      const vao = gl.createVertexArray();
      const vbo = gl.createBuffer();
      const ibo = gl.createBuffer();
      if (!vao || !vbo || !ibo) throw new StudioGlError('Could not allocate GPU buffers.');
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data.vertices, gl.STATIC_DRAW);
      for (const [name, attr] of Object.entries(ATTRIBUTES) as Array<
        [keyof typeof ATTRIBUTES, (typeof ATTRIBUTES)[keyof typeof ATTRIBUTES]]
      >) {
        const loc = ATTRIBUTE_LOCATIONS[name];
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, attr.size, gl.FLOAT, false, STRIDE_BYTES, attr.offset * 4);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      const entry: GpuMesh = {
        key,
        vao,
        vbo,
        ibo,
        indexCount: data.indices.length,
        indexType: data.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        triangleCount: data.triangleCount,
        bytes: data.vertices.byteLength + data.indices.byteLength,
        refs: 1,
      };
      entries.set(key, entry);
      uploads += 1;
      return entry;
    },
    release(key) {
      const m = entries.get(key);
      if (!m) return;
      m.refs -= 1;
      if (m.refs > 0) return;
      entries.delete(key);
      destroy(m);
    },
    get: (key) => entries.get(key),
    get size() {
      return entries.size;
    },
    get bytes() {
      let b = 0;
      for (const m of entries.values()) b += m.bytes;
      return b;
    },
    get uploads() {
      return uploads;
    },
    disposeAll() {
      for (const m of entries.values()) destroy(m);
      entries.clear();
    },
    forget() {
      entries.clear();
    },
  };
}
