/**
 * GLB validator (S11) on crafted binary fixtures. Validation only: storage
 * and rendering are never enabled.
 */
import { describe, expect, it } from 'vitest';
import {
  GLB_IMPORT_NOTICE,
  GLB_LIMITS,
  validateGlb,
  type GlbIssueCode,
  type GlbMetadata,
} from '../../../src/building-studio/glb-validator.ts';
import { PROHIBITED_SOURCE_MESSAGE } from '../../../src/building-studio/text.ts';

const META: GlbMetadata = {
  licence: 'CC-BY-4.0',
  attribution: 'Example Author',
  sourceUrl: 'https://example.org/models/kiosk',
};

const pad4 = (b: Uint8Array, fill: number) => {
  const out = new Uint8Array(Math.ceil(b.length / 4) * 4).fill(fill);
  out.set(b);
  return out;
};

interface GlbOptions {
  magic?: number;
  version?: number;
  lengthDelta?: number;
  extraChunk?: boolean;
  /** Overrides the BIN chunk's declared length. */
  binDeclared?: number;
  jsonType?: number;
}

/** Builds a GLB: 12-byte header, JSON chunk (space padded), optional BIN chunk (zero padded). */
function glb(json: unknown, bin?: Uint8Array, o: GlbOptions = {}): Uint8Array {
  const j = pad4(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const b = bin ? pad4(bin, 0) : null;
  const chunks: [number, Uint8Array, number?][] = [[o.jsonType ?? 0x4e4f534a, j]];
  if (b) chunks.push([0x004e4942, b, o.binDeclared]);
  if (o.extraChunk) chunks.push([0x12345678, new Uint8Array(4)]);
  const total = 12 + chunks.reduce((n, [, d]) => n + 8 + d.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, o.magic ?? 0x46546c67, true);
  v.setUint32(4, o.version ?? 2, true);
  v.setUint32(8, total + (o.lengthDelta ?? 0), true);
  let off = 12;
  for (const [type, data, declared] of chunks) {
    v.setUint32(off, declared ?? data.length, true);
    v.setUint32(off + 4, type, true);
    out.set(data, off + 8);
    off += 8 + data.length;
  }
  return out;
}

/** One triangle: 3 float VEC3 positions (36 bytes). */
const TRI_BIN = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
function triangleDoc(extra: Record<string, unknown> = {}) {
  return {
    asset: { version: '2.0', generator: 'test' },
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    ...extra,
  };
}

const codes = (bytes: Uint8Array | ArrayBuffer, meta: GlbMetadata | null = META) =>
  validateGlb(bytes, meta).issues.map((i) => i.code);
const expectOnly = (bytes: Uint8Array, ...expected: GlbIssueCode[]) =>
  expect([...new Set(codes(bytes))].sort()).toEqual([...expected].sort());

describe('valid minimal GLB', () => {
  it('passes, counts one triangle and still says imports are not enabled', () => {
    const r = validateGlb(glb(triangleDoc(), TRI_BIN), META);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.stats).toMatchObject({ triangles: 1, meshes: 1, images: 0, extensionsUsed: [] });
    expect(r.storageEnabled).toBe(false);
    expect(r.notice).toBe(GLB_IMPORT_NOTICE);
    // ArrayBuffer input works too.
    const bytes = glb(triangleDoc(), TRI_BIN);
    expect(validateGlb(bytes.buffer.slice(0) as ArrayBuffer, META).ok).toBe(true);
  });

  it('accepts an embedded PNG and an allowlisted extension', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const bin = new Uint8Array(48);
    bin.set(TRI_BIN, 0);
    bin.set(png, 36);
    const doc = triangleDoc({
      buffers: [{ byteLength: 48 }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 12 },
      ],
      images: [{ bufferView: 1, mimeType: 'image/png' }],
      extensionsUsed: ['KHR_materials_unlit'],
      materials: [{ extensions: { KHR_materials_unlit: {} } }],
    });
    const r = validateGlb(glb(doc, bin), META);
    expect(r.issues).toEqual([]);
    expect(r.stats.images).toBe(1);
  });
});

describe('container errors', () => {
  it('rejects a wrong magic, version and declared length', () => {
    expectOnly(glb(triangleDoc(), TRI_BIN, { magic: 0x12345678 }), 'bad-magic');
    expectOnly(glb(triangleDoc(), TRI_BIN, { version: 1 }), 'bad-version');
    expectOnly(glb(triangleDoc(), TRI_BIN, { lengthDelta: 4 }), 'bad-length');
  });

  it('rejects truncated files and chunks', () => {
    expectOnly(new Uint8Array([0x67, 0x6c, 0x54, 0x46]), 'truncated');
    const bytes = glb(triangleDoc(), TRI_BIN, { binDeclared: 4000 });
    expectOnly(bytes, 'truncated');
    const cut = glb(triangleDoc(), TRI_BIN);
    const short = cut.slice(0, cut.length - 6);
    new DataView(short.buffer).setUint32(8, short.length, true);
    expect(codes(short)).toContain('truncated');
  });

  it('rejects unknown chunks and a missing JSON chunk', () => {
    expectOnly(glb(triangleDoc(), TRI_BIN, { extraChunk: true }), 'bad-chunk');
    expect(codes(glb(triangleDoc(), TRI_BIN, { jsonType: 0x004e4942 }))).toContain('missing-json');
  });

  it('rejects invalid JSON and a non-2.0 asset', () => {
    const bytes = glb(triangleDoc(), TRI_BIN); // JSON chunk data starts at byte 20
    bytes.set(new TextEncoder().encode('{"a":'), 20);
    expect(codes(bytes)).toContain('invalid-json');
    expect(codes(glb(triangleDoc({ asset: { version: '1.0' } }), TRI_BIN))).toContain('bad-asset');
  });

  it('rejects files over 2 MB before parsing anything', () => {
    const big = new Uint8Array(GLB_LIMITS.maxBytes + 1);
    expect(validateGlb(big, META).issues.map((i) => i.code)).toEqual(['too-large']);
  });
});

