/**
 * GLB (binary glTF 2.0) import validator (S11). Pure: bytes in, verdict out.
 *
 * VALIDATION ONLY. Storing and rendering imported models is NOT enabled: it
 * needs an R2 binding and the D3 Three.js adoption gate. The UI must show
 * GLB_IMPORT_NOTICE and never claim that imports work.
 *
 * Checks (every failure is reported, nothing is repaired):
 *  - size ≤ 2 MB (checked before parsing anything);
 *  - header: magic 'glTF', version 2, declared length = byte length;
 *  - chunks: 8-byte headers, 4-byte aligned lengths inside the file, a JSON
 *    chunk first, at most one BIN chunk after it, no other chunks;
 *  - JSON: strict UTF-8, an object, asset.version "2.0";
 *  - buffers embedded only: no `uri` anywhere (external or data:). Images
 *    must be embedded through a bufferView with an allowlisted MIME type
 *    whose bytes really are that format;
 *  - bufferViews inside their buffers and accessors' elements inside their
 *    bufferViews (so element and triangle counts cannot be inflated);
 *  - extensions only from GLB_EXTENSION_ALLOWLIST (extensionsUsed,
 *    extensionsRequired and every `extensions` object);
 *  - no animations, no skins, nothing script-like;
 *  - ≤ 50,000 triangles, counting every node that instances a mesh;
 *  - licence (allowlisted), attribution and an http(s) source URL that is
 *    not Google Maps / Earth / Street View.
 */
import { hasControlChars, isHttpUrl, isProhibitedSourceUrl, PROHIBITED_SOURCE_MESSAGE } from './text.ts';

export const GLB_LIMITS = { maxBytes: 2 * 1024 * 1024, maxTriangles: 50_000, maxJsonDepth: 64 } as const;
export const GLB_EXTENSION_ALLOWLIST: readonly string[] = [
  'KHR_materials_unlit',
  'KHR_texture_transform',
  'KHR_mesh_quantization',
  'KHR_materials_emissive_strength',
];
export const GLB_IMAGE_MIME_ALLOWLIST: readonly string[] = ['image/png', 'image/jpeg'];
/** Licences an imported model may carry ('own-work' = made by the site owner). */
export const GLB_LICENCES: readonly string[] = [
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'ODbL-1.0',
  'MIT',
  'own-work',
];

export const GLB_IMPORT_NOTICE =
  'Model import is validation only: storing and showing imported models is not enabled yet (it needs file storage and a 3D renderer that is not part of this app).';

export type GlbIssueCode =
  | 'too-large'
  | 'truncated'
  | 'bad-magic'
  | 'bad-version'
  | 'bad-length'
  | 'bad-chunk'
  | 'missing-json'
  | 'invalid-json'
  | 'bad-asset'
  | 'external-uri'
  | 'data-uri'
  | 'buffer-mismatch'
  | 'bad-image'
  | 'bad-accessor'
  | 'extension-not-allowed'
  | 'animations'
  | 'skins'
  | 'scripts'
  | 'too-many-triangles'
  | 'licence-required'
  | 'attribution-required'
  | 'source-required'
  | 'prohibited-source';

export interface GlbIssue {
  code: GlbIssueCode;
  message: string;
  /** JSON pointer-like location, e.g. 'buffers/1/uri', or null. */
  path: string | null;
}

export interface GlbMetadata {
  licence: string;
  attribution: string;
  sourceUrl: string;
}

export interface GlbValidation {
  ok: boolean;
  issues: GlbIssue[];
  stats: {
    bytes: number;
    triangles: number | null;
    meshes: number;
    images: number;
    extensionsUsed: string[];
  };
  /** Always false: imports are validated, never stored or rendered (S11). */
  storageEnabled: false;
  notice: string;
}

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const isObj = (v: unknown): v is Record<string, Json> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v: Json | undefined): Json[] => (Array.isArray(v) ? v : []);
const int = (v: Json | undefined): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;

/** Bytes per component (glTF componentType) and components per element (glTF type). */
const COMPONENT_BYTES: Readonly<Record<string, number>> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};
const TYPE_COMPONENTS: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

