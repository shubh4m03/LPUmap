/**
 * Registry → published manifest for the owner-supplied isometric artwork
 * (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md). Pure functions; the file I/O is
 * in scripts/build-isometric-art.ts. Used by that script (build and --check)
 * and by tests/unit/isometric-art/*.
 *
 * Reuses the inventory/hotspot validators (art-inventory-check.ts,
 * art-hotspots-check.ts) for those files; this module checks only what the
 * registry adds: exact label quotes, one subject per hotspot, associations
 * against the reviewed candidates, and the derived-copy records.
 */
import {
  ISOMETRIC_ART_MANIFEST_VERSION,
  ILLUSTRATION_DISCLAIMER,
  areaSubjectId,
  isometricArtManifestSchema,
  isometricArtRegistrySchema,
  numberSubjectId,
  sceneSubjectId,
  type DerivedSpec,
  type IsometricArtManifest,
  type IsometricArtRegistry,
  type LabelQuote,
  type ManifestAsset,
  type ManifestDerived,
} from '../../src/isometric-art/schema.ts';
import type { ArtHotspots } from './art-hotspots-check.ts';
import type { ArtAsset, ArtInventory } from './art-inventory-check.ts';

export const ART_REGISTRY_PATH = 'data/curated/isometric-art/registry.json';
export const ART_PUBLIC_DIR = 'public/isometric-art';
export const ART_MANIFEST_PATH = `${ART_PUBLIC_DIR}/manifest.json`;
export const ART_MAPPING_DOC_PATH = 'docs/LPU_ISOMETRIC_ASSET_MAPPING.md';

/** Transcription placeholders: recorded in the inventory, never quoted or published as printed text. */
export const LABEL_PLACEHOLDERS: ReadonlySet<string> = new Set(['(blank)', '(illegible)']);

const KIND_OF_ROLE: Record<string, 'master' | 'vignette' | 'scene'> = {
  'master-overview': 'master',
  'block-vignette': 'vignette',
  'scene-vignette': 'scene',
};

/** One reviewed lead of docs/research/block-leads/block-candidates.json (the fields used here). */
export interface BlockCandidateLead {
  block: string;
  recommendation: string;
  candidates: { osmId: string; score: number; shapeMatch: string }[];
}

type InventoryAsset = ArtAsset & { mime?: string };

/** Subject that owns a hotspot: numbered pins → art:num-N, every other hotspot → art:area-<slug>. */
export function subjectIdForHotspot(h: {
  hotspotId: string;
  kind: string;
  artworkLabel: { text: string } | null;
}) {
  return h.kind === 'pin-structure' && h.artworkLabel
    ? numberSubjectId(h.artworkLabel.text)
    : areaSubjectId(h.hotspotId);
}

function walkKeys(value: unknown, visit: (key: string) => void): void {
  if (Array.isArray(value)) for (const v of value) walkKeys(v, visit);
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      visit(k);
      walkKeys(v, visit);
    }
}

/**
 * Validates the registry against the inventory, hotspots and reviewed
 * candidates. `buildingIds` (campus building ids of public/data/buildings.geojson)
 * is optional so the check can run without a generated dataset.
 */
