import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtworkDetails } from '../../../src/components/place/ArtworkDetails.tsx';
import type { ArtworkOnlyEntry } from '../../../src/isometric-art/directory.ts';
import { publicReasonText } from '../../../src/isometric-art/text.ts';
import { renderWithAtlas, resetAppStore } from '../app/render-helpers.tsx';

const PATH = /(?:[\w.-]+\/)+[\w.-]+\.(?:json|md|ts|csv)/;

/** Every association reason in the published artwork manifest. */
function manifestReasons(): string[] {
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), 'public', 'isometric-art', 'manifest.json'), 'utf8'),
  ) as unknown;
  const out = new Set<string>();
  const walk = (o: unknown) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'reason' && typeof v === 'string') out.add(v);
      walk(v);
    }
  };
  walk(manifest);
  return [...out];
}

const CANDIDATE_REASON =
  'Reviewed candidate footprint (docs/research/block-leads/block-candidates.json, recommendation "confirm-on-site" after the 2026-10-24 adversarial review): osm:way/422437885, score 0.8, shape match strong. Not verified: it needs an on-site check or official evidence, is shown only as an unconfirmed match and is never routed.';

describe('public association reason: human text only', () => {
  it('drops research-file paths and internal field names, keeps every other word', () => {
    expect(publicReasonText(CANDIDATE_REASON)).toBe(
      'Reviewed candidate footprint (recommendation "confirm-on-site" after the 2026-10-24 adversarial review): osm:way/422437885, score 0.8, shape match strong. Not verified: it needs an on-site check or official evidence, is shown only as an unconfirmed match and is never routed.',
    );
    expect(
      publicReasonText(
        'Reviewed candidates (docs/research/block-leads/block-candidates.json) give the recommendation "ambiguous": no single footprint is supported.',
      ),
    ).toBe('Reviewed candidates give the recommendation "ambiguous": no single footprint is supported.');
    expect(
      publicReasonText(
        'The printed caption is recorded exactly, but the owner must decide whether it may be displayed (inventory needsManualVerification iso-art-103/L1).',
      ),
    ).toBe('The printed caption is recorded exactly, but the owner must decide whether it may be displayed.');
    expect(publicReasonText('Printed lettering on the illustration; not a building.')).toBe(
      'Printed lettering on the illustration; not a building.',
    );
  });

  it('no published reason keeps a file path once shown publicly', () => {
    const reasons = manifestReasons();
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.map(publicReasonText).filter((t) => PATH.test(t))).toEqual([]);
  });
});

describe('ArtworkDetails', () => {
  beforeEach(resetAppStore);
  afterEach(cleanup);

  it('shows the reason without the internal research-file path', () => {
    const entry: ArtworkOnlyEntry = {
      id: 'art:num-25',
      subjectKind: 'numbered-building',
      title: 'Illustration pin 25',
      subtitle: 'On the campus illustration',
      artworkNumber: null,
      artworkNumberNote: null,
      labels: [],
      aliases: [],
      labelWithheld: false,
      association: { status: 'approximate', reason: CANDIDATE_REASON, evidence: [] },
      unconfirmedMatch: null,
      routable: false,
      routableNote: 'Not routable.',
      location: null,
      hotspotIds: [],
      vignetteAssetIds: [],
    } as unknown as ArtworkOnlyEntry;
    renderWithAtlas(<ArtworkDetails entry={entry} />);
    expect(
      screen.getByText(/^Reviewed candidate footprint \(recommendation "confirm-on-site"/),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(PATH);
  });
});
