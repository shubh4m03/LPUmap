/**
 * Artwork verification model (pure): subject titles and labels exactly as
 * printed, list filtering, the association form, its client-side checks
 * (mirroring the server rules in server/domain/artwork/associations.ts; the
 * server decides) and the write body.
 *
 * Binding rules carried here: printed labels are shown EXACTLY (never
 * trimmed, corrected or case-folded; double spaces kept); an artwork number
 * is never an official block number; an approximate link is only an
 * "Unconfirmed match"; nothing is inferred from position or appearance.
 */
import {
  PROHIBITED_SOURCE_MESSAGE,
  containsProhibitedSourceUrl,
  isProhibitedSourceUrl,
} from '../../../building-studio/text.ts';
import type { EVIDENCE_KINDS } from '../../../isometric-art/schema.ts';
import {
  ARTWORK_NUMBER_NOTE,
  UNCONFIRMED_MATCH_LABEL,
  type ArtSubject,
  type ArtworkAssociationWrite,
  type AssociationEvidence,
  type AssociationStatus,
  type IsometricArtManifest,
  type LabelQuote,
} from '../../../isometric-art/schema.ts';
import type { ArtworkAssociationView } from '../../api/artwork.ts';
import type { FieldErrors } from '../../ui/form-errors.ts';

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const STATUS_LABELS: Readonly<Record<AssociationStatus, string>> = {
  verified: 'Verified',
  approximate: UNCONFIRMED_MATCH_LABEL,
  unresolved: 'Unresolved',
};

export const STATUS_DESCRIPTIONS: Readonly<Record<AssociationStatus, string>> = {
  verified:
    'This illustration item IS this campus building. Needs evidence (a site sign, an official document or your own statement). Joins the map building in search and the directory.',
  approximate:
    'A likely but unchecked building. Shown only as “Unconfirmed match”, never routed and never merged with the building. Needs a private note saying why.',
  unresolved: 'Not linked to any building. The item stays on the illustration only, with no map location.',
};

export const EVIDENCE_KIND_LABELS: Readonly<Record<EvidenceKind, string>> = {
  'site-sign': 'Site sign (photo description)',
  'official-document': 'Official document (URL)',
  'owner-statement': 'Owner statement',
};

export const SOURCE_LABELS = {
  owner: 'Your decision',
  curated: 'Curated baseline',
  default: 'No record',
} as const;

export const NUMBER_NOTE = ARTWORK_NUMBER_NOTE;

/** Title of a subject in the admin: exact display label, else exact block heading, else a neutral non-name. */
export function subjectTitle(s: ArtSubject): string {
  if (s.displayHold) return `Label held for your review (${s.subjectId})`;
  if (s.displayLabel) return s.displayLabel.text;
  if (s.visibleBlockLabel) return s.visibleBlockLabel.text;
  if (s.artworkNumber !== null) return `Illustration pin ${s.artworkNumber}`;
  if (s.kind === 'scene') return `Scene vignette ${s.subjectId.slice('art:scene-'.length)}`;
  return 'Unlabelled area on the illustration';
}

export interface LabelRow {
  role: string;
  quote: LabelQuote;
}

/** Every printed label of a subject, exact, with where it comes from. */
export function subjectLabels(s: ArtSubject): LabelRow[] {
  const rows: LabelRow[] = [];
  if (s.displayLabel) rows.push({ role: 'Caption / display label', quote: s.displayLabel });
  if (s.visibleBlockLabel)
    rows.push({ role: 'Block heading (artwork numbering)', quote: s.visibleBlockLabel });
  for (const q of s.otherLabels) rows.push({ role: 'Other printed label', quote: q });
  if (s.artworkCategory) rows.push({ role: 'Index section', quote: s.artworkCategory });
  return rows;
}

export type StatusFilter = AssociationStatus | 'all' | 'mine' | 'review';

export function parseStatusFilter(query: Readonly<Record<string, string>>): StatusFilter {
  const v = query.status;
  return v === 'verified' || v === 'approximate' || v === 'unresolved' || v === 'mine' || v === 'review'
    ? v
    : 'all';
}

export interface ArtworkRow {
  subject: ArtSubject;
  view: ArtworkAssociationView | null;
  title: string;
}

/** Case-insensitive match on the exact labels, the number, the id and aliases (display only; never stored). */
function matches(row: ArtworkRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase().replace(/\s+/g, ' ').trim();
  const hay = [
    row.subject.subjectId,
    row.subject.artworkNumber ?? '',
    row.title,
    ...subjectLabels(row.subject).map((l) => l.quote.text),
    ...row.subject.aliases,
    row.view?.effective.buildingId ?? '',
    row.view?.effective.unconfirmedMatchId ?? '',
  ]
    .join('\n')
    .toLowerCase()
    .replace(/[ \t]+/g, ' ');
  return hay.includes(needle);
}

export function artworkRows(
  manifest: IsometricArtManifest,
  items: readonly ArtworkAssociationView[] | null,
): ArtworkRow[] {
  const byId = new Map((items ?? []).map((i) => [i.subjectId, i]));
  return manifest.subjects.map((s) => ({
    subject: s,
    view: byId.get(s.subjectId) ?? null,
    title: subjectTitle(s),
  }));
}

export function filterRows(rows: readonly ArtworkRow[], status: StatusFilter, q: string): ArtworkRow[] {
  return rows.filter((r) => {
    if (!matches(r, q)) return false;
    if (status === 'all') return true;
    if (status === 'mine') return r.view?.decision != null;
    if (status === 'review')
      return r.subject.needsManualVerification.length > 0 || r.subject.displayHold !== null;
    return r.view?.effective.status === status;
  });
}