export function validateGlb(input: Uint8Array | ArrayBuffer, meta: GlbMetadata | null): GlbValidation {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const issues: GlbIssue[] = [];
  const add = (code: GlbIssueCode, message: string, path: string | null = null) =>
    issues.push({ code, message, path });
  const stats: GlbValidation['stats'] = {
    bytes: bytes.byteLength,
    triangles: null,
    meshes: 0,
    images: 0,
    extensionsUsed: [],
  };
  const done = (): GlbValidation => {
    checkMetadata(meta, add);
    return { ok: issues.length === 0, issues, stats, storageEnabled: false, notice: GLB_IMPORT_NOTICE };
  };

  if (bytes.byteLength > GLB_LIMITS.maxBytes) {
    add(
      'too-large',
      `The file is ${bytes.byteLength} bytes; at most ${GLB_LIMITS.maxBytes} bytes (2 MB) are allowed.`,
    );
    return done();
  }
  if (bytes.byteLength < 12) {
    add('truncated', 'The file is shorter than a GLB header (12 bytes).');
    return done();
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) {
    add('bad-magic', "Not a GLB file: the first four bytes are not 'glTF'.");
    return done();
  }
  const version = view.getUint32(4, true);
  if (version !== 2) {
    add('bad-version', `GLB version ${version} is not supported; only version 2 is.`);
    return done();
  }
  if (view.getUint32(8, true) !== bytes.byteLength) {
    add(
      'bad-length',
      `The header declares ${view.getUint32(8, true)} bytes but the file has ${bytes.byteLength}.`,
    );
    return done();
  }

  // --- chunks
  let json: Uint8Array | null = null;
  let bin: Uint8Array | null = null;
  let offset = 12;
  let index = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      add('truncated', `Chunk ${index} has an incomplete header.`, `chunks/${index}`);
      return done();
    }
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (offset + 8 + length > bytes.byteLength) {
      add('truncated', `Chunk ${index} declares ${length} bytes but the file ends first.`, `chunks/${index}`);
      return done();
    }
    if (length % 4 !== 0)
      add('bad-chunk', `Chunk ${index} length ${length} is not a multiple of 4.`, `chunks/${index}`);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (index === 0 && type !== CHUNK_JSON)
      add('missing-json', 'The first chunk must be the JSON chunk.', 'chunks/0');
    else if (index === 0) json = data;
    else if (index === 1 && type === CHUNK_BIN) bin = data;
    else
      add(
        'bad-chunk',
        `Unexpected chunk ${index} (type 0x${type.toString(16)}); only JSON and one BIN chunk are allowed.`,
        `chunks/${index}`,
      );
    offset += 8 + length;
    index++;
  }
  if (!json) {
    if (!issues.some((i) => i.code === 'missing-json')) add('missing-json', 'The file has no JSON chunk.');
    return done();
  }

  // --- JSON
  let doc: Json;
  try {
    doc = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(json).replace(/[ \t\r\n]+$/, ''),
    ) as Json;
  } catch {
    add('invalid-json', 'The JSON chunk is not valid UTF-8 JSON.');
    return done();
  }
  if (!isObj(doc)) {
    add('invalid-json', 'The JSON chunk is not a glTF object.');
    return done();
  }
  if (!isObj(doc.asset) || doc.asset.version !== '2.0')
    add('bad-asset', 'asset.version must be "2.0".', 'asset/version');

  // --- recursive scan: URIs, extensions, scripts, depth
  const exts = new Set<string>();
  let tooDeep = false;
  const scan = (v: Json, path: string, depth: number) => {
    if (depth > GLB_LIMITS.maxJsonDepth) {
      tooDeep = true;
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${path}/${i}`, depth + 1));
    else if (isObj(v))
      for (const [k, x] of Object.entries(v)) {
        const p = path ? `${path}/${k}` : k;
        if (k === 'uri' && typeof x === 'string')
          add(x.trim().toLowerCase().startsWith('data:') ? 'data-uri' : 'external-uri', uriMessage(x), p);
        if (/^scripts?$/i.test(k)) add('scripts', 'Scripts are not allowed in imported models.', p);
        if (k === 'extensions' && isObj(x)) for (const name of Object.keys(x)) exts.add(name);
        scan(x, p, depth + 1);
      }
  };
  scan(doc, '', 0);
  if (tooDeep) add('invalid-json', `The JSON is nested deeper than ${GLB_LIMITS.maxJsonDepth} levels.`);
  for (const key of ['extensionsUsed', 'extensionsRequired'])
    for (const e of arr(doc[key])) if (typeof e === 'string') exts.add(e);
  stats.extensionsUsed = [...exts].sort();
  for (const e of stats.extensionsUsed)
    if (!GLB_EXTENSION_ALLOWLIST.includes(e))
      add('extension-not-allowed', `Extension ${e} is not allowed.`, 'extensionsUsed');
  if (arr(doc.animations).length > 0) add('animations', 'Animations are not allowed.', 'animations');
  if (arr(doc.skins).length > 0) add('skins', 'Skins (rigged meshes) are not allowed.', 'skins');

  // --- buffers and views
  const buffers = arr(doc.buffers);
  const bufferLengths: (number | null)[] = buffers.map((b, i) => {
    if (!isObj(b) || int(b.byteLength) === null) {
      add('buffer-mismatch', `Buffer ${i} has no valid byteLength.`, `buffers/${i}`);
      return null;
    }
    if (b.uri !== undefined) return null; // already reported as a URI
    if (i !== 0) {
      add(
        'buffer-mismatch',
        `Buffer ${i} has no data: only buffer 0 can use the embedded BIN chunk.`,
        `buffers/${i}`,
      );
      return null;
    }
    const len = int(b.byteLength)!;
    if (!bin || len > bin.byteLength || bin.byteLength - len > 3)
      add(
        'buffer-mismatch',
        `Buffer 0 declares ${len} bytes but the BIN chunk has ${bin?.byteLength ?? 0}.`,
        'buffers/0',
      );
    return len;
  });
  if (bin && buffers.length === 0)
    add('buffer-mismatch', 'The BIN chunk is not referenced by any buffer.', 'buffers');
  const views = arr(doc.bufferViews);
  const viewOk = views.map((v, i) => {
    if (!isObj(v)) return false;
    const buf = int(v.buffer);
    const len = int(v.byteLength);
    const off = int(v.byteOffset ?? 0);
    const bufLen = buf === null ? null : (bufferLengths[buf] ?? null);
    if (buf === null || len === null || off === null || bufLen === null || off + len > bufLen) {
      add('bad-accessor', `bufferView ${i} lies outside its buffer.`, `bufferViews/${i}`);
      return false;
    }
    return true;
  });
  const accessors = arr(doc.accessors);
  const accessorCount = accessors.map((a, i) => {
    if (!isObj(a) || int(a.count) === null) {
      add('bad-accessor', `Accessor ${i} has no valid count.`, `accessors/${i}`);
      return null;
    }
    const count = int(a.count)!;
    if (a.bufferView !== undefined) {
      const bv = int(a.bufferView);
      if (bv === null || !viewOk[bv]) {
        add('bad-accessor', `Accessor ${i} refers to a missing or invalid bufferView.`, `accessors/${i}`);
        return null;
      }
      // The elements must fit in the view, so counts (and triangle totals) cannot be inflated.
      const comp = COMPONENT_BYTES[String(a.componentType)];
      const n = typeof a.type === 'string' ? TYPE_COMPONENTS[a.type] : undefined;
      const view = views[bv] as Record<string, Json>;
      const elem = comp !== undefined && n !== undefined ? comp * n : null;
      const stride = int(view.byteStride) ?? elem;
      const off = int(a.byteOffset ?? 0);
      if (elem === null || stride === null || off === null) {
        add('bad-accessor', `Accessor ${i} has an unknown componentType or type.`, `accessors/${i}`);
        return null;
      }
      if (count > 0 && off + stride * (count - 1) + elem > int(view.byteLength)!) {
        add(
          'bad-accessor',
          `Accessor ${i} (${count} elements) does not fit in bufferView ${bv}.`,
          `accessors/${i}`,
        );
        return null;
      }
    }
    return count;
  });

  // --- images
  const images = arr(doc.images);
  stats.images = images.length;
  images.forEach((img, i) => {
    if (!isObj(img) || img.uri !== undefined) return; // URIs already reported
    const bv = int(img.bufferView);
    const mime = typeof img.mimeType === 'string' ? img.mimeType : '';
    if (bv === null || !viewOk[bv])
      return add('bad-image', `Image ${i} is not embedded in a valid bufferView.`, `images/${i}`);
    if (!GLB_IMAGE_MIME_ALLOWLIST.includes(mime))
      return add('bad-image', `Image ${i} has type '${mime}'; only PNG and JPEG are allowed.`, `images/${i}`);
    const v = views[bv] as Record<string, Json>;
    const start = int(v.byteOffset ?? 0)!;
    const head = bin ? bin.subarray(start, start + 8) : new Uint8Array();
    const sig = mime === 'image/png' ? PNG : JPEG;
    if (!sig.every((b, k) => head[k] === b))
      add('bad-image', `Image ${i} is declared ${mime} but its bytes are not.`, `images/${i}`);
  });

  // --- triangles
  const meshes = arr(doc.meshes);
  stats.meshes = meshes.length;
  const refs = new Array<number>(meshes.length).fill(0);
  for (const n of arr(doc.nodes))
    if (isObj(n) && int(n.mesh) !== null && int(n.mesh)! < meshes.length) refs[int(n.mesh)!]!++;
  let triangles = 0;
  let countable = true;
  meshes.forEach((m, mi) => {
    let t = 0;
    arr(isObj(m) ? m.primitives : undefined).forEach((p, pi) => {
      if (!isObj(p)) return;
      const mode = p.mode === undefined ? 4 : int(p.mode);
      const src =
        p.indices !== undefined ? int(p.indices) : isObj(p.attributes) ? int(p.attributes.POSITION) : null;
      const count = src === null ? null : (accessorCount[src] ?? null);
      if (count === null || mode === null) {
        countable = false;
        add(
          'bad-accessor',
          `Mesh ${mi} primitive ${pi} has no countable vertices.`,
          `meshes/${mi}/primitives/${pi}`,
        );
        return;
      }
      t += mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
    });
    triangles += t * Math.max(1, refs[mi]!);
  });
  stats.triangles = countable ? triangles : null;
  if (triangles > GLB_LIMITS.maxTriangles)
    add(
      'too-many-triangles',
      `The model has ${triangles} triangles; at most ${GLB_LIMITS.maxTriangles} are allowed.`,
      'meshes',
    );
  return done();
}

function uriMessage(uri: string): string {
  return uri.trim().toLowerCase().startsWith('data:')
    ? 'data: URIs are not allowed: everything must be embedded in the GLB binary chunk.'
    : 'External files are not allowed: everything must be embedded in the GLB binary chunk.';
}

function checkMetadata(
  meta: GlbMetadata | null,
  add: (code: GlbIssueCode, message: string, path?: string | null) => void,
) {
  const licence = meta?.licence.trim() ?? '';
  const attribution = meta?.attribution.trim() ?? '';
  const source = meta?.sourceUrl.trim() ?? '';
  if (!GLB_LICENCES.includes(licence))
    add('licence-required', `Choose a licence: ${GLB_LICENCES.join(', ')}.`, 'meta/licence');
  if (attribution.length < 2 || attribution.length > 300 || hasControlChars(attribution))
    add(
      'attribution-required',
      'Give the attribution (2–300 characters) the licence requires.',
      'meta/attribution',
    );
  if (!isHttpUrl(source))
    add('source-required', 'Give the http(s) URL the model comes from.', 'meta/sourceUrl');
  else if (isProhibitedSourceUrl(source))
    add('prohibited-source', PROHIBITED_SOURCE_MESSAGE, 'meta/sourceUrl');
}