export function validateArtRegistry(
  raw: unknown,
  inventory: ArtInventory,
  hotspots: ArtHotspots,
  candidates: readonly BlockCandidateLead[],
  buildingIds: ReadonlySet<string> | null,
): { registry: IsometricArtRegistry | null; problems: string[] } {
  const parsed = isometricArtRegistrySchema.safeParse(raw);
  if (!parsed.success)
    return {
      registry: null,
      problems: parsed.error.issues.map((i) => `registry ${i.path.join('.')}: ${i.message}`),
    };
  const reg = parsed.data;
  const problems: string[] = [];

  walkKeys(raw, (key) => {
    if (/^official/i.test(key))
      problems.push(`registry must not carry "${key}": artwork numbers and labels are never official facts`);
  });

  // ---- assets: exactly the inventory's files, same roles, duplicates unpublished
  const invById = new Map(inventory.assets.map((a) => [a.id, a as InventoryAsset]));
  const regIds = new Set<string>();
  for (const a of reg.assets) {
    if (regIds.has(a.assetId)) problems.push(`asset ${a.assetId}: listed twice`);
    regIds.add(a.assetId);
    const inv = invById.get(a.assetId);
    if (!inv) {
      problems.push(`asset ${a.assetId}: not in the inventory`);
      continue;
    }
    if (KIND_OF_ROLE[inv.role] !== a.kind)
      problems.push(`asset ${a.assetId}: kind ${a.kind} != inventory role ${inv.role}`);
    if (a.publishOriginal !== inv.canonical)
      problems.push(`asset ${a.assetId}: publishOriginal must equal inventory canonical (${inv.canonical})`);
    const dup = inv.canonical ? null : (inv.duplicates[0] ?? null);
    if (a.duplicateOf !== dup) problems.push(`asset ${a.assetId}: duplicateOf must be ${dup}`);
    if (a.visualFidelity !== 'original-artwork')
      problems.push(`asset ${a.assetId}: an original artwork file is always 'original-artwork'`);
    if (!a.publishOriginal && a.derive.length > 0)
      problems.push(`asset ${a.assetId}: a duplicate is never derived`);
    const purposes = a.derive.map((d) => d.purpose);
    if (new Set(purposes).size !== purposes.length)
      problems.push(`asset ${a.assetId}: one derive spec per purpose`);
  }
  for (const a of inventory.assets)
    if (!regIds.has(a.id)) problems.push(`inventory asset ${a.id} is missing from the registry`);

  // ---- label quotes resolve exactly
  const labels = new Map<string, string>();
  for (const a of inventory.assets) {
    for (const l of a.labels) labels.set(l.id, l.text);
    for (const p of a.pins) labels.set(`${a.id}/pin:${p.label}`, p.label);
  }
  const hotspotById = new Map(hotspots.hotspots.map((h) => [h.hotspotId, h]));
  const checkQuote = (where: string, q: LabelQuote | null) => {
    if (!q) return;
    let source: string | undefined;
    if (q.ref.startsWith('hotspot:'))
      source = hotspotById.get(q.ref.slice('hotspot:'.length))?.artworkLabel?.text;
    else source = labels.get(q.ref);
    if (source === undefined) return problems.push(`${where}: unknown label reference ${q.ref}`);
    if (LABEL_PLACEHOLDERS.has(source) || LABEL_PLACEHOLDERS.has(q.text))
      return problems.push(`${where}: ${q.ref} is a transcription placeholder, not printed text`);
    if (q.span ? !source.includes(q.text) : source !== q.text)
      problems.push(`${where}: "${q.text}" is not ${q.span ? 'an exact part of' : 'exactly'} label ${q.ref}`);
  };

  // ---- subjects
  const subjectIds = new Set<string>();
  const hotspotOwner = new Map<string, string>();
  const artworkNumbers = new Set(inventory.artworkNumbers.map((n) => n.artworkNumber));
  for (const s of reg.subjects) {
    const where = `subject ${s.subjectId}`;
    if (subjectIds.has(s.subjectId)) problems.push(`${where}: listed twice`);
    subjectIds.add(s.subjectId);
    checkQuote(`${where} displayLabel`, s.displayLabel);
    checkQuote(`${where} visibleBlockLabel`, s.visibleBlockLabel);
    checkQuote(`${where} artworkCategory`, s.artworkCategory);
    s.otherLabels.forEach((q, i) => checkQuote(`${where} otherLabels[${i}]`, q));
    if (s.artworkCategory && !/\/L\d+$/.test(s.artworkCategory.ref))
      problems.push(`${where}: category must quote an index section heading`);
    if (s.kind === 'numbered' && s.artworkNumber !== null && !artworkNumbers.has(s.artworkNumber))
      problems.push(`${where}: artwork number ${s.artworkNumber} is not in the inventory`);
    if (s.kind === 'scene') {
      const assetId = `iso-art-${s.subjectId.slice('art:scene-'.length)}`;
      const inv = invById.get(assetId);
      if (!inv || inv.role !== 'scene-vignette' || !inv.canonical || sceneSubjectId(assetId) !== s.subjectId)
        problems.push(`${where}: must name a canonical scene vignette`);
    }
    for (const h of s.hotspotIds) {
      const hs = hotspotById.get(h);
      if (!hs) problems.push(`${where}: unknown hotspot ${h}`);
      else if (subjectIdForHotspot(hs) !== s.subjectId)
        problems.push(`${where}: hotspot ${h} belongs to ${subjectIdForHotspot(hs)}`);
      if (hotspotOwner.has(h))
        problems.push(`hotspot ${h}: claimed by ${hotspotOwner.get(h)} and ${s.subjectId}`);
      hotspotOwner.set(h, s.subjectId);
    }
    for (const v of s.vignetteAssetIds) {
      const inv = invById.get(v);
      if (!inv || inv.role === 'master-overview' || !inv.canonical)
        problems.push(`${where}: ${v} is not a canonical vignette`);
    }
    for (const alias of s.aliases)
      if (s.displayHold) problems.push(`${where}: a held label has no search aliases (${alias})`);
  }
  for (const s of reg.subjects)
    for (const r of s.relations) {
      if (r.subjectId === s.subjectId) problems.push(`subject ${s.subjectId}: relation to itself`);
      else if (!subjectIds.has(r.subjectId))
        problems.push(`subject ${s.subjectId}: relation to unknown ${r.subjectId}`);
    }
  for (const h of hotspots.hotspots)
    if (!hotspotOwner.has(h.hotspotId)) problems.push(`hotspot ${h.hotspotId}: no subject owns it`);
  for (const n of artworkNumbers)
    if (!subjectIds.has(numberSubjectId(n))) problems.push(`artwork number ${n}: no subject`);

  // ---- associations: one per subject, candidates exactly as reviewed
  const leads = new Map(candidates.map((c) => [c.block, c]));
  const assocIds = new Set<string>();
  for (const a of reg.associations) {
    const where = `association ${a.subjectId}`;
    if (assocIds.has(a.subjectId)) problems.push(`${where}: listed twice`);
    assocIds.add(a.subjectId);
    if (!subjectIds.has(a.subjectId)) problems.push(`${where}: unknown subject`);
    const subject = reg.subjects.find((s) => s.subjectId === a.subjectId);
    const lead = subject?.artworkNumber ? leads.get(subject.artworkNumber) : undefined;
    const expected = (lead?.candidates ?? [])
      .map((c) => ({ buildingId: c.osmId, score: c.score, shapeMatch: c.shapeMatch }))
      .sort((x, y) => y.score - x.score);
    const got = a.candidateFootprints.map(({ buildingId, score, shapeMatch }) => ({
      buildingId,
      score,
      shapeMatch,
    }));
    if (JSON.stringify(got) !== JSON.stringify(expected))
      problems.push(`${where}: candidateFootprints differ from the reviewed candidates`);
    a.candidateFootprints.forEach((c, i) => {
      if (c.rank !== i + 1) problems.push(`${where}: candidate ranks must be 1..n in score order`);
    });
    if (a.status === 'approximate') {
      if (!a.candidateFootprints.some((c) => c.buildingId === a.buildingId))
        problems.push(`${where}: an approximate link must be one of the reviewed candidate footprints`);
      if (lead?.recommendation !== 'confirm-on-site')
        problems.push(`${where}: curated 'approximate' needs a reviewed lead recommended "confirm-on-site"`);
    }
    if (a.status === 'verified' && a.evidence.length === 0)
      problems.push(`${where}: verified without evidence`);
    if (buildingIds) {
      for (const id of [a.buildingId, ...a.candidateFootprints.map((c) => c.buildingId)])
        if (id !== null && !buildingIds.has(id))
          problems.push(`${where}: building ${id} is not a campus building`);
    }
  }
  for (const id of subjectIds) if (!assocIds.has(id)) problems.push(`subject ${id}: no association record`);

  return { registry: reg, problems };
}