export function statusCounts(rows: readonly ArtworkRow[]): Record<AssociationStatus, number> {
  const out: Record<AssociationStatus, number> = { verified: 0, approximate: 0, unresolved: 0 };
  for (const r of rows) if (r.view) out[r.view.effective.status] += 1;
  return out;
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

export interface EvidenceDraft {
  kind: EvidenceKind;
  description: string;
  url: string;
  date: string;
}

export interface AssociationFormValues {
  status: AssociationStatus;
  buildingId: string;
  evidence: EvidenceDraft[];
  note: string;
}

export const emptyEvidence = (kind: EvidenceKind = 'site-sign', today = ''): EvidenceDraft => ({
  kind,
  description: '',
  url: '',
  date: today,
});

const draftOf = (e: AssociationEvidence): EvidenceDraft => ({
  kind: e.kind,
  description: e.description,
  url: e.url ?? '',
  date: e.date,
});

/**
 * Initial form: the owner's decision when there is one; otherwise the
 * effective (curated) status and building, with no evidence and no note — so
 * saving unchanged values records the curated link as the owner's own.
 */
export function formFrom(view: ArtworkAssociationView): AssociationFormValues {
  const d = view.decision;
  if (d) {
    return {
      status: d.status,
      buildingId: d.buildingId ?? '',
      evidence: d.evidence.map(draftOf),
      note: d.note ?? '',
    };
  }
  const e = view.effective;
  return {
    status: e.status,
    buildingId: e.buildingId ?? e.unconfirmedMatchId ?? view.baseline?.buildingId ?? '',
    evidence: [],
    note: '',
  };
}

export function sameForm(a: AssociationFormValues, b: AssociationFormValues): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const isHttpUrl = (s: string) => {
  try {
    const u = new URL(s);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
  } catch {
    return false;
  }
};

const isRealDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/**
 * Client-side checks with the server's field paths (evidence, evidence.N.*,
 * note, buildingId). The server re-checks everything, including that the
 * building is a current campus building.
 */
export function validateAssociationForm(
  v: AssociationFormValues,
  opts: { today: string; buildingKnown(id: string): boolean },
): FieldErrors {
  const errors: Record<string, string> = {};
  const building = v.buildingId.trim();
  if (v.status === 'unresolved') {
    if (v.evidence.length > 0)
      errors.evidence = 'An unresolved link carries no evidence. Remove it or pick a building.';
  } else if (!building) {
    errors.buildingId = 'Choose the campus building.';
  } else if (!opts.buildingKnown(building)) {
    errors.buildingId = `${building} is not a campus building in the current dataset.`;
  }
  if (v.status === 'verified' && v.evidence.length === 0)
    errors.evidence = 'Verification needs evidence: a site sign, an official document or your own statement.';
  v.evidence.forEach((e, i) => {
    if (e.description.trim().length < 3)
      errors[`evidence.${i}.description`] = 'Describe the evidence (at least 3 characters).';
    else if (containsProhibitedSourceUrl(e.description))
      errors[`evidence.${i}.description`] = PROHIBITED_SOURCE_MESSAGE;
    if (e.kind === 'official-document' && !e.url.trim())
      errors[`evidence.${i}.url`] = 'Official-document evidence needs the document URL.';
    else if (e.url.trim() && !isHttpUrl(e.url.trim())) errors[`evidence.${i}.url`] = 'Enter an http(s) URL.';
    else if (e.url.trim() && isProhibitedSourceUrl(e.url.trim()))
      errors[`evidence.${i}.url`] = PROHIBITED_SOURCE_MESSAGE;
    if (!isRealDate(e.date)) errors[`evidence.${i}.date`] = 'Enter the date (YYYY-MM-DD).';
    else if (e.date > opts.today) errors[`evidence.${i}.date`] = 'The date cannot be in the future.';
  });
  if (v.status === 'approximate' && !v.note.trim())
    errors.note = 'Say why this is only approximate (private note).';
  if (v.note.trim().length > 1000) errors.note = 'At most 1000 characters.';
  return errors;
}

/** The PUT body (strict contract schema). Unresolved never sends a building or evidence. */
export function associationWriteBody(
  v: AssociationFormValues,
  expectedRevision: number | null,
): ArtworkAssociationWrite {
  const note = v.note.trim();
  const unresolved = v.status === 'unresolved';
  return {
    expectedRevision,
    status: v.status,
    buildingId: unresolved ? null : v.buildingId.trim(),
    evidence: unresolved
      ? []
      : v.evidence.map((e) => ({
          kind: e.kind,
          description: e.description.trim(),
          ...(e.url.trim() ? { url: e.url.trim() } : {}),
          date: e.date,
        })),
    note: note ? note : null,
  };
}

/** Server issues (`evidence.0.url`, `note`, …) as form field errors. */
export function issuesToFieldErrors(issues: readonly { path: string; message: string }[]): FieldErrors {
  const out: Record<string, string> = {};
  for (const i of issues) if (!(i.path in out)) out[i.path] = i.message;
  return out;
}

/** The server's UTC calendar date as YYYY-MM-DD (evidence dates may not be later). */
export const todayUtc = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** Associations (verified or unconfirmed) that point at any of the ids. Pure. */
export function linksForBuildings(
  items: readonly ArtworkAssociationView[],
  buildingIds: readonly string[],
): ArtworkAssociationView[] {
  const ids = new Set(buildingIds);
  return items.filter((i) => {
    const b = i.effective.buildingId ?? i.effective.unconfirmedMatchId;
    return b !== null && ids.has(b);
  });
}
