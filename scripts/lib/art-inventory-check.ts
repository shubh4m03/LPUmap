/**
 * Integrity checks for the owner-supplied isometric artwork inventory
 * (data/curated/isometric-art/inventory.json) and the derived contact sheets
 * (docs/isometric-art/contact-sheets/manifest.json).
 *
 * Pure functions: callers pass the parsed JSON and the file bytes, and get back
 * a list of human-readable problems (empty = OK). Used by the unit test and by
 * `node scripts/isometric-art-contact-sheets.ts --check`. No Chromium needed.
 */
import { createHash } from 'node:crypto';

export const ART_SOURCE_DIR = 'lpu-isometric-map-design';
export const ART_INVENTORY_PATH = 'data/curated/isometric-art/inventory.json';
export const CONTACT_SHEET_DIR = 'docs/isometric-art/contact-sheets';
export const CONTACT_SHEET_MANIFEST = `${CONTACT_SHEET_DIR}/manifest.json`;

/** Labels whose printed spelling must survive verbatim (never silently corrected). */
export const VERBATIM_LABELS: readonly string[] = [
  'SCHOOL OF PHYSIOTHERAPHY AND PARAMEDICAL SCIENCE',
  'SCHOOL OF PHARAMACEUTICAL SCIENCE',
  'SCHOOL OF ARCHITECRURE & PLANING DIVISION OF CONSTRUCTIONS DIVISION OF ARCHITECTURE & DESIGN',
  'GIRLS HOSTAL 1, 2, 3, 4',
  'GIRLS HOSTAL 5, 6.',
  'UNI-CENTER, SCHOOL OF HOTAL MANGMENT AND TOURISM',
  'SCHOOL OF MECHANICAL INGNEERING',
  'SCHOOL OF CIVIL INGNEERING',
  'I) DIVISSION OF ADMISSIONS II)MUSEUM OF ACADEMICS',
  'THE CHANCELLORY  I) ADMINISTRATION-I',
  'COMPTER SCIENCE',
  'POLYTECHINQUE',
  'UNIVERSITY ENTRENCE',
  'PEDISTRIAN',
  'DILDO PARK',
];

const CONFIDENCE = new Set(['high', 'medium', 'low']);
const ROLES = new Set(['master-overview', 'block-vignette', 'scene-vignette']);

export interface ArtLabel {
  id: string;
  kind: string;
  text: string;
  lines: string[];
  confidence: string;
}
export interface ArtPin {
  label: string;
  x: number;
  y: number;
  nx: number;
  ny: number;
  confidence: string;
}
export interface ArtBox {
  x: number;
  y: number;
  w: number;
  h: number;
  nx: number;
  ny: number;
  nw: number;
  nh: number;
}
export interface ArtAsset {
  id: string;
  file: string;
  path: string;
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  role: string;
  canonical: boolean;
  duplicates: string[];
  labels: ArtLabel[];
  pins: ArtPin[];
  coordinateSpace: { width: number; height: number };
  layout?: { card?: ArtBox; sceneFrame?: ArtBox };
  captionMapping?: { heading: string | null; numbers: string[]; caption: string | null }[];
}
export interface ArtInventory {
  schemaVersion: number;
  kind: string;
  sourceDir: string;
  assets: ArtAsset[];
  artworkNumbers: { artworkNumber: string; isOfficialBlockNumber: boolean }[];
  needsManualVerification: { ref: string }[];
}
export interface ContactSheetManifest {
  derived: true;
  sheets: {
    file: string;
    sha256: string;
    bytes: number;
    sources: { id: string; file: string; sha256: string }[];
  }[];
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Pixel size from a PNG IHDR or a baseline/progressive JPEG SOF marker. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2;
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = bytes[o + 1] ?? 0;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: view.getUint16(o + 5), width: view.getUint16(o + 7) };
      o += 2 + view.getUint16(o + 2);
    }
  }
  return null;
}

function walkKeys(value: unknown, visit: (key: string) => void): void {
  if (Array.isArray(value)) {
    for (const v of value) walkKeys(v, visit);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      visit(k);
      walkKeys(v, visit);
    }
  }
}

function checkBox(problems: string[], where: string, box: ArtBox, width: number, height: number): void {
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-4;
  if (!near(box.nx, box.x / width) || !near(box.ny, box.y / height))
    problems.push(`${where}: nx/ny not x/width, y/height`);
  if (!near(box.nw, box.w / width) || !near(box.nh, box.h / height))
    problems.push(`${where}: nw/nh not w/width, h/height`);
  if (box.x < 0 || box.y < 0 || box.x + box.w > width || box.y + box.h > height)
    problems.push(`${where}: outside the image`);
}

/**
 * @param originals map of original file name (inside ART_SOURCE_DIR) to its bytes.
 */
