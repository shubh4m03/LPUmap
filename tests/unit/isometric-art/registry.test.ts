// @vitest-environment node
/**
 * The committed registry and published manifest (Gate 1: assets present and
 * unchanged in a fresh checkout; exact labels; no fabricated links). Runs on
 * the real files with no Chromium, plus deliberate breakages.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ART_HOTSPOTS_PATH, type ArtHotspots } from '../../../scripts/lib/art-hotspots-check.ts';
import {
  ART_INVENTORY_PATH,
  VERBATIM_LABELS,
  type ArtInventory,
} from '../../../scripts/lib/art-inventory-check.ts';
import {
  ART_MANIFEST_PATH,
  ART_PUBLIC_DIR,
  ART_REGISTRY_PATH,
  buildArtManifest,
  expectedDerived,
  publishedFiles,
  validateArtRegistry,
  validateDerived,
  type BlockCandidateLead,
} from '../../../scripts/lib/art-registry-check.ts';
import {
  isometricArtManifestSchema,
  type IsometricArtManifest,
  type IsometricArtRegistry,
  type ManifestDerived,
} from '../../../src/isometric-art/schema.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const json = (p: string): unknown => JSON.parse(readFileSync(join(root, p), 'utf8'));
const sha = (p: string) =>
  createHash('sha256')
    .update(readFileSync(join(root, p)))
    .digest('hex');
const inventory = json(ART_INVENTORY_PATH) as ArtInventory;
const hotspots = json(ART_HOTSPOTS_PATH) as ArtHotspots;
const candidates = json('docs/research/block-leads/block-candidates.json') as BlockCandidateLead[];
const registryRaw = json(ART_REGISTRY_PATH) as IsometricArtRegistry;
const manifest = isometricArtManifestSchema.parse(json(ART_MANIFEST_PATH));
const buildings = json('public/data/buildings.geojson') as {
  features: { properties: { id: string; inCampusInventory?: boolean } }[];
};
const campusIds = new Set(
  buildings.features.filter((f) => f.properties.inCampusInventory).map((f) => f.properties.id),
);

const validate = (raw: unknown) =>
  validateArtRegistry(raw, inventory, hotspots, candidates, campusIds).problems;
const clone = (): IsometricArtRegistry => structuredClone(registryRaw);
const subject = (r: IsometricArtRegistry, id: string) => {
  const s = r.subjects.find((x) => x.subjectId === id);
  if (!s) throw new Error(`no ${id}`);
  return s;
};

describe('registry (data/curated/isometric-art/registry.json)', () => {
  it('passes every cross-check against the inventory, hotspots, reviewed candidates and campus buildings', () => {
    expect(validate(registryRaw)).toEqual([]);
  });

  it('has one subject per artwork number, scene vignette and non-pin hotspot; every hotspot has one owner', () => {
    const kinds = (k: string) => registryRaw.subjects.filter((s) => s.kind === k).length;
    expect(kinds('numbered')).toBe(inventory.artworkNumbers.length);
    expect(kinds('scene')).toBe(7);
    expect(kinds('area')).toBe(hotspots.hotspots.filter((h) => h.kind !== 'pin-structure').length);
    const owned = registryRaw.subjects.flatMap((s) => s.hotspotIds).sort();
    expect(owned).toEqual(hotspots.hotspots.map((h) => h.hotspotId).sort());
  });

  it('records no verified link (no owner/official evidence exists) and approximate only for reviewed confirm-on-site leads', () => {
    expect(registryRaw.associations.filter((a) => a.status === 'verified')).toEqual([]);
    const confirm = new Set(
      candidates.filter((c) => c.recommendation === 'confirm-on-site').map((c) => c.block),
    );
    for (const a of registryRaw.associations.filter((x) => x.status === 'approximate')) {
      const n = subject(registryRaw, a.subjectId).artworkNumber;
      expect(n !== null && confirm.has(n), a.subjectId).toBe(true);
      expect(a.buildingId).toBe(a.candidateFootprints[0]?.buildingId);
      expect(a.reason).toMatch(/Not verified/);
    }
    expect(registryRaw.associations.filter((a) => a.status === 'approximate')).toHaveLength(confirm.size);
  });

  it('keeps printed labels exactly (typos stay in labels; corrections only in aliases)', () => {
    const s55 = subject(registryRaw, 'art:num-55');
    expect(s55.displayLabel?.text).toBe('SCHOOL OF MECHANICAL INGNEERING');
    expect(s55.visibleBlockLabel?.text).toBe('BLOCK- 55');
    expect(s55.aliases).toContain('SCHOOL OF MECHANICAL ENGINEERING');
    expect(subject(registryRaw, 'art:num-2').displayLabel?.text).toBe('CAMPUS CAFE  & BALDEV RAJ AUDITORIUM');
    const labels = registryRaw.subjects.flatMap((s) =>
      [s.displayLabel, s.visibleBlockLabel, ...s.otherLabels].filter((q) => q !== null).map((q) => q.text),
    );
    for (const alias of registryRaw.subjects.flatMap((s) => s.aliases)) expect(labels).not.toContain(alias);
  });

  it('withholds the label the owner must rule on, without altering it', () => {
    const s = subject(registryRaw, 'art:scene-103');
    expect(s.displayLabel?.text).toBe('DILDO PARK');
    expect(s.displayHold).not.toBeNull();
    expect(s.aliases).toEqual([]);
  });

  it('never chooses a display label when the printed sources disagree', () => {
    expect(subject(registryRaw, 'art:num-20').displayLabel).toBeNull();
    expect(subject(registryRaw, 'art:num-20').otherLabels.map((q) => q.text)).toEqual([
      'FILM & JOURNALISM',
      'LAW',
    ]);
  });

  describe('rejects', () => {
    it('a silently corrected label', () => {
      const r = clone();
      subject(r, 'art:num-55').displayLabel!.text = 'SCHOOL OF MECHANICAL ENGINEERING';
      expect(validate(r).join('\n')).toMatch(
        /art:num-55 displayLabel: .* is not exactly label iso-art-083\/L2/,
      );
    });

    it('a quote of a transcription placeholder', () => {
      const r = clone();
      subject(r, 'art:num-58').otherLabels.push({ ref: 'iso-art-001/L25', text: '(blank)' });
      expect(validate(r).join('\n')).toMatch(/placeholder/);
    });

    it('any "official…" key', () => {
      const r = clone() as unknown as { subjects: Record<string, unknown>[] };
      r.subjects[0]!.officialBlockNumber = '1';
      expect(validate(r).join('\n')).toMatch(/official/i);
    });

    it('an approximate link that is not a reviewed candidate, or for a lead not recommended for a site check', () => {
      const r = clone();
      const a = r.associations.find((x) => x.subjectId === 'art:num-25')!;
      a.buildingId = 'osm:way/422437887';
      expect(validate(r).join('\n')).toMatch(/one of the reviewed candidate footprints/);
      const r2 = clone();
      const b = r2.associations.find((x) => x.subjectId === 'art:num-9')!;
      b.status = 'approximate';
      b.buildingId = b.candidateFootprints[0]!.buildingId;
      expect(validate(r2).join('\n')).toMatch(/confirm-on-site/);
    });

    it('edited candidate scores, unknown buildings, a hotspot owned twice and a missing association', () => {
      const r = clone();
      r.associations.find((x) => x.subjectId === 'art:num-25')!.candidateFootprints[0]!.score = 0.99;
      expect(validate(r).join('\n')).toMatch(/differ from the reviewed candidates/);
      const r2 = clone();
      subject(r2, 'art:num-26').hotspotIds.push('hs-pin-25');
      expect(validate(r2).join('\n')).toMatch(/hs-pin-25/);
      const r3 = clone();
      r3.associations = r3.associations.filter((x) => x.subjectId !== 'art:num-1');
      expect(validate(r3).join('\n')).toMatch(/art:num-1: no association record/);
      const problems = validateArtRegistry(registryRaw, inventory, hotspots, candidates, new Set()).problems;
      expect(problems.join('\n')).toMatch(/is not a campus building/);
    });

    it('a published duplicate or a derived spec on a duplicate', () => {
      const r = clone();
      const dup = r.assets.find((a) => a.assetId === 'iso-art-115')!;
      dup.publishOriginal = true;
      expect(validate(r).join('\n')).toMatch(/publishOriginal/);
    });
  });
});

describe('published manifest (public/isometric-art/manifest.json)', () => {
  it('is exactly what the build produces from the committed inputs (not stale)', () => {
    const { registry } = validateArtRegistry(registryRaw, inventory, hotspots, candidates, campusIds);
    const rebuilt = buildArtManifest({
      registry: registry!,
      inventory,
      hotspots,
      sha256: {
        registry: sha(ART_REGISTRY_PATH),
        inventory: sha(ART_INVENTORY_PATH),
        hotspots: sha(ART_HOTSPOTS_PATH),
      },
      derived: new Map(manifest.assets.map((a) => [a.assetId, a.derived])),
    });
    expect(rebuilt).toEqual(manifest);
  });

  it('publishes every canonical original byte-identical under its original file name, and nothing for the duplicate', () => {
    const files = publishedFiles(manifest);
    expect(files.filter((f) => f.startsWith('original/'))).toHaveLength(28);
    for (const a of manifest.assets) {
      if (!a.original) {
        expect(a.assetId).toBe('iso-art-115');
        expect(
          existsSync(join(root, ART_PUBLIC_DIR, 'original', a.source.originalPath.split('/').pop()!)),
        ).toBe(false);
        continue;
      }
      expect(a.original.url).toBe(`original/${a.source.originalPath.split('/').pop()}`);
      const copy = join(ART_PUBLIC_DIR, a.original.url);
      expect(sha(copy), copy).toBe(a.source.sha256);
      expect(sha(a.source.originalPath), a.source.originalPath).toBe(a.source.sha256);
    }
    const master = manifest.assets.find((a) => a.assetId === 'iso-art-001')!;
    expect(master.source).toMatchObject({ width: 3371, height: 2384, mime: 'image/jpeg' });
    expect(manifest.coordinateSpace).toEqual({ assetId: 'iso-art-001', width: 3371, height: 2384 });
  });

  it('carries every verbatim label exactly and no transcription placeholder', () => {
    const texts = manifest.assets.flatMap((a) => a.labels.map((l) => l.text));
    for (const v of VERBATIM_LABELS)
      expect(
        texts.some((t) => t === v || t.includes(v)),
        v,
      ).toBe(true);
    expect(texts).not.toContain('(illegible)');
    expect(texts).not.toContain('(blank)');
  });

  it('gives every hotspot its subject and keeps the needs-review flag', () => {
    const subjects = new Set(manifest.subjects.map((s) => s.subjectId));
    for (const h of manifest.hotspots) expect(subjects.has(h.subjectId), h.hotspotId).toBe(true);
    expect(manifest.hotspots.find((h) => h.hotspotId === 'hs-pin-25')?.subjectId).toBe('art:num-25');
    expect(manifest.hotspots.filter((h) => h.reviewStatus === 'needs-manual-verification').length).toBe(
      hotspots.hotspots.filter((h) => h.reviewStatus === 'needs-manual-verification').length,
    );
  });
});

describe('derived copies (contract for --derive)', () => {
  const W = 3371;
  const H = 2384;

  it('plans uniform scales: full size, a width-capped preview, and a pyramid that tiles each level exactly', () => {
    expect(
      expectedDerived('iso-art-001', { purpose: 'web-full', format: 'image/webp', quality: 0.9 }, W, H),
    ).toEqual([
      {
        purpose: 'web-full',
        url: 'derived/iso-art-001/web-full.webp',
        width: W,
        height: H,
        mime: 'image/webp',
      },
    ]);
    const [p] = expectedDerived(
      'iso-art-001',
      { purpose: 'preview', format: 'image/jpeg', quality: 0.85, maxWidth: 1600 },
      W,
      H,
    );
    expect(p).toMatchObject({ width: 1600, height: Math.round((H * 1600) / W) });
    const tiles = expectedDerived(
      'iso-art-001',
      { purpose: 'tiles', format: 'image/webp', quality: 0.9, tileSize: 512, levels: 3 },
      W,
      H,
    );
    for (const level of [0, 1, 2]) {
      const t = tiles.filter((x) => x.tile?.level === level);
      const lw = Math.ceil(W / 2 ** level);
      const lh = Math.ceil(H / 2 ** level);
      const cols = Math.ceil(lw / 512);
      const rows = Math.ceil(lh / 512);
      expect(t).toHaveLength(cols * rows);
      expect(t.filter((x) => x.tile?.row === 0).reduce((s, x) => s + x.width, 0)).toBe(lw);
      expect(t.filter((x) => x.tile?.col === 0).reduce((s, x) => s + x.height, 0)).toBe(lh);
      const area = t.reduce((s, x) => s + (x.tile?.nw ?? 0) * (x.tile?.nh ?? 0), 0);
      expect(area).toBeCloseTo(1, 9);
    }
  });

  it('flags a missing, stale, resized or unrecorded derived copy', () => {
    const reg = clone();
    reg.assets.find((a) => a.assetId === 'iso-art-001')!.derive = [
      { purpose: 'preview', format: 'image/jpeg', quality: 0.85, maxWidth: 1600 },
    ];
    const m: IsometricArtManifest = structuredClone(manifest);
    const master = m.assets.find((a) => a.assetId === 'iso-art-001')!;
    expect(validateDerived(m, reg, () => null).join('\n')).toMatch(/has not been produced/);
    const good: ManifestDerived = {
      purpose: 'preview',
      url: 'derived/iso-art-001/preview-1600.jpg',
      sha256: 'a'.repeat(64),
      sourceSha256: master.source.sha256,
      bytes: 10,
      width: 1600,
      height: Math.round((H * 1600) / W),
      mime: 'image/jpeg',
    };
    master.derived = [good];
    expect(validateDerived(m, reg, () => 'a'.repeat(64))).toEqual([]);
    expect(validateDerived(m, reg, () => null).join('\n')).toMatch(/is missing/);
    expect(validateDerived(m, reg, () => 'b'.repeat(64)).join('\n')).toMatch(/bytes do not match/);
    master.derived = [{ ...good, sourceSha256: 'c'.repeat(64) }];
    expect(validateDerived(m, reg, () => 'a'.repeat(64)).join('\n')).toMatch(/stale/);
    master.derived = [{ ...good, height: 900 }];
    expect(validateDerived(m, reg, () => 'a'.repeat(64)).join('\n')).toMatch(/uniform scale/);
    master.derived = [good, { ...good, url: 'derived/iso-art-001/extra.jpg' }];
    expect(validateDerived(m, reg, () => 'a'.repeat(64)).join('\n')).toMatch(/no derive spec/);
  });
});