/**
 * Expected derived outputs of a spec for a source of W×H (no files; names and
 * sizes only). Every output is a uniform scale of the whole source.
 */
export function expectedDerived(
  assetId: string,
  spec: DerivedSpec,
  W: number,
  H: number,
): Pick<ManifestDerived, 'purpose' | 'url' | 'width' | 'height' | 'mime' | 'tile'>[] {
  const ext = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' }[spec.format];
  const base = `derived/${assetId}`;
  if (spec.purpose === 'web-full')
    return [{ purpose: 'web-full', url: `${base}/web-full.${ext}`, width: W, height: H, mime: spec.format }];
  if (spec.purpose === 'preview') {
    const w = Math.min(spec.maxWidth, W);
    return [
      {
        purpose: 'preview',
        url: `${base}/preview-${w}.${ext}`,
        width: w,
        height: Math.round((H * w) / W),
        mime: spec.format,
      },
    ];
  }
  const out: ReturnType<typeof expectedDerived> = [];
  for (let level = 0; level < spec.levels; level++) {
    const lw = Math.ceil(W / 2 ** level);
    const lh = Math.ceil(H / 2 ** level);
    for (let row = 0; row * spec.tileSize < lh; row++)
      for (let col = 0; col * spec.tileSize < lw; col++) {
        const x = col * spec.tileSize;
        const y = row * spec.tileSize;
        const w = Math.min(spec.tileSize, lw - x);
        const h = Math.min(spec.tileSize, lh - y);
        out.push({
          purpose: 'tile',
          url: `${base}/tiles/${level}/${col}-${row}.${ext}`,
          width: w,
          height: h,
          mime: spec.format,
          tile: { level, col, row, nx: x / lw, ny: y / lh, nw: w / lw, nh: h / lh },
        });
      }
  }
  return out;
}