export function validateArtInventory(
  inventory: ArtInventory,
  originals: ReadonlyMap<string, Uint8Array>,
): string[] {
  const problems: string[] = [];
  if (inventory.kind !== 'lpu-isometric-art-inventory') problems.push('inventory.kind is wrong');
  if (inventory.sourceDir !== ART_SOURCE_DIR) problems.push('inventory.sourceDir is wrong');

  const listed = new Set(inventory.assets.map((a) => a.file));
  for (const f of originals.keys())
    if (!listed.has(f)) problems.push(`original ${f} is missing from the inventory`);
  for (const f of listed)
    if (!originals.has(f)) problems.push(`inventory lists ${f}, which is not in ${ART_SOURCE_DIR}/`);

  const ids = new Set<string>();
  const labelIds = new Set<string>();
  const byHash = new Map<string, string[]>();
  const allText: string[] = [];
  const uncertain: string[] = [];

  for (const a of inventory.assets) {
    if (ids.has(a.id)) problems.push(`duplicate asset id ${a.id}`);
    ids.add(a.id);
    if (!ROLES.has(a.role)) problems.push(`${a.id}: unknown role ${a.role}`);
    if (a.path !== `${ART_SOURCE_DIR}/${a.file}`) problems.push(`${a.id}: path does not match file`);
    const bytes = originals.get(a.file);
    if (bytes) {
      const hash = sha256Hex(bytes);
      if (hash !== a.sha256) problems.push(`${a.id}: sha256 mismatch (original changed or inventory stale)`);
      if (bytes.length !== a.bytes) problems.push(`${a.id}: byte size mismatch`);
      const size = imageSize(bytes);
      if (!size || size.width !== a.width || size.height !== a.height)
        problems.push(`${a.id}: dimensions mismatch`);
      byHash.set(hash, [...(byHash.get(hash) ?? []), a.id]);
    }
    if (a.coordinateSpace.width !== a.width || a.coordinateSpace.height !== a.height) {
      problems.push(`${a.id}: coordinateSpace does not match the image size`);
    }
    for (const p of a.pins) {
      const where = `${a.id} pin ${p.label}`;
      if (Math.abs(p.nx - p.x / a.width) > 1e-4 || Math.abs(p.ny - p.y / a.height) > 1e-4) {
        problems.push(`${where}: normalized coordinates do not match pixels`);
      }
      if (p.nx < 0 || p.nx > 1 || p.ny < 0 || p.ny > 1)
        problems.push(`${where}: normalized coordinates outside [0, 1]`);
      if (!CONFIDENCE.has(p.confidence)) problems.push(`${where}: bad confidence`);
      if (p.confidence !== 'high') uncertain.push(`${a.id}/pin:${p.label}`);
    }
    if (a.layout?.card) checkBox(problems, `${a.id} card`, a.layout.card, a.width, a.height);
    if (a.layout?.sceneFrame)
      checkBox(problems, `${a.id} sceneFrame`, a.layout.sceneFrame, a.width, a.height);
    for (const l of a.labels) {
      if (labelIds.has(l.id)) problems.push(`duplicate label id ${l.id}`);
      labelIds.add(l.id);
      if (!l.id.startsWith(`${a.id}/`)) problems.push(`${l.id}: label id not under its asset`);
      if (!l.text.trim()) problems.push(`${l.id}: empty label text`);
      if (l.text !== l.lines.join(' '))
        problems.push(`${l.id}: text is not the printed lines joined by one space`);
      if (!CONFIDENCE.has(l.confidence)) problems.push(`${l.id}: bad confidence`);
      if (l.confidence !== 'high') uncertain.push(l.id);
      allText.push(l.text);
    }
    for (const m of a.captionMapping ?? []) if (m.caption) allText.push(m.caption);
  }

  for (const [hash, group] of byHash) {
    for (const id of group) {
      const a = inventory.assets.find((x) => x.id === id);
      const expected = group.filter((x) => x !== id).sort();
      if (a && JSON.stringify([...a.duplicates].sort()) !== JSON.stringify(expected)) {
        problems.push(`${id}: duplicates list is wrong for sha256 ${hash.slice(0, 12)}`);
      }
    }
    if (group.filter((id) => inventory.assets.find((x) => x.id === id)?.canonical).length !== 1) {
      problems.push(`sha256 ${hash.slice(0, 12)}: exactly one asset must be canonical`);
    }
  }

  const flagged = new Set(inventory.needsManualVerification.map((n) => n.ref));
  for (const ref of uncertain)
    if (!flagged.has(ref)) problems.push(`${ref}: not high confidence but not in needsManualVerification`);

  for (const want of VERBATIM_LABELS) {
    if (!allText.some((t) => t === want || t.includes(want)))
      problems.push(`verbatim label missing or altered: "${want}"`);
  }
  for (const n of inventory.artworkNumbers) {
    if (n.isOfficialBlockNumber !== false)
      problems.push(`artwork number ${n.artworkNumber} is marked as an official block number`);
  }
  walkKeys(inventory, (key) => {
    if (key === 'officialBlockNumber' || key === 'officialName') {
      problems.push(
        `inventory must not carry "${key}"; official facts live in verified data, not in the artwork inventory`,
      );
    }
  });
  return problems;
}

export function validateContactSheets(
  manifest: ContactSheetManifest,
  inventory: ArtInventory,
  sheets: ReadonlyMap<string, Uint8Array>,
): string[] {
  const problems: string[] = [];
  if (manifest.derived !== true) problems.push('contact-sheet manifest must say derived: true');
  const byId = new Map(inventory.assets.map((a) => [a.id, a]));
  const covered = new Set<string>();
  for (const s of manifest.sheets) {
    const bytes = sheets.get(s.file);
    if (!bytes) {
      problems.push(`contact sheet ${s.file} is missing`);
    } else {
      if (sha256Hex(bytes) !== s.sha256)
        problems.push(`contact sheet ${s.file}: sha256 differs from manifest (edited by hand?)`);
      if (bytes.length !== s.bytes) problems.push(`contact sheet ${s.file}: byte size differs from manifest`);
    }
    for (const src of s.sources) {
      const a = byId.get(src.id);
      if (!a) problems.push(`contact sheet ${s.file}: unknown source ${src.id}`);
      else if (a.sha256 !== src.sha256 || a.file !== src.file) {
        problems.push(
          `contact sheet ${s.file}: source ${src.id} changed since the sheet was made; regenerate`,
        );
      }
      covered.add(src.id);
    }
  }
  for (const a of inventory.assets)
    if (!covered.has(a.id)) problems.push(`${a.id} is not on any contact sheet`);
  return problems;
}