describe('content rules', () => {
  it('rejects an external buffer URI and a data: URI buffer', () => {
    const external = triangleDoc({ buffers: [{ byteLength: 36, uri: 'https://example.org/model.bin' }] });
    expect(codes(glb(external))).toContain('external-uri');
    const dataUri = triangleDoc({
      buffers: [{ byteLength: 36, uri: 'data:application/octet-stream;base64,AAAA' }],
    });
    expect(codes(glb(dataUri))).toContain('data-uri');
    expect(validateGlb(glb(external), META).issues.find((i) => i.code === 'external-uri')!.path).toBe(
      'buffers/0/uri',
    );
  });

  it('rejects image URIs, disallowed image types and mislabelled image bytes', () => {
    const withImage = (img: Record<string, unknown>, bytes: number[]) => {
      const bin = new Uint8Array(48);
      bin.set(TRI_BIN, 0);
      bin.set(bytes, 36);
      return glb(
        triangleDoc({
          buffers: [{ byteLength: 48 }],
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: 36 },
            { buffer: 0, byteOffset: 36, byteLength: 12 },
          ],
          images: [img],
        }),
        bin,
      );
    };
    expect(codes(withImage({ uri: 'texture.png' }, []))).toContain('external-uri');
    expect(codes(withImage({ uri: 'data:image/png;base64,iVBORw0KGgo=' }, []))).toContain('data-uri');
    expect(codes(withImage({ bufferView: 1, mimeType: 'image/gif' }, [0x47, 0x49, 0x46]))).toContain(
      'bad-image',
    );
    expect(codes(withImage({ bufferView: 1, mimeType: 'image/png' }, [0xff, 0xd8, 0xff]))).toContain(
      'bad-image',
    );
    expect(codes(withImage({ bufferView: 1, mimeType: 'image/jpeg' }, [0xff, 0xd8, 0xff]))).toEqual([]);
  });

  it('rejects disallowed extensions wherever they appear', () => {
    expect(codes(glb(triangleDoc({ extensionsUsed: ['KHR_draco_mesh_compression'] }), TRI_BIN))).toContain(
      'extension-not-allowed',
    );
    expect(codes(glb(triangleDoc({ extensionsRequired: ['EXT_meshopt_compression'] }), TRI_BIN))).toContain(
      'extension-not-allowed',
    );
    const hidden = triangleDoc({ nodes: [{ mesh: 0, extensions: { KHR_interactivity: {} } }] });
    expect(codes(glb(hidden, TRI_BIN))).toContain('extension-not-allowed');
  });

  it('rejects animations, skins and scripts', () => {
    expect(codes(glb(triangleDoc({ animations: [{ channels: [], samplers: [] }] }), TRI_BIN))).toContain(
      'animations',
    );
    expect(codes(glb(triangleDoc({ skins: [{ joints: [0] }] }), TRI_BIN))).toContain('skins');
    expect(codes(glb(triangleDoc({ extras: { script: 'alert(1)' } }), TRI_BIN))).toContain('scripts');
  });

  it('rejects more than 50,000 triangles, counting instanced meshes', () => {
    const nodes = Array.from({ length: 50_001 }, () => ({ mesh: 0 }));
    const r = validateGlb(glb(triangleDoc({ nodes, scenes: [{ nodes: [0] }] }), TRI_BIN), META);
    expect(r.issues.map((i) => i.code)).toEqual(['too-many-triangles']);
    expect(r.stats.triangles).toBe(50_001);
    expect(validateGlb(glb(triangleDoc({ nodes: nodes.slice(1) }), TRI_BIN), META).ok).toBe(true);
  });

  it('rejects accessors and views that do not fit (counts cannot be inflated)', () => {
    const inflated = triangleDoc({
      accessors: [{ bufferView: 0, componentType: 5126, count: 300_000, type: 'VEC3' }],
    });
    expect(codes(glb(inflated, TRI_BIN))).toContain('bad-accessor');
    const outside = triangleDoc({ bufferViews: [{ buffer: 0, byteOffset: 8, byteLength: 36 }] });
    expect(codes(glb(outside, TRI_BIN))).toContain('bad-accessor');
    expect(codes(glb(triangleDoc(), new Uint8Array(12)))).toContain('buffer-mismatch');
  });
});

describe('licence, attribution and source', () => {
  it('are required; Google Maps / Earth / Street View are never a source', () => {
    const ok = glb(triangleDoc(), TRI_BIN);
    expect(codes(ok, null).sort()).toEqual(['attribution-required', 'licence-required', 'source-required']);
    expect(codes(ok, { ...META, licence: 'All rights reserved' })).toEqual(['licence-required']);
    expect(codes(ok, { ...META, attribution: ' ' })).toEqual(['attribution-required']);
    expect(codes(ok, { ...META, sourceUrl: 'ftp://example.org/x' })).toEqual(['source-required']);
    const google = validateGlb(ok, { ...META, sourceUrl: 'https://earth.google.com/web/@31.25,75.70' });
    expect(google.issues).toEqual([
      { code: 'prohibited-source', message: PROHIBITED_SOURCE_MESSAGE, path: 'meta/sourceUrl' },
    ]);
    expect(codes(ok, { ...META, licence: 'own-work' })).toEqual([]);
  });
});