export interface BuildManifestInput {
  registry: IsometricArtRegistry;
  inventory: ArtInventory;
  hotspots: ArtHotspots;
  sha256: { registry: string; inventory: string; hotspots: string };
  /** Derived records already produced (by --derive), by assetId; carried over unchanged. */
  derived: ReadonlyMap<string, readonly ManifestDerived[]>;
}

const fileUrl = (file: string) => `original/${file}`;

/** The published manifest, deterministic for the same inputs. */
export function buildArtManifest(input: BuildManifestInput): IsometricArtManifest {
  const { registry, inventory, hotspots } = input;
  const invById = new Map(inventory.assets.map((a) => [a.id, a as InventoryAsset]));
  const master = invById.get(hotspots.source.assetId);
  if (!master) throw new Error('hotspots source asset is not in the inventory');
  const assets: ManifestAsset[] = registry.assets.map((r) => {
    const a = invById.get(r.assetId);
    if (!a) throw new Error(`registry asset ${r.assetId} is not in the inventory`);
    const card = a.layout?.card;
    return {
      assetId: r.assetId,
      kind: r.kind,
      source: {
        originalPath: a.path,
        sha256: a.sha256,
        bytes: a.bytes,
        width: a.width,
        height: a.height,
        mime: a.mime === 'image/jpeg' ? 'image/jpeg' : 'image/png',
      },
      original: r.publishOriginal ? { url: fileUrl(a.file), sha256: a.sha256, bytes: a.bytes } : null,
      duplicateOf: r.duplicateOf,
      derived: [...(input.derived.get(r.assetId) ?? [])],
      labels: a.labels
        .filter((l) => !LABEL_PLACEHOLDERS.has(l.text))
        .map((l) => ({
          labelId: l.id,
          kind: l.kind,
          text: l.text,
          lines: [...l.lines],
          confidence: l.confidence as 'high' | 'medium' | 'low',
        })),
      visualFidelity: r.visualFidelity,
      hotspotIds: r.assetId === hotspots.source.assetId ? hotspots.hotspots.map((h) => h.hotspotId) : [],
      contentFrame: card ? { nx: card.nx, ny: card.ny, nw: card.nw, nh: card.nh } : null,
      needsManualVerification: [...r.needsManualVerification],
    };
  });
  const manifest: IsometricArtManifest = {
    schemaVersion: ISOMETRIC_ART_MANIFEST_VERSION,
    kind: 'lpu-isometric-art-manifest',
    generatedFrom: {
      registrySha256: input.sha256.registry,
      inventorySha256: input.sha256.inventory,
      hotspotsSha256: input.sha256.hotspots,
    },
    disclaimer: ILLUSTRATION_DISCLAIMER,
    coordinateSpace: {
      assetId: master.id,
      width: hotspots.source.sourceWidth,
      height: hotspots.source.sourceHeight,
    },
    assets,
    hotspots: hotspots.hotspots.map((h) => ({
      hotspotId: h.hotspotId,
      subjectId: subjectIdForHotspot(h),
      kind: h.kind,
      polygon: h.polygon.map(([x, y]) => [x, y] as [number, number]),
      labelAnchor: [h.labelAnchor[0], h.labelAnchor[1]],
      pin: h.pin ? { x: h.pin.x, y: h.pin.y, rx: h.pin.rx, ry: h.pin.ry } : null,
      printedLabel: h.artworkLabel?.text ?? null,
      confidence: h.confidence,
      reviewStatus: h.reviewStatus,
    })),
    subjects: registry.subjects,
    associations: registry.associations,
  };
  return isometricArtManifestSchema.parse(manifest);
}

