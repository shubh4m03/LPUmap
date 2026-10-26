/**
 * Effective artwork associations: the curated baseline (registry →
 * public/isometric-art/manifest.json) merged with the owner's decisions (D1
 * `artwork_associations`, published as GET /api/locations v3
 * `artworkAssociations`). Pure; used by the browser app and the admin app.
 *
 * Merge rule (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §4, binding):
 *  1. For every subject in the manifest: an owner decision, when present,
 *     replaces the curated baseline WHOLE (status, building, evidence). The
 *     candidate footprints always come from the curated baseline (research
 *     data, not a decision). No decision and no baseline → 'unresolved'.
 *  2. Owner decisions live in D1 only, so regenerating the curated registry
 *     never overwrites them; deleting a decision is the only way back to the
 *     baseline (audited).
 *  3. A decision for a subject the manifest does not know is an orphan: it is
 *     reported and ignored (never shown, never guessed onto another subject).
 *  4. A verified or approximate link to a building that is not in the current
 *     building set is reported and downgraded to 'unresolved' for display (the
 *     stored decision is untouched, so it comes back if the building does).
 *  5. Only 'verified' yields `buildingId` (the canonical identity join).
 *     'approximate' yields `unconfirmedMatchId` (shown as "Unconfirmed match",
 *     never routed, never an identity).
 */
import type {
  AssociationEvidence,
  AssociationStatus,
  CandidateFootprint,
  CuratedAssociation,
  PublishedArtworkAssociation,
} from './schema.ts';

export interface EffectiveArtworkAssociation {
  subjectId: string;
  status: AssociationStatus;
  /** Verified only: the canonical building id. The ONLY field that joins artwork and map identities. */
  buildingId: string | null;
  /** Approximate only: a candidate footprint, shown as "Unconfirmed match"; never routed, never an identity. */
  unconfirmedMatchId: string | null;
  evidence: AssociationEvidence[];
  candidateFootprints: CandidateFootprint[];
  /** Curated reason (owner decisions carry no public reason; their note is private). */
  reason: string | null;
  source: 'owner' | 'curated' | 'default';
  revision: number | null;
  updatedAt: string | null;
}

export type ArtworkAssociationIssueCode = 'orphan-decision' | 'building-missing' | 'duplicate-decision';

export interface ArtworkAssociationIssue {
  subjectId: string;
  code: ArtworkAssociationIssueCode;
  message: string;
}

export interface MergeArtworkAssociationsInput {
  /** Every subject id of the manifest. */
  subjectIds: readonly string[];
  baseline: readonly CuratedAssociation[];
  /** Owner decisions (publication `artworkAssociations`; absent on v1/v2 publications → []). */
  decisions: readonly PublishedArtworkAssociation[];
  /** True when the id is a building in the current campus building set (directory or studio). */
  buildingExists: (buildingId: string) => boolean;
}

export interface MergedArtworkAssociations {
  bySubject: ReadonlyMap<string, EffectiveArtworkAssociation>;
  issues: readonly ArtworkAssociationIssue[];
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function effective(
  subjectId: string,
  status: AssociationStatus,
  building: string | null,
  rest: Omit<EffectiveArtworkAssociation, 'subjectId' | 'status' | 'buildingId' | 'unconfirmedMatchId'>,
): EffectiveArtworkAssociation {
  return {
    subjectId,
    status,
    buildingId: status === 'verified' ? building : null,
    unconfirmedMatchId: status === 'approximate' ? building : null,
    ...rest,
  };
}

export function mergeArtworkAssociations(input: MergeArtworkAssociationsInput): MergedArtworkAssociations {
  const issues: ArtworkAssociationIssue[] = [];
  const known = new Set(input.subjectIds);
  const baseline = new Map(input.baseline.map((a) => [a.subjectId, a]));
  const decisions = new Map<string, PublishedArtworkAssociation>();
  for (const d of [...input.decisions].sort((a, b) => byString(a.subjectId, b.subjectId))) {
    if (!known.has(d.subjectId)) {
      issues.push({
        subjectId: d.subjectId,
        code: 'orphan-decision',
        message: 'Owner decision for an artwork subject the current registry does not contain; ignored.',
      });
      continue;
    }
    if (decisions.has(d.subjectId)) {
      issues.push({
        subjectId: d.subjectId,
        code: 'duplicate-decision',
        message: 'More than one owner decision for this subject; the highest revision is used.',
      });
      if ((decisions.get(d.subjectId)?.revision ?? 0) >= d.revision) continue;
    }
    decisions.set(d.subjectId, d);
  }

  const out = new Map<string, EffectiveArtworkAssociation>();
  for (const subjectId of [...known].sort(byString)) {
    const base = baseline.get(subjectId);
    const decision = decisions.get(subjectId);
    const candidateFootprints = base?.candidateFootprints ?? [];
    let e: EffectiveArtworkAssociation;
    if (decision) {
      e = effective(subjectId, decision.status, decision.buildingId, {
        evidence: decision.evidence,
        candidateFootprints,
        reason: null,
        source: 'owner',
        revision: decision.revision,
        updatedAt: decision.updatedAt,
      });
    } else if (base) {
      e = effective(subjectId, base.status, base.buildingId, {
        evidence: base.evidence,
        candidateFootprints,
        reason: base.reason,
        source: 'curated',
        revision: base.revision,
        updatedAt: null,
      });
    } else {
      e = effective(subjectId, 'unresolved', null, {
        evidence: [],
        candidateFootprints: [],
        reason: 'No association has been recorded for this artwork item.',
        source: 'default',
        revision: null,
        updatedAt: null,
      });
    }
    const linked = e.buildingId ?? e.unconfirmedMatchId;
    if (linked !== null && !input.buildingExists(linked)) {
      issues.push({
        subjectId,
        code: 'building-missing',
        message: `Linked building ${linked} is not in the current building set; shown as unresolved until it returns or the link is changed.`,
      });
      e = { ...e, status: 'unresolved', buildingId: null, unconfirmedMatchId: null };
    }
    out.set(subjectId, e);
  }
  return { bySubject: out, issues };
}