/**
 * Derived records of a manifest against the registry specs and the current
 * originals: every spec fully produced, nothing extra, each record pointing at
 * the CURRENT source sha256 (a changed original makes its copies stale), and
 * each file's bytes matching its sha256 (`fileSha` returns null when missing).
 */
export function validateDerived(
  manifest: IsometricArtManifest,
  registry: IsometricArtRegistry,
  fileSha: (url: string) => string | null,
): string[] {
  const problems: string[] = [];
  for (const r of registry.assets) {
    const m = manifest.assets.find((a) => a.assetId === r.assetId);
    if (!m) {
      problems.push(`manifest is missing asset ${r.assetId}`);
      continue;
    }
    const expected = r.derive.flatMap((s) => expectedDerived(r.assetId, s, m.source.width, m.source.height));
    const got = new Map(m.derived.map((d) => [d.url, d]));
    for (const e of expected) {
      const d = got.get(e.url);
      if (!d) {
        problems.push(
          `${r.assetId}: derived ${e.url} has not been produced (run npm run art:build -- --derive)`,
        );
        continue;
      }
      if (d.width !== e.width || d.height !== e.height)
        problems.push(
          `${r.assetId}: ${e.url} is ${d.width}x${d.height}, expected ${e.width}x${e.height} (uniform scale)`,
        );
      if (d.mime !== e.mime || d.purpose !== e.purpose)
        problems.push(`${r.assetId}: ${e.url} has the wrong type`);
      if (JSON.stringify(d.tile) !== JSON.stringify(e.tile))
        problems.push(`${r.assetId}: ${e.url} tile rectangle differs`);
      if (d.sourceSha256 !== m.source.sha256)
        problems.push(`${r.assetId}: ${e.url} was made from a different original (stale; re-derive)`);
      const sha = fileSha(e.url);
      if (sha === null) problems.push(`${r.assetId}: ${e.url} is missing from ${ART_PUBLIC_DIR}`);
      else if (sha !== d.sha256)
        problems.push(`${r.assetId}: ${e.url} bytes do not match the manifest sha256`);
    }
    for (const url of got.keys())
      if (!expected.some((e) => e.url === url))
        problems.push(`${r.assetId}: derived ${url} has no derive spec`);
  }
  return problems;
}

/** Every file the manifest publishes under public/isometric-art (manifest.json excluded). */
export function publishedFiles(manifest: IsometricArtManifest): string[] {
  return manifest.assets
    .flatMap((a) => [...(a.original ? [a.original.url] : []), ...a.derived.map((d) => d.url)])
    .sort();
}

// ---------------------------------------------------------------------------
// docs/LPU_ISOMETRIC_ASSET_MAPPING.md (generated)
// ---------------------------------------------------------------------------

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const code = (s: string) => `\`${s.replace(/`/g, "'")}\``;

export function renderMappingMarkdown(manifest: IsometricArtManifest): string {
  const subjects = manifest.subjects;
  const assoc = new Map(manifest.associations.map((a) => [a.subjectId, a]));
  const count = (s: string) => manifest.associations.filter((a) => a.status === s).length;
  const label = (q: LabelQuote | null) => (q ? code(q.text) : '—');
  const lines: string[] = [
    '# LPU isometric artwork: asset ↔ building mapping (draft)',
    '',
    '> **Generated** by `npm run art:build` from `data/curated/isometric-art/registry.json`. Do not edit by hand;',
    '> `npm run art:check` fails when this file is stale. Contract: [LPU_ISOMETRIC_ASSET_INTEGRATION.md](LPU_ISOMETRIC_ASSET_INTEGRATION.md).',
    '',
    'Labels are quoted **exactly as printed** (typos included). Artwork numbers and "BLOCK-…" headings are the',
    "illustration's own numbering, **never official LPU block numbers**. This table is the curated baseline only:",
    'owner decisions recorded in `/admin` (D1) override a row and are not shown here.',
    '',
    `Subjects: **${subjects.length}** — verified **${count('verified')}**, approximate (unconfirmed match) **${count('approximate')}**, unresolved **${count('unresolved')}**.`,
    '',
    '- **verified**: linked to a canonical building id with recorded owner/official evidence. None exists yet.',
    '- **approximate**: the top reviewed candidate of a lead recommended "confirm-on-site" in',
    '  `docs/research/block-leads/block-candidates.json`. Shown only as "Unconfirmed match"; never routed.',
    '- **unresolved**: no single reviewed footprint. Candidates, if any, are listed for the owner.',
    '',
    '## Numbered subjects',
    '',
    '| Subject | Artwork no. | Block heading (exact) | Display label (exact) | Hotspot | Status | Building / candidates | Reason |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const candidatesText = (subjectId: string) => {
    const a = assoc.get(subjectId);
    if (!a) return '—';
    const c = a.candidateFootprints.map((f) => `${f.buildingId} (${f.score}, ${f.shapeMatch})`).join('; ');
    if (a.status === 'unresolved') return c === '' ? '—' : `candidates: ${c}`;
    return `**${a.buildingId}**${c ? `; candidates: ${c}` : ''}`;
  };
  for (const s of subjects.filter((x) => x.kind === 'numbered')) {
    const a = assoc.get(s.subjectId);
    lines.push(
      `| ${code(s.subjectId)} | ${s.artworkNumber ?? '—'} | ${label(s.visibleBlockLabel)} | ${label(s.displayLabel)} | ${
        s.hotspotIds.join(', ') || '—'
      } | ${a?.status ?? '—'} | ${cell(candidatesText(s.subjectId))} | ${cell(a?.reason ?? '—')} |`,
    );
  }
  lines.push('', '## Scenes and other illustrated areas', '');
  lines.push('| Subject | Display label (exact) | Hotspot | Related (unverified) | Status | Reason |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const s of subjects.filter((x) => x.kind !== 'numbered')) {
    const a = assoc.get(s.subjectId);
    const shown = s.displayHold ? '*(withheld pending owner review)*' : label(s.displayLabel);
    lines.push(
      `| ${code(s.subjectId)} | ${shown} | ${s.hotspotIds.join(', ') || '—'} | ${
        s.relations.map((r) => `${r.subjectId} (${r.relation})`).join('; ') || '—'
      } | ${a?.status ?? '—'} | ${cell(a?.reason ?? '—')} |`,
    );
  }
  lines.push('', '## Assets', '');
  lines.push('| Asset | Kind | File | Published original | Derived copies | Needs manual verification |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const a of manifest.assets) {
    lines.push(
      `| ${code(a.assetId)} | ${a.kind} | ${code(a.source.originalPath)} | ${
        a.original ? code(a.original.url) : `no (duplicate of ${a.duplicateOf})`
      } | ${a.derived.length} | ${a.needsManualVerification.length} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
